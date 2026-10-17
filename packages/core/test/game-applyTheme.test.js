const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { seedGameTemplate, THEME_ASSETS } = require('./support/seedGameTemplate');
const { tmpDir } = require('./support/gameFixtures');
const { readThemes, validateTheme } = require('../src/game/themes');
const { applyTheme, unityFloat, unityColor } = require('../src/game/applyTheme');
const { getScalar } = require('../src/game/unityYaml');
const { paletteProblems } = require('../src/game/themeColors');
const GUIDS = require('./fixtures/game/theme/guids.json');

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

async function seeded(t, { full = true } = {}) {
    const dir = await tmpDir(t);
    await seedGameTemplate(dir, { full, themes: true });
    return { dir, themes: await readThemes(dir) };
}

function theme(themes, request) {
    const r = validateTheme(request, themes);
    assert.ok(r.ok, r.error);
    return r.value;
}

// Back from Unity's text to #RRGGBB(AA)
function hexOf(unity) {
    const m = /^\{r: ([\d.]+), g: ([\d.]+), b: ([\d.]+), a: ([\d.]+)\}$/.exec(unity);
    assert.ok(m, unity);
    const b = (v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${b(m[1])}${b(m[2])}${b(m[3])}${m[4] === '1' ? '' : b(m[4])}`;
}

const roleField = (role) => role.charAt(0).toLowerCase() + role.slice(1);
const paletteOf = (text, roles) => Object.fromEntries(Object.keys(roles).map((role) => [role, hexOf(getScalar(text, roleField(role)))]));

test('Unity floats: the shortest text of the 32-bit value, as Unity writes it', () => {
    assert.equal(unityFloat(234 / 255), '0.91764706');
    assert.equal(unityFloat(45 / 255), '0.1764706');
    assert.equal(unityFloat(0.35), '0.35');
    assert.equal(unityFloat(20), '20');
    assert.equal(unityFloat(1), '1');
    assert.equal(unityColor('#00000099'), '{r: 0, g: 0, b: 0, a: 0.6}');
});

test('the default family on the template: the three assets stay byte-identical', async (t) => {
    const { dir, themes } = await seeded(t);
    const before = await Promise.all(Object.values(THEME_ASSETS).map((rel) => read(dir, rel)));
    const result = await applyTheme(dir, theme(themes, undefined), themes, { uiTheme: true });
    assert.deepEqual(result, { warnings: [], theme: { family: 'clean', fontPair: 'outfit-inter' } });
    assert.deepEqual(await Promise.all(Object.values(THEME_ASSETS).map((rel) => read(dir, rel))), before);
});

test('neon with the second font pair and uiTheme: both palettes, the fonts, post and style are written', async (t) => {
    const { dir, themes } = await seeded(t);
    const neon = themes.families.find((f) => f.id === 'neon');
    const result = await applyTheme(dir, theme(themes, { family: 'neon', fontPair: 'outfit-exo2' }), themes, { uiTheme: true });
    assert.deepEqual(result, { warnings: [], theme: { family: 'neon', fontPair: 'outfit-exo2' } });

    assert.deepEqual(paletteOf(await read(dir, THEME_ASSETS.light), neon.light), neon.light);
    assert.deepEqual(paletteOf(await read(dir, THEME_ASSETS.dark), neon.dark), neon.dark);
    const style = await read(dir, THEME_ASSETS.style);
    const ref = (rel) => `{fileID: 11400000, guid: ${GUIDS[rel]}, type: 2}`;
    assert.equal(getScalar(style, 'familyId'), 'neon');
    assert.equal(getScalar(style, 'displayFont'), ref(neon.fontPairs[1].display));
    assert.equal(getScalar(style, 'bodyFont'), ref(neon.fontPairs[1].body));
    assert.equal(getScalar(style, 'post'), ref(neon.style.post));
    assert.equal(getScalar(style, 'cornerRadius'), String(neon.style.cornerRadius));
    assert.equal(getScalar(style, 'shadowStrength'), unityFloat(neon.style.shadowStrength));
    assert.equal(getScalar(style, 'surface'), String(['Flat', 'Soft', 'Raised'].indexOf(neon.style.surface)));
    assert.equal(getScalar(style, 'motion'), String(['Calm', 'Snappy', 'Bouncy'].indexOf(neon.style.motion)));
    assert.equal(getScalar(style, 'background'), String(['Solid', 'Gradient', 'Pattern'].indexOf(neon.style.background)));
    const world = style.split('\n').filter((l) => l.startsWith('  - {r:')).map((l) => hexOf(l.slice(4)));
    assert.deepEqual(world, neon.style.worldColors.map((c) => c.toUpperCase()));
    // The rest of the asset is untouched
    assert.match(style, /^  m_Name: Style$/m);
    assert.match(style, /^  m_Script: \{fileID: 11500000, guid: 83edc961561242848ac4b6707b78488e, type: 3\}$/m);
});

test('uiTheme off: the flag removed Dark.asset and applyTheme never recreates it', async (t) => {
    const { dir, themes } = await seeded(t);
    await fs.remove(path.join(dir, 'Assets/_Project/Core/Theme'));
    await applyTheme(dir, theme(themes, { family: 'bold' }), themes, { uiTheme: false });
    assert.equal(await fs.pathExists(path.join(dir, THEME_ASSETS.dark)), false);
    assert.equal(getScalar(await read(dir, THEME_ASSETS.style), 'familyId'), 'bold');
});

test('primary and accent shifts land in both palettes and pass every floor', async (t) => {
    const { dir, themes } = await seeded(t);
    const result = await applyTheme(dir, theme(themes, { primary: '#E91E63', accent: '#FFFF00' }), themes, { uiTheme: true });
    assert.deepEqual(result, { warnings: [], theme: { family: 'clean', primary: '#E91E63', accent: '#FFFF00', fontPair: 'outfit-inter' } });
    const clean = themes.families.find((f) => f.id === 'clean');
    for (const [mode, rel] of [['light', THEME_ASSETS.light], ['dark', THEME_ASSETS.dark]]) {
        const palette = paletteOf(await read(dir, rel), clean[mode]);
        assert.notEqual(palette.Primary, clean[mode].Primary, mode);
        assert.deepEqual(paletteProblems(palette, mode), [], mode);
    }
});

test('a colour that falls back: a warning, and the record leaves it out', async (t) => {
    const { dir, themes } = await seeded(t);
    const grey = Object.fromEntries(Object.keys(themes.families[0].light).map((role) => [role, '#777777']));
    const clean = themes.families.find((f) => f.id === 'clean');
    const greyThemes = { ...themes, families: [{ ...clean, light: grey, dark: grey }] };
    const result = await applyTheme(dir, theme(greyThemes, { primary: '#E91E63' }), greyThemes, { uiTheme: false });
    assert.deepEqual(result, {
        warnings: ['theme: Primary fell back to the family default in the light palette'],
        theme: { family: 'clean', fontPair: 'outfit-inter' }
    });
});

test('nothing is written when a font, profile or asset is missing, or a style value is out of range', async (t) => {
    const { dir, themes } = await seeded(t);
    const neon = themes.families.find((f) => f.id === 'neon');
    const before = await read(dir, THEME_ASSETS.light);
    await fs.remove(path.join(dir, `${neon.fontPairs[0].display}.meta`));
    await assert.rejects(applyTheme(dir, theme(themes, { family: 'neon' }), themes, { uiTheme: true }), /theme: display font .* is missing/);
    await fs.remove(path.join(dir, neon.style.post));
    await assert.rejects(applyTheme(dir, theme(themes, { family: 'neon', fontPair: 'outfit-exo2' }), themes, { uiTheme: true }),
        /theme: post profile .* is missing/);
    assert.equal(await read(dir, THEME_ASSETS.light), before);

    const clean = themes.families.find((f) => f.id === 'clean');
    const cleanWith = (style) => ({ ...themes, families: [{ ...clean, style: { ...clean.style, ...style } }] });
    const cv = { family: 'clean', fontPair: 'outfit-inter' };
    await assert.rejects(applyTheme(dir, cv, cleanWith({ cornerRadius: 60 }), {}), /style\.cornerRadius must be from 0 to 48/);
    await assert.rejects(applyTheme(dir, cv, cleanWith({ surface: 'Glossy' }), {}), /style\.surface must be one of Flat, Soft, Raised/);
    await assert.rejects(applyTheme(dir, cv, cleanWith({ worldColors: ['#FFFFFF'] }), {}), /worldColors needs 3 or 4/);
    // Paths outside Assets are never followed
    await assert.rejects(applyTheme(dir, cv, cleanWith({ post: '../../etc/passwd' }), {}), /post profile must be a path inside Assets/);
    await assert.rejects(applyTheme(dir, cv, cleanWith({ post: 'Assets/../../x.asset' }), {}), /post profile must be a path inside Assets/);
    assert.equal(await read(dir, THEME_ASSETS.light), before);

    await fs.remove(path.join(dir, THEME_ASSETS.dark));
    await assert.rejects(applyTheme(dir, cv, themes, { uiTheme: true }), /Dark\.asset is missing/);
    assert.equal(await read(dir, THEME_ASSETS.light), before);
});
