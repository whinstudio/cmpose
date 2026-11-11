const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const featureMarkers = require('../src/featureMarkers');

const { applyFeatureMarkers } = featureMarkers;

const MAIN_SCREEN = 'shared/src/commonMain/kotlin/com/example/MainScreen.kt';
const BUILD = 'feature/account/presentation/build.gradle.kts';
const INFO_PLIST = 'iosApp/iosApp/Info.plist';
const MANIFEST = 'iosApp/iosApp/PrivacyInfo.xcprivacy';
const KOTLIN_FILES = [MAIN_SCREEN, BUILD];
const ALL_ON = { purchases: true, ads: true, insights: true };
const ALL_OFF = { purchases: false, ads: false, insights: false };

// An indented purchases block, an ads block with trailing spaces on its markers and two insights blocks (an import and
// a call)
const MAIN_SCREEN_CONTENT = [
    'package com.example',
    '',
    'import com.example.core.ui.Theme',
    '// cmpose:insights',
    'import com.example.core.insights.consent.ui.InsightsConsentDialog',
    '// /cmpose:insights',
    '',
    'fun mainScreen() {',
    '    val start = Home',
    '',
    '    // cmpose:purchases',
    '    PaywallOnFirstLaunch()',
    '    // /cmpose:purchases',
    '',
    '    // cmpose:ads  ',
    '    InterstitialPacer()',
    '    // /cmpose:ads  ',
    '',
    '    // cmpose:insights',
    '    InsightsConsentDialog()',
    '    // /cmpose:insights',
    '',
    '    Navigation(start)',
    '}',
    ''
].join('\n');
const BUILD_CONTENT = [
    'dependencies {',
    '    implementation(projects.core.ui)',
    '// cmpose:purchases',
    '    implementation(projects.core.purchases)',
    '// /cmpose:purchases',
    '            // cmpose:insights',
    '            implementation(projects.core.insights)',
    '            // /cmpose:insights',
    '}',
    ''
].join('\n');
const INFO_PLIST_LINES = [
    '<plist version="1.0">',
    '    <dict>',
    '        <key>CFBundleURLTypes</key>',
    '        <array/>',
    '        <!-- cmpose:insights -->',
    '        <!-- Firebase Analytics stays off until the user agrees -->',
    '        <key>FIREBASE_ANALYTICS_COLLECTION_ENABLED</key>',
    '        <false/>',
    '        <!-- /cmpose:insights -->',
    '        <key>GADApplicationIdentifier</key>',
    '        <string>ca-app-pub-0~0</string>',
    '    </dict>',
    '</plist>',
    ''
];
const INFO_PLIST_CONTENT = INFO_PLIST_LINES.join('\n');
const INFO_PLIST_MARKERS = new Set(['        <!-- cmpose:insights -->', '        <!-- /cmpose:insights -->']);
// The privacy manifest has its own writer (writePrivacyManifest)
const MANIFEST_CONTENT = '<dict>\n<!-- cmpose:ads -->\n<string>ads</string>\n<!-- /cmpose:ads -->\n'
    + '<!-- cmpose:insights -->\n<string>crash</string>\n<!-- /cmpose:insights -->\n</dict>\n';

async function seed(t, extra = {}, { infoPlist = true } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-feature-markers-'));
    t.after(() => fs.remove(dir));
    const files = { [MAIN_SCREEN]: MAIN_SCREEN_CONTENT, [BUILD]: BUILD_CONTENT, [MANIFEST]: MANIFEST_CONTENT, ...extra };
    if (infoPlist) files[INFO_PLIST] = INFO_PLIST_CONTENT;
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

async function assertNoMarkerLine(dir) {
    for (const rel of [...KOTLIN_FILES, INFO_PLIST]) {
        const content = await read(dir, rel);
        assert.ok(!/cmpose:(purchases|ads|insights)/.test(content), `${rel}: marker left\n${content}`);
    }
}

test('the old monetization-only name is gone', () => {
    assert.equal(featureMarkers.applyMonetizationMarkers, undefined);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'monetizationMarkers.js')), false);
});

