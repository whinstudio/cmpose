'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs-extra');
const { validateBackend } = require('../src/backend/validate');
const { generateBackend } = require('../src/backend/generate');
const { verifyBackendProject } = require('../src/backend/verifier');
const { buildBackendRecord } = require('../src/backend/record');
const { backendContractVersion } = require('../src/backend/contract');
const pins = require('../src/pins');
const { fixtureCopy, read, exists, isExecutable } = require('./backend-helpers');

function valueOf(request) {
    const { ok, value, errors } = validateBackend({
        projectName: 'MyApp', appName: 'my-app', packageName: 'com.example.myapp', outputDir: path.resolve('/out'), ...request
    });
    assert.ok(ok, JSON.stringify(errors));
    return value;
}

for (const sharing of [false, true]) {
    test(`sharing ${sharing ? 'on' : 'off'}: a clean project with its record`, async (t) => {
        const projectDir = await fixtureCopy(t);
        await fs.writeFile(path.join(projectDir, '.template-ref'), 'backend-template-test\n');
        await fs.writeFile(path.join(projectDir, '.template-commit'), 'abc1234\n');
        await fs.ensureDir(path.join(projectDir, '.git'));
        const value = valueOf({ sharing });
        const now = new Date('2026-10-17T12:00:00Z');
        const result = await generateBackend(value, { projectDir, generatorVersion: 'test', now });

        assert.deepEqual(await verifyBackendProject(projectDir, value), []);
        for (const gone of ['.git', '.template-ref', '.template-commit', 'tools/gate.sh', 'tools/sharing-paths.txt', 'tools/resolve-markers.sh',
            'tools/resolve-markers.test.sh', 'tools/TEMPLATE.md']) {
            assert.equal(await exists(projectDir, gone), false, gone);
        }
        assert.ok(await isExecutable(projectDir, 'tools/deploy-lint.sh'));
        assert.deepEqual(await fs.readdir(path.join(projectDir, 'tools')), ['deploy-lint.sh']);
        assert.ok(await isExecutable(projectDir, 'gradlew'));
        assert.equal(await exists(projectDir, 'src/main/kotlin/com/example/myapp/sharing'), sharing);
        assert.equal(await exists(projectDir, 'src/main/resources/db/migration/V2__sharing.sql'), sharing);

        const record = JSON.parse(await read(projectDir, '.cmpose/generation.json'));
        assert.deepEqual(record, {
            generator: '@cmpose/core',
            coreVersion: require('../package.json').version,
            generatorVersion: 'test',
            kind: 'backend',
            contractVersion: backendContractVersion(),
            sharing,
            template: { repo: pins.backend.repo, ref: 'backend-template-test', commit: 'abc1234' },
            generatedAt: '2026-10-17T12:00:00.000Z'
        });
        assert.deepEqual(result.record, record);
        assert.ok(!JSON.stringify(record).includes(path.resolve('/out')), 'the output dir is never recorded');
    });
}

test('the given template ref and commit win over the cache markers', async (t) => {
    const projectDir = await fixtureCopy(t);
    await fs.writeFile(path.join(projectDir, '.template-ref'), 'old\n');
    await generateBackend(valueOf({}), { projectDir, templateRef: 'backend-template-x', templateCommit: 'def5678' });
    const record = JSON.parse(await read(projectDir, '.cmpose/generation.json'));
    assert.deepEqual(record.template, { repo: pins.backend.repo, ref: 'backend-template-x', commit: 'def5678' });
    assert.equal(record.generatorVersion, null);
});

test('a project that fails verification throws', async (t) => {
    const projectDir = await fixtureCopy(t);
    // a sharing word outside the markers survives the off variant
    await fs.appendFile(path.join(projectDir, 'README.md'), '\nInvite a friend.\n');
    await assert.rejects(generateBackend(valueOf({ sharing: false }), { projectDir }),
        /^Error: backend verification failed: sharing word in README\.md \(sharing is off\)$/);
});

test('the record holds only known options', () => {
    const record = buildBackendRecord({ ...valueOf({ sharing: true }), secret: 'x' }, {});
    assert.equal(record.sharing, true);
    assert.equal(JSON.stringify(record).includes('secret'), false);
    assert.deepEqual(record.template, { repo: pins.backend.repo, ref: null, commit: null });
});
