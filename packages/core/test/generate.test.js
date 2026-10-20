'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { seedTemplate, OLD_PACKAGE_PATH } = require('./support/seedTemplate');
const { OLD_PACKAGE_NAME } = require('../src/templateIdentity');
const { BACKEND_PATHS } = require('../src/backendOption');
const { TEST_SOURCE_SET_REGEX, BLANK_KEPT_TEST_DIRS } = require('../src/featureModules');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');
const { fixtureCopy } = require('./backend-helpers');

const BACKEND_TEMPLATE = { repo: 'https://example.invalid/backend-template.git', ref: 'backend-template-test', commit: 'c'.repeat(40) };
// The fixture has no Dockerfile: the server image check is the verifier's own test
const NO_DOCKER = async () => ({ status: 'SKIP', detail: 'test' });

async function freshCopy() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-gen-'));
    await seedTemplate(dir, { commit: 'a'.repeat(40), ref: 'refs/tags/template-test' });
    return dir;
}

test('generates a showcase project in place and reports what it did', async () => {
    const projectDir = await freshCopy();
    const { value } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0' });
    const summary = await generateCmpProject(value, { projectDir, generatorVersion: 'test@1' });

    assert.strictEqual(summary.templateCommit, 'a'.repeat(40));
    assert.strictEqual(summary.templateRef, 'refs/tags/template-test');
    assert.strictEqual(summary.warnings.length, 2);
    for (const leftover of ['.git', '.idea', 'local.properties', '.template-commit', '.template-ref', 'Multiplatform.iml', 'LICENSE']) {
        assert.strictEqual(await fs.pathExists(path.join(projectDir, leftover)), false, leftover);
    }
    const record = await fs.readJson(path.join(projectDir, '.cmpose', 'generation.json'));
    assert.strictEqual(record.backend.revision, 'test@1');
    assert.strictEqual(record.template.commit, 'a'.repeat(40));
    const settings = await fs.readFile(path.join(projectDir, 'settings.gradle.kts'), 'utf8');
    assert.match(settings, /rootProject\.name = "Demo"/);
    await fs.remove(projectDir);
});

test('a broken copy fails instead of returning a project', async () => {
    const projectDir = await freshCopy();
    await fs.remove(path.join(projectDir, 'iosApp'));
    const { value } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0' });
    await assert.rejects(generateCmpProject(value, { projectDir }));
    await fs.remove(projectDir);
});

