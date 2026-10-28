const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processCoreFeatures, assertNoInsightsResidue } = require('../src/fileService');
const { applyBackendOption, stripBackendPbxproj } = require('../src/backendOption');

// The seed is the template after the package move (dev.cmpose.app), trimmed to what insights touches. The backend
// option runs first, as in generateCmpProject: it keeps or drops the Firebase setup (cmpose:firebase) insights shares.
const NEW_PACKAGE = 'dev.cmpose.app';
const PKG = 'dev/cmpose/app';
const FIXTURES = path.join(__dirname, 'fixtures', 'insights');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const BACKEND_PBXPROJ = fs.readFileSync(path.join(__dirname, 'fixtures', 'backend', 'project.pbxproj'), 'utf8');

const INIT_KOIN = `shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt`;
const REGISTRATION = `shared/src/iosMain/kotlin/${PKG}/InsightsBridgeRegistration.kt`;
const BRIDGE = 'iosApp/iosApp/InsightsBridge.swift';
const PBXPROJ = 'iosApp/iosApp.xcodeproj/project.pbxproj';
const INSIGHTS_SRC = `core/insights/src/commonMain/kotlin/${PKG}/core/insights`;

// Every other flag on, so only the insights (and backend) parts act on the tree
const OTHERS_ON = { network: true, networkInspector: true, theming: true, multiLang: true, dataStore: true, detekt: true,
    purchases: true, ads: true, room: true };

async function seed(extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'insights-'));
    const files = {
        'settings.gradle.kts': fixture('settings.gradle.kts'),
        'shared/build.gradle.kts': fixture('shared.build.gradle.kts'),
        [INIT_KOIN]: fixture('initKoin.kt'),
        [REGISTRATION]: fixture('InsightsBridgeRegistration.kt'),
        'iosApp/iosApp/iOSApp.swift': fixture('iOSApp.swift'),
        [BRIDGE]: fixture('InsightsBridge.swift'),
        [PBXPROJ]: fixture('project.pbxproj'),
        'androidApp/build.gradle.kts': fixture('androidApp.build.gradle.kts'),
        'gradle/libs.versions.toml': fixture('libs.versions.toml'),
        'README.md': fixture('README.md'),
        'core/insights/build.gradle.kts': [
            'kotlin {',
            '    sourceSets {',
            '        androidMain.dependencies {',
            '            implementation(project.dependencies.platform(libs.firebase.bom))',
            '            implementation(libs.firebase.crashlytics)',
            '            implementation(libs.firebase.analytics)',
            '        }',
            '        iosMain.dependencies {',
            '            implementation(libs.crashkios.crashlytics)',
            '        }',
            '    }',
            '}',
            ''
        ].join('\n'),
        [`${INSIGHTS_SRC}/Insights.kt`]: `package ${NEW_PACKAGE}.core.insights\n\nobject Insights\n`,
        [`${INSIGHTS_SRC}/InsightsLogWriter.kt`]: `package ${NEW_PACKAGE}.core.insights\n\nclass InsightsLogWriter\n\nfun installInsightsLogging(insights: Any) = Unit\n`,
        [`${INSIGHTS_SRC}/di/InsightsModule.kt`]: `package ${NEW_PACKAGE}.core.insights.di\n\nclass InsightsModule\n`,
        [`core/insights/src/iosMain/kotlin/${PKG}/core/insights/IosInsights.kt`]:
            `package ${NEW_PACKAGE}.core.insights\n\nimport co.touchlab.crashkios.crashlytics.enableCrashlytics\n\ninterface IosInsightsBridge\n\nobject IosInsights\n`,
        [`core/insights/src/androidMain/kotlin/${PKG}/core/insights/AndroidInsights.kt`]:
            `package ${NEW_PACKAGE}.core.insights\n\nimport com.google.firebase.crashlytics.FirebaseCrashlytics\n`,
        ...extra
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    return dir;
}

