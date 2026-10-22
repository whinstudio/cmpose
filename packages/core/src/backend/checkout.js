'use strict';
// Copies a local backend template checkout: only git's tracked files, as the working tree holds them
// (used by @cmpose/mcp for CMPOSE_BACKEND_TEMPLATE_DIR and by the release tools)
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');

// A local checkout's working files that a released template never holds
const LOCAL_SKIP = new Set(['.git', '.claude', '.idea', '.gradle', '.kotlin', '.local-server', 'build', '.DS_Store']);

// dir is not inside a git work tree; cause is git's error (code ENOENT when git itself is missing)
class NotACheckoutError extends Error {
    constructor(dir, cause) {
        super(`${dir} is not inside a git work tree.`, { cause });
        this.name = 'NotACheckoutError';
    }
}

const git = (dir, args) => promisify(execFile)('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });

// Copies dir's tracked files into dest, keeping their modes (so the executable bits too).
// Skips a path whose first segment is in LOCAL_SKIP, and a tracked path deleted in the work tree or a submodule.
// Returns { commit (HEAD, null before the first commit), copied (file count), dirty (uncommitted changes to tracked files) }.
// Throws NotACheckoutError (dir is not in a git work tree) or TypeError('no tracked files') (nothing to copy).
async function copyTrackedFiles(dir, dest) {
    let inside;
    try {
        inside = (await git(dir, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
    } catch (err) {
        throw new NotACheckoutError(dir, err);
    }
    if (inside !== 'true') throw new NotACheckoutError(dir); // a .git directory or a bare repository
    const { stdout: listed } = await git(dir, ['ls-files', '-z']);
    let copied = 0;
    for (const rel of listed.split('\0').filter(Boolean)) {
        if (LOCAL_SKIP.has(rel.split('/')[0])) continue;
        const src = path.join(dir, rel);
        const stat = await fs.lstat(src).catch(() => null);
        if (!stat || stat.isDirectory()) continue;
        await fs.copy(src, path.join(dest, rel));
        copied += 1;
    }
    if (!copied) throw new TypeError('no tracked files');
    const head = await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => null);
    const { stdout: status } = await git(dir, ['status', '--porcelain', '--untracked-files=no']);
    return { commit: head ? head.stdout.trim() : null, copied, dirty: status.trim() !== '' };
}

module.exports = { copyTrackedFiles, LOCAL_SKIP, NotACheckoutError };
