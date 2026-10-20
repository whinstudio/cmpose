'use strict';
const path = require('path');
const fs = require('fs-extra');
const { kindOf } = require('../markerBlocks');

// The backend template's optional parts (cmpose:<option>: sharing, sample), resolved exactly as the template's
// tools/resolve-markers.sh <dir> <option> on|off does (the gate's reference), so a generated project is byte for byte
// what the template's gate built and tested:
//   on:  only the marker lines go; a swap marker goes and the line after it stays.
//   off: each marked block goes with its markers, a swap marker's text replaces the line after it (at that line's
//        indentation), the paths of tools/<option>-paths.txt go, and so do the Kotlin imports the rest no longer names.
// Either way a blank line on both sides of a dropped run becomes one. Files are read as latin1, so bytes round-trip.
// A run sees only its own option's markers (another option's marker lines are plain text, so blocks of different
// options may nest), except that the line after a swap may not be a marker of any option. The generator runs
// sharing first, then sample.

const OPTION_RE = /^[a-z]+$/;
const pathsFileOf = (tag) => path.join('tools', `${tag}-paths.txt`);
// The resolver's own tools (with every tools/*-paths.txt), which a generated project has no use for
const RESOLVER_TOOLS = ['resolve-markers.sh', 'resolve-markers.test.sh'];
const PATHS_FILE_RE = /-paths\.txt$/;
// The directories the resolver never enters, at any depth
const PRUNED = new Set(['.git', 'build', '.gradle', '.kotlin', '.local-server', 'node_modules']);
const COMMENTS = { slash: '//', dash: '--', hash: '#' };
// Every marker comment style, for what a swap must not stand before
const ANY_STYLE = ['//', '--', '#', '<!--'];
const IMPORT_RE = /^import[ \t]+[A-Za-z0-9_.`]+([ \t]+as[ \t]+[A-Za-z0-9_`]+)?[ \t]*$/;
const WORD = /[A-Za-z0-9_]/;

// awk's trim: spaces and tabs at the start; spaces, tabs and \r at the end
const trim = (s) => s.replace(/^[ \t]+/, '').replace(/[ \t\r]+$/, '');

function formsOf(kind, tag) {
    if (kind === 'xml') return { open: `<!-- cmpose:${tag} -->`, close: `<!-- /cmpose:${tag} -->`, swap: '', prefix: '<!--' };
    const c = COMMENTS[kind];
    return { open: `${c} cmpose:${tag}`, close: `${c} /cmpose:${tag}`, swap: `${c} cmpose:${tag}-off: `, prefix: c };
}

// A line that looks like a marker of this option (cmpose:<tag> not followed by a letter) but is none of the known forms
function malformed(t, prefix, tag) {
    if (!t.startsWith(prefix)) return false;
    const rest = t.slice(prefix.length).replace(/^[ \t]*\/?/, '');
    const marker = `cmpose:${tag}`;
    return rest.startsWith(marker) && !/[a-z]/.test(rest.charAt(marker.length));
}

// A line that looks like a marker of any option, in any comment style
const anyMarker = (t) => ANY_STYLE.some((style) => t.startsWith(style)
    && t.slice(style.length).replace(/^[ \t]*\/?/, '').startsWith('cmpose:'));

// Whether the code names <name> as a whole word
function names(code, name) {
    for (let at = code.indexOf(name); at >= 0; at = code.indexOf(name, at + 1)) {
        const before = at > 0 ? code[at - 1] : '';
        const after = code[at + name.length] || '';
        if (!WORD.test(before) && !WORD.test(after)) return true;
    }
    return false;
}

