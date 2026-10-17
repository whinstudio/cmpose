const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { readThemes, validateTheme, checkThemeShape, THEMES_PATH } = require('../src/game/themes');
const { seedGameTemplate } = require('./support/seedGameTemplate');

const IDS = ['bright', 'neon', 'pastel', 'bold', 'nature', 'clean'];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cmpose-themes-'));

async function seeded() {
    return readThemes(await seedGameTemplate(tmp(), { themes: true }));
}

test('reads the seeded families', async () => {
    const t = await seeded();
    assert.strictEqual(t.version, 1);
    assert.strictEqual(t.default, 'clean');
    assert.deepStrictEqual(t.families.map((f) => f.id), IDS);
    const clean = t.families.find((f) => f.id === 'clean');
    assert.strictEqual(clean.title, 'Clean');
    assert.strictEqual(clean.light.Primary, '#2D68EC');
    assert.strictEqual(clean.dark.Primary, '#5586EF');
    assert.strictEqual(clean.style.cornerRadius, 20);
    assert.deepStrictEqual(clean.fontPairs.map((p) => p.id), ['outfit-inter', 'montserrat-inter']);
    assert.match(clean.fontPairs[0].display, /Outfit-Bold SDF\.asset$/);
});

test('a template without themes.json has no families', async () => {
    const t = await readThemes(await seedGameTemplate(tmp()));
    assert.deepStrictEqual(t.families, []);
    assert.strictEqual(t.default, null);
});

test('a broken themes.json fails closed', async () => {
    const dir = await seedGameTemplate(tmp());
    const file = path.join(dir, THEMES_PATH);
    await fs.outputFile(file, '{ not json');
    await assert.rejects(readThemes(dir), /themes\.json/);
    for (const bad of [
        { version: 1, default: 'clean', families: 'x' },
        { version: 1, default: 'missing', families: [] },
        { version: 1, default: 'a', families: [{ id: 'a', light: {}, dark: {}, style: {}, fontPairs: [] }] },
        { version: 1, default: 'a', families: [{ id: 'a', light: { Primary: 'blue' }, dark: {}, style: {}, fontPairs: [{ id: 'p', display: 'd', body: 'b' }] }] },
        { version: 1, default: 'a', families: [{ id: 'a', light: {}, dark: {}, style: {}, fontPairs: [{ id: 'p', display: 'd', body: 'b' }] }, { id: 'a', light: {}, dark: {}, style: {}, fontPairs: [{ id: 'p', display: 'd', body: 'b' }] }] }
    ]) {
        await fs.outputFile(file, JSON.stringify(bad));
        await assert.rejects(readThemes(dir), /themes\.json/, JSON.stringify(bad));
    }
});

test('absent theme: the default family and its first font pair', async () => {
    const t = await seeded();
    assert.deepStrictEqual(validateTheme(undefined, t), { ok: true, value: { family: 'clean', fontPair: 'outfit-inter' } });
    assert.deepStrictEqual(validateTheme(null, t), { ok: true, value: { family: 'clean', fontPair: 'outfit-inter' } });
});

test('a family, colours and a font pair are kept', async () => {
    const t = await seeded();
    assert.deepStrictEqual(validateTheme({ family: 'neon' }, t).value, { family: 'neon', fontPair: 'chakrapetch-exo2' });
    assert.deepStrictEqual(validateTheme({ family: 'neon', primary: '#ff00aa', accent: '#00FF00', fontPair: 'outfit-exo2' }, t).value,
        { family: 'neon', primary: '#FF00AA', accent: '#00FF00', fontPair: 'outfit-exo2' });
    // Without family the default family is themed
    assert.deepStrictEqual(validateTheme({ primary: '#123456' }, t).value, { family: 'clean', primary: '#123456', fontPair: 'outfit-inter' });
});

test('unknown family names theme.family and the six ids', async () => {
    const r = validateTheme({ family: 'retro' }, await seeded());
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /theme\.family/);
    for (const id of IDS) assert.ok(r.error.includes(id), id);
});

test('unknown font pair names theme.fontPair and the family\'s pairs', async () => {
    const r = validateTheme({ family: 'bold', fontPair: 'outfit-inter' }, await seeded());
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /theme\.fontPair/);
    assert.match(r.error, /montserrat-inter, rubik-inter/);
});

test('bad colours are rejected naming the field', async () => {
    const t = await seeded();
    for (const primary of ['#FFF', 'FF0000', '#GG0000', '#FF000080', 5, '']) {
        const r = validateTheme({ primary }, t);
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /theme\.primary/);
    }
    assert.match(validateTheme({ accent: 'red' }, t).error, /theme\.accent/);
});

test('a template without families rejects a theme but accepts none', async () => {
    const t = await readThemes(await seedGameTemplate(tmp()));
    assert.deepStrictEqual(validateTheme(undefined, t), { ok: true, value: null });
    const r = validateTheme({ family: 'clean' }, t);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /this template has no theme families/);
});

test('shape check: object, known fields, strings', () => {
    for (const theme of ['clean', [], 5]) assert.strictEqual(checkThemeShape(theme).error, 'theme must be an object');
    assert.match(checkThemeShape({ colour: '#000000' }).error, /theme has unknown fields: colour \(known: family, primary, accent, fontPair\)/);
    assert.match(checkThemeShape({ family: 5 }).error, /theme\.family must be a string/);
    assert.match(checkThemeShape({ fontPair: ['a'] }).error, /theme\.fontPair must be a string/);
    assert.deepStrictEqual(checkThemeShape({}).value, {});
});
