'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');
const { listTextFiles } = require('../src/projectFiles');
const { BACKEND_RESIDUE_TOKENS } = require('../src/fileService');

// The whole pipeline against the REAL templates (CMP_REAL_TEMPLATE_DIR, e.g. a `git archive` of the CMP template's
// branch; CMPOSE_BACKEND_TEMPLATE_DIR, a backend template checkout, which server/ comes from). Skipped, not failed,
// when either is unset or the CMP template predates the backend.
const REAL = process.env.CMP_REAL_TEMPLATE_DIR;
const BACKEND = process.env.CMPOSE_BACKEND_TEMPLATE_DIR;
const HAS_TEMPLATE = Boolean(REAL) && Boolean(BACKEND) && fs.existsSync(path.join(BACKEND, 'settings.gradle.kts'))
    && fs.existsSync(path.join(REAL, 'blank', 'layers')) && fs.existsSync(path.join(REAL, 'feature', 'sample'));
const NO_TEMPLATE = {
    skip: !REAL ? 'CMP_REAL_TEMPLATE_DIR is not set'
        : !BACKEND ? 'CMPOSE_BACKEND_TEMPLATE_DIR is not set' : `no backend-ready templates at CMP_REAL_TEMPLATE_DIR (${REAL}) and CMPOSE_BACKEND_TEMPLATE_DIR (${BACKEND})`
};
const OPTIONS = HAS_TEMPLATE ? {} : NO_TEMPLATE;
// A checkout's own state and build output never reach the copy
const BACKEND_SKIPPED = new Set(['.git', '.gradle', '.kotlin', 'build', '.local-server', '.idea', '.claude']);

// What the template's sync (updateTemplate) keeps out of the template: an upstream archive still has them
const MAINTAINER_ONLY = ['gradle/wizard.gradle.kts', 'MAINTAINING.md', 'scripts/ios-add-packages.rb', 'scripts-maintainer'];
const PBXPROJ = 'iosApp/iosApp.xcodeproj/project.pbxproj';
const PACKAGE_RESOLVED = 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
const GMA_PINS = ['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform'];

async function generate(t, request) {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-real-'));
    t.after(() => fs.remove(projectDir));
    await fs.copy(REAL, projectDir, {
        filter: (src) => {
            const rel = path.relative(REAL, src).split(path.sep).join('/');
            return !MAINTAINER_ONLY.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
        }
    });
    const { ok, value, error } = validate({ appName: 'Demo App', minSdk: '24', iosVersion: '16.0', ...request });
    assert.ok(ok, error);
    let backendTemplate = null;
    if (value.templateType === 'blank' && value.featuresConfig.backend === true) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-template-'));
        t.after(() => fs.remove(dir));
        await fs.copy(BACKEND, dir, { filter: (src) => !BACKEND_SKIPPED.has(path.basename(src)) });
        backendTemplate = { dir, repo: 'local', ref: 'local', commit: null };
    }
    await generateCmpProject(value, { projectDir, generatorVersion: 'test', backendTemplate });
    return projectDir;
}

const read = (projectDir, rel) => fs.readFile(path.join(projectDir, rel), 'utf8');
const tokenLabel = (token) => (typeof token === 'string' ? token : token.label);
const tokenFound = (content, token) => (typeof token === 'string' ? content.includes(token) : token.regex.test(content));

// Every residue token in every text file (.gitignore too); the project's own names spell none of them
async function residue(projectDir) {
    const found = [];
    const files = [...await listTextFiles(projectDir), path.join(projectDir, '.gitignore')];
    for (const file of files) {
        if (!(await fs.pathExists(file))) continue;
        const content = await fs.readFile(file, 'utf8');
        for (const token of BACKEND_RESIDUE_TOKENS) {
            if (tokenFound(content, token)) found.push(`${path.relative(projectDir, file)}: ${tokenLabel(token)}`);
        }
    }
    return found;
}

async function assertBackendOff(projectDir) {
    assert.deepEqual(await residue(projectDir), []);
    for (const dir of ['server', 'core/api', 'core/auth', 'feature/account', 'feature/sharing']) {
        assert.equal(await fs.pathExists(path.join(projectDir, dir)), false, dir);
    }
    const pbxproj = await read(projectDir, PBXPROJ);
    assert.ok(pbxproj.includes('swift-package-manager-google-mobile-ads'), 'GMA package missing from project.pbxproj');
    assert.ok(!/firebase|GoogleSignIn/i.test(pbxproj), 'Firebase or GoogleSignIn left in project.pbxproj');
    const pins = JSON.parse(await read(projectDir, PACKAGE_RESOLVED)).pins.map((pin) => pin.identity);
    assert.deepEqual(pins.sort(), GMA_PINS);
}

// A test the project keeps compiles only with its module's test libraries: one that answers with Ktor's MockEngine
// needs ktor-client-mock in that module's build file and in the catalog (the template once kept both for the backend)
async function testsWithoutMockClient(projectDir) {
    const missing = [];
    const catalog = /^ktor-client-mock\s*=/m.test(await read(projectDir, 'gradle/libs.versions.toml'));
    for (const file of await listTextFiles(projectDir)) {
        const rel = path.relative(projectDir, file).split(path.sep).join('/');
        const at = rel.indexOf('/src/');
        if (!rel.endsWith('.kt') || at < 0 || !/^import io\.ktor\.client\.engine\.mock\./m.test(await fs.readFile(file, 'utf8'))) continue;
        const build = `${rel.slice(0, at)}/build.gradle.kts`;
        if (!(await read(projectDir, build)).includes('libs.ktor.client.mock')) missing.push(`${rel} (${build})`);
        if (!catalog) missing.push(`${rel} (gradle/libs.versions.toml)`);
    }
    return missing;
}