test('keepsEveryBlockWithoutMarkers', async (t) => {
    const dir = await seed(t);
    await applyFeatureMarkers(dir, ALL_ON);
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.match(mainScreen, /^    PaywallOnFirstLaunch\(\)$/m);
    assert.match(mainScreen, /^    InterstitialPacer\(\)$/m);
    assert.match(mainScreen, /^import com\.example\.core\.insights\.consent\.ui\.InsightsConsentDialog$/m);
    assert.match(mainScreen, /^    InsightsConsentDialog\(\)$/m);
    const build = await read(dir, BUILD);
    assert.match(build, /^    implementation\(projects\.core\.purchases\)$/m);
    assert.match(build, /^            implementation\(projects\.core\.insights\)$/m);
    await assertNoMarkerLine(dir);
});

test('dropsOnlyTheAdsBlock', async (t) => {
    const dir = await seed(t);
    await applyFeatureMarkers(dir, { purchases: true, ads: false, insights: true });
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.match(mainScreen, /PaywallOnFirstLaunch\(\)/);
    assert.doesNotMatch(mainScreen, /InterstitialPacer/);
    assert.match(mainScreen, /InsightsConsentDialog\(\)/);
    assert.match(await read(dir, BUILD), /projects\.core\.purchases/);
    await assertNoMarkerLine(dir);
});

test('dropsOnlyTheInsightsBlocks', async (t) => {
    const dir = await seed(t);
    await applyFeatureMarkers(dir, { purchases: true, ads: true, insights: false });
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.match(mainScreen, /PaywallOnFirstLaunch\(\)/);
    assert.match(mainScreen, /InterstitialPacer\(\)/);
    assert.doesNotMatch(mainScreen, /insights|InsightsConsent/);
    const build = await read(dir, BUILD);
    assert.match(build, /projects\.core\.purchases/);
    assert.doesNotMatch(build, /insights/);
    assert.doesNotMatch(await read(dir, INFO_PLIST), /FIREBASE_ANALYTICS_COLLECTION_ENABLED|Firebase Analytics/);
    await assertNoMarkerLine(dir);
});

test('dropsEveryBlock', async (t) => {
    const dir = await seed(t);
    await applyFeatureMarkers(dir, ALL_OFF);
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.doesNotMatch(mainScreen, /\n\n\n/);
    assert.equal(mainScreen, 'package com.example\n\nimport com.example.core.ui.Theme\n\n'
        + 'fun mainScreen() {\n    val start = Home\n\n    Navigation(start)\n}\n');
    assert.equal(await read(dir, BUILD), 'dependencies {\n    implementation(projects.core.ui)\n}\n');
    assert.equal(await read(dir, INFO_PLIST), [...INFO_PLIST_LINES.slice(0, 4), ...INFO_PLIST_LINES.slice(9)].join('\n'));
    await assertNoMarkerLine(dir);
});

test('infoPlistKeepsTheAnalyticsKeyWithoutMarkers', async (t) => {
    const dir = await seed(t);
    await applyFeatureMarkers(dir, { purchases: false, ads: false, insights: true });
    assert.equal(await read(dir, INFO_PLIST), INFO_PLIST_LINES.filter((line) => !INFO_PLIST_MARKERS.has(line)).join('\n'));
});

test('leavesThePrivacyManifestAlone', async (t) => {
    for (const flags of [ALL_ON, ALL_OFF]) {
        const dir = await seed(t);
        await applyFeatureMarkers(dir, flags);
        assert.equal(await read(dir, MANIFEST), MANIFEST_CONTENT);
    }
});

test('aProjectWithoutInfoPlistIsFine', async (t) => {
    const dir = await seed(t, {}, { infoPlist: false });
    await applyFeatureMarkers(dir, ALL_OFF);
    assert.equal(await fs.pathExists(path.join(dir, INFO_PLIST)), false);
    assert.doesNotMatch(await read(dir, MAIN_SCREEN), /InsightsConsentDialog/);
});

