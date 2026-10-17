'use strict';
const fs = require('fs-extra');
const path = require('path');
const { log } = require('../log');
const pins = require('../pins');
const { COMMIT_FILE_NAME, REF_FILE_NAME } = require('../templateVersions');
const { GAME_SCHEMA } = require('./contract');
const { cloneModules } = require('./modules');
const { applyFlags } = require('./flags');
const { applyGameIdentity } = require('./identity');
const { writeGameIds } = require('./ids');
const { applyGameReadme } = require('./readme');
const { buildGameRecord, writeGameRecord } = require('./record');
const { verifyGameProject } = require('./verifier');
const { readThemes, validateTheme } = require('./themes');
const { applyTheme } = require('./applyTheme');

// The template cache's own records and Unity's local state never reach the project; nor does the template's
// LICENSE (the generated project is the user's, to license as they choose), nor an older template's GameCI
// workflow (.github; GameCI is not offered for games)
const LEFTOVERS = ['.git', COMMIT_FILE_NAME, REF_FILE_NAME, 'LICENSE', 'Library', 'Temp', 'Logs', 'UserSettings', '.github'];
const PACKAGE_GUIDS = path.join('.cmpose', 'package-guids.txt');

function gameWarnings(value) {
    const on = (flag) => value.flags.includes(flag);
    const warnings = [];
    if (on('ads') && !value.ids.admob) warnings.push('Ads use AdMob test IDs: replace them with your own before release.');
    if (on('purchases') && !value.ids.revenueCat) warnings.push('Purchases use the RevenueCat Test Store key: replace it before release.');
    if (on('leaderboards') && !value.ids.gameServices) {
        warnings.push('Leaderboard and achievement IDs are placeholders: game services stay off until you set them.');
    }
    warnings.push(`Open the project with Unity ${GAME_SCHEMA.unityVersion} (Android and iOS Build Support); the first import takes a few minutes.`);
    return warnings;
}

// Turns a fresh Unity template copy (projectDir) into the requested game, in place.
// value: validateGame().value. generatorVersion: who ran the core, for the record (e.g. mcp@0.2.0). template: { repo, ref, commit } for the record; without it the pinned repo and the
// cache's markers are recorded. Throws when a step fails or the result fails verification.
async function generateGame(value, { projectDir, template = null, coreVersion, generatorVersion = null, now = new Date() }) {
    const readMarker = (name) => fs.readFile(path.join(projectDir, name), 'utf8').then((v) => v.trim() || null, () => null);
    const source = template || {
        repo: pins.game.repo,
        ref: (await readMarker(REF_FILE_NAME)) || pins.game.ref,
        commit: await readMarker(COMMIT_FILE_NAME)
    };

    // The family and font pair are checked against the template's themes.json before anything changes
    const themes = await readThemes(projectDir);
    const theme = validateTheme(value.theme, themes);
    if (!theme.ok) throw new Error(theme.error);

    // 1. leftovers
    for (const leftover of LEFTOVERS) await fs.remove(path.join(projectDir, leftover));
    log.info('✅ Cleanup completed');

    // 2. blank modules, cloned before the flags so a turned-off flag removes their parts too
    if (value.templateType === 'blank' && value.features.length) {
        await cloneModules(projectDir, value.features, { seed: value.packageName });
        log.info(`✅ Added modules: ${value.features.join(', ')}`);
    }

    // 3. flags and render (showcase keeps every flag)
    const off = GAME_SCHEMA.flags.filter((f) => !value.flags.includes(f));
    await applyFlags(projectDir, { kind: value.templateType, render: value.render, off });
    log.info(`✅ Applied ${value.templateType} (${value.render}), flags off: ${off.length ? off.join(', ') : 'none'}`);

    // 4–6. identity, real IDs and README
    await applyGameIdentity(projectDir, value);
    await writeGameIds(projectDir, value.ids);
    await applyGameReadme(projectDir, value);
    log.info(`✅ Renamed to ${value.companyName}.${value.projectName} (${value.packageName})`);

    // 7. the style family (the template's default when none was asked; nothing for a template without families)
    let applied = { warnings: [], theme: null };
    if (theme.value) {
        applied = await applyTheme(projectDir, theme.value, themes, { uiTheme: value.flags.includes('uiTheme') });
        log.info(`✅ Applied theme ${applied.theme.family} (${applied.theme.fontPair})`);
    }

    // 8. a broken project is never returned
    const problems = await verifyGameProject(projectDir);
    if (problems.length) throw new Error('generated project failed verification:\n- ' + problems.join('\n- '));

    // 9. the template's package guid allowlist goes; the record stays
    await fs.remove(path.join(projectDir, PACKAGE_GUIDS));
    const record = buildGameRecord({ template: source, coreVersion, generatorVersion, value, theme: applied.theme, now });
    await writeGameRecord(projectDir, record);

    return {
        templateType: value.templateType,
        render: value.render,
        flags: value.flags.slice(),
        features: value.features.slice(),
        ids: record.ids,
        theme: applied.theme,
        warnings: [...applied.warnings, ...gameWarnings(value)]
    };
}

module.exports = { generateGame, gameWarnings };
