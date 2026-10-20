const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { OLD_PACKAGE_NAME } = require('./templateIdentity');
const { removeMarkedBlock } = require('./readmeService');

// Blank's shell and every requested feature module come from the template itself (the
// blank/ overlay and the compiled feature/sample module). Both steps run BEFORE the package
// rename, on the template's own package, so processAllFiles/movePackageStructure then treat the
// clones like any other module.
// The shell's conditional layers (blank/layers/) are copied over it the same way, so blank needs no
// line-level Kotlin edits for theme or language.

const BLANK_OVERLAY_DIR = 'blank';
// Conditional file layers of the blank shell, copied over it in this order. `release` names the
// template release that brought the layer (the old-template error names it; default B)
const LAYERS_DIR = 'layers';
const BLANK_LAYERS = [
    // Theming off: a plain MaterialTheme that follows the system replaces the themed AppTheme.kt
    { name: 'theming-off', applies: (cfg) => cfg.theming !== true },
    // Multi-Language on: the MainScreen that provides the strings, and generic string keys
    { name: 'multilang', applies: (cfg) => cfg.multiLang === true },
    // Ads without purchases: an ad-free source that never grants premium replaces the RevenueCat one
    { name: 'ads-without-purchases', release: 'monetization', applies: (cfg) => cfg.ads === true && cfg.purchases !== true },
    // Room on: the database holds the Notes demo only (AppDatabase.kt and its schema replace the favorites ones)
    { name: 'room', release: 'room', applies: (cfg) => cfg.room === true }
];
const SAMPLE_MODULE = 'sample';
const SHOWCASE_FEATURES = ['home', 'onboarding'];
// include(":feature:sample") and its four layers, with or without the leading colon
const SAMPLE_INCLUDE_REGEX = /^\s*include\("?:?feature:sample(?::(?:contract|data|domain|presentation))?"\)\s*$/;
// Blank-only features of the template: the showcase drops them (see removeBlankOnlyParts)
const BLANK_ONLY_FEATURES = ['notes'];
const NOTES_INCLUDE_REGEX = /^\s*include\("?:?feature:notes(?::(?:contract|presentation))?"\)\s*$/;
// Cloned modules carry no test sources (Compass counts the iOS tests of a project as the agent's)
const TEST_SOURCE_SET_REGEX = /(^|\/)src\/[^/]*Test\//;
// The template test source sets a blank project keeps: Android-host checks only, never an iOS test. shared's Koin
// graph check, and core/api's contract test (ApiContractTest: the app's models and routes against server/; core/api
// is there only with the backend)
const BLANK_KEPT_TEST_DIRS = ['shared/src/androidHostTest/', 'core/api/src/androidHostTest/'];

