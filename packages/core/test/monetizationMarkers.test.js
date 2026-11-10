const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { applyMonetizationMarkers } = require('../src/monetizationMarkers');

const MAIN_SCREEN = 'shared/src/commonMain/kotlin/com/example/MainScreen.kt';
const BUILD = 'shared/build.gradle.kts';
const MANIFEST = 'iosApp/iosApp/PrivacyInfo.xml';
const KOTLIN_FILES = [MAIN_SCREEN, BUILD];

// An indented purchases block and an ads block with trailing spaces on its markers
const MAIN_SCREEN_CONTENT = [
    'package com.example',
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
    '}',
    ''
].join('\n');
const MANIFEST_CONTENT = '<dict>\n<!-- cmpose:ads -->\n<string>ads</string>\n<!-- /cmpose:ads -->\n</dict>\n';

async function seed(t, extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-monetization-markers-'));
    t.after(() => fs.remove(dir));
    const files = { [MAIN_SCREEN]: MAIN_SCREEN_CONTENT, [BUILD]: BUILD_CONTENT, [MANIFEST]: MANIFEST_CONTENT, ...extra };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

async function assertNoMarkerLine(dir) {
    for (const rel of KOTLIN_FILES) {
        const content = await read(dir, rel);
        assert.ok(!/cmpose:(purchases|ads)/.test(content), `${rel}: marker left\n${content}`);
    }
}

test('keepsBothBlocksWithoutMarkers', async (t) => {
    const dir = await seed(t);
    await applyMonetizationMarkers(dir, { purchases: true, ads: true });
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.match(mainScreen, /^    PaywallOnFirstLaunch\(\)$/m);
    assert.match(mainScreen, /^    InterstitialPacer\(\)$/m);
    assert.match(await read(dir, BUILD), /^    implementation\(projects\.core\.purchases\)$/m);
    await assertNoMarkerLine(dir);
});

test('dropsOnlyTheAdsBlock', async (t) => {
    const dir = await seed(t);
    await applyMonetizationMarkers(dir, { purchases: true, ads: false });
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.match(mainScreen, /PaywallOnFirstLaunch\(\)/);
    assert.doesNotMatch(mainScreen, /InterstitialPacer/);
    assert.match(await read(dir, BUILD), /projects\.core\.purchases/);
    await assertNoMarkerLine(dir);
});

test('dropsBothBlocks', async (t) => {
    const dir = await seed(t);
    await applyMonetizationMarkers(dir, { purchases: false, ads: false });
    const mainScreen = await read(dir, MAIN_SCREEN);
    assert.doesNotMatch(mainScreen, /PaywallOnFirstLaunch|InterstitialPacer/);
    assert.doesNotMatch(mainScreen, /\n\n\n/);
    assert.equal(mainScreen, 'package com.example\n\nfun mainScreen() {\n    val start = Home\n\n    Navigation(start)\n}\n');
    assert.equal(await read(dir, BUILD), 'dependencies {\n    implementation(projects.core.ui)\n}\n');
    await assertNoMarkerLine(dir);
});

test('leavesOtherFilesAlone', async (t) => {
    const dir = await seed(t);
    const before = await fs.readFile(path.join(dir, MANIFEST));
    await applyMonetizationMarkers(dir, { purchases: false, ads: false });
    assert.ok((await fs.readFile(path.join(dir, MANIFEST))).equals(before));
});

test('failsOnAnUnclosedBlock', async (t) => {
    const broken = 'shared/src/commonMain/kotlin/com/example/Broken.kt';
    const brokenContent = 'package com.example\n\n// cmpose:ads\nfun ads() = Unit\n';
    const dir = await seed(t, { [broken]: brokenContent });
    await assert.rejects(applyMonetizationMarkers(dir, { purchases: false, ads: false }), (error) => {
        assert.ok(error.message.includes(broken), error.message);
        return true;
    });
    assert.equal(await read(dir, broken), brokenContent);
    // Fail before writing: the well-formed files are untouched too
    assert.equal(await read(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
    assert.equal(await read(dir, BUILD), BUILD_CONTENT);
});

test('skipsBuildDirectories', async (t) => {
    const skipped = {};
    for (const dirName of ['build', '.gradle', 'node_modules']) {
        // Unclosed on purpose: reading it would fail the call
        skipped[`shared/${dirName}/generated/Out.kt`] = '// cmpose:purchases\nfun out() = Unit\n';
    }
    const dir = await seed(t, skipped);
    await applyMonetizationMarkers(dir, { purchases: false, ads: false });
    for (const [rel, content] of Object.entries(skipped)) assert.equal(await read(dir, rel), content, rel);
});

test('the verifier names each Kotlin file with a purchases or ads marker line left', async (t) => {
    const { verifyMonetizationMarkers } = require('../src/generationVerifier');
    const dir = await seed(t);
    const problems = new Set();
    await verifyMonetizationMarkers(dir, problems);
    assert.deepEqual([...problems].sort(), [
        `${BUILD}: // /cmpose:purchases marker left`,
        `${BUILD}: // cmpose:purchases marker left`,
        `${MAIN_SCREEN}: // /cmpose:ads marker left`,
        `${MAIN_SCREEN}: // /cmpose:purchases marker left`,
        `${MAIN_SCREEN}: // cmpose:ads marker left`,
        `${MAIN_SCREEN}: // cmpose:purchases marker left`
    ].sort());

    await applyMonetizationMarkers(dir, { purchases: true, ads: false });
    const after = new Set();
    await verifyMonetizationMarkers(dir, after);
    assert.deepEqual([...after], []);
});

test('packagesNamedBuildOrServerAreScanned', async (t) => {
    const block = '// cmpose:ads\nfun ads() = Unit\n// /cmpose:ads\n';
    const inPackage = 'app/src/commonMain/kotlin/com/build/server/Main.kt';
    const rootServer = 'server/x/Main.kt';
    const moduleOutput = 'app/build/gen/Main.kt';
    const dir = await seed(t, {
        [inPackage]: `package com.build.server\n\n${block}`,
        [rootServer]: block,
        // Unclosed on purpose: reading it would fail the call
        [moduleOutput]: '// cmpose:ads\nfun out() = Unit\n'
    });
    await applyMonetizationMarkers(dir, { purchases: true, ads: false });
    assert.equal(await read(dir, inPackage), 'package com.build.server\n');
    assert.equal(await read(dir, rootServer), block);
    assert.equal(await read(dir, moduleOutput), '// cmpose:ads\nfun out() = Unit\n');
});
