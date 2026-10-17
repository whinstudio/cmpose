'use strict';
const path = require('path');
const fs = require('fs-extra');
const pins = require('../pins');
const { backendContractVersion } = require('./contract');

const RECORD_PATH = path.join('.cmpose', 'generation.json');

/** The .cmpose/generation.json content of a generated backend: the options and the template, no personal data
 * (no output dir); generatorVersion names the caller (e.g. mcp@0.4.0), null when not given */
function buildBackendRecord(value, { templateRef = null, templateCommit = null, generatorVersion = null, now = new Date() } = {}) {
    return {
        generator: '@cmpose/core',
        coreVersion: require('../../package.json').version,
        generatorVersion: generatorVersion || null,
        kind: 'backend',
        contractVersion: backendContractVersion(),
        sharing: value.sharing === true,
        template: { repo: pins.backend.repo, ref: templateRef || null, commit: templateCommit || null },
        generatedAt: now.toISOString()
    };
}

async function writeBackendRecord(projectDir, value, options = {}) {
    const record = buildBackendRecord(value, options);
    const file = path.join(projectDir, RECORD_PATH);
    await fs.outputFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return record;
}

module.exports = { RECORD_PATH, buildBackendRecord, writeBackendRecord };