function capitalize(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

// ktlint keeps a signature that fits in this many columns on one line, and wraps a longer one
const KTLINT_MAX_SIGNATURE_LENGTH = 100;

// The closing paren of the parameter list opened at `open`, and whether it holds exactly one
// parameter (no comma outside nested parens, brackets, braces and generics). null if unbalanced or
// if a `<`/`>` cannot be proven a generic bracket (a comparison operator in a default argument).
function scanParameterList(line, open) {
    const stack = [];
    const closers = { ')': '(', ']': '[', '}': '{', '>': '<' };
    let commas = 0;
    for (let i = open; i < line.length; i++) {
        const ch = line[i];
        if (ch === '-' && line[i + 1] === '>') { i++; continue; }
        // a spaced `<` / `>` (also `<=`, `>=`) is a comparison, never a generic bracket
        if ((ch === '<' || ch === '>') && line[i - 1] === ' ' && (line[i + 1] === ' ' || line[i + 1] === '=')) return null;
        if ('([{<'.includes(ch)) stack.push(ch);
        else if (ch in closers) {
            if (stack.pop() !== closers[ch]) return null;
            if (stack.length === 0) return { close: i, single: commas === 0 && i > open + 1 };
        } else if (ch === ',' && stack.length === 1) commas++;
    }
    return null;
}

// Rewrites a single-line function signature longer than 100 characters with exactly one parameter
// into ktlint's multi-line form (no trailing comma: compass-kit's intellij_idea style forbids it at
// declaration sites); every other line is left untouched. CRLF lines stay CRLF.
function wrapLongSingleParamSignatures(content) {
    return content.split('\n').map((raw) => {
        const cr = raw.endsWith('\r') ? '\r' : '';
        const line = cr ? raw.slice(0, -1) : raw;
        if (line.length <= KTLINT_MAX_SIGNATURE_LENGTH) return raw;
        const match = /^(\s*)(?:[a-z]+ )*fun\b[^(]*\(/.exec(line);
        if (!match) return raw;
        const open = match[0].length - 1;
        const list = scanParameterList(line, open);
        if (!list || !list.single) return raw;
        const param = line.slice(open + 1, list.close).trim();
        const indent = match[1];
        return `${line.slice(0, open + 1)}${cr}\n${indent}    ${param}${cr}\n${indent}${line.slice(list.close)}${cr}`;
    }).join('\n');
}

async function listFiles(dir) {
    const files = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(full));
        else files.push(full);
    }
    return files;
}

// Showcase: blank's Notes demo (featuresConfig.room) goes, with its entity/DAO and its README part;
// the showcase uses Room for favorites. Runs before the rename, on the template's own package.
// A template without Room has none of it: every step is a no-op.
async function removeBlankOnlyParts(projectPath) {
    for (const feature of BLANK_ONLY_FEATURES) await fs.remove(path.join(projectPath, 'feature', feature));
    const roomSrc = path.join(projectPath, 'core', 'room', 'src');
    if (await fs.pathExists(roomSrc)) {
        for (const sourceSet of await fs.readdir(roomSrc)) {
            await fs.remove(path.join(roomSrc, sourceSet, 'kotlin', ...OLD_PACKAGE_NAME.split('.'), 'core', 'room', 'notes'));
        }
    }
    const settingsPath = path.join(projectPath, 'settings.gradle.kts');
    if (await fs.pathExists(settingsPath)) {
        const content = await fs.readFile(settingsPath, 'utf8');
        const kept = content.split('\n').filter((line) => !NOTES_INCLUDE_REGEX.test(line)).join('\n');
        if (kept !== content) await fs.writeFile(settingsPath, kept);
    }
    const readmePath = path.join(projectPath, 'README.md');
    if (await fs.pathExists(readmePath)) {
        const content = await fs.readFile(readmePath, 'utf8');
        const updated = removeMarkedBlock(content, 'cmpose:room-notes');
        if (updated !== content) await fs.writeFile(readmePath, updated);
    }
}

async function applyBlankShell(projectPath, templateType, featuresConfig = {}) {
    const overlay = path.join(projectPath, BLANK_OVERLAY_DIR);
    if (templateType === 'blank') {
        const layersDir = path.join(overlay, LAYERS_DIR);
        if (!(await fs.pathExists(layersDir))) {
            throw new Error('Template has no blank/layers/ (template older than the B release)');
        }
        const layers = BLANK_LAYERS.filter((layer) => layer.applies(featuresConfig));
        for (const layer of layers) {
            if (!(await fs.pathExists(path.join(layersDir, layer.name)))) {
                throw new Error(`Template has no blank/layers/${layer.name}/ (template older than the ${layer.release || 'B'} release)`);
            }
        }
        // The showcase's own features go before any clone lands (a custom module may be named home)
        for (const feature of SHOWCASE_FEATURES) {
            await fs.remove(path.join(projectPath, 'feature', feature));
        }
        // The shell itself, without its layers
        await fs.copy(overlay, projectPath, {
            overwrite: true,
            filter: (src) => path.relative(overlay, src).split(path.sep)[0] !== LAYERS_DIR
        });
        for (const layer of layers) {
            await fs.copy(path.join(layersDir, layer.name), projectPath, { overwrite: true });
        }
    }
    if (templateType === 'showcase') await removeBlankOnlyParts(projectPath);
    await fs.remove(overlay);
}

// What a blank project's on flags need from the template. A template pinned before the release that
// brought them has none of it; generation then stops before the pipeline runs with a 500 that names the
// missing directories (not the generic verifier 500 after it; not 503, which the contract reserves for the
// concurrency limit that clients retry).
const MONETIZATION_LAYER = BLANK_LAYERS.find((layer) => layer.name === 'ads-without-purchases');
const MONETIZATION_CAPABILITIES = [
    { dir: 'core/purchases', needed: (cfg) => cfg.purchases === true },
    { dir: 'core/ads', needed: (cfg) => cfg.ads === true },
    { dir: 'feature/monetization', needed: (cfg) => cfg.purchases === true || cfg.ads === true },
    { dir: `${BLANK_OVERLAY_DIR}/${LAYERS_DIR}/${MONETIZATION_LAYER.name}`, needed: MONETIZATION_LAYER.applies }
];
// Checked per request only: a readiness check (no config) does not need them, so a template pinned
// before the backend release still serves every other option (server/ comes from the backend template)
const BACKEND_CAPABILITIES = ['core/api', 'core/auth', 'feature/account', 'feature/sharing']
    .map((dir) => ({ dir, needed: (cfg) => cfg.backend === true }));

class TemplateCapabilityError extends Error {
    constructor(missing) {
        super(templateLacksMessage(missing));
        this.name = 'TemplateCapabilityError';
        this.status = 500;
        this.missing = missing;
    }
}

function templateLacksMessage(missing) {
    return `Template lacks ${missing.join(', ')} (older than the release that added them); update templateRef`;
}

// Every directory the template at `templatePath` lacks for `cfg`'s on flags; without a config (a readiness
// check: any of them means the cache is stale), every monetization directory
async function missingTemplateCapabilities(templatePath, cfg = null) {
    const capabilities = cfg ? [...MONETIZATION_CAPABILITIES, ...BACKEND_CAPABILITIES].filter((c) => c.needed(cfg)) : MONETIZATION_CAPABILITIES;
    const missing = [];
    for (const capability of capabilities) {
        if (!(await fs.pathExists(path.join(templatePath, capability.dir)))) missing.push(capability.dir);
    }
    return missing;
}

// Blank only: showcase ignores featuresConfig
async function assertTemplateCapabilities(templatePath, templateType, featuresConfig) {
    if (templateType !== 'blank') return;
    const missing = await missingTemplateCapabilities(templatePath, featuresConfig || {});
    if (missing.length > 0) throw new TemplateCapabilityError(missing);
}

async function cloneModule(sourceDir, targetDir, moduleName) {
    const className = capitalize(moduleName);
    for (const file of await listFiles(sourceDir)) {
        const rel = path.relative(sourceDir, file).split(path.sep).join('/');
        if (TEST_SOURCE_SET_REGEX.test(rel)) continue;
        const renamedRel = rel
            .replace(/\/feature\/sample\//g, `/feature/${moduleName}/`)
            .replace(/(^|\/)Sample([^/]*)$/, `$1${className}$2`);
        const content = await fs.readFile(file, 'utf8');
        let renamed = content
            .replace(/\bfeature\.sample\b/g, `feature.${moduleName}`)
            .replace(/"sample"/g, () => `"${moduleName}"`)
            .replace(/Sample/g, className);
        // A long module name lengthens a signature past ktlint's limit (compass-kit FunctionSignature)
        if (rel.endsWith('.kt')) renamed = wrapLongSingleParamSignatures(renamed);
        await fs.outputFile(path.join(targetDir, renamedRel), renamed);
    }
}

async function cloneFeatureModules(projectPath, features) {
    const samplePath = path.join(projectPath, 'feature', SAMPLE_MODULE);
    const hasSample = await fs.pathExists(samplePath);
    if (features.length > 0 && !hasSample) {
        throw new Error('Template has no feature/sample module (template older than the F29 release)');
    }
    if (hasSample) {
        // Clone from an untouched copy, so a module named "sample" does not copy onto itself
        // (outside the project: it can never end up in the zip, even if cleanup fails)
        const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-sample-'));
        const source = path.join(tmpRoot, 'sample');
        try {
            await fs.move(samplePath, source, { overwrite: true });
            for (const moduleName of features) {
                await cloneModule(source, path.join(projectPath, 'feature', moduleName), moduleName);
            }
        } finally {
            await fs.remove(tmpRoot);
        }
    }
    const settingsPath = path.join(projectPath, 'settings.gradle.kts');
    if (await fs.pathExists(settingsPath)) {
        const content = await fs.readFile(settingsPath, 'utf8');
        const kept = content.split('\n').filter((line) => !SAMPLE_INCLUDE_REGEX.test(line));
        await fs.writeFile(settingsPath, kept.join('\n'));
    }
}

module.exports = {
    applyBlankShell, cloneFeatureModules, wrapLongSingleParamSignatures, capitalize, TEST_SOURCE_SET_REGEX, BLANK_KEPT_TEST_DIRS,
    assertTemplateCapabilities, missingTemplateCapabilities, templateLacksMessage, TemplateCapabilityError
};
