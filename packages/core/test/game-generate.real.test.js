const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { tmpDir } = require('./support/gameFixtures');
const { validateGame } = require('../src/game/validate');
const { generateGame } = require('../src/game/generate');
const { verifyGameProject } = require('../src/game/verifier');
const { GAME_SCHEMA } = require('../src/game/contract');
const { readThemes, validateTheme } = require('../src/game/themes');
const { applyTheme } = require('../src/game/applyTheme');

// The whole pipeline against the REAL Unity template (CMP_GAME_TEMPLATE_DIR, a copy without Unity's local state).
// Skipped, not failed, when it is unset.
const REAL = process.env.CMP_GAME_TEMPLATE_DIR;
const LOCAL = new Set(['Library', 'Temp', 'Logs', 'UserSettings', 'Builds', 'obj', '.git']);

test('the real template generates blank with every flag, two modules, and verifies clean', REAL ? {} : { skip: 'CMP_GAME_TEMPLATE_DIR not set' }, async (t) => {
    const dir = await tmpDir(t);
    await fs.copy(REAL, dir, { filter: (src) => !LOCAL.has(path.relative(REAL, src).split(path.sep)[0]) });
    const r = validateGame({
        projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper',
        templateType: 'blank', flags: GAME_SCHEMA.flags.slice(), features: ['shop', 'quests']
    });
    assert.ok(r.ok, r.error);
    const result = await generateGame(r.value, {
        projectDir: dir, template: { repo: 'real', ref: 'local', commit: null }, coreVersion: 'test', now: new Date(0)
    });
    // generateGame verified the project before dropping the package guid allowlist (step 8); verify again with it put back
    const allowlist = path.join(dir, '.cmpose/package-guids.txt');
    assert.equal(await fs.pathExists(allowlist), false);
    await fs.copy(path.join(REAL, '.cmpose/package-guids.txt'), allowlist);
    assert.deepEqual(await verifyGameProject(dir), []);
    assert.deepEqual(result.features, ['shop', 'quests']);
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/_Project/Features/Shop')));
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/_Project/Features/Quests')));
    assert.ok(await fs.pathExists(path.join(dir, '.cmpose/generation.json')));
    assert.equal(await fs.pathExists(path.join(dir, '.github')), false);
});

// The real template's committed theme assets and its style families
const THEME_FILES = [
    'Assets/_Project/Core/Presentation/Resources/Theme/Light.asset',
    'Assets/_Project/Core/Theme/Resources/Theme/Dark.asset',
    'Assets/_Project/Core/Presentation/Resources/Theme/Style.asset'
];

async function generateReal(t, request) {
    const dir = await tmpDir(t);
    await fs.copy(REAL, dir, { filter: (src) => !LOCAL.has(path.relative(REAL, src).split(path.sep)[0]) });
    const r = validateGame({ projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper', ...request });
    assert.ok(r.ok, r.error);
    const result = await generateGame(r.value, {
        projectDir: dir, template: { repo: 'real', ref: 'local', commit: null }, coreVersion: 'test', now: new Date(0)
    });
    await fs.copy(path.join(REAL, '.cmpose/package-guids.txt'), path.join(dir, '.cmpose/package-guids.txt'));
    return { dir, result };
}

test('the real template without a theme: clean, the three theme assets as committed (bar the namespace)', REAL ? {} : { skip: 'CMP_GAME_TEMPLATE_DIR not set' }, async (t) => {
    const { dir, result } = await generateReal(t, { templateType: 'showcase' });
    assert.deepEqual(result.theme, { family: 'clean', fontPair: 'outfit-inter' });
    for (const rel of THEME_FILES) {
        const committed = (await fs.readFile(path.join(REAL, rel), 'utf8')).replaceAll('Kturker.UnityBase', 'Acme.SkyHopper');
        assert.equal(await fs.readFile(path.join(dir, rel), 'utf8'), committed, rel);
    }
});

test('the real template takes every family and font pair, with shifted colours, and still verifies clean', REAL ? {} : { skip: 'CMP_GAME_TEMPLATE_DIR not set' }, async (t) => {
    const { dir, result } = await generateReal(t, {
        templateType: 'blank', flags: GAME_SCHEMA.flags.slice(), theme: { family: 'neon', primary: '#FFFF00', accent: '#E91E63', fontPair: 'outfit-exo2' }
    });
    assert.deepEqual(result.theme, { family: 'neon', primary: '#FFFF00', accent: '#E91E63', fontPair: 'outfit-exo2' });
    assert.ok(!result.warnings.some((w) => w.startsWith('theme:')), result.warnings.join('\n'));
    assert.deepEqual(await verifyGameProject(dir), []);

    const themes = await readThemes(dir);
    assert.deepEqual(themes.families.map((f) => f.id), ['bright', 'neon', 'pastel', 'bold', 'nature', 'clean']);
    for (const family of themes.families) {
        for (const pair of family.fontPairs) {
            const v = validateTheme({ family: family.id, fontPair: pair.id, primary: '#E91E63' }, themes);
            assert.ok(v.ok, v.error);
            const applied = await applyTheme(dir, v.value, themes, { uiTheme: true });
            assert.deepEqual(applied.warnings, [], `${family.id} ${pair.id}`);
            const style = await fs.readFile(path.join(dir, THEME_FILES[2]), 'utf8');
            assert.match(style, new RegExp(`^  familyId: ${family.id}$`, 'm'));
        }
    }
    assert.deepEqual(await verifyGameProject(dir), []);
});

test('the real template with uiTheme off: no Dark.asset, a themed light palette', REAL ? {} : { skip: 'CMP_GAME_TEMPLATE_DIR not set' }, async (t) => {
    const { dir, result } = await generateReal(t, {
        templateType: 'blank', flags: GAME_SCHEMA.flags.filter((f) => f !== 'uiTheme'), theme: { family: 'pastel' }
    });
    assert.equal(result.theme.family, 'pastel');
    assert.equal(await fs.pathExists(path.join(dir, THEME_FILES[1])), false);
    assert.deepEqual(await verifyGameProject(dir), []);
});

test('the real template describes its six families for a planner', REAL ? {} : { skip: 'CMP_GAME_TEMPLATE_DIR not set' }, async () => {
    const { describeGame } = require('../src/game/describe');
    const { themes } = describeGame({ themes: await readThemes(REAL) });
    assert.equal(themes.default, 'clean');
    assert.deepEqual(themes.families.map((f) => f.id), ['bright', 'neon', 'pastel', 'bold', 'nature', 'clean']);
    for (const f of themes.families) {
        assert.ok(f.title && f.suits, f.id);
        assert.ok(f.fontPairs.length > 0 && f.fontPairs.every((p) => typeof p === 'string'), f.id);
    }
});
