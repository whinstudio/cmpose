const test = require('node:test');
const assert = require('node:assert/strict');
const { contrast, luminance, hexToHsl, hslToHex, paletteProblems, derivePalette } = require('../src/game/themeColors');
const THEMES = require('./fixtures/game/themes.json');

const family = (id) => THEMES.families.find((f) => f.id === id);

test('contrast matches WCAG: black on white 21:1, #777 on white about 4.48, order does not matter', () => {
    assert.equal(contrast('#000000', '#FFFFFF'), 21);
    assert.equal(contrast('#FFFFFF', '#000000'), 21);
    assert.ok(Math.abs(contrast('#777777', '#FFFFFF') - 4.48) < 0.01);
    assert.equal(contrast('#3B82F6', '#3B82F6'), 1);
    assert.equal(luminance('#FFFFFF'), 1);
    // Scrim's alpha is not part of the luminance
    assert.equal(luminance('#00000099'), 0);
});

test('HSL round-trips a colour', () => {
    for (const hex of ['#E91E63', '#3B82F6', '#FFFF00', '#808080', '#000000', '#FFFFFF']) assert.equal(hslToHex(hexToHsl(hex)), hex);
});

test('every family of the template passes every floor', () => {
    for (const f of THEMES.families) assert.deepEqual(paletteProblems(f.light), [], f.id);
});

test('paletteProblems names the pairs under their floor', () => {
    const roles = { ...family('clean').light, Primary: '#FFFF00' };
    const problems = paletteProblems(roles);
    assert.ok(problems.includes('OnPrimary on Primary'));
    assert.ok(problems.includes('Primary on Surface'));
    const clean = family('clean').light;
    assert.deepEqual(paletteProblems({ ...clean, Accent: clean.Primary, OnAccent: clean.OnPrimary }, ['Accent']), ['Accent is Primary']);
    // only: the pairs of the named roles alone
    assert.deepEqual(paletteProblems(roles, ['Accent']), []);
});

test('no colours asked: the family palette as it is, no warnings', () => {
    assert.deepEqual(derivePalette(family('neon'), {}), { roles: family('neon').light, warnings: [] });
});

test('clean shifted toward #E91E63: the hue stays, every floor holds', () => {
    const asked = hexToHsl('#E91E63');
    const { roles, warnings } = derivePalette(family('clean'), { primary: '#E91E63', accent: '#22E4FF' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(paletteProblems(roles), []);
    assert.notEqual(roles.Primary, family('clean').light.Primary);
    assert.ok(Math.abs(hexToHsl(roles.Primary).h - asked.h) < 0.02, `hue ${roles.Primary}`);
    assert.ok(Math.abs(hexToHsl(roles.Accent).h - hexToHsl('#22E4FF').h) < 0.02, `accent hue ${roles.Accent}`);
});

test('a colour that already reads is kept exactly', () => {
    const { roles } = derivePalette(family('clean'), { primary: '#1D4ED8' });
    assert.equal(roles.Primary, '#1D4ED8');
});

test('#FFFF00 on a light family: lightness moves until it reads, never a failing palette', () => {
    for (const f of THEMES.families) {
        const { roles, warnings } = derivePalette(f, { primary: '#FFFF00', accent: '#FFFF00' });
        assert.deepEqual(paletteProblems(roles), [], f.id);
        assert.deepEqual(warnings, [], f.id);
    }
    const { roles } = derivePalette(family('clean'), { primary: '#FFFF00' });
    assert.ok(hexToHsl(roles.Primary).l < 0.5, roles.Primary);
});

test('a shift no lightness can rescue: the family colour and a warning', () => {
    // Mid grey everywhere: no visible lightness of any hue reads 4.5:1 against it
    const grey = Object.fromEntries(Object.keys(family('clean').light).map((role) => [role, '#777777']));
    const impossible = { id: 'grey', light: grey };
    const { roles, warnings } = derivePalette(impossible, { primary: '#E91E63', accent: '#22E4FF' });
    assert.deepEqual(roles, grey);
    assert.deepEqual(warnings, [
        'theme: Primary fell back to the family default in the light palette',
        'theme: Accent fell back to the family default in the light palette'
    ]);
});

test('derivePalette refuses a family without the palette', () => {
    assert.throws(() => derivePalette({ id: 'x' }, {}), /no palette/);
});
