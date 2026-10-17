'use strict';
const path = require('path');
const fs = require('fs-extra');

// The template owns its style families (palettes, style, font pairs); older pins have no such file
const THEMES_PATH = path.join('.cmpose', 'themes.json');
const THEME_FIELDS = ['family', 'primary', 'accent', 'fontPair'];
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
// Palette entries: #RRGGBB or #RRGGBBAA (Scrim carries alpha)
const PALETTE_HEX_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;

// A template's themes.json that is there but cannot be used
class ThemesFileError extends Error { }

function broken(why) {
    return new ThemesFileError(`${THEMES_PATH.split(path.sep).join('/')} is not valid: ${why}`);
}

function checkPalette(id, name, palette) {
    if (!isObject(palette)) throw broken(`family "${id}" has no ${name} palette`);
    for (const [key, value] of Object.entries(palette)) {
        if (typeof value !== 'string' || !PALETTE_HEX_RE.test(value)) throw broken(`family "${id}" ${name}.${key} is not a #RRGGBB colour`);
    }
}

function checkFamily(f) {
    if (!isObject(f) || !isText(f.id)) throw broken('a family has no id');
    checkPalette(f.id, 'light', f.light);
    checkPalette(f.id, 'dark', f.dark);
    if (!isObject(f.style)) throw broken(`family "${f.id}" has no style`);
    if (!Array.isArray(f.fontPairs) || !f.fontPairs.length) throw broken(`family "${f.id}" has no font pairs`);
    for (const p of f.fontPairs) {
        if (!isObject(p) || !isText(p.id) || !isText(p.display) || !isText(p.body)) throw broken(`family "${f.id}" has a font pair without id, display or body`);
    }
    return {
        id: f.id, title: f.title, suits: f.suits,
        light: { ...f.light }, dark: { ...f.dark }, style: { ...f.style },
        fontPairs: f.fontPairs.map((p) => ({ id: p.id, display: p.display, body: p.body }))
    };
}

/** The template's style families from .cmpose/themes.json; no families when the file is missing.
 * A file that is there but broken throws: the generator must not guess a theme. */
async function readThemes(templateDir) {
    const file = path.join(templateDir, THEMES_PATH);
    if (!(await fs.pathExists(file))) return { version: null, default: null, families: [] };
    let data;
    try {
        data = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        throw broken('not JSON');
    }
    if (!isObject(data) || !Array.isArray(data.families)) throw broken('no families list');
    const families = data.families.map(checkFamily);
    const ids = families.map((f) => f.id);
    if (new Set(ids).size !== ids.length) throw broken('duplicate family ids');
    if (!ids.includes(data.default)) throw broken(`default "${data.default}" is not a family`);
    return { version: data.version, default: data.default, families };
}

/** theme's shape alone (validateGame has no template): an object of known string fields, colours as #RRGGBB.
 * value keeps the given fields, colours uppercased. */
function checkThemeShape(theme) {
    if (!isObject(theme)) return { error: 'theme must be an object' };
    const extra = Object.keys(theme).filter((k) => !THEME_FIELDS.includes(k));
    if (extra.length) return { error: `theme has unknown fields: ${extra.join(', ')} (known: ${THEME_FIELDS.join(', ')})` };
    const value = {};
    for (const k of THEME_FIELDS) {
        if (!Object.hasOwn(theme, k)) continue;
        const v = theme[k];
        if (typeof v !== 'string') return { error: `theme.${k} must be a string` };
        if ((k === 'primary' || k === 'accent') && !HEX_RE.test(v)) return { error: `theme.${k} must look like #RRGGBB` };
        value[k] = k === 'primary' || k === 'accent' ? v.toUpperCase() : v;
    }
    return { value };
}

// Errors list the valid ids but never echo the request's value back
/** A theme request against the template's families (readThemes). value: { family, primary?, accent?, fontPair },
 * the default family and each family's first font pair filling gaps; null when the template has no families and
 * none was asked for. */
function validateTheme(theme, themes) {
    const families = themes && Array.isArray(themes.families) ? themes.families : [];
    const asked = theme !== undefined && theme !== null;
    if (!families.length) {
        return asked ? { ok: false, error: 'theme cannot be used: this template has no theme families' } : { ok: true, value: null };
    }
    const shape = asked ? checkThemeShape(theme) : { value: {} };
    if (shape.error) return { ok: false, error: shape.error };
    const t = shape.value;
    const ids = families.map((f) => f.id);
    const familyId = t.family === undefined ? themes.default : t.family;
    const family = families.find((f) => f.id === familyId);
    if (!family) return { ok: false, error: `theme.family must be one of this template's families: ${ids.join(', ')}` };
    const pairs = family.fontPairs.map((p) => p.id);
    const fontPair = t.fontPair === undefined ? pairs[0] : t.fontPair;
    if (!pairs.includes(fontPair)) return { ok: false, error: `theme.fontPair must be one of ${family.id}'s font pairs: ${pairs.join(', ')}` };
    return {
        ok: true,
        value: {
            family: family.id,
            ...(t.primary ? { primary: t.primary } : {}),
            ...(t.accent ? { accent: t.accent } : {}),
            fontPair
        }
    };
}

module.exports = { THEMES_PATH, THEME_FIELDS, ThemesFileError, readThemes, validateTheme, checkThemeShape };
