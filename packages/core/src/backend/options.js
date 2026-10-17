'use strict';
const path = require('path');
const fs = require('fs-extra');
const { kindOf } = require('../markerBlocks');

// The backend template's sharing part, resolved exactly as the template's tools/resolve-markers.sh does (the gate's
// reference), so a generated project is byte for byte what the template's gate built and tested:
//   on:  only the marker lines go; a swap marker goes and the line after it stays.
//   off: each marked block goes with its markers, a swap marker's text replaces the line after it (at that line's
//        indentation), the paths of tools/sharing-paths.txt go, and so do the Kotlin imports the rest no longer names.
// Either way a blank line on both sides of a dropped run becomes one. Files are read as latin1, so bytes round-trip.

const TAG = 'sharing';
const PATHS_FILE = path.join('tools', 'sharing-paths.txt');
// The resolver's own tools, which a generated project has no use for
const RESOLVER_TOOLS = ['sharing-paths.txt', 'resolve-markers.sh', 'resolve-markers.test.sh'];
// The directories the resolver never enters, at any depth
const PRUNED = new Set(['.git', 'build', '.gradle', '.kotlin', '.local-server', 'node_modules']);
const COMMENTS = { slash: '//', dash: '--', hash: '#' };
const IMPORT_RE = /^import[ \t]+[A-Za-z0-9_.`]+([ \t]+as[ \t]+[A-Za-z0-9_`]+)?[ \t]*$/;
const WORD = /[A-Za-z0-9_]/;

// awk's trim: spaces and tabs at the start; spaces, tabs and \r at the end
const trim = (s) => s.replace(/^[ \t]+/, '').replace(/[ \t\r]+$/, '');

function formsOf(kind) {
    if (kind === 'xml') return { open: `<!-- cmpose:${TAG} -->`, close: `<!-- /cmpose:${TAG} -->`, swap: '', prefix: '<!--' };
    const c = COMMENTS[kind];
    return { open: `${c} cmpose:${TAG}`, close: `${c} /cmpose:${TAG}`, swap: `${c} cmpose:${TAG}-off: `, prefix: c };
}

// A line that looks like a marker but is none of the known forms
function malformed(t, prefix) {
    if (!t.startsWith(prefix)) return false;
    return t.slice(prefix.length).replace(/^[ \t]*\/?/, '').startsWith('cmpose:');
}

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

/** One file's content resolved (enabled = on); throws `<file>:<line>: <problem>` on a marker error */
function resolveContent(content, kind, enabled, { file = 'file', kotlin = false } = {}) {
    const { open, close, swap, prefix } = formsOf(kind);
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
            if (inside) die(`nested cmpose:${TAG} block (open since line ${opened})`, i + 1);
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
            if (i === lines.length - 1) die(`cmpose:${TAG}-off marker on the last line`, i + 1);
            let next = lines[i + 1];
            const nt = trim(next);
            if (nt === open || nt === close || malformed(nt, prefix)) die(`cmpose:${TAG}-off marker before a marker`, i + 1);
            if (!enabled) next = next.match(/^[ \t]*/)[0] + t.slice(swap.length);
            i++;
            emit(next);
            continue;
        }
        if (malformed(t, prefix)) die(`malformed cmpose marker: ${t}`, i + 1);
        emit(line);
    }
    if (inside) die(`unclosed cmpose:${TAG} block`, opened);
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

// The sharing-only paths: relative, inside the project
async function readSharingPaths(projectDir) {
    const file = path.join(projectDir, PATHS_FILE);
    if (!(await fs.pathExists(file))) throw new Error(`${PATHS_FILE} is missing`);
    const paths = [];
    for (const raw of (await fs.readFile(file, 'utf8')).split('\n')) {
        const p = raw.replace(/\r$/, '');
        if (p === '' || p.startsWith('#')) continue;
        const slashed = `/${p}/`;
        if (slashed.startsWith('//') || slashed.includes('/../') || slashed.includes('/./')) {
            throw new Error(`${PATHS_FILE}: '${p}' must be a relative path inside the project`);
        }
        paths.push(p);
    }
    return paths;
}

/** Resolves the sharing markers of a fresh template copy in place, then drops the resolver's own tools. Every file is
 * resolved before any is written, so a marker error leaves the directory as it was. */
async function applySharingOption(projectDir, enabled) {
    const results = [];
    for (const rel of await listFiles(projectDir)) {
        const kind = kindOf(rel);
        if (!kind) continue;
        const file = path.join(projectDir, rel);
        const content = await fs.readFile(file, 'latin1');
        if (!content.includes('cmpose:')) continue;
        const kotlin = rel.endsWith('.kt') || rel.endsWith('.kts');
        results.push({ file, content: resolveContent(content, kind, enabled, { file: rel, kotlin }) });
    }
    const sharingPaths = enabled ? [] : await readSharingPaths(projectDir);
    // writeFile keeps an existing file's mode
    for (const { file, content } of results) await fs.writeFile(file, content, 'latin1');
    for (const p of sharingPaths) await fs.remove(path.join(projectDir, p));
    for (const tool of RESOLVER_TOOLS) await fs.remove(path.join(projectDir, 'tools', tool));
    return { resolvedFiles: results.length, removedPaths: sharingPaths };
}

module.exports = { applySharingOption, resolveContent, PRUNED };
