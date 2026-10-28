const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { renderRequirements, renderModules, replaceBetweenMarkers, removeMarkedBlock, fillReadme } = require('../src/readmeService');
const { setLogger } = require('../src/log');

const VERSIONS = { jdk: '21', kotlin: '2.3.21', composeMultiplatform: '1.11.1', agp: '9.2.1', gradle: '9.7.0', compileSdk: '36', targetSdk: '36' };

const README = [
    'Intro',
    '<!-- cmpose:requirements -->',
    'old table',
    '<!-- /cmpose:requirements -->',
    'Middle',
    '<!-- cmpose:modules -->',
    'old modules',
    '<!-- /cmpose:modules -->',
    'End'
].join('\n');

test('renderRequirements lists the template versions and the request values', () => {
    const out = renderRequirements(VERSIONS, { minSdk: '24', iosVersion: '15.0' });

    assert.ok(out.includes('| JDK | 21 |'), out);
    assert.ok(out.includes('| Kotlin | 2.3.21 |'), out);
    assert.ok(out.includes('| Android compileSdk / targetSdk | 36 / 36 |'), out);
    assert.ok(out.includes('| Android minSdk | 24 |'), out);
    assert.ok(out.includes('| iOS minimum | 15.0 |'), out);
    assert.ok(out.includes('Apple Silicon'), out);
});

test('renderRequirements shows a dash for a version the template does not expose', () => {
    const out = renderRequirements({ ...VERSIONS, compileSdk: null, kotlin: null }, { minSdk: '24', iosVersion: '15.0' });

    assert.ok(out.includes('| Kotlin | — |'), out);
    assert.ok(out.includes('| Android compileSdk / targetSdk | — |'), out);
});

test('renderModules groups core modules and features with their layers', () => {
    const settings = [
        'include(":shared")', 'include(":androidApp")', 'include(":core:domain")', 'include(":core:network")',
        'include(":feature:orders")', 'include(":feature:orders:contract")', 'include(":feature:orders:data")',
        'include("feature:orders:domain")', 'include("feature:orders:presentation")', 'includeBuild("build-logic")'
    ].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes('- `:androidApp`: Android entry point'), out);
    assert.ok(out.includes('- `:shared`: app shell'), out);
    assert.ok(out.includes('- `:core:domain`: '), out);
    assert.ok(out.includes('- `:core:network`: '), out);
    assert.ok(out.includes('- `:feature:orders`: contract, data, domain, presentation'), out);
    assert.ok(!out.includes('build-logic'), out);
});

test('renderModules describes core/logging as Kermit logging', () => {
    const settings = ['include(":shared")', 'include(":core:domain")', 'include(":core:logging")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes('- `:core:logging`: Kermit logging: every level in debug, warnings and errors in release'), out);
});

test('renderModules describes core/review as in-app review', () => {
    const settings = ['include(":shared")', 'include(":core:domain")', 'include(":core:review")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes('- `:core:review`: in-app review (Play In-App Review, StoreKit) and the store page link'), out);
});

test('renderModules describes core/about as app version, legal links and licences', () => {
    const settings = ['include(":shared")', 'include(":core:domain")', 'include(":core:about")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes('- `:core:about`: app version, legal links and open source licences'), out);
});

test('renderModules lists the backend modules with descriptions', () => {
    const settings = ['include(":shared")', 'include(":core:api")', 'include(":core:auth")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes("- `:core:api`: the app's client models and routes for the backend API, checked by ApiContractTest"), out);
    assert.ok(out.includes("- `:core:auth`: Firebase sign-in: email, Google, Apple; the server client's token"), out);
});

const SERVER_LINE = '- `server/`: Ktor server from the cmpose backend template (an included build): sign-in check, spaces, sharing, files; '
    + '`./gradlew :server:runLocal`; deploying: `server/deploy/README.md`';
const INCLUDE_SERVER = '// server/ is generated from the cmpose backend template (an included build)\n'
    + 'if (file("server/settings.gradle.kts").exists()) includeBuild("server")';

test('includedServerBuildIsListed', async () => {
    const settings = `include(":shared")\ninclude(":core:api")\n${INCLUDE_SERVER}\n`;
    assert.ok(renderModules(settings, { serverDir: true }).endsWith(SERVER_LINE));
    // not without server/, nor when the settings do not include it (a comment does not count)
    assert.ok(!renderModules(settings).includes('server/'));
    assert.ok(!renderModules('include(":shared")\n// includeBuild("server")\n', { serverDir: true }).includes('server/'));
    // fillReadme looks for server/ itself
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-readme-server-'));
    try {
        await fs.outputFile(path.join(dir, 'README.md'), README);
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), settings);
        await fs.outputFile(path.join(dir, 'server', 'settings.gradle.kts'), 'rootProject.name = "demo"\n');
        assert.equal(await fillReadme(dir, { versions: VERSIONS, minSdk: '24', iosVersion: '15.0' }), true);
        assert.ok((await fs.readFile(path.join(dir, 'README.md'), 'utf8')).includes(SERVER_LINE));
    } finally {
        await fs.remove(dir);
    }
});

test('renderModules does not list a server the settings do not include', () => {
    assert.ok(!renderModules('include(":shared")\ninclude(":server")', { serverDir: true }).includes('server'));
});

test('renderModules describes core/update as app updates', () => {
    const settings = ['include(":shared")', 'include(":core:domain")', 'include(":core:update")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes(
        '- `:core:update`: app updates: Play In-App Updates, the App Store lookup and an optional minimum version'
    ), out);
});

test('renderModules describes core/image as Coil image loading', () => {
    const settings = ['include(":shared")', 'include(":core:domain")', 'include(":core:image")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes(
        '- `:core:image`: image loading (Coil 3): memory and disk cache, network images with the network module'
    ), out);
});