test('failsOnAnUnclosedBlock', async (t) => {
    const broken = 'shared/src/commonMain/kotlin/com/example/Broken.kt';
    const brokenContent = 'package com.example\n\n// cmpose:ads\nfun ads() = Unit\n';
    const dir = await seed(t, { [broken]: brokenContent });
    await assert.rejects(applyFeatureMarkers(dir, ALL_OFF), (error) => {
        assert.ok(error.message.includes(broken), error.message);
        return true;
    });
    assert.equal(await read(dir, broken), brokenContent);
    // Fail before writing: the well-formed files are untouched too
    assert.equal(await read(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
    assert.equal(await read(dir, BUILD), BUILD_CONTENT);
    assert.equal(await read(dir, INFO_PLIST), INFO_PLIST_CONTENT);
});

test('failsOnAnUnclosedInfoPlistBlock', async (t) => {
    const brokenPlist = '<dict>\n<!-- cmpose:insights -->\n<key>FIREBASE_ANALYTICS_COLLECTION_ENABLED</key>\n</dict>\n';
    const dir = await seed(t, {}, { infoPlist: false });
    await fs.outputFile(path.join(dir, INFO_PLIST), brokenPlist);
    await assert.rejects(applyFeatureMarkers(dir, ALL_ON), (error) => {
        assert.ok(error.message.includes(INFO_PLIST), error.message);
        assert.ok(error.message.includes('cmpose:insights'), error.message);
        return true;
    });
    assert.equal(await read(dir, INFO_PLIST), brokenPlist);
    assert.equal(await read(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
});

test('skipsBuildDirectories', async (t) => {
    const skipped = {};
    for (const dirName of ['build', '.gradle', 'node_modules']) {
        // Unclosed on purpose: reading it would fail the call
        skipped[`shared/${dirName}/generated/Out.kt`] = '// cmpose:insights\nfun out() = Unit\n';
    }
    const dir = await seed(t, skipped);
    await applyFeatureMarkers(dir, ALL_OFF);
    for (const [rel, content] of Object.entries(skipped)) assert.equal(await read(dir, rel), content, rel);
});

test('the verifier names each Kotlin file and Info.plist with a feature marker line left', async (t) => {
    const { verifyFeatureMarkers } = require('../src/generationVerifier');
    const dir = await seed(t);
    const problems = new Set();
    await verifyFeatureMarkers(dir, problems);
    assert.deepEqual([...problems].sort(), [
        `${BUILD}: // /cmpose:insights marker left`,
        `${BUILD}: // /cmpose:purchases marker left`,
        `${BUILD}: // cmpose:insights marker left`,
        `${BUILD}: // cmpose:purchases marker left`,
        `${INFO_PLIST}: <!-- /cmpose:insights --> marker left`,
        `${INFO_PLIST}: <!-- cmpose:insights --> marker left`,
        `${MAIN_SCREEN}: // /cmpose:ads marker left`,
        `${MAIN_SCREEN}: // /cmpose:insights marker left`,
        `${MAIN_SCREEN}: // /cmpose:purchases marker left`,
        `${MAIN_SCREEN}: // cmpose:ads marker left`,
        `${MAIN_SCREEN}: // cmpose:insights marker left`,
        `${MAIN_SCREEN}: // cmpose:purchases marker left`
    ].sort());

    await applyFeatureMarkers(dir, { purchases: true, ads: false, insights: true });
    const after = new Set();
    await verifyFeatureMarkers(dir, after);
    assert.deepEqual([...after], []);
});

test('packagesNamedBuildOrServerAreScanned', async (t) => {
    const block = '// cmpose:insights\nfun insights() = Unit\n// /cmpose:insights\n';
    const inPackage = 'app/src/commonMain/kotlin/com/build/server/Main.kt';
    const rootServer = 'server/x/Main.kt';
    const moduleOutput = 'app/build/gen/Main.kt';
    const dir = await seed(t, {
        [inPackage]: `package com.build.server\n\n${block}`,
        [rootServer]: block,
        // Unclosed on purpose: reading it would fail the call
        [moduleOutput]: '// cmpose:insights\nfun out() = Unit\n'
    });
    await applyFeatureMarkers(dir, ALL_OFF);
    assert.equal(await read(dir, inPackage), 'package com.build.server\n');
    assert.equal(await read(dir, rootServer), block);
    assert.equal(await read(dir, moduleOutput), '// cmpose:insights\nfun out() = Unit\n');
});
