'use strict';
const path = require('path');
const fs = require('fs-extra');
const { log } = require('../log');
const { COMMIT_FILE_NAME, REF_FILE_NAME } = require('../templateVersions');
const { applySharingOption, applySampleOption, removeResolverTools } = require('./options');
const { applyBackendIdentity } = require('./identity');
const { writeBackendRecord } = require('./record');
const { verifyBackendProject } = require('./verifier');

// The template cache's own records and the template's gate and notes never reach the project (tools/deploy-lint.sh stays)
const LEFTOVERS = ['.git', COMMIT_FILE_NAME, REF_FILE_NAME, path.join('tools', 'gate.sh'), path.join('tools', 'TEMPLATE.md')];

// Turns a fresh backend template copy (projectDir) into the requested project, in place. value: validateBackend().value.
// templateRef and templateCommit default to the cache's markers. Throws when a step fails or the result fails verification.
async function generateBackend(value, { projectDir, templateRef = null, templateCommit = null, generatorVersion = null, now = new Date() }) {
    const readMarker = (name) => fs.readFile(path.join(projectDir, name), 'utf8').then((v) => v.trim() || null, () => null);
    const ref = templateRef || (await readMarker(REF_FILE_NAME));
    const commit = templateCommit || (await readMarker(COMMIT_FILE_NAME));

    // 1. options, sharing then sample (the template gate's order), before the package moves (tools/<option>-paths.txt
    // names the template's package dir); then the resolver's own tools go
    await applySharingOption(projectDir, value.sharing);
    log.info(`✅ Sharing ${value.sharing ? 'on' : 'off'}`);
    await applySampleOption(projectDir, value.sample);
    log.info(`✅ Sample ${value.sample ? 'on' : 'off'}`);
    await removeResolverTools(projectDir);

    // 2. identity
    await applyBackendIdentity(projectDir, value);
    log.info(`✅ Renamed to ${value.appName} (${value.packageName})`);

    // 3. leftovers, then the record
    for (const leftover of LEFTOVERS) await fs.remove(path.join(projectDir, leftover));
    const record = await writeBackendRecord(projectDir, value, { templateRef: ref, templateCommit: commit, generatorVersion, now });

    // 4. a broken project is never returned
    const problems = await verifyBackendProject(projectDir, value);
    if (problems.length) throw new Error(`backend verification failed: ${problems.join('; ')}`);
    return { sharing: value.sharing, sample: value.sample, record };
}

module.exports = { generateBackend };
