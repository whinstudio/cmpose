'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const core = require('@cmpose/core');
const { DEFAULTS } = require('./describe');
const { resolveBackendTemplate, copyBackendTemplate } = require('./backendTemplate');

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

const NEXT_STEPS = [
    'Open the project folder in Android Studio (it writes local.properties with your Android SDK path).',
    'Run the Android app from Android Studio; for iOS open iosApp/iosApp.xcodeproj in Xcode.',
    'Read README.md for the modules, requirements and release checklist.'
];

async function targetProblem(target) {
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) return null;
    if (!stat.isDirectory()) return `${target} already exists and is a file`;
    if ((await fs.readdir(target)).length > 0) return `${target} already exists and is not empty`;
    return null;
}

// Non-recursive: fails (ENOTEMPTY) if anything appeared at the target since it was checked.
async function removeEmptyDir(dir) {
    await fs.promises.rmdir(dir).catch((err) => { if (err.code !== 'ENOENT') throw err; });
}

// Validate → template cache → generate in a hidden sibling → rename into place.
// Never overwrites anything and never leaves half a project behind.
// A typo in a flag would otherwise just leave the feature out and still report success
function unknownFeaturesConfigKeys(featuresConfig) {
    if (!featuresConfig || typeof featuresConfig !== 'object' || Array.isArray(featuresConfig)) return [];
    return Object.keys(featuresConfig).filter((k) => !core.SCHEMA.featuresConfigKeys.includes(k));
}

// Agents often send numbers; the core takes the hosted generator's strings
function coerceVersions(options) {
    const out = { ...options };
    if (typeof out.minSdk === 'number') out.minSdk = String(out.minSdk);
    if (typeof out.iosVersion === 'number') {
        out.iosVersion = Number.isInteger(out.iosVersion) ? `${out.iosVersion}.0` : String(out.iosVersion);
    }
    return out;
}

const BACKEND_REF_IGNORED = 'backendTemplateRef ignored: featuresConfig.backend is off';
const LOCAL_BACKEND_WARNING = 'server/ was generated from a local backend template checkout (CMPOSE_BACKEND_TEMPLATE_DIR), not a released tag.';

// Blank with backend: server/ comes from the backend template (validated value, or the raw args with the defaults)
const usesBackendTemplate = ({ templateType = DEFAULTS.templateType, featuresConfig } = {}) =>
    templateType === 'blank' && Boolean(featuresConfig) && featuresConfig.backend === true;

// The progress steps of a run: the backend template, the CMP template, the generation
const progressSteps = (args) => (usesBackendTemplate(args || {}) ? 3 : 2);

