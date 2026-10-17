'use strict';
const PV = require('../ProjectValidator');
const limits = require('../limits');
const { GAME_SCHEMA: S } = require('./contract');
const { checkThemeShape } = require('./themes');

const CSHARP_KEYWORDS = ('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while').split(' ');
const KOTLIN_KEYWORDS = PV.KOTLIN_HARD_KEYWORDS;

const NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,29}$/;
const PACKAGE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/;
const MODULE_RE = /^[a-z][a-z0-9]{0,19}$/;
// 'M', 'M.m' or 'M.m.0' (leading zeros allowed); normalized to 'M.m'
const IOS_VERSION_RE = /^(\d+)(?:\.(\d+)(?:\.(0+))?)?$/;

// Each ID's pattern and the shape an error message names
const ADMOB_APP = { re: /^ca-app-pub-\d{16}~\d{10}$/, shape: 'ca-app-pub-<16 digits>~<10 digits>' };
const ADMOB_UNIT = { re: /^ca-app-pub-\d{16}\/\d{10}$/, shape: 'ca-app-pub-<16 digits>/<10 digits>' };
const GPGS_ID = { re: /^[A-Za-z0-9_-]{4,64}$/, shape: '4-64 letters, digits, _ or -' };
const GC_ID = { re: /^[A-Za-z0-9._-]{1,100}$/, shape: '1-100 letters, digits, ., _ or -' };
const ID_FORMATS = {
    admob: {
        androidAppId: ADMOB_APP, iosAppId: ADMOB_APP,
        androidBanner: ADMOB_UNIT, androidInterstitial: ADMOB_UNIT, androidRewarded: ADMOB_UNIT,
        iosBanner: ADMOB_UNIT, iosInterstitial: ADMOB_UNIT, iosRewarded: ADMOB_UNIT
    },
    revenueCat: {
        appleApiKey: { re: /^appl_[A-Za-z0-9]{20,}$/, shape: 'appl_ followed by at least 20 letters or digits' },
        googleApiKey: { re: /^goog_[A-Za-z0-9]{20,}$/, shape: 'goog_ followed by at least 20 letters or digits' }
    },
    gameServices: {
        androidAppId: { re: /^\d{6,20}$/, shape: '6-20 digits' },
        leaderboardAndroid: GPGS_ID, firstCompletionAndroid: GPGS_ID, tenCompletionsAndroid: GPGS_ID,
        leaderboardIos: GC_ID, firstCompletionIos: GC_ID, tenCompletionsIos: GC_ID
    }
};