test('renderModules describes core/network with the ConnectivityMonitor', () => {
    const settings = ['include(":shared")', 'include(":core:domain")', 'include(":core:network")'].join('\n');

    const out = renderModules(settings);

    assert.ok(out.includes('- `:core:network`: Ktor client, ApiConfig (base URLs), BaseRepository, ConnectivityMonitor'), out);
});

test('replaceBetweenMarkers replaces only the text between one pair of markers', () => {
    const out = replaceBetweenMarkers(README, 'cmpose:modules', 'NEW');

    assert.ok(out.includes('<!-- cmpose:modules -->\nNEW\n<!-- /cmpose:modules -->'), out);
    assert.ok(out.includes('old table'), out);
});

test('replaceBetweenMarkers inserts $& and $1 literally', () => {
    const out = replaceBetweenMarkers(README, 'cmpose:modules', 'a $& b $1');

    assert.ok(out.includes('\na $& b $1\n'), out);
});

async function withProject(files, fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-readme-test-'));
    try {
        for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

test('fillReadme fills both marked sections from the project', async () => {
    await withProject({ 'README.md': README, 'settings.gradle.kts': 'include(":shared")\ninclude(":core:domain")\n' }, async (dir) => {
        const changed = await fillReadme(dir, { versions: VERSIONS, minSdk: '26', iosVersion: '16.0' });
        const out = await fs.readFile(path.join(dir, 'README.md'), 'utf8');

        assert.equal(changed, true);
        assert.ok(out.includes('| Android minSdk | 26 |'), out);
        assert.ok(out.includes('- `:core:domain`: '), out);
        assert.ok(!out.includes('old table') && !out.includes('old modules'), out);
        assert.ok(out.startsWith('Intro\n') && out.endsWith('End'), out);
    });
});

test('fillReadme leaves a README without markers untouched (older template)', async () => {
    await withProject({ 'README.md': 'Just links\n', 'settings.gradle.kts': 'include(":shared")\n' }, async (dir) => {
        const changed = await fillReadme(dir, { versions: VERSIONS, minSdk: '24', iosVersion: '15.0' });

        assert.equal(changed, false);
        assert.equal(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), 'Just links\n');
    });
});

test('renderModules reads every path of a multi-argument include', () => {
    const out = renderModules('include(":androidApp", ":shared")\ninclude(\n    ":core:domain",\n    ":feature:home:presentation"\n)\n');
    assert.match(out, /`:androidApp`/);
    assert.match(out, /`:shared`/);
    assert.match(out, /`:core:domain`/);
    assert.match(out, /`:feature:home`: presentation/);
});

test('fillReadme never fails the generation: an unreadable README is skipped with a warning', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-readme-'));
    fs.mkdirSync(path.join(dir, 'README.md')); // a directory: readFile throws EISDIR
    const warned = [];
    setLogger({ info() { }, warn: (...a) => warned.push(a.join(' ')), error() { } });
    t.after(() => setLogger(null));
    assert.equal(await fillReadme(dir, { versions: {}, minSdk: '24', iosVersion: '15.0' }), false);
    assert.ok(warned.some((w) => /README/.test(w)), warned.join('\n'));
});