// backendTemplateDir: a local backend template checkout used instead of the cache (CMPOSE_BACKEND_TEMPLATE_DIR).
// cacheEnsure serves both templates (the tests inject one for the two repos).
async function runGenerate(args, {
    cacheDir, remoteUrl, onProgress = () => { }, generatorVersion = null,
    backendTemplateDir = null, cacheEnsure = core.templateCache.ensure
} = {}) {
    const { outputDir, templateRef, backendTemplateRef, ...rest } = args || {};
    const options = coerceVersions(rest);
    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) {
        return fail('outputDir must be an absolute path (for example /path/to/projects).');
    }
    const unknown = unknownFeaturesConfigKeys(options.featuresConfig);
    if (unknown.length > 0) {
        return fail(`Unknown featuresConfig key(s): ${unknown.join(', ')}. ` +
            `Valid keys: ${core.SCHEMA.featuresConfigKeys.join(', ')}.`);
    }
    const checked = core.validate({ ...DEFAULTS, ...options });
    if (!checked.ok) return fail(checked.error);
    const value = checked.value;
    const target = path.join(outputDir, value.projectName);
    const withBackend = usesBackendTemplate(value);
    if (withBackend && backendTemplateRef !== undefined) {
        const refProblem = core.backend.templateRefProblem(backendTemplateRef, 'backendTemplateRef');
        if (refProblem) return fail(refProblem);
    }
    const problem = await targetProblem(target);
    if (problem) return fail(problem);

    const template = { repo: core.pins.cmp.repo, ref: templateRef || core.pins.cmp.ref, cacheDir };
    let cache;
    let backend = null;
    try {
        // Before the CMP template: a PENDING pin or a bad checkout fails before anything is downloaded or written.
        // remoteUrl names the CMP template's remote, so the backend template keeps its own.
        if (withBackend) {
            backend = await resolveBackendTemplate({
                templateRef: backendTemplateRef, templateDir: backendTemplateDir, cacheDir, cacheEnsure,
                onProgress: (m) => onProgress(m.replace(/\btemplate\b/, 'server template'))
            });
        }
        const cached = await core.templateCache.isCached(template);
        onProgress(cached ? 'Preparing the template' : 'Downloading the template (first run only)');
        cache = await cacheEnsure({ ...template, remoteUrl });
    } catch (err) {
        if (err instanceof core.TemplateFetchError || err instanceof TypeError) return fail(err.message);
        throw err;
    }
    const versions = await core.readTemplateVersions(cache.dir);
    const sdkError = core.minSdkAboveTarget(value.minSdk, versions.targetSdk);
    if (sdkError) return fail(sdkError);

    await fs.ensureDir(outputDir);
    const work = path.join(outputDir, `.cmpose-${crypto.randomBytes(6).toString('hex')}`);
    // The backend template's raw copy, beside the work dir; core places it as server/
    const serverRaw = `${work}-server`;
    try {
        onProgress('Generating the project');
        let backendWarnings = [];
        if (backend) backendWarnings = await copyBackendTemplate(backend, serverRaw);
        await fs.copy(cache.dir, work);
        const summary = await core.generateCmpProject(value, {
            projectDir: work, generatorVersion,
            ...(backend ? { backendTemplate: { dir: serverRaw, repo: backend.repo, ref: backend.ref, commit: backend.commit } } : {})
        });
        const late = await targetProblem(target);
        if (late) throw new Error(late);
        await removeEmptyDir(target); // never recursive: a concurrent run's project stays intact
        await fs.rename(work, target);
        const warnings = [...summary.warnings];
        if (value.templateType === 'showcase' && options.featuresConfig !== undefined) {
            warnings.push('featuresConfig is ignored for showcase (it applies to blank only); the showcase template has its own fixed feature set');
        }
        if (!withBackend && backendTemplateRef !== undefined) warnings.push(BACKEND_REF_IGNORED);
        if (backend && backend.local) warnings.push(LOCAL_BACKEND_WARNING, ...backendWarnings);
        const result = {
            projectDir: target,
            template: { repo: core.pins.cmp.repo, ref: cache.ref, commit: cache.commit },
            templateType: summary.templateType,
            features: summary.features,
            featuresConfig: value.templateType === 'blank' ? value.featuresConfig : null,
            ...(backend ? { backendTemplate: { repo: backend.repo, ref: backend.ref, commit: backend.commit } } : {}),
            warnings,
            nextSteps: NEXT_STEPS
        };
        const text = [
            `Generated ${value.projectName} at ${target}`,
            `Template: ${result.template.repo}@${result.template.ref} (${String(cache.commit).slice(0, 7)})`,
            ...(backend ? [`Server template: ${backend.repo}@${backend.ref}${backend.commit ? ` (${String(backend.commit).slice(0, 7)})` : ''}`] : []),
            ...warnings.map((w) => `Warning: ${w}`),
            'Next steps:', ...NEXT_STEPS.map((s) => `- ${s}`)
        ].join('\n');
        return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (err) {
        await fs.remove(work).catch(() => { });
        return fail(`Generation failed: ${err.message}`);
    } finally {
        await fs.remove(serverRaw).catch(() => { });
    }
}

module.exports = { runGenerate, progressSteps, removeEmptyDir, targetProblem, NEXT_STEPS };
