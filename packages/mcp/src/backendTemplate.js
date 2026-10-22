'use strict';
// The backend template's source for backend_generate and for cmp_generate's server/ (blank with backend):
// a local checkout (CMPOSE_BACKEND_TEMPLATE_DIR) or the template cache at the pinned (or given) tag
const path = require('path');
const fs = require('fs-extra');
const core = require('@cmpose/core');

const { copyTrackedFiles, LOCAL_SKIP, NotACheckoutError } = core.backend;
const isPending = (ref) => /-PENDING$/.test(ref);
// Secret files a checkout outside git may hold, skipped at every level (deploy/.env.example is the template's own)
const isSecretName = (name) => name !== '.env.example' && (name === '.env' || name.endsWith('.env') || name.startsWith('.env.')
    || /\.(p8|pem|key)$/.test(name) || /^service-account.*\.json$/.test(name)
    || name === 'google-services.json' || name === 'GoogleService-Info.plist');
const LOCAL_DIRTY_WARNING = 'The local template checkout has uncommitted changes; the project holds them.';

// Copies a local checkout into dest: only git's tracked files, or (outside git) all but the working and secret files.
// Returns the warnings the result carries.
async function copyLocalTemplate(dir, dest) {
    let copy;
    try {
        copy = await copyTrackedFiles(dir, dest);
    } catch (err) {
        if (err instanceof NotACheckoutError) {
            if (err.cause?.code === 'ENOENT' && (await fs.pathExists(path.join(dir, '.git')))) {
                throw new TypeError('git is needed to copy the local template checkout (CMPOSE_BACKEND_TEMPLATE_DIR).');
            }
            const filter = (src) => !isSecretName(path.basename(src)) && (path.dirname(src) !== dir || !LOCAL_SKIP.has(path.basename(src)));
            await fs.copy(dir, dest, { filter });
            return [];
        }
        if (err instanceof TypeError && err.message === 'no tracked files') {
            throw new TypeError('The local template checkout (CMPOSE_BACKEND_TEMPLATE_DIR) has no tracked files.');
        }
        throw err;
    }
    return copy.dirty ? [LOCAL_DIRTY_WARNING] : [];
}

// The template source: a local checkout (templateDir / CMPOSE_BACKEND_TEMPLATE_DIR) or the template cache.
// Throws TypeError (bad local path, PENDING pin) or core.TemplateFetchError (download).
// refField names the caller's ref input in the PENDING hint; label names the template in the progress messages.
async function resolveBackendTemplate({
    templateRef, templateDir, cacheDir, remoteUrl, cacheEnsure = core.templateCache.ensure, onProgress = () => { },
    refField = 'templateRef', label = 'template'
}) {
    const repo = core.pins.backend.repo;
    if (templateDir) {
        const stat = path.isAbsolute(templateDir) ? await fs.stat(templateDir).catch(() => null) : null;
        if (!stat || !stat.isDirectory()) throw new TypeError('CMPOSE_BACKEND_TEMPLATE_DIR must be the absolute path of a backend template checkout.');
        onProgress(`Preparing the local ${label}`);
        return { dir: templateDir, repo, ref: templateRef || 'local', commit: null, local: true };
    }
    const template = { repo, ref: templateRef || core.pins.backend.ref, cacheDir };
    if (isPending(template.ref)) {
        throw new TypeError(`The backend template is not released yet; pass ${refField} or set CMPOSE_BACKEND_TEMPLATE_DIR.`);
    }
    const cached = await core.templateCache.isCached(template);
    onProgress(cached ? `Preparing the ${label}` : `Downloading the ${label} (first run only)`);
    const cache = await cacheEnsure({ ...template, remoteUrl });
    return { dir: cache.dir, repo, ref: cache.ref, commit: cache.commit, local: false };
}

// Copies a resolved template into dest (a fresh directory): a local checkout through copyLocalTemplate, a cached tag as is.
// Returns the warnings the copy raises (a dirty local checkout).
async function copyBackendTemplate(resolved, dest) {
    if (resolved.local) return copyLocalTemplate(resolved.dir, dest);
    await fs.copy(resolved.dir, dest);
    return [];
}

module.exports = { resolveBackendTemplate, copyBackendTemplate, isPending };
