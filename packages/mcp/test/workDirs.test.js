'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { sweepStaleWorkDirs, STALE_AFTER_MS } = require('../src/workDirs');

const NOW = Date.now();
const OLD = new Date(NOW - STALE_AFTER_MS - 60 * 1000);

async function parent(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-workdirs-'));
    t.after(() => fs.remove(dir));
    return dir;
}

// A work dir with a file in it, its mtime set to `when` (after the file, so the write does not bump it)
async function workDir(dir, name, when) {
    const p = path.join(dir, name);
    await fs.outputFile(path.join(p, 'settings.gradle.kts'), '');
    if (when) await fs.utimes(p, when, when);
    return p;
}

test('removes an old .cmpose- dir', async (t) => {
    const dir = await parent(t);
    const work = await workDir(dir, '.cmpose-aaaaaaaaaaaa', OLD);
    const server = await workDir(dir, '.cmpose-aaaaaaaaaaaa-server', OLD);
    const removed = await sweepStaleWorkDirs(dir, { now: NOW });
    assert.deepStrictEqual(removed.sort(), [work, server].sort());
    assert.strictEqual(await fs.pathExists(work), false);
    assert.strictEqual(await fs.pathExists(server), false);
});

test('keeps a recent .cmpose- dir (a concurrent run)', async (t) => {
    const dir = await parent(t);
    const live = await workDir(dir, '.cmpose-bbbbbbbbbbbb');
    const liveServer = await workDir(dir, '.cmpose-bbbbbbbbbbbb-server');
    const stale = await workDir(dir, '.cmpose-cccccccccccc', OLD);
    const removed = await sweepStaleWorkDirs(dir, { now: NOW });
    assert.deepStrictEqual(removed, [stale]);
    assert.ok(await fs.pathExists(path.join(live, 'settings.gradle.kts')));
    assert.ok(await fs.pathExists(path.join(liveServer, 'settings.gradle.kts')));
});

test('honours a custom age threshold', async (t) => {
    const dir = await parent(t);
    const hourOld = new Date(NOW - 2 * 60 * 60 * 1000);
    const work = await workDir(dir, '.cmpose-dddddddddddd', hourOld);
    assert.deepStrictEqual(await sweepStaleWorkDirs(dir, { now: NOW }), []);
    assert.deepStrictEqual(await sweepStaleWorkDirs(dir, { now: NOW, olderThanMs: 60 * 60 * 1000 }), [work]);
});

test('keeps other names', async (t) => {
    const dir = await parent(t);
    const project = await workDir(dir, 'MyApp', OLD);
    const otherHidden = await workDir(dir, '.cmpose', OLD);
    const similar = await workDir(dir, 'x.cmpose-eeeeeeeeeeee', OLD);
    const file = path.join(dir, '.cmpose-ffffffffffff');
    await fs.outputFile(file, 'not a dir');
    await fs.utimes(file, OLD, OLD);
    const nested = await workDir(path.join(dir, 'MyApp'), '.cmpose-gggggggggggg', OLD);
    await fs.utimes(project, OLD, OLD);
    assert.deepStrictEqual(await sweepStaleWorkDirs(dir, { now: NOW }), []);
    for (const p of [project, otherHidden, similar, file, nested]) assert.ok(await fs.pathExists(p), p);
});

test('a failing removal does not throw', async (t) => {
    const dir = await parent(t);
    const first = await workDir(dir, '.cmpose-hhhhhhhhhhhh', OLD);
    const second = await workDir(dir, '.cmpose-iiiiiiiiiiii', OLD);
    const remove = async (p) => {
        if (p === first) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        await fs.remove(p);
    };
    const removed = await sweepStaleWorkDirs(dir, { now: NOW, remove });
    assert.deepStrictEqual(removed, [second]);
    assert.ok(await fs.pathExists(first));
});

test('a missing parent dir does not throw', async (t) => {
    const dir = await parent(t);
    assert.deepStrictEqual(await sweepStaleWorkDirs(path.join(dir, 'absent')), []);
});

// Wiring: a generation sweeps its output dir's stale leftovers and leaves a live one alone
test('a generation sweeps stale work dirs in its output dir', async (t) => {
    const { runBackendGenerate } = require('../src/backendGenerate');
    const { fixtureCopy } = require('../../core/test/backend-helpers');
    const template = await fixtureCopy(t);
    const outputDir = await parent(t);
    const stale = await workDir(outputDir, '.cmpose-jjjjjjjjjjjj', OLD);
    const live = await workDir(outputDir, '.cmpose-kkkkkkkkkkkk');
    const cacheEnsure = async (req) => ({ dir: template, ref: req.ref, commit: 'a'.repeat(40) });
    const r = await runBackendGenerate(
        { projectName: 'NotesBackend', appName: 'notes-api', packageName: 'com.acme.notes', outputDir, templateRef: 'backend-template-test' },
        { cacheDir: await parent(t), cacheEnsure }
    );
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.strictEqual(await fs.pathExists(stale), false);
    assert.ok(await fs.pathExists(live));
    assert.ok(await fs.pathExists(path.join(outputDir, 'NotesBackend')));
});