// The seeded slice plus the backend's parts, marked as the template marks them (MAINTAINING.md → Backend markers)
async function seedBackendSlice(dir) {
    const block = (open, lines, close) => [open, ...lines, close].join('\n');
    const slash = (...lines) => block('// cmpose:backend', lines, '// /cmpose:backend');
    const files = {};
    // server/ is not the CMP template's: it comes from the backend template
    for (const rel of BACKEND_PATHS.filter((p) => p !== 'server')) {
        if (/\.\w+$/.test(rel)) files[rel] = rel.endsWith('.kt') ? `package ${OLD_PACKAGE_NAME}\n` : '\n';
        else files[`${rel}/build.gradle.kts`] = 'plugins { }\n';
    }
    for (const feature of ['account', 'sharing']) {
        for (const layer of ['contract', 'presentation']) files[`feature/${feature}/${layer}/build.gradle.kts`] = 'plugins { }\n';
    }
    // core/api's tests: the contract test against server/ (Android host) and the models' common tests
    for (const [sourceSet, name] of [['androidHostTest', 'ApiContractTest'], ['commonTest', 'ApiModelsTest']]) {
        files[`core/api/src/${sourceSet}/kotlin/${OLD_PACKAGE_PATH}/core/api/${name}.kt`] = `package ${OLD_PACKAGE_NAME}.core.api\n`;
    }
    files['settings.gradle.kts'] = `rootProject.name = "Multiplatform"\ninclude(":composeApp")\n${slash(
        'include(":core:api")', 'include(":core:auth")', 'include(":feature:account:contract")', 'include(":feature:account:presentation")',
        'include(":feature:sharing:contract")', 'include(":feature:sharing:presentation")',
        '// server/ is generated from the cmpose backend template (an included build)',
        'if (file("server/settings.gradle.kts").exists()) includeBuild("server")')}\n`;
    files['README.md'] = '# Multiplatform\n\n<!-- cmpose:modules -->\nold\n<!-- /cmpose:modules -->\n';
    files['shared/build.gradle.kts'] = `plugins { }\n${slash('implementation(projects.core.auth)',
        'implementation(projects.feature.account.presentation)', 'implementation(projects.feature.sharing.presentation)')}\n`;
    files[`shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/di/initKoin.kt`] = `package ${OLD_PACKAGE_NAME}.di\n\nfun modules() {\n${slash(
        '    add(AuthModule().module)', '    add(AccountModule().module)', '    add(SharingModule().module)')}\n}\n`;
    const mainScreen = `package ${OLD_PACKAGE_NAME}\n\nfun mainScreen() {\n    LocalStringResources provides strings\n    setSystemLanguage()\n`
        + '    // cmpose:backend-off: val start = Home\n    val start = rememberSessionStart(home = Home) ?: return\n}\n';
    files[`blank/shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/MainScreen.kt`] = mainScreen;
    files[`blank/layers/multilang/shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/MainScreen.kt`] = mainScreen;
    files['iosApp/iosApp/Info.plist'] = ['<plist>', '<key>CFBundleURLTypes</key>', '<array>', '<dict>',
        '<key>CFBundleURLSchemes</key>', '<array>', '<string>multiplatform</string>', '</array>', '</dict>',
        '<!-- cmpose:backend -->', '<dict>', '<key>CFBundleURLSchemes</key>', '<array>', '<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>',
        '</array>', '</dict>', '<!-- /cmpose:backend -->', '</array>', '</plist>', ''].join('\n');
    files['gradle/libs.versions.toml'] = `[versions]\nandroid-minSdk = "24"\n${block('# cmpose:backend', ['googleServices = "4.4.4"'], '# /cmpose:backend')}\n`;
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function listAll(root) {
    const out = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) out.push(...await listAll(full)); else out.push(full);
    }
    return out;
}

// A BACKEND_PATHS entry where the generated project has it: the template package renamed
const generatedPath = (rel, packageName) => rel.split(OLD_PACKAGE_PATH).join(packageName.replace(/\./g, '/'));

async function generateBackendSlice(t, input) {
    const projectDir = await freshCopy();
    t.after(() => fs.remove(projectDir));
    await seedBackendSlice(projectDir);
    const { value, error } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0', ...input });
    assert.ok(value, error);
    const backendOn = input.templateType === 'blank' && input.featuresConfig.backend === true;
    const backendTemplate = backendOn ? { dir: await fixtureCopy(t), ...BACKEND_TEMPLATE } : null;
    const summary = await generateCmpProject(value, { projectDir, generatorVersion: 'test@1', backendTemplate, serverImageCheck: NO_DOCKER });
    return { projectDir, summary, backendTemplate };
}

for (const [name, input] of [
    ['blank backend=false', { templateType: 'blank', featuresConfig: { backend: false } }],
    ['showcase', { templateType: 'showcase' }]
]) {
    test(`${name} leaves none of the backend's paths (backend)`, async (t) => {
        const { projectDir, summary } = await generateBackendSlice(t, input);
        assert.strictEqual(summary.serverTemplate, null);
        for (const rel of BACKEND_PATHS) {
            const generated = generatedPath(rel, 'com.example.demo');
            assert.strictEqual(await fs.pathExists(path.join(projectDir, generated)), false, generated);
        }
    });
}

