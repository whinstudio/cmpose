'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const PREFIX = '.cmpose-';
// Old enough that no live generation still owns the dir; a concurrent run's fresh dir is never touched
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// Removes the hidden work dirs (and their -server siblings) a killed run left in parentDir.
// Only direct child dirs named .cmpose-* and older than the threshold; never fails a generation.
async function sweepStaleWorkDirs(parentDir, { olderThanMs = STALE_AFTER_MS, now = Date.now(), remove = fs.remove } = {}) {
    const names = await fs.readdir(parentDir).catch(() => []);
    const removed = [];
    for (const name of names) {
        if (!name.startsWith(PREFIX)) continue;
        const dir = path.join(parentDir, name);
        try {
            const stat = await fs.lstat(dir);
            if (!stat.isDirectory() || now - stat.mtimeMs <= olderThanMs) continue;
            await remove(dir);
            removed.push(dir);
        } catch {
            // Gone already or not removable: the next run tries again
        }
    }
    return removed;
}

// Sweeps stale leftovers, then names this run's work dir (not created; the caller copies into it)
async function newWorkDir(parentDir) {
    await sweepStaleWorkDirs(parentDir);
    return path.join(parentDir, `${PREFIX}${crypto.randomBytes(6).toString('hex')}`);
}

module.exports = { sweepStaleWorkDirs, newWorkDir, STALE_AFTER_MS };
