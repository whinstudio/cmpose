'use strict';
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { COMMIT_FILE_NAME, REF_FILE_NAME } = require('./templateVersions');

const run = promisify(execFile);
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_TMP_MS = 60 * 60 * 1000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;

class TemplateFetchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TemplateFetchError';
    }
}

function defaultCacheDir(env = process.env) {
    if (env.CMPOSE_CACHE_DIR) return env.CMPOSE_CACHE_DIR;
    return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cmpose');
}

async function readMarker(dir, name) {
    return fs.readFile(path.join(dir, name), 'utf8').then((v) => v.trim() || null, () => null);
}

const readCommit = (dir) => readMarker(dir, COMMIT_FILE_NAME);

// Only an immutable ref may be served from disk: a full commit SHA, or a ref the clone recorded as a tag.
// A branch moves, so it is never served without asking the remote first.
async function servableFromCache(dir, ref) {
    if (!(await readCommit(dir))) return false;
    return SHA_RE.test(ref) || (await readMarker(dir, REF_FILE_NAME)) === `refs/tags/${ref}`;
}

// Interrupted clones leave .tmp-* directories; drop the old ones
async function removeStaleTemps(parent) {
    const entries = await fs.readdir(parent).catch(() => []);
    for (const name of entries.filter((n) => n.startsWith('.tmp-'))) {
        const full = path.join(parent, name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > STALE_TMP_MS) await fs.remove(full).catch(() => { });
    }
}

function validateTarget(repo, ref) {
    if (!REPO_RE.test(repo || '') || repo.split('/').some((p) => p === '.' || p === '..')) throw new TypeError(`invalid template repo: ${repo}`);
    if (!REF_RE.test(ref || '') || ref.startsWith('.')) throw new TypeError(`invalid template ref: ${ref}`);
}

function templateDir(cacheDir, repo, ref) {
    return path.join(cacheDir, 'templates', repo.replace('/', '__'), ref);
}

// True when ensure() will serve this ref from disk without asking the remote
async function isCached({ repo, ref, cacheDir = defaultCacheDir() } = {}) {
    validateTarget(repo, ref);
    return servableFromCache(templateDir(cacheDir, repo, ref), ref);
}

// An empty credential.helper: no credential manager can pop up a prompt (public repo)
function remoteGit(args) {
    return run('git', ['-c', 'credential.helper=', ...args], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: CLONE_TIMEOUT_MS
    });
}

// What the ref names on the remote. A branch wins over a tag of the same name, as it does for git clone --branch.
async function resolveRemoteRef(url, ref) {
    if (SHA_RE.test(ref)) return { kind: 'commit', marker: ref, commit: ref };
    const { stdout } = await remoteGit(['ls-remote', url, `refs/heads/${ref}`, `refs/tags/${ref}`]);
    const names = new Map(stdout.split('\n').filter(Boolean).map((line) => line.split('\t').reverse()));
    if (names.has(`refs/heads/${ref}`)) return { kind: 'branch', marker: `refs/heads/${ref}`, commit: names.get(`refs/heads/${ref}`) };
    if (names.has(`refs/tags/${ref}`)) return { kind: 'tag', marker: `refs/tags/${ref}`, commit: null };
    throw new Error(`no branch or tag named ${ref} on the remote`);
}

async function download(url, ref, tmp) {
    if (SHA_RE.test(ref)) {
        // clone --branch takes no SHA: fetch that one commit into an empty repository
        await run('git', ['init', '--quiet', tmp]);
        await remoteGit(['-C', tmp, 'fetch', '--quiet', '--depth', '1', url, ref]);
        await run('git', ['-C', tmp, 'checkout', '--quiet', 'FETCH_HEAD']);
    } else {
        await remoteGit(['clone', '--quiet', '--depth', '1', '--branch', ref, url, tmp]);
    }
    const { stdout } = await run('git', ['-C', tmp, 'rev-parse', 'HEAD']);
    return stdout.trim();
}

// Moves a finished clone into place. A branch replaces the older clone it supersedes; a tag or SHA keeps
// whichever complete clone got there first.
async function install(tmp, dir, parent, replace) {
    if (await fs.pathExists(dir) && (replace || !(await readCommit(dir)))) {
        const old = path.join(parent, `.tmp-${crypto.randomBytes(6).toString('hex')}`);
        await fs.rename(dir, old).catch(() => { }); // a concurrent run may have moved it already
        await fs.remove(old).catch(() => { });
    }
    try {
        await fs.rename(tmp, dir);
    } catch (err) {
        if (!(await readCommit(dir))) throw err; // lost the race to a complete clone: use it
        await fs.remove(tmp);
    }
}

// A tag or a full commit SHA is immutable: clone it once (shallow, no credentials), then serve it from disk.
// A branch moves: every call asks the remote for its head and clones again when the cached commit is behind.
// The clone lands in a temporary sibling and is renamed into place, so readers never see half a template.
async function ensure({ repo, ref, cacheDir = defaultCacheDir(), remoteUrl } = {}) {
    validateTarget(repo, ref);

    const dir = templateDir(cacheDir, repo, ref);
    const parent = path.dirname(dir);
    if (await servableFromCache(dir, ref)) return { dir, ref, commit: await readCommit(dir) };

    const url = remoteUrl || `https://github.com/${repo}.git`;
    let tmp = null;
    try {
        const remote = await resolveRemoteRef(url, ref);
        const cached = await readCommit(dir);
        if (remote.kind === 'branch' && cached === remote.commit && (await readMarker(dir, REF_FILE_NAME)) === remote.marker) {
            return { dir, ref, commit: cached };
        }

        await fs.ensureDir(parent);
        await removeStaleTemps(parent);
        tmp = path.join(parent, `.tmp-${crypto.randomBytes(6).toString('hex')}`);
        const commit = await download(url, ref, tmp);
        await fs.remove(path.join(tmp, '.git'));
        await fs.writeFile(path.join(tmp, COMMIT_FILE_NAME), `${commit}\n`);
        await fs.writeFile(path.join(tmp, REF_FILE_NAME), `${remote.marker}\n`);
        await install(tmp, dir, parent, remote.kind === 'branch');
        return { dir, ref, commit: await readCommit(dir) };
    } catch (err) {
        if (tmp) await fs.remove(tmp).catch(() => { });
        const reason = err.code === 'ENOENT'
            ? 'git is not installed or not on PATH'
            : String(err.stderr || err.message).trim().split('\n').pop();
        throw new TemplateFetchError(
            `Could not download the template ${repo}@${ref}: ${reason}. Check that git is installed and the network is reachable.`
        );
    }
}

module.exports = { ensure, isCached, defaultCacheDir, TemplateFetchError };
