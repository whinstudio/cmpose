'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { execFileSync } = require('child_process');
const { trackedFiles } = require('./realTemplate-helpers');

async function tmpDir(t, prefix) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    t.after(() => fs.remove(dir));
    return dir;
}

// A git work tree at `dir` with `files` (relative path -> content) committed
async function repo(dir, files) {
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'gc.auto=0', ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A', '-f');
    git('commit', '-q', '-m', 'repo');
}

test('returns the tracked files of a work tree root', async (t) => {
    const dir = await tmpDir(t, 'cmpose-tracked-');
    await repo(dir, { 'tracked.txt': 'tracked\n' });
    await fs.outputFile(path.join(dir, 'untracked.txt'), 'untracked\n');
    assert.deepEqual(trackedFiles(dir), ['tracked.txt']);
});

test('returns null outside a work tree', async (t) => {
    const dir = await tmpDir(t, 'cmpose-plain-');
    await fs.outputFile(path.join(dir, 'file.txt'), 'file\n');
    assert.equal(trackedFiles(dir), null);
});

test('returns null for a subdirectory of another repo', async (t) => {
    const dir = await tmpDir(t, 'cmpose-outer-');
    await repo(dir, { 'outer.txt': 'outer\n', 'template/inner.txt': 'inner\n' });
    assert.equal(trackedFiles(path.join(dir, 'template')), null);
});