// generateCmpProject's order: the backend option (firebase = backend || insights), then processCoreFeatures
async function generate(t, { backend, insights }, extra) {
    t.mock.method(console, 'log', () => { });
    const dir = await seed(extra);
    t.after(() => fs.remove(dir));
    await applyBackendOption(dir, { enabled: backend, firebase: backend || insights });
    await processCoreFeatures(dir, { ...OTHERS_ON, backend, insights }, NEW_PACKAGE);
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));

// What insights off leaves, whatever the backend
async function assertInsightsGone(dir) {
    for (const gone of ['core/insights', REGISTRATION, BRIDGE]) assert.equal(await exists(dir, gone), false, gone);

    assert.doesNotMatch(await read(dir, 'settings.gradle.kts'), /core:insights/);
    assert.equal(await read(dir, 'shared/build.gradle.kts'), fixture('shared.build.gradle.kts')
        .replace('            // Swift implements core:insights\' IosInsightsBridge and hands it to IosInsights.register\n', '')
        .replace('            export(projects.core.insights)\n', '')
        .replace('            api(projects.core.insights)\n', ''));

    // initKoin.kt compiles: no import, call or module of insights is left, nor KoinPlatform's unused import
    assert.equal(await read(dir, INIT_KOIN), [
        '@file:Suppress("Filename")',
        '',
        'package dev.cmpose.app.di',
        '',
        'import dev.cmpose.app.core.navigation.NavigationModule',
        'import org.koin.core.context.startKoin',
        'import org.koin.ksp.generated.module',
        'import org.koin.core.module.Module as KoinModule',
        '',
        'fun initKoin() {',
        '    startKoin { modules(appModules()) }',
        '}',
        '',
        'fun appModules(): List<KoinModule> = buildList {',
        '    add(NavigationModule().module)',
        '}',
        ''
    ].join('\n'));

    const swift = await read(dir, 'iosApp/iosApp/iOSApp.swift');
    assert.doesNotMatch(swift, /Insights/);
    assert.match(swift, /MainViewControllerKt\.startKoinAtLaunch\(\)/);
    assert.match(swift, /AdsBridgeRegistrationKt\.registerAdsBridge\(bridge: AdsBridge\(\)\)/);

    const androidBuild = await read(dir, 'androidApp/build.gradle.kts');
    assert.doesNotMatch(androidBuild, /[Cc]rashlytics/);

    const toml = await read(dir, 'gradle/libs.versions.toml');
    for (const gone of ['firebaseBom', 'firebaseCrashlyticsPlugin', 'firebase-bom', 'firebase-crashlytics', 'firebase-analytics', 'firebaseCrashlytics',
        'crashkios', 'crashkios-crashlytics']) {
        assert.doesNotMatch(toml, new RegExp(`^${gone}\\s*=`, 'm'), gone);
    }
    assert.match(toml, /^kotlin-test = /m);

    const pbxproj = await read(dir, PBXPROJ);
    for (const gone of ['FirebaseCrashlytics', 'FirebaseAnalytics', 'Upload Crashlytics symbols']) {
        assert.ok(!pbxproj.includes(gone), `${gone} still in project.pbxproj`);
    }

    const readme = await read(dir, 'README.md');
    assert.doesNotMatch(readme, /cmpose:insights|Crashlytics/);
    assert.match(readme, /Open the project\.\n\n## Modules/);
}

test('insights off removes the module and every wiring line', async (t) => {
    const dir = await generate(t, { backend: false, insights: false });
    await assertInsightsGone(dir);
    // Backend off too: the Firebase setup is gone with the backend option, the project is the one before both
    assert.equal(await read(dir, PBXPROJ), stripBackendPbxproj(BACKEND_PBXPROJ));
    assert.doesNotMatch(await read(dir, 'androidApp/build.gradle.kts'), /google-services|googleServices|cmpose:/);
    assert.doesNotMatch(await read(dir, 'iosApp/iosApp/iOSApp.swift'), /Firebase|firebaseConfigured/);
});

test('insights off removes the CrashKiOS catalog entries', async (t) => {
    for (const backend of [false, true]) {
        const dir = await generate(t, { backend, insights: false });
        // By key: the entries around them stay
        const toml = await read(dir, 'gradle/libs.versions.toml');
        assert.ok(!toml.includes('crashkios'), `crashkios left in libs.versions.toml (backend ${backend})`);
        assert.match(toml, /^kotlin = "2\.3\.21"$/m);
        assert.match(toml, /^kotlinMultiplatform = /m);
    }
});

test('insights off: the Firebase block above Koin goes or stays with the backend', async (t) => {
    const lines = (swift) => swift.split('\n').map((line) => line.trim());
    const off = await read(await generate(t, { backend: false, insights: false }), 'iosApp/iosApp/iOSApp.swift');
    assert.deepEqual(lines(off).slice(lines(off).indexOf('init() {') + 1, lines(off).indexOf('init() {') + 4), [
        'MainViewControllerKt.startKoinAtLaunch()',
        '// Google Mobile Ads lives in Swift (AdsBridge.swift); Kotlin reaches it through this bridge.',
        'AdsBridgeRegistrationKt.registerAdsBridge(bridge: AdsBridge())'
    ]);
    const on = await read(await generate(t, { backend: true, insights: false }), 'iosApp/iosApp/iOSApp.swift');
    // FirebaseApp.configure() still runs before Koin starts and the sign-in bridge registers
    assert.ok(on.indexOf('FirebaseApp.configure()') < on.indexOf('startKoinAtLaunch()'));
    assert.ok(on.indexOf('startKoinAtLaunch()') < on.indexOf('registerSignInBridge'));
    assert.ok(on.indexOf('registerSignInBridge') < on.indexOf('registerAdsBridge'));
});

test('insights off leaves no residue token', async (t) => {
    const dir = await generate(t, { backend: false, insights: false });
    // The generator's own check passes on what it left
    await assertNoInsightsResidue(dir, NEW_PACKAGE, { insights: false });
});

test('insights off with backend on keeps FirebaseAuth and the firebase blocks', async (t) => {
    const dir = await generate(t, { backend: true, insights: false });
    await assertInsightsGone(dir);
    // Sign-in still works: the firebase-ios-sdk package with FirebaseAuth, the Copy phase, the project before insights
    assert.equal(await read(dir, PBXPROJ), BACKEND_PBXPROJ);
    const swift = await read(dir, 'iosApp/iosApp/iOSApp.swift');
    assert.match(swift, /^import FirebaseCore$/m);
    assert.match(swift, /FirebaseApp\.configure\(\)/);
    assert.match(swift, /registerSignInBridge/);
    const androidBuild = await read(dir, 'androidApp/build.gradle.kts');
    assert.match(androidBuild, /alias\(libs\.plugins\.googleServices\) apply false/);
    assert.match(androidBuild, /apply\(plugin = "com\.google\.gms\.google-services"\)/);
    assert.match(await read(dir, 'gradle/libs.versions.toml'), /^googleServices = \{ id = "com\.google\.gms\.google-services"/m);
});

test('insights on keeps everything', async (t) => {
    for (const backend of [false, true]) {
        const dir = await generate(t, { backend, insights: true });
        for (const kept of ['core/insights/build.gradle.kts', `${INSIGHTS_SRC}/di/InsightsModule.kt`, REGISTRATION, BRIDGE]) {
            assert.ok(await exists(dir, kept), `${kept} (backend ${backend})`);
        }
        assert.equal(await read(dir, INIT_KOIN), fixture('initKoin.kt'));
        assert.equal(await read(dir, 'shared/build.gradle.kts'), fixture('shared.build.gradle.kts'));
        assert.equal(await read(dir, 'settings.gradle.kts'), fixture('settings.gradle.kts'));
        assert.equal(await read(dir, 'README.md'), fixture('README.md'));
        assert.match(await read(dir, 'iosApp/iosApp/iOSApp.swift'),
            /registerInsightsBridge\(bridge: InsightsBridge\(firebaseConfigured: firebaseConfigured\)\)/);
        const androidBuild = await read(dir, 'androidApp/build.gradle.kts');
        assert.match(androidBuild, /alias\(libs\.plugins\.firebaseCrashlytics\) apply false/);
        assert.match(androidBuild, /apply\(plugin = "com\.google\.firebase\.crashlytics"\)/);
        const toml = await read(dir, 'gradle/libs.versions.toml');
        for (const kept of ['firebaseBom', 'firebaseCrashlyticsPlugin', 'firebase-bom', 'firebase-crashlytics', 'firebase-analytics', 'firebaseCrashlytics']) {
            assert.match(toml, new RegExp(`^${kept}\\s*=`, 'm'), kept);
        }
        // The template's order: Firebase configured, Koin started, sign-in (backend on), insights, then ads registered
        const swift = await read(dir, 'iosApp/iosApp/iOSApp.swift');
        const order = ['FirebaseApp.configure()', 'startKoinAtLaunch()', ...(backend ? ['registerSignInBridge'] : []),
            'registerInsightsBridge', 'registerAdsBridge'].map((call) => swift.indexOf(call));
        assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `iOSApp.swift order (backend ${backend})`);
        assert.equal(swift.includes('registerSignInBridge'), backend);
        const pbxproj = await read(dir, PBXPROJ);
        if (backend) {
            assert.equal(pbxproj, fixture('project.pbxproj'));
        } else {
            // The backend's FirebaseAuth and GoogleSignIn go, insights' products and phases stay
            for (const kept of ['/* FirebaseCrashlytics in Frameworks */', '/* FirebaseAnalytics in Frameworks */',
                'name = "Upload Crashlytics symbols if configured";', 'name = "Copy GoogleService-Info if present";']) {
                assert.ok(pbxproj.includes(kept), `${kept} missing from project.pbxproj`);
            }
            assert.ok(!pbxproj.includes('FirebaseAuth') && !pbxproj.includes('GoogleSignIn'));
        }
    }
});

test('insights on keeps the CrashKiOS catalog entries and the module\'s dependency', async (t) => {
    for (const backend of [false, true]) {
        const dir = await generate(t, { backend, insights: true });
        const toml = await read(dir, 'gradle/libs.versions.toml');
        assert.match(toml, /^crashkios = "0\.10\.1"$/m, `backend ${backend}`);
        assert.match(toml, /^crashkios-crashlytics = \{ module = "co\.touchlab\.crashkios:crashlytics"/m, `backend ${backend}`);
        assert.match(await read(dir, 'core/insights/build.gradle.kts'), /implementation\(libs\.crashkios\.crashlytics\)/);
    }
});

test('a leftover CrashKiOS token fails generation', async (t) => {
    t.mock.method(console, 'log', () => { });
    const strays = [
        [`shared/src/iosMain/kotlin/${PKG}/Crash.kt`, `package ${NEW_PACKAGE}\n\nimport co.touchlab.crashkios.crashlytics.enableCrashlytics\n`,
            /Crash\.kt: co\.touchlab\.crashkios/],
        ['shared/build.gradle.kts', `${fixture('shared.build.gradle.kts')}dependencies { implementation(libs.crashkios.crashlytics) }\n`,
            /shared[\\/]build\.gradle\.kts: libs\.crashkios/]
    ];
    for (const [rel, content, expected] of strays) {
        const dir = await seed({ [rel]: content });
        t.after(() => fs.remove(dir));
        await applyBackendOption(dir, { enabled: false, firebase: false });
        await assert.rejects(processCoreFeatures(dir, { ...OTHERS_ON, backend: false, insights: false }, NEW_PACKAGE),
            new RegExp(`Insights residue after removal:[\\s\\S]*${expected.source}`), rel);
    }
});

test('a leftover Crashlytics token fails generation', async (t) => {
    t.mock.method(console, 'log', () => { });
    const stray = { [`shared/src/androidMain/kotlin/${PKG}/Crash.kt`]: `package ${NEW_PACKAGE}\n\nimport com.google.firebase.crashlytics.FirebaseCrashlytics\n` };
    const dir = await seed(stray);
    t.after(() => fs.remove(dir));
    await applyBackendOption(dir, { enabled: false, firebase: false });
    await assert.rejects(processCoreFeatures(dir, { ...OTHERS_ON, backend: false, insights: false }, NEW_PACKAGE),
        /Insights residue after removal:[\s\S]*Crash\.kt: com\.google\.firebase\.crashlytics/);
});

test('assertNoInsightsResidue: each wiring line left over is named', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'insights-residue-'));
    t.after(() => fs.remove(dir));
    const cases = [
        ['settings.gradle.kts', 'include(":core:insights")\n', '":core:insights"'],
        ['shared/build.gradle.kts', 'api(projects.core.insights)\n', 'projects.core.insights'],
        [INIT_KOIN, 'add(InsightsModule().module)\n', 'InsightsModule'],
        ['iosApp/iosApp/iOSApp.swift', 'InsightsBridgeRegistrationKt.registerInsightsBridge(bridge: b)\n', 'registerInsightsBridge'],
        ['androidApp/build.gradle.kts', 'alias(libs.plugins.firebaseCrashlytics) apply false\n', 'libs.plugins.firebaseCrashlytics'],
        ['gradle/libs.versions.toml', 'firebase-analytics = { module = "com.google.firebase:firebase-analytics" }\n', 'com.google.firebase:firebase'],
        ['gradle/libs.versions.toml', 'crashkios-crashlytics = { module = "co.touchlab.crashkios:crashlytics" }\n', 'co.touchlab.crashkios'],
        ['core/sample/build.gradle.kts', 'implementation(libs.crashkios.crashlytics)\n', 'libs.crashkios'],
        [PBXPROJ, 'productName = FirebaseAnalytics;\n', 'FirebaseAnalytics'],
        [PBXPROJ, 'name = "Upload Crashlytics symbols if configured";\n', 'Upload Crashlytics symbols'],
        ['README.md', '<!-- cmpose:insights -->\n', 'cmpose:insights']
    ];
    for (const [rel, content, label] of cases) {
        await fs.emptyDir(dir);
        await fs.outputFile(path.join(dir, rel), content);
        await assert.rejects(assertNoInsightsResidue(dir, NEW_PACKAGE, { insights: false }),
            (error) => error.message.includes(`${path.normalize(rel)}: ${label}`), `${rel}: ${label}`);
        await assertNoInsightsResidue(dir, NEW_PACKAGE, { insights: true });
    }
    // A file the removal must take out
    await fs.emptyDir(dir);
    await fs.outputFile(path.join(dir, BRIDGE), 'import Shared\n');
    await assert.rejects(assertNoInsightsResidue(dir, NEW_PACKAGE, { insights: false }), /InsightsBridge\.swift: file still present/);
});

