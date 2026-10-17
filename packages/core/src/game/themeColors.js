'use strict';

// cmpose game: a family's palette with the requested Primary/Accent. The colours keep the requested hue and saturation;
// only the lightness moves, until every contrast floor the template's own tests ask for holds (ThemeFamilyTests'
// AssertReads, Contrast.AssertBoxes and AssertAccentAndStatus). A colour that cannot reach them stays the family's.

// Contrast floors of Contrast (Assets/_Project/Tests/EditMode/ThemeTests.cs)
const BODY_TEXT = 4.5;
const NON_TEXT = 3;
const SMALL_TEXT = 3;
const BOX_ON_PANEL = 1.25;
const SELECTED_ON_ROW = 1.1;
// The floors that differ by palette: Primary text on the rows, Control on Surface
const MODE_FLOORS = {
    light: { accentOnRow: 3, controlOnSurface: 1.4 },
    dark: { accentOnRow: 2.3, controlOnSurface: 3 }
};
// A requested hue stays visible: never shifted to black or white
const MIN_LIGHTNESS = 0.1;
const MAX_LIGHTNESS = 0.9;
const STEP = 0.01;

function hexToRgb(hex) {
    const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})?$/.exec(hex);
    if (!m) throw new Error(`'${hex}' is not a #RRGGBB colour`);
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: m[4] === undefined ? 255 : parseInt(m[4], 16) };
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
const rgbToHex = ({ r, g, b }) => `#${byte(r)}${byte(g)}${byte(b)}`;

// WCAG 2 relative luminance, as Contrast.Luminance computes it
function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const channel = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hexToHsl(hex) {
    const { r, g, b } = hexToRgb(hex);
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    return { h: h / 6, s, l };
}

function hslToHex({ h, s, l }) {
    if (s === 0) return rgbToHex({ r: l * 255, g: l * 255, b: l * 255 });
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return rgbToHex({ r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 });
}

// Every floor a palette must meet: [a, b, floor] contrast pairs, then the colours that must differ
function contrastPairs(mode) {
    const { accentOnRow, controlOnSurface } = MODE_FLOORS[mode];
    return [
        ['Text', 'Background', BODY_TEXT],
        ['Text', 'Surface', BODY_TEXT],
        ['TextMuted', 'Surface', BODY_TEXT],
        ['OnPrimary', 'Primary', BODY_TEXT],
        ['OnAccent', 'Accent', BODY_TEXT],
        ['Danger', 'Surface', NON_TEXT],
        ['Success', 'Surface', NON_TEXT],
        ['Primary', 'Surface', NON_TEXT],
        ['Primary', 'Control', NON_TEXT],
        ['Control', 'Surface', controlOnSurface],
        ['Track', 'Surface', BOX_ON_PANEL],
        ['SurfaceVariant', 'Surface', BOX_ON_PANEL],
        ['SurfaceVariant', 'Background', BOX_ON_PANEL],
        ['SurfaceVariant', 'Track', SELECTED_ON_ROW],
        ['TextMuted', 'Track', SMALL_TEXT],
        ['TextMuted', 'SurfaceVariant', SMALL_TEXT],
        ['Primary', 'Track', accentOnRow],
        ['Primary', 'SurfaceVariant', accentOnRow],
        ['Primary', 'Track', NON_TEXT]
    ];
}
const DISTINCT = [['Accent', 'Primary'], ['Success', 'Danger']];

const sameColour = (a, b) => a.toUpperCase() === b.toUpperCase();

/** The floors roles (role → #RRGGBB) misses in mode ('light' | 'dark'), as 'A on B' / 'A is B'; only the pairs
 * that involve one of `only` when given */
function paletteProblems(roles, mode, only = null) {
    if (!MODE_FLOORS[mode]) throw new Error(`unknown palette mode '${mode}'`);
    const concerns = (a, b) => !only || only.includes(a) || only.includes(b);
    const problems = [];
    for (const [a, b, floor] of contrastPairs(mode)) {
        if (concerns(a, b) && contrast(roles[a], roles[b]) < floor) problems.push(`${a} on ${b}`);
    }
    for (const [a, b] of DISTINCT) if (concerns(a, b) && sameColour(roles[a], roles[b])) problems.push(`${a} is ${b}`);
    return problems;
}

// Lightness values from the requested one outwards, inside the visible range
function lightnessSteps(from) {
    const start = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, from));
    const steps = [start];
    for (let d = STEP; d <= 1; d += STEP) {
        if (start - d >= MIN_LIGHTNESS - 1e-9) steps.push(start - d);
        if (start + d <= MAX_LIGHTNESS + 1e-9) steps.push(start + d);
    }
    return steps;
}

const unique = (list) => list.filter((c, i) => list.findIndex((x) => sameColour(x, c)) === i);

// The requested colour itself when it passes, else its hue at the nearest lightness that does; the text on it is the
// family's On colour, its Text or its Surface (whichever reads); Control moves only when nothing else works
function shiftRole(roles, mode, role, requested) {
    const on = `On${role}`;
    const changes = role === 'Primary' ? [role, on, 'Control'] : [role, on];
    const ons = unique([roles[on], roles.Text, roles.Surface]);
    const hsl = hexToHsl(requested);
    const candidates = unique([requested.toUpperCase(), ...lightnessSteps(hsl.l).map((l) => hslToHex({ ...hsl, l }))]);
    const controls = [roles.Control];
    if (role === 'Primary') {
        const c = hexToHsl(roles.Control);
        controls.push(...unique(lightnessSteps(c.l).map((l) => hslToHex({ ...c, l }))).filter((x) => !sameColour(x, roles.Control)));
    }
    for (const control of controls) {
        for (const colour of candidates) {
            for (const text of ons) {
                const next = { ...roles, [role]: colour, [on]: text, ...(role === 'Primary' ? { Control: control } : {}) };
                if (!paletteProblems(next, mode, changes).length) return next;
            }
        }
    }
    return null;
}

/** family's palette for mode ('light' | 'dark') with the requested primary/accent (#RRGGBB) shifted to pass every
 * contrast floor. roles: role → #RRGGBB(AA); warnings: one line per colour that fell back to the family's */
function derivePalette(family, { primary, accent } = {}, mode = 'light') {
    if (!family || !family[mode]) throw new Error(`family has no ${mode} palette`);
    let roles = { ...family[mode] };
    const warnings = [];
    for (const [role, requested] of [['Primary', primary], ['Accent', accent]]) {
        if (!requested) continue;
        const next = shiftRole(roles, mode, role, requested);
        if (next) roles = next;
        else warnings.push(`theme: ${role} fell back to the family default in the ${mode} palette`);
    }
    return { roles, warnings };
}

module.exports = { MODE_FLOORS, hexToRgb, rgbToHex, luminance, contrast, hexToHsl, hslToHex, paletteProblems, derivePalette };