test('removeMarkedBlock removes the block with its markers', () => {
    const content = ['Intro', '', '<!-- x:a -->', 'gone', '<!-- /x:a -->', '', 'End', ''].join('\n');

    assert.equal(removeMarkedBlock(content, 'x:a'), 'Intro\n\nEnd\n');
});

test('removeMarkedBlock leaves a README without the markers untouched', () => {
    const content = 'Intro\n\n\n\nEnd\n<!-- x:a -->\nno closing marker\n';

    assert.equal(removeMarkedBlock(content, 'x:a'), content);
    assert.equal(removeMarkedBlock(content, 'x:b'), content);
});

test('removeMarkedBlock collapses the blank lines it leaves to one', () => {
    const content = ['Intro', '', '', '<!-- x:a -->', 'gone', '<!-- /x:a -->', '', '', 'End'].join('\n');
    const out = removeMarkedBlock(content, 'x:a');

    assert.equal(out, 'Intro\n\nEnd');
    assert.doesNotMatch(out, /\n{3,}/);
});

test('removeMarkedBlock collapses blank lines only where the block was removed', () => {
    const content = ['Intro', '', '', '', 'Kept gap', '', '<!-- x:a -->', 'gone', '<!-- /x:a -->', '', '', 'End', '```', 'code', '', '', '', 'more', '```'].join('\n');
    const out = removeMarkedBlock(content, 'x:a');

    assert.equal(out, ['Intro', '', '', '', 'Kept gap', '', 'End', '```', 'code', '', '', '', 'more', '```'].join('\n'));
});

test('removeMarkedBlock removes a nested block and keeps its siblings', () => {
    const content = ['<!-- o -->', 'head', '<!-- a -->', 'A', '<!-- /a -->', '<!-- b -->', 'B', '<!-- /b -->', '<!-- /o -->'].join('\n');

    assert.equal(removeMarkedBlock(content, 'a'), ['<!-- o -->', 'head', '<!-- b -->', 'B', '<!-- /b -->', '<!-- /o -->'].join('\n'));
});

test('renderModules describes the monetization core modules', () => {
    const out = renderModules('include(":core:purchases")\ninclude(":core:ads")\n');

    assert.ok(out.includes('- `:core:purchases`: RevenueCat in-app purchases (Test Store key)'), out);
    assert.ok(out.includes('- `:core:ads`: AdMob ads and consent (test IDs)'), out);
});

test('renderModules lists the monetization feature with its layers', () => {
    const settings = [
        'include(":shared")',
        'include(":feature:monetization")',
        'include(":feature:monetization:contract")',
        'include(":feature:monetization:presentation")'
    ].join('\n');

    assert.ok(renderModules(settings).includes('- `:feature:monetization`: contract, presentation'), renderModules(settings));
});

test('renderModules describes core/room and lists the notes feature with its two layers', () => {
    const settings = [
        'include(":shared")',
        'include(":core:room")',
        'include(":feature:notes")',
        'include(":feature:notes:contract")',
        'include(":feature:notes:presentation")'
    ].join('\n');
    const out = renderModules(settings);

    assert.ok(out.includes('- `:core:room`: Room database (bundled SQLite): AppDatabase, DAOs and schemas'), out);
    assert.ok(out.includes('- `:feature:notes`: contract, presentation'), out);
});

test('removeMarkedBlock cmpose:room does not take a room-favorites/room-notes opening for its own', () => {
    const content = [
        'Intro',
        '',
        '<!-- cmpose:room -->',
        '## Local database (Room)',
        '<!-- cmpose:room-favorites -->',
        '- Favorites',
        '<!-- /cmpose:room-favorites -->',
        '<!-- cmpose:room-notes -->',
        '- Notes',
        '<!-- /cmpose:room-notes -->',
        '',
        'To add a table.',
        '<!-- /cmpose:room -->',
        '',
        'End',
        ''
    ].join('\n');

    assert.equal(removeMarkedBlock(content, 'cmpose:room'), 'Intro\n\nEnd\n');
});

test('renderModules describes core/insights', () => {
    const out = renderModules(['include(":shared")', 'include(":core:insights")'].join('\n'));

    assert.ok(out.includes('- `:core:insights`: Firebase Crashlytics + Analytics (off until the Firebase config files are added)'), out);
});
