'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { deriveServerAppName, placeServer } = require('../src/serverFromBackend');
const { validateBackend } = require('../src/backend/validate');
const { fixtureCopy, read, exists } = require('./backend-helpers');

const TEMPLATE = { repo: 'https://example.invalid/backend-template.git', ref: 'backend-template-test', commit: 'c'.repeat(40) };
const appNameOk = (appName) => validateBackend({
    projectName: 'Demo', appName, packageName: 'com.example.demo', outputDir: path.resolve('/')
}).ok;

test('deriveServerAppNameKebabCases', () => {
    assert.equal(deriveServerAppName('MyApp'), 'my-app');
    assert.equal(deriveServerAppName('Notes'), 'notes');
    assert.equal(deriveServerAppName('CloudList'), 'cloud-list');
});

test('deriveServerAppNameAvoidsReservedAndKeywords', () => {
    // api is a route prefix, user a PostgreSQL key word
    assert.equal(deriveServerAppName('Api'), 'api-app');
    assert.equal(deriveServerAppName('User'), 'user-app');
    // one letter is too short on its own
    assert.equal(deriveServerAppName('A'), 'a-app');
});

test('deriveServerAppNameCapsLength', () => {
    const name = deriveServerAppName('A'.repeat(20) + 'b'.repeat(20));
    assert.ok(name.length <= 31, name);
    assert.ok(appNameOk(name), name);
    // the cut never leaves a trailing -
    const cut = deriveServerAppName(`${'Ab'.repeat(13)}aCd`);
    assert.ok(!cut.endsWith('-'), cut);
    assert.ok(appNameOk(cut), cut);
});

test('deriveServerAppName throws when no candidate is valid', () => {
    assert.throws(() => deriveServerAppName('123'), /Cannot derive a server name from 123/);
});

async function placed(t, { github = false } = {}) {
    const raw = await fixtureCopy(t);
    if (github) await fs.outputFile(path.join(raw, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-place-'));
    t.after(() => fs.remove(projectDir));
    const result = await placeServer(projectDir, {
        packageName: 'com.example.cloudlist', projectName: 'CloudList', backendTemplate: { dir: raw, ...TEMPLATE },
        generatorVersion: 'test@1', now: new Date('2026-10-20T10:00:00.000Z')
    });
    return { raw, projectDir, server: path.join(projectDir, 'server'), result };
}

test('placeServerProducesServerPackageAndLocalDir', async (t) => {
    const { raw, server, result } = await placed(t);
    assert.deepEqual(result, { appName: 'cloud-list', packageName: 'com.example.cloudlist.server', template: TEMPLATE });
    // moved, not copied
    assert.equal(await fs.pathExists(raw), false);
    assert.match(await read(server, 'src/main/kotlin/com/example/cloudlist/server/Main.kt'), /^package com\.example\.cloudlist\.server$/m);
    assert.match(await read(server, 'src/local/kotlin/com/example/cloudlist/server/local/LocalMain.kt'),
        /^package com\.example\.cloudlist\.server\.local$/m);
    assert.ok((await read(server, 'build.gradle.kts')).includes('"com.example.cloudlist.server.local.LocalMainKt"'));
    assert.match(await read(server, 'gradle.properties'), /^localServerDir=\.\.\/\.local-server$/m);
    assert.match(await read(server, 'settings.gradle.kts'), /rootProject\.name = "cloud-list"/);
    // sharing on, sample off
    assert.ok(await exists(server, 'src/main/kotlin/com/example/cloudlist/server/sharing/Spaces.kt'));
    assert.equal(await exists(server, 'src/main/kotlin/com/example/cloudlist/server/feature/sample'), false);
    assert.equal(await exists(server, 'src/main/resources/db/migration/V3__sample.sql'), false);
});

test('placeServer appends localServerDir to an existing gradle.properties', async (t) => {
    const raw = await fixtureCopy(t);
    await fs.writeFile(path.join(raw, 'gradle.properties'), 'kotlin.code.style=official');
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-place-'));
    t.after(() => fs.remove(projectDir));
    await placeServer(projectDir, { packageName: 'com.example.demo', projectName: 'Demo', backendTemplate: { dir: raw, ...TEMPLATE } });
    assert.equal(await read(path.join(projectDir, 'server'), 'gradle.properties'), 'kotlin.code.style=official\nlocalServerDir=../.local-server\n');
});

test('placeServerRemovesGithubAndRecord', async (t) => {
    const { server } = await placed(t, { github: true });
    assert.equal(await exists(server, '.github'), false);
    assert.equal(await exists(server, '.cmpose'), false);
    assert.equal(await exists(server, 'tools/gate.sh'), false);
});

test('placeServer refuses a project that already has server/', async (t) => {
    const raw = await fixtureCopy(t);
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-place-'));
    t.after(() => fs.remove(projectDir));
    await fs.outputFile(path.join(projectDir, 'server', 'build.gradle.kts'), 'plugins { }\n');
    await assert.rejects(
        placeServer(projectDir, { packageName: 'com.example.demo', projectName: 'Demo', backendTemplate: { dir: raw, ...TEMPLATE } }),
        /server\/ already exists/);
    assert.ok(await fs.pathExists(raw));
});
