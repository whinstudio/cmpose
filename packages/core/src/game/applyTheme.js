'use strict';
const path = require('path');
const fs = require('fs-extra');
const { setScalar, setList } = require('./unityYaml');
const { readMetaGuid } = require('./guid');
const { hexToRgb, derivePalette } = require('./themeColors');

// cmpose game: writes a style family (themes.js) into the project as ThemeFamilies.Apply does in the editor: the light
// palette, the dark one while the uiTheme flag's folder is there, and the style asset (fonts, shapes, motion, post,
// world colours). Values are written the way Unity serializes them, so applying the template's own family changes nothing.
const LIGHT_PATH = 'Assets/_Project/Core/Presentation/Resources/Theme/Light.asset';
const DARK_PATH = 'Assets/_Project/Core/Theme/Resources/Theme/Dark.asset';
const STYLE_PATH = 'Assets/_Project/Core/Presentation/Resources/Theme/Style.asset';
const ASSET_DOC = { classId: 114, fileId: 11400000 };

// ThemeStyle's enums (SurfaceStyle, MotionProfile, BackgroundStyle): Unity stores the index
const ENUMS = {
    surface: ['Flat', 'Soft', 'Raised'],
    motion: ['Calm', 'Snappy', 'Bouncy'],
    background: ['Solid', 'Gradient', 'Pattern']
};

// A float as Unity writes it: the shortest text that reads back as the same 32-bit float
function unityFloat(x) {
    const f = Math.fround(x);
    for (let p = 1; p <= 9; p++) {
        const s = f.toPrecision(p);
        if (Math.fround(Number(s)) === f) return String(Number(s));
    }
    return String(f);
}

function unityColor(hex) {
    const { r, g, b, a } = hexToRgb(hex);
    return `{r: ${unityFloat(r / 255)}, g: ${unityFloat(g / 255)}, b: ${unityFloat(b / 255)}, a: ${unityFloat(a / 255)}}`;
}

// Palette's serialized field of a ThemeRole: Background → background, OnPrimary → onPrimary
const fieldOf = (role) => role.charAt(0).toLowerCase() + role.slice(1);

// themes.json names assets by project path; only paths inside Assets are followed
function assetPath(projectDir, rel, what) {
    if (typeof rel !== 'string' || !rel.startsWith('Assets/') || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        throw new Error(`theme: ${what} must be a path inside Assets`);
    }
    return path.join(projectDir, rel);
}

async function assetRef(projectDir, rel, what) {
    const file = assetPath(projectDir, rel, what);
    if (!(await fs.pathExists(file)) || !(await fs.pathExists(`${file}.meta`))) throw new Error(`theme: ${what} ${rel} is missing`);
    return `{fileID: 11400000, guid: ${readMetaGuid(await fs.readFile(`${file}.meta`, 'utf8'))}, type: 2}`;
}

function enumIndex(name, value) {
    const i = ENUMS[name].indexOf(value);
    if (i < 0) throw new Error(`theme: style.${name} must be one of ${ENUMS[name].join(', ')}`);
    return i;
}

function writePalette(text, roles) {
    let out = text;
    for (const [role, hex] of Object.entries(roles)) out = setScalar(out, fieldOf(role), unityColor(hex), { doc: ASSET_DOC });
    return out;
}

async function readAsset(projectDir, rel) {
    const file = path.join(projectDir, rel);
    if (!(await fs.pathExists(file))) throw new Error(`theme: ${rel} is missing`);
    return fs.readFile(file, 'utf8');
}

/** Writes themeValue (validateTheme().value: family, fontPair, primary?, accent?) of themes (readThemes) into
 * projectDir. uiTheme: whether the flag is on (its Dark.asset is written, never created). Every asset is read and every
 * reference resolved before anything is written. Returns the warnings of colours that fell back and the theme as
 * applied (primary/accent only where they were kept). */
async function applyTheme(projectDir, themeValue, themes, { uiTheme = false } = {}) {
    const family = themes.families.find((f) => f.id === themeValue.family);
    if (!family) throw new Error('theme: unknown family');
    const pair = family.fontPairs.find((p) => p.id === themeValue.fontPair);
    if (!pair) throw new Error('theme: unknown font pair');
    const style = family.style;

    const requested = { primary: themeValue.primary, accent: themeValue.accent };
    const light = derivePalette(family, requested, 'light');
    const dark = uiTheme ? derivePalette(family, requested, 'dark') : null;

    const display = await assetRef(projectDir, pair.display, 'display font');
    const body = await assetRef(projectDir, pair.body, 'body font');
    const post = await assetRef(projectDir, style.post, 'post profile');
    const worldColors = Array.isArray(style.worldColors) ? style.worldColors : [];
    if (worldColors.length < 3 || worldColors.length > 4) throw new Error('theme: style.worldColors needs 3 or 4 colours');
    const numbers = {};
    for (const [key, min, max] of [['cornerRadius', 0, 48], ['shadowStrength', 0, 1]]) {
        const v = style[key];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`theme: style.${key} must be from ${min} to ${max}`);
        numbers[key] = unityFloat(v);
    }
    const enums = Object.fromEntries(Object.keys(ENUMS).map((k) => [k, enumIndex(k, style[k])]));

    const lightText = writePalette(await readAsset(projectDir, LIGHT_PATH), light.roles);
    const darkText = dark ? writePalette(await readAsset(projectDir, DARK_PATH), dark.roles) : null;
    let styleText = await readAsset(projectDir, STYLE_PATH);
    const scalars = [
        ['familyId', family.id], ['displayFont', display], ['bodyFont', body],
        ['cornerRadius', numbers.cornerRadius], ['surface', enums.surface], ['shadowStrength', numbers.shadowStrength],
        ['motion', enums.motion], ['post', post], ['background', enums.background]
    ];
    for (const [key, v] of scalars) styleText = setScalar(styleText, key, v, { doc: ASSET_DOC });
    styleText = setList(styleText, 'worldColors', worldColors.map(unityColor), { doc: ASSET_DOC });

    await fs.writeFile(path.join(projectDir, LIGHT_PATH), lightText);
    if (darkText !== null) await fs.writeFile(path.join(projectDir, DARK_PATH), darkText);
    await fs.writeFile(path.join(projectDir, STYLE_PATH), styleText);

    const warnings = [...light.warnings, ...(dark ? dark.warnings : [])];
    const fellBack = (role) => warnings.some((w) => w.startsWith(`theme: ${role} `));
    return {
        warnings,
        theme: {
            family: family.id,
            ...(themeValue.primary && !fellBack('Primary') ? { primary: themeValue.primary } : {}),
            ...(themeValue.accent && !fellBack('Accent') ? { accent: themeValue.accent } : {}),
            fontPair: pair.id
        }
    };
}

module.exports = { LIGHT_PATH, DARK_PATH, STYLE_PATH, unityFloat, unityColor, applyTheme };