test('assertNoInsightsResidue: a custom module named insights and a package spelling core.insights are the user\'s', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'insights-residue-'));
    t.after(() => fs.remove(dir));
    const files = {
        'settings.gradle.kts': 'include(":feature:insights:presentation")\n',
        'shared/build.gradle.kts': 'implementation(projects.feature.insights.presentation)\n',
        [INIT_KOIN]: 'import dev.cmpose.app.feature.insights.presentation.di.InsightsPresentationModule\n\nfun m() = add(InsightsPresentationModule().module)\n',
        [`feature/insights/presentation/src/commonMain/kotlin/${PKG}/feature/insights/presentation/InsightsModule.kt`]:
            'package dev.cmpose.app.feature.insights.presentation\n\nclass InsightsModule\n'
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    await assertNoInsightsResidue(dir, NEW_PACKAGE, { insights: false });

    const packageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'insights-residue-'));
    t.after(() => fs.remove(packageDir));
    await fs.outputFile(path.join(packageDir, 'shared/src/commonMain/kotlin/io/core/insights/di/initKoin.kt'),
        'package io.core.insights.di\n\nimport io.core.insights.core.navigation.NavigationModule\n');
    await fs.outputFile(path.join(packageDir, 'androidApp/build.gradle.kts'), 'android {\n    namespace = "io.core.insights"\n}\n');
    await assertNoInsightsResidue(packageDir, 'io.core.insights', { insights: false });
});
