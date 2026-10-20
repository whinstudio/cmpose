'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { verifyBackendProject } = require('../src/backend/verifier');

const OPTS = { sharing: false, packageName: 'com.example.myapp', appName: 'my-app', projectName: 'My App' };

// The smallest clean project: the package dir and the two deploy files
async function cleanDir(t, extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-verify-'));
    t.after(() => fs.remove(dir));
    const files = {
        'src/main/kotlin/com/example/myapp/Main.kt': 'package com.example.myapp\n',
        'deploy/docker-compose.my-app.yml': 'services:\n  my-app:\n    mem_limit: 512m\n',
        'deploy/nginx/my-app.conf': 'location /my-app/ {}\n',
        'README.md': '# My App\n',
        ...extra
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    return dir;
}

test('a clean project has no problems', async (t) => {
    assert.deepEqual(await verifyBackendProject(await cleanDir(t), OPTS), []);
});

test('a leftover marker of any form is found (not in tools/)', async (t) => {
    for (const marker of ['// cmpose:sharing', '-- /cmpose:sharing', '# cmpose:sharing', '<!-- cmpose:sharing -->', '    // cmpose:sharing-off: x']) {
        const dir = await cleanDir(t, { 'src/main/kotlin/com/example/myapp/A.kt': `a\n${marker}\n` });
        assert.deepEqual(await verifyBackendProject(dir, OPTS), ['marker left in src/main/kotlin/com/example/myapp/A.kt'], marker);
    }
    const dir = await cleanDir(t, { 'tools/deploy-lint.sh': 'grep "# cmpose:" .\n' });
    assert.deepEqual(await verifyBackendProject(dir, OPTS), []);
});

test('a template tool other than tools/deploy-lint.sh is found', async (t) => {
    const leftovers = ['tools/TEMPLATE.md', 'tools/gate.sh', 'tools/resolve-markers.sh', 'tools/resolve-markers.test.sh', 'tools/sharing-paths.txt', 'tools/x/y.sh'];
    const dir = await cleanDir(t, { 'tools/deploy-lint.sh': 'echo lint\n', ...Object.fromEntries(leftovers.map((rel) => [rel, 'x\n'])) });
    assert.deepEqual(await verifyBackendProject(dir, OPTS), leftovers.sort().map((rel) => `template tool left in ${rel}`));
    assert.deepEqual(await verifyBackendProject(await cleanDir(t, { 'tools/deploy-lint.sh': 'echo lint\n' }), OPTS), []);
});

test('a template identity token in a content or a name is found', async (t) => {
    for (const token of ['io.cmpose.backendtemplate', 'io/cmpose/backendtemplate', 'cmpose-app', 'cmpose_app', 'CMPOSE_APP', 'Cmpose Backend']) {
        const dir = await cleanDir(t, { 'build.gradle.kts': `x = "${token}"\n` });
        assert.deepEqual(await verifyBackendProject(dir, OPTS), [`old identity ${token} in build.gradle.kts`], token);
    }
    const dir = await cleanDir(t, { 'deploy/sql/create-cmpose-app.sql': 'CREATE DATABASE my_app;\n' });
    assert.deepEqual(await verifyBackendProject(dir, OPTS), ['old identity cmpose-app in the name deploy/sql/create-cmpose-app.sql']);
});

test('a token the project\'s own names spell is no residue', async (t) => {
    const opts = { ...OPTS, appName: 'cmpose-app-x' };
    const dir = await cleanDir(t, {
        'deploy/docker-compose.cmpose-app-x.yml': 'services:\n  cmpose-app-x: {}\n',
        'deploy/nginx/cmpose-app-x.conf': 'location /cmpose-app-x/ {}\n'
    });
    await fs.remove(path.join(dir, 'deploy/docker-compose.my-app.yml'));
    await fs.remove(path.join(dir, 'deploy/nginx/my-app.conf'));
    assert.deepEqual(await verifyBackendProject(dir, opts), []);
});

test('a missing package dir or deploy file is found', async (t) => {
    const dir = await cleanDir(t);
    await fs.remove(path.join(dir, 'src'));
    await fs.remove(path.join(dir, 'deploy/nginx/my-app.conf'));
    assert.deepEqual(await verifyBackendProject(dir, OPTS), ['missing deploy/nginx/my-app.conf', 'missing package dir src/main/kotlin/com/example/myapp']);
    const other = await cleanDir(t);
    await fs.remove(path.join(other, 'deploy/docker-compose.my-app.yml'));
    assert.deepEqual(await verifyBackendProject(other, OPTS), ['missing deploy/docker-compose.my-app.yml']);
});

test('with sharing off a sharing word in src, the docs or deploy is found; with sharing on it is not', async (t) => {
    const words = {
        'src/main/kotlin/com/example/myapp/A.kt': 'val spaceId = 1\n',
        'SECURITY-CHECKLIST.md': 'Invites expire.\n',
        'deploy/README.md': 'A MEMBER sees it.\n',
        'README.md': '# My App\nspace_id\n'
    };
    const dir = await cleanDir(t, words);
    assert.deepEqual(await verifyBackendProject(dir, OPTS), Object.keys(words).sort().map((rel) => `sharing word in ${rel} (sharing is off)`));
    assert.deepEqual(await verifyBackendProject(dir, { ...OPTS, sharing: true }), []);
    // outside those parts (build files) a word is no problem
    assert.deepEqual(await verifyBackendProject(await cleanDir(t, { 'build.gradle.kts': '// spaces\n' }), OPTS), []);
});

test('the project\'s own names are no sharing words', async (t) => {
    const opts = { ...OPTS, packageName: 'com.myspace.app', appName: 'space-notes', projectName: 'Space Notes' };
    const dir = await cleanDir(t, {
        'src/main/kotlin/com/myspace/app/Main.kt': 'package com.myspace.app\n',
        'deploy/docker-compose.space-notes.yml': 'services:\n  space-notes:\n    env_file: SPACE_NOTES.env\n',
        'deploy/nginx/space-notes.conf': 'location /space-notes/ {}\n',
        'README.md': '# Space Notes\nDB space_notes\n'
    });
    await fs.remove(path.join(dir, 'deploy/docker-compose.my-app.yml'));
    await fs.remove(path.join(dir, 'deploy/nginx/my-app.conf'));
    await fs.remove(path.join(dir, 'src/main/kotlin/com/example'));
    assert.deepEqual(await verifyBackendProject(dir, opts), []);
});

test('sampleOffLeftoverIsAProblem', async (t) => {
    const leftovers = {
        'src/main/kotlin/com/example/myapp/Routing.kt': 'import com.example.myapp.feature.sample.Things\n',
        'src/main/kotlin/com/example/myapp/openapi/Spec.kt': 'val path = "/api/v1/items"\n',
        'src/test/kotlin/com/example/myapp/T.kt': 'val repo = ItemRepository()\n',
        'README.md': '# My App\nSee ItemDto.\n',
        'SECURITY-CHECKLIST.md': 'ItemOpenApi\n',
        'deploy/README.md': 'Runs V3__sample first.\n'
    };
    const dir = await cleanDir(t, {
        ...leftovers,
        // a sample dir and migration count by their names
        'src/main/kotlin/com/example/myapp/feature/sample/Things.kt': 'class Things\n',
        'src/main/resources/db/migration/V3__sample.sql': 'CREATE TABLE things (id UUID);\n'
    });
    const off = { ...OPTS, sharing: true, sample: false };
    assert.deepEqual(await verifyBackendProject(dir, off), [
        'sample dir src/main/kotlin/com/example/myapp/feature/sample left (sample is off)',
        'sample migration src/main/resources/db/migration/V3__sample.sql left (sample is off)',
        ...Object.keys(leftovers).sort().map((rel) => `sample word in ${rel} (sample is off)`)
    ].sort());
    // with sample on, or not given, none of it is a problem
    assert.deepEqual(await verifyBackendProject(dir, { ...OPTS, sharing: true, sample: true }), []);
    assert.deepEqual(await verifyBackendProject(dir, { ...OPTS, sharing: true }), []);
    // outside src, the docs and deploy, and in other spellings (items, itemRoutes), a word is no problem
    const clean = await cleanDir(t, {
        'build.gradle.kts': '// feature/sample /items\n',
        'src/main/kotlin/com/example/myapp/A.kt': 'val items = itemRoutes()\nCREATE TABLE items\n'
    });
    assert.deepEqual(await verifyBackendProject(clean, off), []);
});

test('a secret in any file is found', async (t) => {
    const secrets = {
        // spelled in two parts, so the repo's own privacy scan does not take the test for a key
        'src/main/resources/key.pem': `-----BEGIN RSA ${'PRIVATE'} KEY-----\nabc\n`,
        'service-account.json': '{ "private_key": "x" }\n',
        'deploy/.env.example': `KEY=AIza${'A'.repeat(35)}\n`
    };
    const dir = await cleanDir(t, secrets);
    assert.deepEqual(await verifyBackendProject(dir, OPTS), [
        'Google API key in deploy/.env.example', 'private key in src/main/resources/key.pem', 'service account key in service-account.json'
    ]);
});
