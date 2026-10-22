'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { execFileSync } = require('child_process');
const core = require('../src');
const { copyTrackedFiles, LOCAL_SKIP, NotACheckoutError } = require('../src/backend/checkout');

async function tmpDir(t, prefix) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    t.after(() => fs.remove(dir));
    return dir;
}

// A git checkout holding `files` (relative path -> content), every one of them committed
async function checkout(t, files) {
    const dir = await tmpDir(t, 'cmpose-checkout-');
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'gc.auto=0', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('add', '-A', '-f');
    git('commit', '-q', '-m', 'checkout');
    return { dir, git };
}

test('core.backend exports the checkout copy', () => {
    assert.equal(core.backend.copyTrackedFiles, copyTrackedFiles);
    assert.equal(core.backend.LOCAL_SKIP, LOCAL_SKIP);
    assert.equal(core.backend.NotACheckoutError, NotACheckoutError);
    for (const name of ['.git', '.gradle', 'build', '.DS_Store']) assert.ok(LOCAL_SKIP.has(name), name);
});

test('copies the tracked files with their modes and leaves the untracked ones', async (t) => {
    const { dir, git } = await checkout(t, { 'README.md': 'readme\n', 'gradlew': '#!/bin/sh\n', 'src/Main.kt': 'fun main() {}\n' });
    await fs.chmod(path.join(dir, 'gradlew'), 0o755);
    git('commit', '-q', '-am', 'executable');
    await fs.outputFile(path.join(dir, 'notes.txt'), 'untracked\n');
    await fs.outputFile(path.join(dir, 'src', 'scratch.kt'), 'untracked\n');
    const dest = await tmpDir(t, 'cmpose-dest-');
    const result = await copyTrackedFiles(dir, dest);
    assert.equal(result.copied, 3);
    assert.equal(result.dirty, false);
    assert.equal(await fs.readFile(path.join(dest, 'src', 'Main.kt'), 'utf8'), 'fun main() {}\n');
    assert.notEqual((await fs.stat(path.join(dest, 'gradlew'))).mode & 0o111, 0);
    assert.equal((await fs.stat(path.join(dest, 'README.md'))).mode & 0o111, 0);
    for (const rel of ['notes.txt', 'src/scratch.kt', '.git']) assert.equal(await fs.pathExists(path.join(dest, rel)), false, rel);
});

test('skips tracked paths whose first segment is a local working directory', async (t) => {
    const { dir } = await checkout(t, { 'README.md': 'readme\n', 'build/x': 'x\n', '.gradle/y': 'y\n', 'src/build/z': 'z\n' });
    const dest = await tmpDir(t, 'cmpose-dest-');
    const result = await copyTrackedFiles(dir, dest);
    assert.equal(result.copied, 2);
    assert.equal(await fs.pathExists(path.join(dest, 'build')), false);
    assert.equal(await fs.pathExists(path.join(dest, '.gradle')), false);
    // only the first segment counts
    assert.ok(await fs.pathExists(path.join(dest, 'src', 'build', 'z')));
});

test('skips a tracked file deleted in the work tree', async (t) => {
    const { dir } = await checkout(t, { 'README.md': 'readme\n', 'gone.txt': 'gone\n' });
    await fs.remove(path.join(dir, 'gone.txt'));
    const dest = await tmpDir(t, 'cmpose-dest-');
    const result = await copyTrackedFiles(dir, dest);
    assert.equal(result.copied, 1);
    assert.equal(result.dirty, true);
    assert.equal(await fs.pathExists(path.join(dest, 'gone.txt')), false);
});

test('returns the HEAD commit and reports an edited tracked file as dirty', async (t) => {
    const { dir, git } = await checkout(t, { 'README.md': 'readme\n' });
    await fs.appendFile(path.join(dir, 'README.md'), 'a local edit\n');
    const dest = await tmpDir(t, 'cmpose-dest-');
    const result = await copyTrackedFiles(dir, dest);
    assert.deepEqual(result, { commit: git('rev-parse', 'HEAD'), copied: 1, dirty: true });
    assert.match(result.commit, /^[0-9a-f]{40}$/);
    assert.equal(await fs.readFile(path.join(dest, 'README.md'), 'utf8'), 'readme\na local edit\n');
});

test('a plain directory is a NotACheckoutError', async (t) => {
    const dir = await tmpDir(t, 'cmpose-plain-');
    await fs.outputFile(path.join(dir, 'README.md'), 'readme\n');
    const dest = await tmpDir(t, 'cmpose-dest-');
    await assert.rejects(copyTrackedFiles(dir, dest), (err) => err instanceof NotACheckoutError && err.name === 'NotACheckoutError');
    assert.deepEqual(await fs.readdir(dest), []);
});

test('a checkout that tracks only local working files has no tracked files', async (t) => {
    const { dir } = await checkout(t, { 'build/x': 'x\n' });
    const dest = await tmpDir(t, 'cmpose-dest-');
    await assert.rejects(copyTrackedFiles(dir, dest), (err) => err instanceof TypeError && err.message === 'no tracked files');
});