test('real template, showcase: no backend part is left, GMA stays', OPTIONS, async (t) => {
    const projectDir = await generate(t, { projectName: 'Demo', packageName: 'com.example.demo', templateType: 'showcase' });
    await assertBackendOff(projectDir);
    // core/network's BaseRepositoryTest keeps its MockEngine cases without the backend
    assert.ok(await fs.pathExists(path.join(projectDir, 'core/network/src/commonTest/kotlin/com/example/demo/core/network/BaseRepositoryTest.kt')));
    assert.deepEqual(await testsWithoutMockClient(projectDir), []);
});

test('real template, blank with purchases and ads, backend off: no backend part is left, GMA stays', OPTIONS, async (t) => {
    const projectDir = await generate(t, {
        projectName: 'Demo', packageName: 'com.example.demo', templateType: 'blank',
        featuresConfig: { backend: false, purchases: true, ads: true }
    });
    await assertBackendOff(projectDir);
});

test('real template, blank with the backend and a custom module: server, modules, URL schemes and README', OPTIONS, async (t) => {
    const projectDir = await generate(t, {
        projectName: 'CloudList', packageName: 'com.example.cloudlist', templateType: 'blank',
        features: ['notesx'], featuresConfig: { backend: true }
    });

    // The local runner keeps its place: the local main class com.example.cloudlist.server.local.LocalMainKt
    const localMain = await read(projectDir, 'server/src/local/kotlin/com/example/cloudlist/server/local/LocalMain.kt');
    assert.match(localMain, /^package com\.example\.cloudlist\.server\.local$/m);
    assert.ok((await read(projectDir, 'server/build.gradle.kts')).includes('"com.example.cloudlist.server.local.LocalMainKt"'));

    // The app's scheme is the user's; the Google Sign-In scheme stays a build setting
    const plist = await read(projectDir, 'iosApp/iosApp/Info.plist');
    const firstScheme = plist.match(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>([^<]*)<\/string>/);
    assert.equal(firstScheme && firstScheme[1], 'cloudlist');
    assert.ok(plist.includes('<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>'));

    const settings = await read(projectDir, 'settings.gradle.kts');
    assert.match(settings, /^(?![ \t]*\/\/).*\bincludeBuild\("server"\)/m, 'includeBuild("server") missing');
    for (const include of [':core:api', ':core:auth', ':feature:account:presentation', ':feature:sharing:presentation',
        ':feature:notesx:presentation']) {
        assert.ok(settings.includes(`"${include}"`), `${include} not included`);
    }
    const sharedBuild = await read(projectDir, 'shared/build.gradle.kts');
    assert.ok(sharedBuild.includes('projects.feature.notesx.presentation'));
    assert.ok(sharedBuild.includes('projects.feature.account.presentation'));
    const initKoin = await read(projectDir, 'shared/src/commonMain/kotlin/com/example/cloudlist/di/initKoin.kt');
    for (const module of ['NotesxPresentationModule', 'AuthModule', 'AccountModule', 'SharingModule']) {
        assert.match(initKoin, new RegExp(`\\b${module}\\b`), module);
    }

    // server/ is the backend template's (sharing on, sample off, the package <app>.server), its CI and record gone
    assert.match(await read(projectDir, 'server/gradle.properties'), /^localServerDir=\.\.\/\.local-server$/m);
    for (const gone of ['server/.github', 'server/.cmpose', 'server/src/main/kotlin/com/example/cloudlist/server/feature/sample']) {
        assert.equal(await fs.pathExists(path.join(projectDir, gone)), false, gone);
    }
    for (const file of await listTextFiles(path.join(projectDir, 'server'))) {
        const rel = path.relative(projectDir, file).split(path.sep).join('/');
        assert.ok(!rel.includes('feature/sample'), rel);
        assert.ok(!(await fs.readFile(file, 'utf8')).includes('io.cmpose.backendtemplate'), rel);
    }

    // core/api keeps its contract test against server/ (Android host); its common tests go like blank's other ones
    assert.ok(await fs.pathExists(path.join(projectDir, 'core/api/src/androidHostTest/kotlin/com/example/cloudlist/core/api/ApiContractTest.kt')),
        'ApiContractTest missing');
    assert.equal(await fs.pathExists(path.join(projectDir, 'core/api/src/commonTest')), false, 'core/api commonTest');
    assert.deepEqual(await testsWithoutMockClient(projectDir), []);

    // detekt is off: core/api no longer applies its plugin (server/ keeps the backend template's own detekt)
    assert.ok(!(await read(projectDir, 'core/api/build.gradle.kts')).includes('.detekt")'), 'core/api/build.gradle.kts');

    // ads is off: Package.resolved keeps the backend's pins and loses only GMA and UMP
    const pins = JSON.parse(await read(projectDir, PACKAGE_RESOLVED)).pins.map((pin) => pin.identity);
    assert.ok(pins.includes('firebase-ios-sdk') && pins.includes('googlesignin-ios'), pins.join(', '));
    for (const gone of GMA_PINS) assert.ok(!pins.includes(gone), gone);

    const readme = await read(projectDir, 'README.md');
    assert.ok(readme.includes('- `server/`: Ktor server from the cmpose backend template'), 'README does not list server/');
    assert.ok(readme.includes('- `:feature:notesx`'), 'README does not list the custom module');

    for (const file of await listTextFiles(projectDir)) {
        assert.ok(!(await fs.readFile(file, 'utf8')).includes('cmpose:backend'), path.relative(projectDir, file));
    }
});
