'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');
const { listTextFiles } = require('../src/projectFiles');
const { INSIGHTS_RESIDUE_TOKENS } = require('../src/fileService');

// The whole pipeline against the REAL templates, for the four backend × insights combinations (CMP_REAL_TEMPLATE_DIR, a
// `git archive` of the CMP template's branch; CMPOSE_BACKEND_TEMPLATE_DIR, a backend template checkout, for backend on).
// Skipped, not failed, when either is unset or the CMP template predates insights.
const REAL = process.env.CMP_REAL_TEMPLATE_DIR;
const BACKEND = process.env.CMPOSE_BACKEND_TEMPLATE_DIR;
const HAS_TEMPLATE = Boolean(REAL) && fs.existsSync(path.join(REAL, 'core', 'insights'))
    && fs.existsSync(path.join(REAL, 'blank', 'layers')) && fs.existsSync(path.join(REAL, 'feature', 'sample'));
const HAS_BACKEND = Boolean(BACKEND) && fs.existsSync(path.join(BACKEND, 'settings.gradle.kts'));
const TEMPLATE_OPTIONS = HAS_TEMPLATE ? {}
    : { skip: !REAL ? 'CMP_REAL_TEMPLATE_DIR is not set' : `no insights-ready template at CMP_REAL_TEMPLATE_DIR (${REAL})` };
const BACKEND_OPTIONS = !HAS_TEMPLATE ? TEMPLATE_OPTIONS
    : HAS_BACKEND ? {} : { skip: 'CMPOSE_BACKEND_TEMPLATE_DIR is not set' };
// A checkout's own state and build output never reach the copy
const BACKEND_SKIPPED = new Set(['.git', '.gradle', '.kotlin', 'build', '.local-server', '.idea', '.claude']);
// What the template's sync keeps out of the template: an upstream archive still has them
const MAINTAINER_ONLY = ['gradle/wizard.gradle.kts', 'MAINTAINING.md', 'scripts/ios-add-packages.rb', 'scripts-maintainer'];
const PBXPROJ = 'iosApp/iosApp.xcodeproj/project.pbxproj';
const INIT_KOIN = 'shared/src/commonMain/kotlin/com/example/demo/di/initKoin.kt';
const TOML = 'gradle/libs.versions.toml';
// CrashKiOS's catalog keys (the version key itself spells no residue token)
const CRASHKIOS_KEY = /^crashkios(?:-crashlytics)?\s*=/m;
const TEMPLATE_HAS_CRASHKIOS = HAS_TEMPLATE && CRASHKIOS_KEY.test(fs.readFileSync(path.join(REAL, TOML), 'utf8'));

async function generate(t, request) {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-insights-real-'));
    t.after(() => fs.remove(projectDir));
    await fs.copy(REAL, projectDir, {
        filter: (src) => {
            const rel = path.relative(REAL, src).split(path.sep).join('/');
            return !MAINTAINER_ONLY.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
        }
    });
    const { ok, value, error } = validate({ appName: 'Demo App', minSdk: '24', iosVersion: '16.0', projectName: 'Demo',
        packageName: 'com.example.demo', ...request });
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
const exists = (projectDir, rel) => fs.pathExists(path.join(projectDir, rel));

// Every insights residue token in the files it is looked for in (the project's own names spell none of them)
async function residue(projectDir) {
    const found = [];
    for (const file of await listTextFiles(projectDir)) {
        const content = await fs.readFile(file, 'utf8');
        for (const token of INSIGHTS_RESIDUE_TOKENS) {
            if (token.extensions.has(path.extname(file)) && token.regex.test(content)) {
                found.push(`${path.relative(projectDir, file)}: ${token.label}`);
            }
        }
    }
    return found;
}

async function assertInsightsOff(projectDir) {
    assert.deepEqual(await residue(projectDir), []);
    assert.equal(await exists(projectDir, 'core/insights'), false);
    assert.doesNotMatch(await read(projectDir, INIT_KOIN), /Insights|KoinPlatform/);
    assert.doesNotMatch(await read(projectDir, TOML), CRASHKIOS_KEY);
}

async function assertInsightsOn(projectDir) {
    assert.ok(await exists(projectDir, 'core/insights/build.gradle.kts'));
    assert.ok((await read(projectDir, 'settings.gradle.kts')).includes('":core:insights"'));
    assert.match(await read(projectDir, INIT_KOIN), /\bInsightsModule\b/);
    if (TEMPLATE_HAS_CRASHKIOS) {
        assert.match(await read(projectDir, TOML), /^crashkios-crashlytics\s*=/m);
        assert.match(await read(projectDir, 'core/insights/build.gradle.kts'), /\blibs\.crashkios\.crashlytics\b/);
    }
    const pbxproj = await read(projectDir, PBXPROJ);
    for (const kept of ['productName = FirebaseCrashlytics;', 'productName = FirebaseAnalytics;', 'Upload Crashlytics symbols if configured',
        'Copy GoogleService-Info if present']) {
        assert.ok(pbxproj.includes(kept), `${kept} missing from project.pbxproj`);
    }
}

test('real template, blank, backend off and insights off: no Firebase anywhere', TEMPLATE_OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { backend: false, insights: false } });
    await assertInsightsOff(projectDir);
    assert.doesNotMatch(await read(projectDir, PBXPROJ), /firebase|GoogleService-Info/i);
});

test('real template, blank, backend off and insights on: the Firebase setup and insights stay, sign-in goes', TEMPLATE_OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { backend: false, insights: true } });
    await assertInsightsOn(projectDir);
    const pbxproj = await read(projectDir, PBXPROJ);
    assert.ok(!pbxproj.includes('FirebaseAuth') && !pbxproj.includes('GoogleSignIn'), 'FirebaseAuth or GoogleSignIn left in project.pbxproj');
    assert.match(await read(projectDir, 'iosApp/iosApp/iOSApp.swift'), /\bregisterInsightsBridge\b/);
});

test('real template, blank, backend on and insights off: sign-in keeps FirebaseAuth, insights goes', BACKEND_OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { backend: true, insights: false } });
    await assertInsightsOff(projectDir);
    const pbxproj = await read(projectDir, PBXPROJ);
    for (const kept of ['productName = FirebaseAuth;', 'Copy GoogleService-Info if present']) {
        assert.ok(pbxproj.includes(kept), `${kept} missing from project.pbxproj`);
    }
    assert.match(await read(projectDir, 'iosApp/iosApp/iOSApp.swift'), /FirebaseApp\.configure\(\)/);
    assert.match(await read(projectDir, 'androidApp/build.gradle.kts'), /com\.google\.gms\.google-services/);
});

test('real template, blank, backend on and insights on: both stay', BACKEND_OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { backend: true, insights: true } });
    await assertInsightsOn(projectDir);
    assert.ok((await read(projectDir, PBXPROJ)).includes('productName = FirebaseAuth;'));
});

test('real template, showcase keeps insights', TEMPLATE_OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'showcase' });
    await assertInsightsOn(projectDir);
    assert.ok(!(await read(projectDir, PBXPROJ)).includes('FirebaseAuth'), 'FirebaseAuth left in a showcase project.pbxproj');
});
