'use strict';
const path = require('path');
const fs = require('fs-extra');
const { GAME_SCHEMA } = require('./contract');

const RECORD_PATH = path.join('.cmpose', 'generation.json');

// Whether each ID group's real values were written ('custom'), the template's test IDs stay ('test') or its
// flag is off ('off'). The values themselves are never recorded.
function idStatuses(flags, ids) {
    const out = {};
    for (const [group, { flag }] of Object.entries(GAME_SCHEMA.idGroups)) {
        if (!flags.includes(flag)) out[group] = 'off';
        else out[group] = ids && ids[group] ? 'custom' : 'test';
    }
    return out;
}

// The value is meant to come from validateGame, but the record never assumes it: odd entries are dropped
const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);

/** The .cmpose/generation.json content of a generated Unity game (no personal data, no ID values);
 * generatorVersion names the caller (e.g. mcp@0.2.0), null when not given; theme the style family as applied
 * (applyTheme), null for a template without families */
function buildGameRecord({ template, coreVersion, generatorVersion = null, value, theme = null, now = new Date() }) {
    const flags = strings(value.flags);
    return {
        generator: '@cmpose/core',
        coreVersion,
        generatorVersion: generatorVersion || null,
        engine: 'unity',
        unityVersion: GAME_SCHEMA.unityVersion,
        templateType: value.templateType,
        render: value.render,
        flags,
        features: strings(value.features),
        minSdk: value.minSdk,
        iosVersion: value.iosVersion,
        ids: idStatuses(flags, value.ids),
        theme: theme ? { ...theme } : null,
        template: { repo: template.repo, ref: template.ref, commit: template.commit },
        generatedAt: now.toISOString()
    };
}

async function writeGameRecord(projectDir, record) {
    const file = path.join(projectDir, RECORD_PATH);
    await fs.outputFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return file;
}

module.exports = { RECORD_PATH, buildGameRecord, writeGameRecord };
