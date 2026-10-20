'use strict';
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');
const core = require('@cmpose/core');
const { removeEmptyDir, targetProblem } = require('./generate');

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

const NEXT_STEPS_BACKEND = [
    'Create .local-server/config.properties with firebaseProjectId=<your Firebase project id>, then run ./gradlew runLocal (port 18001).',
    // The add-a-feature convention itself, so the step is right whether the sample feature is there or not
    `${core.backend.describeBackend().conventions.newFeature} Then go through SECURITY-CHECKLIST.md.`,
    'Read deploy/README.md for the server contract, the first deployment and updates.'
];

// A local checkout's working files that a released template never holds
const LOCAL_SKIP = new Set(['.git', '.claude', '.idea', '.gradle', '.kotlin', '.local-server', 'build', '.DS_Store']);
const isPending = (ref) => /-PENDING$/.test(ref);
// Secret files a checkout outside git may hold, skipped at every level (deploy/.env.example is the template's own)
const isSecretName = (name) => name !== '.env.example' && (name === '.env' || name.endsWith('.env') || name.startsWith('.env.')
    || /\.(p8|pem|key)$/.test(name) || /^service-account.*\.json$/.test(name)
    || name === 'google-services.json' || name === 'GoogleService-Info.plist');
const LOCAL_DIRTY_WARNING = 'The local template checkout has uncommitted changes; the project holds them.';

const git = (dir, args) => promisify(execFile)('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });

// A git checkout's tracked files (relative paths), or null when dir is not in a git work tree
async function trackedFiles(dir) {
    try {
        await git(dir, ['rev-parse', '--is-inside-work-tree']);
    } catch (err) {
        if (err.code === 'ENOENT' && (await fs.pathExists(path.join(dir, '.git')))) {
            throw new TypeError('git is needed to copy the local template checkout (CMPOSE_BACKEND_TEMPLATE_DIR).');
        }
        return null;
    }
    const { stdout } = await git(dir, ['ls-files', '-z']);
    return stdout.split('\0').filter(Boolean);
}

// Copies a local checkout into work: only git's tracked files, or (outside git) all but the working and secret files.
// Returns the warnings the result carries.
async function copyLocalTemplate(dir, work) {
    const tracked = await trackedFiles(dir);
    if (!tracked) {
        const filter = (src) => !isSecretName(path.basename(src)) && (path.dirname(src) !== dir || !LOCAL_SKIP.has(path.basename(src)));
        await fs.copy(dir, work, { filter });
        return [];
    }
    let copied = 0;
    for (const rel of tracked) {
        if (LOCAL_SKIP.has(rel.split('/')[0])) continue;
        const src = path.join(dir, rel);
        const stat = await fs.lstat(src).catch(() => null);
        // a tracked file deleted in the work tree, or a submodule, is not copied
        if (!stat || stat.isDirectory()) continue;
        await fs.copy(src, path.join(work, rel)); // keeps the mode, so the executable bits too
        copied += 1;
    }
    if (!copied) throw new TypeError('The local template checkout (CMPOSE_BACKEND_TEMPLATE_DIR) has no tracked files.');
    const { stdout } = await git(dir, ['status', '--porcelain', '--untracked-files=no']);
    return stdout.trim() ? [LOCAL_DIRTY_WARNING] : [];
}

// The template source: a local checkout (templateDir / CMPOSE_BACKEND_TEMPLATE_DIR) or the template cache
async function resolveTemplate({ templateRef, templateDir, cacheDir, remoteUrl, cacheEnsure, onProgress }) {
    if (templateDir) {
        const stat = path.isAbsolute(templateDir) ? await fs.stat(templateDir).catch(() => null) : null;
        if (!stat || !stat.isDirectory()) throw new TypeError('CMPOSE_BACKEND_TEMPLATE_DIR must be the absolute path of a backend template checkout.');
        onProgress('Preparing the local template');
        return { dir: templateDir, ref: templateRef || 'local', commit: null, local: true };
    }
    const template = { repo: core.pins.backend.repo, ref: templateRef || core.pins.backend.ref, cacheDir };
    if (isPending(template.ref)) {
        throw new TypeError('The backend template is not released yet; pass templateRef or set CMPOSE_BACKEND_TEMPLATE_DIR.');
    }
    const cached = await core.templateCache.isCached(template);
    onProgress(cached ? 'Preparing the template' : 'Downloading the template (first run only)');
    return cacheEnsure({ ...template, remoteUrl });
}

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
        cache = await resolveTemplate({ templateRef: value.templateRef, templateDir, cacheDir, remoteUrl, cacheEnsure, onProgress });
    } catch (err) {
        if (err instanceof core.TemplateFetchError || err instanceof TypeError) return fail(err.message);
        throw err;
    }

    await fs.ensureDir(value.outputDir);
    const work = path.join(value.outputDir, `.cmpose-${crypto.randomBytes(6).toString('hex')}`);
    try {
        onProgress('Generating the project');
        let localWarnings = [];
        if (cache.local) localWarnings = await copyLocalTemplate(cache.dir, work);
        else await fs.copy(cache.dir, work);
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