// Why an ID value is rejected (null = valid). The value is written into C#, XML and YAML lines.
function idProblem(group, field, v) {
    if (typeof v !== 'string') return 'must be a string';
    if (/["\\$\r\n]/.test(v)) return 'must not contain ", \\, $ or a line break';
    if (/replace_me/i.test(v)) return 'is a placeholder (REPLACE_ME): use your real ID';
    const { re, shape } = ID_FORMATS[group][field];
    return re.test(v) ? null : `must look like ${shape}`;
}

const fail = (error) => ({ ok: false, error });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inList = (list, word, ci) => list.includes(ci ? String(word).toLowerCase() : word);

function checkName(field, value) {
    if (typeof value !== 'string' || !NAME_RE.test(value)) return `${field} must be 1-${S.limits.nameMax} letters or digits, starting with a letter`;
    if (inList(CSHARP_KEYWORDS, value, false)) return `${field} must not be a C# keyword`;
    if (S.reservedNames.includes(value)) return `${field} is reserved`;
    return null;
}

function parseIosVersion(v) {
    return String(v).split('.').map(Number);
}
// '015.0' / '15.0.0' / '15' -> '15.0'; null when not a version this accepts
function normalizeIosVersion(v) {
    const m = typeof v === 'string' ? IOS_VERSION_RE.exec(v) : null;
    return m ? `${Number(m[1])}.${Number(m[2] || 0)}` : null;
}
function cmpVersion(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d;
    }
    return 0;
}

function validateIds(ids, flags) {
    if (!isObject(ids)) return { error: 'ids must be an object' };
    const out = {};
    for (const group of Object.keys(ids)) {
        const def = Object.hasOwn(S.idGroups, group) ? S.idGroups[group] : null;
        if (!def) return { error: `ids.${group} is not a known group (${Object.keys(S.idGroups).join(', ')})` };
        const g = ids[group];
        if (!isObject(g)) return { error: `ids.${group} must be an object` };
        const missing = def.fields.filter((f) => !Object.hasOwn(g, f));
        if (missing.length) return { error: `ids.${group} is missing: ${missing.join(', ')}` };
        const extra = Object.keys(g).filter((f) => !def.fields.includes(f));
        if (extra.length) return { error: `ids.${group} has unknown fields: ${extra.join(', ')} (known: ${def.fields.join(', ')})` };
        if (!flags.includes(def.flag)) return { error: `ids.${group} needs the ${def.flag} flag` };
        out[group] = {};
        for (const f of def.fields) {
            const problem = idProblem(group, f, g[f]);
            if (problem) return { error: `ids.${group}.${f} ${problem}` };
            out[group][f] = g[f];
        }
    }
    return { value: out };
}

function validateGame(input) {
    if (!isObject(input)) return fail('input must be an object');
    const { projectName, appName, packageName } = input;

    let err = checkName('projectName', projectName);
    if (err) return fail(err);

    if (typeof appName !== 'string' || !PV.validateAppName(appName) || appName.length > S.limits.appNameMax) return fail(PV.messages.appNameInvalid.replace('App Name', 'appName'));

    if (typeof packageName !== 'string' || !PACKAGE_RE.test(packageName) || packageName.length > S.limits.packageNameMax) {
        return fail(`packageName must look like com.company.app (lowercase, at least 3 segments, up to ${S.limits.packageNameMax} characters)`);
    }
    const segments = packageName.split('.');
    if (segments.some((s) => inList(CSHARP_KEYWORDS, s, true) || inList(KOTLIN_KEYWORDS, s, true))) return fail('packageName must not contain a keyword segment');
    if (packageName === S.reservedPackagePrefix || packageName.startsWith(S.reservedPackagePrefix + '.')) return fail('packageName must not use the reserved com.kturker prefix');

    // Without companyName it comes from packageName's second segment: an error then points at packageName
    const derived = input.companyName === undefined;
    const companyName = derived ? segments[1][0].toUpperCase() + segments[1].slice(1) : input.companyName;
    err = checkName('companyName', companyName);
    if (err) return fail(derived ? `${err} (companyName "${companyName}" is derived from packageName's second segment: shorten it there or set companyName)` : err);

    const templateType = input.templateType === undefined ? 'showcase' : input.templateType;
    if (!S.templateTypes.includes(templateType)) return fail(`templateType must be one of: ${S.templateTypes.join(', ')}`);
    const render = input.render === undefined ? '2d' : input.render;
    if (!S.renders.includes(render)) return fail(`render must be one of: ${S.renders.join(', ')}`);

    const blank = templateType === 'blank';
    if (!blank && input.flags !== undefined) return fail('flags apply to blank only');
    if (!blank && input.features !== undefined) return fail('features apply to blank only');

    let flags = S.flags.slice();
    if (blank) {
        const wanted = input.flags === undefined ? [] : input.flags;
        if (!Array.isArray(wanted) || wanted.some((f) => !S.flags.includes(f))) return fail(`flags must be an array of: ${S.flags.join(', ')}`);
        const set = new Set(wanted);
        for (const f of wanted) for (const r of (Object.hasOwn(S.flagRequires, f) ? S.flagRequires[f] : [])) set.add(r);
        flags = S.flags.filter((f) => set.has(f));
    }

    let features = [];
    if (blank && input.features !== undefined) {
        const list = input.features;
        if (!Array.isArray(list)) return fail('features must be an array');
        if (list.length > S.limits.maxModules) return fail(`features allows at most ${S.limits.maxModules} entries`);
        for (const f of list) {
            if (typeof f !== 'string' || !MODULE_RE.test(f)) return fail(`features entry "${f}" must be 1-${S.limits.moduleNameMax} lowercase letters or digits, starting with a letter`);
            if (inList(CSHARP_KEYWORDS, f, true) || inList(KOTLIN_KEYWORDS, f, true)) return fail(`features entry "${f}" is a keyword`);
            if (S.reservedModuleNames.includes(f)) return fail(`features entry "${f}" is reserved`);
        }
        if (new Set(list).size !== list.length) return fail('features must not contain duplicates');
        features = list.slice();
    }

    let minSdk = S.limits.minSdkMin;
    if (input.minSdk !== undefined) {
        const raw = input.minSdk;
        const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN);
        if (!Number.isInteger(n) || n < S.limits.minSdkMin || n > S.limits.minSdkMax) return fail(`minSdk must be an integer from ${S.limits.minSdkMin} to ${S.limits.minSdkMax}`);
        minSdk = n;
    }

    let iosVersion = S.limits.iosVersionMin;
    if (input.iosVersion !== undefined) {
        let v = input.iosVersion;
        if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
        v = normalizeIosVersion(v);
        if (v === null) return fail('iosVersion must look like 15.0 (major.minor; a third part must be 0)');
        if (cmpVersion(parseIosVersion(v), parseIosVersion(S.limits.iosVersionMin)) < 0
            || cmpVersion(parseIosVersion(v), parseIosVersion(limits.iosVersionMax)) > 0) {
            return fail(`iosVersion must be from ${S.limits.iosVersionMin} to ${limits.iosVersionMax}`);
        }
        iosVersion = v;
    }

    // GameCI is not offered for Unity games: false (or absent) is accepted and dropped
    if (input.ci !== undefined && typeof input.ci !== 'boolean') return fail('ci must be a boolean');
    if (input.ci === true) return fail('ci is not offered for Unity games');

    let ids = {};
    if (input.ids !== undefined) {
        const r = validateIds(input.ids, flags);
        if (r.error) return fail(r.error);
        ids = r.value;
    }

    // The family and font pair are checked against the template's themes.json later (validateTheme)
    let theme = null;
    if (input.theme !== undefined) {
        const r = checkThemeShape(input.theme);
        if (r.error) return fail(r.error);
        theme = r.value;
    }

    return {
        ok: true,
        value: { projectName, appName, packageName, companyName, templateType, render, flags, features, minSdk, iosVersion, ids, theme }
    };
}

module.exports = { validateGame, idProblem };