// The Kotlin imports (star imports aside) whose simple name or alias the rest of the file no longer names
function dropUnusedImports(lines) {
    const code = lines.filter((l) => !IMPORT_RE.test(l)).map((l) => `${l}\n`).join('');
    return lines.filter((line) => {
        if (!IMPORT_RE.test(line) || /\.\*[ \t]*$/.test(line)) return true;
        let name = trim(line);
        name = /[ \t]as[ \t]/.test(name) ? name.replace(/^.*[ \t]as[ \t]+/, '') : name.replace(/^.*\./, '');
        return names(code, name.replace(/`/g, ''));
    });
}

/** One file's content with the markers of one option (tag) resolved (enabled = on); throws `<file>:<line>: <problem>`
 * on a marker error */
function resolveContent(content, kind, enabled, { file = 'file', kotlin = false, tag = 'sharing' } = {}) {
    const { open, close, swap, prefix } = formsOf(kind, tag);
    const lines = content.split('\n');
    if (content.endsWith('\n')) lines.pop();
    const die = (message, at) => { throw new Error(`${file}:${at}: ${message}`); };
    const out = [];
    let inside = false;
    let opened = 0;
    let dropped = false;
    let joining = false;
    const emit = (s) => {
        if (dropped) { joining = true; dropped = false; }
        if (joining) {
            if (s === '' && out.length && out[out.length - 1] === '') return;
            joining = false;
        }
        out.push(s);
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = trim(line);
        if (t === open) {
            if (inside) die(`nested cmpose:${tag} block (open since line ${opened})`, i + 1);
            inside = true; opened = i + 1; dropped = true;
            continue;
        }
        if (t === close) {
            if (!inside) die('block close without an open', i + 1);
            inside = false; dropped = true;
            continue;
        }
        if (inside && !enabled) continue;
        if (swap && t.startsWith(swap)) {
            if (i === lines.length - 1) die(`cmpose:${tag}-off marker on the last line`, i + 1);
            let next = lines[i + 1];
            const nt = trim(next);
            if (nt === open || nt === close || malformed(nt, prefix, tag) || anyMarker(nt)) {
                die(`cmpose:${tag}-off marker before a marker`, i + 1);
            }
            if (!enabled) next = next.match(/^[ \t]*/)[0] + t.slice(swap.length);
            i++;
            emit(next);
            continue;
        }
        if (malformed(t, prefix, tag)) die(`malformed cmpose marker: ${t}`, i + 1);
        emit(line);
    }
    if (inside) die(`unclosed cmpose:${tag} block`, opened);
    const kept = kotlin && !enabled ? dropUnusedImports(out) : out;
    return kept.map((l) => `${l}\n`).join('');
}

// Every file below dir outside the pruned directories, as paths relative to dir
async function listFiles(dir, rel = '', out = []) {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        if (PRUNED.has(entry.name)) continue;
        const r = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) await listFiles(dir, r, out);
        else if (entry.isFile()) out.push(r);
    }
    return out;
}

// The option-only paths: relative, inside the project
async function readOptionPaths(projectDir, pathsFile) {
    const paths = [];
    for (const raw of (await fs.readFile(path.join(projectDir, pathsFile), 'utf8')).split('\n')) {
        const p = raw.replace(/\r$/, '');
        if (p === '' || p.startsWith('#')) continue;
        const slashed = `/${p}/`;
        if (slashed.startsWith('//') || slashed.includes('/../') || slashed.includes('/./')) {
            throw new Error(`${pathsFile}: '${p}' must be a relative path inside the project`);
        }
        paths.push(p);
    }
    return paths;
}

/** Resolves the cmpose:<tag> markers of a template copy in place and, when off, deletes the paths of
 * tools/<tag>-paths.txt. Only the files holding a marker of this option are resolved. The paths file must exist in
 * either mode, and every file is resolved before any is written, so an error leaves the directory as it was. */
async function applyMarkerOption(projectDir, tag, enabled) {
    if (typeof tag !== 'string' || !OPTION_RE.test(tag)) throw new Error(`option must be lowercase letters: ${JSON.stringify(tag)}`);
    const pathsFile = pathsFileOf(tag);
    if (!(await fs.pathExists(path.join(projectDir, pathsFile)))) throw new Error(`${pathsFile.split(path.sep).join('/')} is missing`);
    // the resolver's file pick: cmpose:<tag> not followed by a letter
    const own = new RegExp(`cmpose:${tag}([^a-z]|$)`, 'm');
    const results = [];
    for (const rel of await listFiles(projectDir)) {
        const kind = kindOf(rel);
        if (!kind) continue;
        const file = path.join(projectDir, rel);
        const content = await fs.readFile(file, 'latin1');
        if (!own.test(content)) continue;
        const kotlin = rel.endsWith('.kt') || rel.endsWith('.kts');
        results.push({ file, content: resolveContent(content, kind, enabled, { file: rel, kotlin, tag }) });
    }
    const optionPaths = enabled ? [] : await readOptionPaths(projectDir, pathsFile);
    // writeFile keeps an existing file's mode
    for (const { file, content } of results) await fs.writeFile(file, content, 'latin1');
    for (const p of optionPaths) await fs.remove(path.join(projectDir, p));
    return { resolvedFiles: results.length, removedPaths: optionPaths };
}

const applySharingOption = (projectDir, enabled) => applyMarkerOption(projectDir, 'sharing', enabled);
const applySampleOption = (projectDir, enabled) => applyMarkerOption(projectDir, 'sample', enabled);

/** Deletes the resolver's own tools: tools/resolve-markers.sh, tools/resolve-markers.test.sh and every tools/*-paths.txt */
async function removeResolverTools(projectDir) {
    const tools = path.join(projectDir, 'tools');
    const names = (await fs.pathExists(tools)) ? await fs.readdir(tools) : [];
    for (const name of [...RESOLVER_TOOLS, ...names.filter((n) => PATHS_FILE_RE.test(n))]) await fs.remove(path.join(tools, name));
}

module.exports = { applyMarkerOption, applySharingOption, applySampleOption, removeResolverTools, resolveContent, PRUNED };
