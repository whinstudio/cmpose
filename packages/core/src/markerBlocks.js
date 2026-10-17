'use strict';
const path = require('path');

// The cmpose:<tag> marker blocks a template wraps around an optional part (the CMP template's backend, the backend
// template's sharing). Off drops each block, on drops only the marker lines.

const COMMENTS = { slash: '//', dash: '--', hash: '#' };
// html: the CMP template's name for the xml form
const XML_KINDS = new Set(['xml', 'html']);

// The backend template's marker form by file name (the CMP backend option keeps its own table)
const KIND_BY_EXTENSION = {
    '.kt': 'slash', '.kts': 'slash',
    '.sql': 'dash',
    '.yml': 'hash', '.yaml': 'hash', '.toml': 'hash', '.properties': 'hash',
    '.md': 'xml'
};
const KIND_BY_NAME = { '.gitignore': 'hash', '.env.example': 'hash', '.dockerignore': 'hash' };

function markersOf(kind, tag) {
    if (XML_KINDS.has(kind)) return { open: `<!-- cmpose:${tag} -->`, close: `<!-- /cmpose:${tag} -->` };
    const comment = COMMENTS[kind];
    if (!comment) throw new Error(`unknown marker kind: ${kind}`);
    return { open: `${comment} cmpose:${tag}`, close: `${comment} /cmpose:${tag}` };
}

// Off: drops each marked block with its marker lines; on: drops only the marker lines. Either way a blank
// line on both sides of a dropped run becomes one (blank runs elsewhere stay).
function removeMarkedBlocks(content, kind, keep, tag = 'backend') {
    const { open, close } = markersOf(kind, tag);
    const out = [];
    const joins = [];
    let inside = false;
    let dropped = false;
    for (const line of content.split('\n')) {
        const t = line.trim();
        if (t === open) {
            if (inside) throw new Error(`nested ${open}`);
            inside = true;
            dropped = true;
            continue;
        }
        if (t === close) {
            if (!inside) throw new Error(`stray ${close}`);
            inside = false;
            dropped = true;
            continue;
        }
        if (inside && !keep) continue;
        if (dropped) joins.push(out.length);
        dropped = false;
        out.push(line);
    }
    if (inside) throw new Error(`unclosed cmpose:${tag} block`);
    if (dropped) joins.push(out.length);
    return collapseBlankRuns(out, joins).join('\n');
}

// At each join (the index of the first line after a dropped run), blank lines that follow a blank line go
function collapseBlankRuns(lines, joins) {
    const drop = new Set();
    for (const join of joins) {
        if (join === 0 || lines[join - 1] !== '') continue;
        for (let i = join; i < lines.length && lines[i] === ''; i++) drop.add(i);
    }
    return lines.filter((_, i) => !drop.has(i));
}

// Off: the line after a swap marker becomes the marker's text at that line's indentation; on: the marker goes
function applySwapMarkers(content, keep, tag = 'backend', kind = 'slash') {
    const comment = COMMENTS[kind];
    if (!comment) throw new Error(`no swap marker for kind: ${kind}`);
    const swap = `${comment} cmpose:${tag}-off: `;
    const lines = content.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t.startsWith(swap)) { out.push(lines[i]); continue; }
        const next = lines[i + 1];
        if (next === undefined) throw new Error(`cmpose:${tag}-off marker on the last line`);
        if (keep) { out.push(next); } else { out.push(next.match(/^\s*/)[0] + t.slice(swap.length)); }
        i++;
    }
    return out.join('\n');
}

// The marker kind of a backend template file; undefined when it takes no markers
function kindOf(file) {
    const name = path.basename(file);
    return Object.hasOwn(KIND_BY_NAME, name) ? KIND_BY_NAME[name] : KIND_BY_EXTENSION[path.extname(name)];
}

module.exports = { removeMarkedBlocks, applySwapMarkers, kindOf };
