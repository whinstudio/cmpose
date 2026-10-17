'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs-extra');
const { applyBackendIdentity } = require('../src/backend/identity');
const { fixtureCopy, read, exists, isExecutable } = require('./backend-helpers');

const IDENTITY = { packageName: 'com.example.myapp', appName: 'my-app', projectName: 'My App' };
const OLD_TOKENS = ['io.cmpose.backendtemplate', 'io/cmpose/backendtemplate', 'cmpose-app', 'cmpose_app', 'CMPOSE_APP', 'Cmpose Backend'];

async function allFiles(dir, rel = '', out = []) {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        out.push(r);
        if (entry.isDirectory()) await allFiles(dir, r, out);
    }
    return out;
}

test('every identity token is renamed in contents, names and package dirs', async (t) => {
    const dir = await fixtureCopy(t);
    await applyBackendIdentity(dir, IDENTITY);
    const files = await allFiles(dir);
    for (const rel of files) {
        for (const token of OLD_TOKENS) assert.ok(!rel.includes(token), `${token} in the name ${rel}`);
        const file = path.join(dir, rel);
        if ((await fs.stat(file)).isDirectory()) continue;
        const text = await fs.readFile(file, 'utf8');
        for (const token of OLD_TOKENS) assert.ok(!text.includes(token), `${token} in ${rel}`);
    }
    assert.ok(await exists(dir, 'deploy/docker-compose.my-app.yml'));
    assert.ok(await exists(dir, 'deploy/nginx/my-app.conf'));
    assert.ok(await exists(dir, 'src/main/kotlin/com/example/myapp/Main.kt'));
    assert.ok(await exists(dir, 'src/main/kotlin/com/example/myapp/sharing/Spaces.kt'));
    assert.ok(await exists(dir, 'src/test/kotlin/com/example/myapp/SpaceRoutesTest.kt'));
    assert.equal(await exists(dir, 'src/main/kotlin/io'), false, 'the emptied template dirs go');
    assert.match(await read(dir, 'deploy/sql/create-my-app.sql'), /CREATE DATABASE my_app OWNER my_app;/);
    assert.match(await read(dir, 'deploy/docker-compose.my-app.yml'), /\$\{MY_APP_MEM_LIMIT:-512m\}/);
    assert.match(await read(dir, 'src/main/kotlin/com/example/myapp/Main.kt'), /^package com\.example\.myapp$/m);
    assert.match(await read(dir, 'build.gradle.kts'), /"com\.example\.myapp\.MainKt"/);
    assert.equal(await read(dir, 'settings.gradle.kts'), 'rootProject.name = "my-app"\n');
    assert.match(await read(dir, 'README.md'), /^# My App$/m);
    assert.match(await read(dir, 'tools/sharing-paths.txt'), /src\/main\/kotlin\/com\/example\/myapp\/sharing/);
});

test('binary files keep their bytes, executables their mode', async (t) => {
    const dir = await fixtureCopy(t);
    const jar = path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    const bytes = Buffer.from([0x50, 0x4b, 0, 0x63, 0x6d, 0x70, 0x6f, 0x73, 0x65, 0x2d, 0x61, 0x70, 0x70]); // ...cmpose-app
    await fs.writeFile(jar, bytes);
    await applyBackendIdentity(dir, IDENTITY);
    assert.deepEqual(await fs.readFile(jar), bytes);
    assert.ok(await isExecutable(dir, 'gradlew'));
    assert.ok(await isExecutable(dir, 'tools/deploy-lint.sh'));
});

test('a new name is never renamed again (one pass)', async (t) => {
    const dir = await fixtureCopy(t);
    await applyBackendIdentity(dir, { packageName: 'com.example.cmpose_app', appName: 'cmpose-app-x', projectName: 'Cmpose Backend X' });
    assert.match(await read(dir, 'README.md'), /^# Cmpose Backend X$/m);
    assert.equal(await read(dir, 'settings.gradle.kts'), 'rootProject.name = "cmpose-app-x"\n');
    assert.match(await read(dir, 'src/main/kotlin/com/example/cmpose_app/Main.kt'), /^package com\.example\.cmpose_app$/m);
    assert.ok(await exists(dir, 'deploy/docker-compose.cmpose-app-x.yml'));
});

test('a package below the template\'s parent dirs moves cleanly', async (t) => {
    const dir = await fixtureCopy(t);
    await applyBackendIdentity(dir, { packageName: 'io.cmpose.other', appName: 'my-app', projectName: 'My App' });
    assert.ok(await exists(dir, 'src/main/kotlin/io/cmpose/other/Main.kt'));
    assert.equal(await exists(dir, 'src/main/kotlin/io/cmpose/backendtemplate'), false);
});
