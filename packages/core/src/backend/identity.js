'use strict';
const path = require('path');
const fs = require('fs-extra');
const { BACKEND_SCHEMA: S } = require('./contract');
const { PRUNED } = require('./options');

const TEMPLATE_APP = S.identity.appName;
const dbName = (appName) => appName.replace(/-/g, '_');
const envPrefix = (appName) => dbName(appName).toUpperCase();

/** The template's identity tokens and what each becomes */
function identityPairs({ packageName, appName, projectName }) {
    return [
        { from: S.identity.package, to: packageName },
        { from: S.identity.package.replace(/\./g, '/'), to: packageName.replace(/\./g, '/') },
        { from: S.identity.projectName, to: projectName },
        { from: TEMPLATE_APP, to: appName },
        { from: dbName(TEMPLATE_APP), to: dbName(appName) },
        { from: envPrefix(TEMPLATE_APP), to: envPrefix(appName) }
    ];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// One pass, so a new name is never renamed again
function renameAll(pairs) {
    const to = new Map(pairs.map((p) => [p.from, p.to]));
    const re = new RegExp([...to.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'g');
    return (text) => text.replace(re, (m) => to.get(m));
}
// A file with a NUL byte is binary (gradle-wrapper.jar) and keeps its bytes
const isBinary = (buffer) => buffer.includes(0);

async function walk(dir, rel, out) {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        if (PRUNED.has(entry.name)) continue;
        const r = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
            out.push({ rel: r, dir: true });
            await walk(dir, r, out);
        } else if (entry.isFile()) {
            out.push({ rel: r, dir: false });
        }
    }
    return out;
}

// Moves every file of the template package dir (any source set) into the new package dir, then drops the emptied dirs
async function movePackageDirs(projectDir, packageName) {
    const from = S.identity.package.split('.');
    const to = packageName.split('.');
    const srcDir = path.join(projectDir, 'src');
    if (!(await fs.pathExists(srcDir))) return;
    for (const sourceSet of await fs.readdir(srcDir)) {
        const kotlinDir = path.join(srcDir, sourceSet, 'kotlin');
        const oldDir = path.join(kotlinDir, ...from);
        if (!(await fs.pathExists(oldDir))) continue;
        const newDir = path.join(kotlinDir, ...to);
        const staging = path.join(kotlinDir, `.cmpose-package-${process.pid}`);
        await fs.move(oldDir, staging);
        // the template package's parents (io/cmpose) go when nothing else lives in them
        for (let depth = from.length - 1; depth > 0; depth--) {
            const parent = path.join(kotlinDir, ...from.slice(0, depth));
            if ((await fs.readdir(parent)).length) break;
            await fs.remove(parent);
        }
        if (await fs.pathExists(newDir)) throw new Error(`cannot move the package to ${path.relative(projectDir, newDir)}: it exists`);
        await fs.move(staging, newDir);
    }
}

/** Renames the template's package, app name (and its database and env forms) and display name: in the text files, the
 * package dirs and every file or dir name holding the app name. Binary files and file modes stay. */
async function applyBackendIdentity(projectDir, { packageName, appName, projectName }) {
    const rename = renameAll(identityPairs({ packageName, appName, projectName }));
    const entries = await walk(projectDir, '', []);

    // 1. content
    for (const e of entries) {
        if (e.dir) continue;
        const file = path.join(projectDir, e.rel);
        const buffer = await fs.readFile(file);
        if (isBinary(buffer)) continue;
        const text = buffer.toString('utf8');
        const next = rename(text);
        if (next !== text) await fs.writeFile(file, next);
    }

    // 2. package dirs
    await movePackageDirs(projectDir, packageName);

    // 3. names holding the app name, deepest first; every target is checked before anything moves
    const appRename = renameAll([{ from: TEMPLATE_APP, to: appName }]);
    const moves = (await walk(projectDir, '', []))
        .filter((e) => path.basename(e.rel).includes(TEMPLATE_APP))
        .sort((a, b) => b.rel.split(path.sep).length - a.rel.split(path.sep).length)
        .map((e) => {
            const from = path.join(projectDir, e.rel);
            return { rel: e.rel, from, to: path.join(path.dirname(from), appRename(path.basename(from))) };
        });
    const targets = new Set();
    for (const m of moves) {
        if (targets.has(m.to) || (await fs.pathExists(m.to))) throw new Error(`cannot rename ${m.rel}: target exists`);
        targets.add(m.to);
    }
    for (const m of moves) await fs.move(m.from, m.to);
    return { renamedFiles: moves.length };
}

module.exports = { applyBackendIdentity, identityPairs, dbName, envPrefix };
