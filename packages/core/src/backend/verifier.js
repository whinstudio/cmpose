'use strict';
const path = require('path');
const fs = require('fs-extra');
const { PRUNED } = require('./options');
const { identityPairs } = require('./identity');

// A marker line of any form (// -- # <!--), open, close, swap or malformed
const MARKER_RE = /^[ \t]*(?:\/\/|--|#|<!--)[ \t]*\/?cmpose:/m;
// The template gate's sharing words, in the code, docs and deploy parts
const SHARING_WORDS = /space|invite|member/i;
// The template gate's sample words (no_sample_words), in the same parts
const SAMPLE_WORDS = /feature[./]sample|\/items|Item(Repository|Routes|Table|Dto|OpenApi)|V3__sample/;
const SAMPLE_MIGRATION = 'V3__sample.sql';
const SHARING_TARGETS = ['src', 'SECURITY-CHECKLIST.md', 'deploy', 'README.md'];
const SECRET_PATTERNS = [
    { name: 'private key', re: /-----BEGIN .*PRIVATE KEY-----/ },
    { name: 'service account key', re: /"private_key":/ },
    { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ }
];
// tools/ scripts may spell the marker forms
const MARKER_SKIPPED = 'tools';
// The one template tool a project keeps
const KEPT_TOOLS = ['tools/deploy-lint.sh'];

async function listFiles(dir, rel = '', out = []) {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        if (PRUNED.has(entry.name)) continue;
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await listFiles(dir, r, out); continue; }
        if (!entry.isFile()) continue;
        const buffer = await fs.readFile(path.join(dir, r));
        // a binary file (gradle-wrapper.jar) is checked by name only
        out.push({ rel: r, text: buffer.includes(0) ? '' : buffer.toString('utf8') });
    }
    return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Problems of a generated backend project (empty = clean), sorted */
async function verifyBackendProject(projectDir, { sharing, sample, packageName, appName, projectName = '' }) {
    const problems = [];
    const pairs = identityPairs({ packageName, appName, projectName });
    // A template token the project's own names spell (a package io.cmpose.backendtemplatex) is not residue
    const tokens = pairs.filter((p) => !p.to.includes(p.from)).map((p) => p.from);
    // The project's own names never count as sharing words (an app named space-notes)
    const ownNames = pairs.map((p) => p.to).filter(Boolean).sort((a, b) => b.length - a.length);
    const ownNamesRe = ownNames.length ? new RegExp(ownNames.map(escapeRe).join('|'), 'g') : null;

    for (const { rel, text } of await listFiles(projectDir)) {
        for (const token of tokens) {
            if (rel.includes(token)) problems.push(`old identity ${token} in the name ${rel}`);
            if (text.includes(token)) problems.push(`old identity ${token} in ${rel}`);
        }
        if (rel.split('/')[0] !== MARKER_SKIPPED && MARKER_RE.test(text)) problems.push(`marker left in ${rel}`);
        if (rel.startsWith('tools/') && !KEPT_TOOLS.includes(rel)) problems.push(`template tool left in ${rel}`);
        if (SHARING_TARGETS.some((t) => rel === t || rel.startsWith(`${t}/`))) {
            const own = ownNamesRe ? text.replace(ownNamesRe, '') : text;
            if (!sharing && SHARING_WORDS.test(own)) problems.push(`sharing word in ${rel} (sharing is off)`);
            if (sample === false && SAMPLE_WORDS.test(own)) problems.push(`sample word in ${rel} (sample is off)`);
        }
        if (sample === false && path.posix.basename(rel) === SAMPLE_MIGRATION) problems.push(`sample migration ${rel} left (sample is off)`);
        for (const { name, re } of SECRET_PATTERNS) if (re.test(text)) problems.push(`${name} in ${rel}`);
    }

    const packageDir = path.posix.join('src', 'main', 'kotlin', ...packageName.split('.'));
    if (!(await fs.pathExists(path.join(projectDir, packageDir)))) problems.push(`missing package dir ${packageDir}`);
    const sampleDir = path.posix.join(packageDir, 'feature', 'sample');
    if (sample === false && (await fs.pathExists(path.join(projectDir, sampleDir)))) problems.push(`sample dir ${sampleDir} left (sample is off)`);
    for (const rel of [`deploy/docker-compose.${appName}.yml`, `deploy/nginx/${appName}.conf`]) {
        if (!(await fs.pathExists(path.join(projectDir, rel)))) problems.push(`missing ${rel}`);
    }
    return problems.sort();
}

module.exports = { verifyBackendProject };