test('blank backend=true keeps the backend\'s paths and leaves no cmpose:backend text anywhere (backend)', async (t) => {
    const { projectDir } = await generateBackendSlice(t, { templateType: 'blank', featuresConfig: { backend: true } });
    for (const rel of BACKEND_PATHS) {
        // Blank ships no template tests (but its Android-host checks), and blank/ itself goes
        if (rel.startsWith('blank/') || (TEST_SOURCE_SET_REGEX.test(rel) && !BLANK_KEPT_TEST_DIRS.some((dir) => rel.startsWith(dir)))) continue;
        const generated = generatedPath(rel, 'com.example.demo');
        assert.strictEqual(await fs.pathExists(path.join(projectDir, generated)), true, generated);
    }
    // The contract test checks the app against server/, so blank keeps it; core/api's common tests go
    assert.ok(await fs.pathExists(path.join(projectDir, 'core/api/src/androidHostTest/kotlin/com/example/demo/core/api/ApiContractTest.kt')));
    assert.strictEqual(await fs.pathExists(path.join(projectDir, 'core/api/src/commonTest')), false);
    for (const file of await listAll(projectDir)) {
        assert.ok(!(await fs.readFile(file, 'utf8')).includes('cmpose:backend'), path.relative(projectDir, file));
    }
    const plist = await fs.readFile(path.join(projectDir, 'iosApp/iosApp/Info.plist'), 'utf8');
    assert.ok(plist.includes('<string>demo</string>'));
    assert.ok(plist.includes('<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>'));
});

test('backendOnWithoutBackendTemplateThrows', async (t) => {
    const projectDir = await freshCopy();
    t.after(() => fs.remove(projectDir));
    await seedBackendSlice(projectDir);
    const { value } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0',
        templateType: 'blank', featuresConfig: { backend: true } });
    await assert.rejects(generateCmpProject(value, { projectDir }), { message: 'backend: the backend template is required (backendTemplate)' });
    // nothing was touched
    assert.ok(await fs.pathExists(path.join(projectDir, '.template-commit')));
});

test('backendOnPlacesServerAndRecordsItsTemplate', async (t) => {
    const { projectDir, summary, backendTemplate } = await generateBackendSlice(t, { templateType: 'blank', featuresConfig: { backend: true } });
    const server = path.join(projectDir, 'server');
    const read = (rel) => fs.readFile(path.join(server, rel), 'utf8');
    assert.strictEqual(await fs.pathExists(backendTemplate.dir), false);
    assert.match(await read('src/local/kotlin/com/example/demo/server/local/LocalMain.kt'), /^package com\.example\.demo\.server\.local$/m);
    assert.ok((await read('build.gradle.kts')).includes('"com.example.demo.server.local.LocalMainKt"'));
    assert.match(await read('gradle.properties'), /^localServerDir=\.\.\/\.local-server$/m);
    assert.match(await read('settings.gradle.kts'), /rootProject\.name = "demo"/);
    // the app's rename never reaches server/: no app package dir in it, nor its sample feature
    assert.strictEqual(await fs.pathExists(path.join(server, 'src/main/kotlin/com/example/demo/server/feature/sample')), false);
    for (const leftover of ['.github', '.cmpose', 'tools/gate.sh']) assert.strictEqual(await fs.pathExists(path.join(server, leftover)), false, leftover);

    const expected = { repo: BACKEND_TEMPLATE.repo, ref: BACKEND_TEMPLATE.ref, commit: BACKEND_TEMPLATE.commit };
    assert.deepStrictEqual(summary.serverTemplate, expected);
    const record = await fs.readJson(path.join(projectDir, '.cmpose', 'generation.json'));
    assert.deepStrictEqual(record.serverTemplate, expected);
    assert.strictEqual(record.backend.revision, 'test@1');
    const readme = await fs.readFile(path.join(projectDir, 'README.md'), 'utf8');
    assert.ok(readme.includes('- `server/`: Ktor server from the cmpose backend template (an included build)'), readme);
});

test('a CMP template that already has server/ fails before the pipeline runs (backend)', async (t) => {
    const projectDir = await freshCopy();
    t.after(() => fs.remove(projectDir));
    await seedBackendSlice(projectDir);
    await fs.outputFile(path.join(projectDir, 'server', 'build.gradle.kts'), 'plugins { }\n');
    const { value } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0',
        templateType: 'blank', featuresConfig: { backend: true } });
    const raw = await fixtureCopy(t);
    await assert.rejects(generateCmpProject(value, { projectDir, backendTemplate: { dir: raw, ...BACKEND_TEMPLATE } }),
        { message: 'backend: the CMP template already has server/, which comes from the backend template (use a newer templateRef)' });
    // nothing was touched: the cache markers and the backend template copy are where they were
    assert.ok(await fs.pathExists(path.join(projectDir, '.template-commit')));
    assert.ok(await fs.pathExists(raw));
});
