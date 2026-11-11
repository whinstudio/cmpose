'use strict';
const fs = require('fs-extra');
const path = require('path');
const { removeMarkedBlocks } = require('./markerBlocks');

// The CMP template marks the parts of its Kotlin sources that only one flag needs (// cmpose:purchases, // cmpose:ads,
// // cmpose:insights) and Info.plist's insights keys (<!-- cmpose:insights -->). On keeps a block and drops its
// marker lines, off drops it whole. Only .kt, .kts and iosApp/iosApp/Info.plist: the privacy manifest and the other
// platform files have their own writers. server/ is the backend template's, never marked for these flags.
const TAGS = ['purchases', 'ads', 'insights'];
const EXTENSIONS = new Set(['.kt', '.kts']);
const INFO_PLIST = ['iosApp', 'iosApp', 'Info.plist'];
// Skipped at any depth. build/ is a module's output only outside a src/ tree and server/ only at the project root:
// a package can spell either (com.build.app, com.example.server).
const SKIP_DIRS = new Set(['.git', '.gradle', 'node_modules']);

async function listKotlinFiles(dir, { root = true, inSrc = false } = {}) {
    const files = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            if (root && entry.name === 'server') continue;
            if (!inSrc && entry.name === 'build') continue;
            files.push(...await listKotlinFiles(full, { root: false, inSrc: inSrc || entry.name === 'src' }));
        } else if (EXTENSIONS.has(path.extname(entry.name))) {
            files.push(full);
        }
    }
    return files;
}

// Every new text is computed before any file is written, so an unbalanced block leaves the project as it was
async function applyFeatureMarkers(projectDir, { purchases, ads, insights }) {
    const keep = { purchases: purchases === true, ads: ads === true, insights: insights === true };
    const targets = (await listKotlinFiles(projectDir)).map((file) => [file, 'slash']);
    const infoPlist = path.join(projectDir, ...INFO_PLIST);
    if (await fs.pathExists(infoPlist)) targets.push([infoPlist, 'xml']);
    const changes = [];
    for (const [file, kind] of targets) {
        const content = await fs.readFile(file, 'utf8');
        if (!TAGS.some((tag) => content.includes(`cmpose:${tag}`))) continue;
        let next = content;
        try {
            for (const tag of TAGS) next = removeMarkedBlocks(next, kind, keep[tag], tag);
        } catch (error) {
            const rel = path.relative(projectDir, file).split(path.sep).join('/');
            throw new Error(`${rel}: ${error.message}`);
        }
        if (next !== content) changes.push([file, next]);
    }
    for (const [file, next] of changes) await fs.writeFile(file, next);
}

module.exports = { applyFeatureMarkers, TAGS, INFO_PLIST };
