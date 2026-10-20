'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const core = require('@cmpose/core');
const { removeEmptyDir, targetProblem } = require('./generate');
const { resolveBackendTemplate, copyBackendTemplate } = require('./backendTemplate');

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

const NEXT_STEPS_BACKEND = [
    'Create .local-server/config.properties with firebaseProjectId=<your Firebase project id>, then run ./gradlew runLocal (port 18001).',
    // The add-a-feature convention itself, so the step is right whether the sample feature is there or not
    `${core.backend.describeBackend().conventions.newFeature} Then go through SECURITY-CHECKLIST.md.`,
    'Read deploy/README.md for the server contract, the first deployment and updates.'
];

// Validate → template cache → generate in a hidden sibling → rename into place (the runGameGenerate flow).
// Never overwrites anything and never leaves half a project behind.
async function runBackendGenerate(args, {
    cacheDir, remoteUrl, templateDir = null, cacheEnsure = core.templateCache.ensure,
    onProgress = () => { }, generatorVersion = null, now
} = {}) {
    const checked = core.backend.validateBackend(args);
    if (!checked.ok) return fail(['Invalid input:', ...checked.errors.map((e) => `- ${e.field}: ${e.message}`)].join('\n'));
    const value = checked.value;
    const target = path.join(value.outputDir, value.projectName);
    const problem = await targetProblem(target);
    if (problem) return fail(problem);

    let cache;
    try {
        cache = await resolveBackendTemplate({ templateRef: value.templateRef, templateDir, cacheDir, remoteUrl, cacheEnsure, onProgress });
    } catch (err) {
        if (err instanceof core.TemplateFetchError || err instanceof TypeError) return fail(err.message);
        throw err;
    }

    await fs.ensureDir(value.outputDir);
    const work = path.join(value.outputDir, `.cmpose-${crypto.randomBytes(6).toString('hex')}`);
    try {
        onProgress('Generating the project');
        const localWarnings = await copyBackendTemplate(cache, work);
        // Called through core.backend at call time (never destructured): the tests replace it to fail mid-generation
        const { record } = await core.backend.generateBackend(value, {
            projectDir: work, templateRef: cache.ref, templateCommit: cache.commit, generatorVersion, ...(now ? { now } : {})
        });
        const late = await targetProblem(target);
        if (late) throw new Error(late);
        await removeEmptyDir(target); // never recursive: a concurrent run's project stays intact
        await fs.rename(work, target);
        const warnings = cache.local
            ? ['Generated from a local template checkout (CMPOSE_BACKEND_TEMPLATE_DIR), not a released tag.', ...localWarnings] : [];
        const result = {
            projectDir: target, sharing: value.sharing, sample: value.sample, template: record.template, record, warnings, nextSteps: NEXT_STEPS_BACKEND
        };
        const text = [
            `Generated ${value.projectName} at ${target}`,
            `Template: ${record.template.repo}@${record.template.ref}${record.template.commit ? ` (${String(record.template.commit).slice(0, 7)})` : ''}`,
            `Sharing: ${value.sharing ? 'on' : 'off'}`,
            `Sample: ${value.sample ? 'on' : 'off'}`,
            ...warnings.map((w) => `Warning: ${w}`),
            'Next steps:', ...NEXT_STEPS_BACKEND.map((s) => `- ${s}`)
        ].join('\n');
        return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (err) {
        await fs.remove(work).catch(() => { });
        return fail(`Generation failed: ${err.message}`);
    }
}

module.exports = { runBackendGenerate, NEXT_STEPS_BACKEND };
