const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { removeTomlEntries, processBlankApp } = require('../src/fileService');

// test/fixtures/libs.versions.toml: the template's gradle/libs.versions.toml as the pipeline
// (replaceInContent) produces it for package dev.doktor.app - i.e. with the
// `com.kturker.multiplatform.` ids under [plugins] rewritten to `dev.doktor.app.`.
// The substring "doktor" CONTAINS "ktor", so this package reproduces the real bug in which
// the old substring filter removed the *-plugin alias lines by mistake.
const DOKTOR_TOML_PATH = path.join(__dirname, 'fixtures', 'libs.versions.toml');
// test/fixtures/libs.versions.neutral.toml: the same template generated for package dev.cmpose.app
// - a "neutral" package with no clashing substring (for the equivalence test).
const NEUTRAL_TOML_PATH = path.join(__dirname, 'fixtures', 'libs.versions.neutral.toml');

const PLUGIN_ALIAS_LINES = [
    'kmp-library-plugin = { id = "dev.doktor.app.kmp.library", version = "unspecified" }',
    'compose-multiplatform-plugin = { id = "dev.doktor.app.compose.multiplatform", version = "unspecified" }',
    'multiplatform-application-plugin = { id = "dev.doktor.app.multiplatformApplication", version = "unspecified" }',
    'feature-contract-plugin = { id = "dev.doktor.app.feature.contract", version = "unspecified" }',
    'feature-data-plugin = { id = "dev.doktor.app.feature.data", version = "unspecified" }',
    'feature-domain-plugin = { id = "dev.doktor.app.feature.domain", version = "unspecified" }',
    'feature-presentation-plugin = { id = "dev.doktor.app.feature.presentation", version = "unspecified" }'
];

const KTOR_KEYS = {
    versions: ['ktorClientCore'],
    libraries: [
        'ktor-client-android',
        'ktor-client-content-negotiation',
        'ktor-client-core',
        'ktor-client-darwin',
        'ktor-client-logging',
        'ktor-client-mock',
        'ktor-serialization-kotlinx-json',
        'coil-network-ktor3'
    ]
};
const NETWORK_MONITOR_KEYS = {
    versions: ['networkMonitor'],
    libraries: ['networkMonitor-debug', 'networkMonitor-release']
};
const DATASTORE_KEYS = {
    versions: ['datastore'],
    libraries: ['androidx-datastore', 'androidx-datastore-preferences']
};
const DETEKT_KEYS = {
    versions: ['detekt'],
    libraries: ['detekt-plugin', 'detekt-formatting'],
    plugins: ['detekt']
};

async function readDoktorToml() {
    return fs.readFile(DOKTOR_TOML_PATH, 'utf8');
}

async function readNeutralToml() {
    return fs.readFile(NEUTRAL_TOML_PATH, 'utf8');
}

// An exact copy of the behaviour before key-based removal: searches for a substring in the
// lowercased line. Used as the reference for the "old" behaviour in the equivalence test.
function oldSubstringFilter(content, keyword) {
    return content
        .split('\n')
        .filter(line => !line.toLowerCase().includes(keyword))
        .join('\n');
}

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-toml-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// --- removeTomlEntries: core contract -----------------------------------------

test('removeTomlEntries deletes only the exact key inside its own [section]', () => {
    const content = [
        '[versions]',
        'foo = "1.0"',
        '',
        '[libraries]',
        'foo = { module = "com.example:foo" }',
        '',
        '[plugins]',
        'foo = { id = "com.example.foo" }'
    ].join('\n');

    const out = removeTomlEntries(content, { versions: ['foo'] });

    assert.deepEqual(out.split('\n'), [
        '[versions]',
        '',
        '[libraries]',
        'foo = { module = "com.example:foo" }',
        '',
        '[plugins]',
        'foo = { id = "com.example.foo" }'
    ]);
});

test('removeTomlEntries does not match a key that is only a prefix of another key', () => {
    const content = [
        '[libraries]',
        'detekt = { module = "x" }',
        'detekt-plugin = { module = "y" }'
    ].join('\n');

    const out = removeTomlEntries(content, { libraries: ['detekt'] });

    assert.ok(!out.includes('detekt = { module = "x" }'), out);
    assert.ok(out.includes('detekt-plugin = { module = "y" }'), out);
});

test('removeTomlEntries escapes regex metacharacters in keys', () => {
    const content = [
        '[versions]',
        'foo.bar = "1.0"',
        'fooXbar = "2.0"'
    ].join('\n');

    const out = removeTomlEntries(content, { versions: ['foo.bar'] });

    assert.ok(!out.includes('foo.bar = "1.0"'), out);
    assert.ok(out.includes('fooXbar = "2.0"'), 'a literal dot must not act as a wildcard: ' + out);
});

test('removeTomlEntries is a no-op when the key list for a section is empty', () => {
    const content = '[versions]\nfoo = "1.0"\n[plugins]\nfoo = { id = "x" }';
    assert.equal(removeTomlEntries(content, {}), content);
    assert.equal(removeTomlEntries(content), content);
});

// --- Section headers: any [name], decorated or unknown ---------------------------

test('removeTomlEntries still recognises a section header followed by a comment', () => {
    const content = [
        '[libraries]',
        'foo = { module = "com.example:foo" }',
        '',
        '[plugins] # convention plugins live below',
        'foo = { id = "com.example.foo" }'
    ].join('\n');

    const pluginsOnly = removeTomlEntries(content, { plugins: ['foo'] });
    assert.ok(pluginsOnly.includes('foo = { module = "com.example:foo" }'), pluginsOnly);
    assert.ok(!pluginsOnly.includes('foo = { id = "com.example.foo" }'), pluginsOnly);

    const librariesOnly = removeTomlEntries(content, { libraries: ['foo'] });
    assert.ok(!librariesOnly.includes('foo = { module = "com.example:foo" }'), librariesOnly);
    assert.ok(librariesOnly.includes('foo = { id = "com.example.foo" }'),
        'a [plugins] key must not be deleted as a [libraries] key: ' + librariesOnly);
});

test('removeTomlEntries recognises a section header with inner whitespace', () => {
    const content = [
        '[libraries]',
        'foo = { module = "com.example:foo" }',
        '[ plugins ]',
        'foo = { id = "com.example.foo" }'
    ].join('\n');

    const out = removeTomlEntries(content, { plugins: ['foo'] });

    assert.deepEqual(out.split('\n'), [
        '[libraries]',
        'foo = { module = "com.example:foo" }',
        '[ plugins ]'
    ]);
});

test('removeTomlEntries never deletes keys under an unknown section, even when listed for [libraries]', () => {
    const content = [
        '[libraries]',
        'foo = { module = "com.example:foo" }',
        '',
        '[metadata]',
        'foo = "kept"',
        '[constructor]',
        'foo = "kept too"',
        '[__proto__]',
        'foo = "and this"'
    ].join('\n');

    const out = removeTomlEntries(content, { libraries: ['foo'] });

    assert.deepEqual(out.split('\n'), [
        '[libraries]',
        '',
        '[metadata]',
        'foo = "kept"',
        '[constructor]',
        'foo = "kept too"',
        '[__proto__]',
        'foo = "and this"'
    ]);
});

// --- Real catalog fixture (package dev.doktor.app: "doktor" contains "ktor") ---

test('removing ktor keeps every *-plugin alias and removes exactly the ktor version/library lines', async () => {
    const content = await readDoktorToml();
    const out = removeTomlEntries(content, KTOR_KEYS);

    for (const aliasLine of PLUGIN_ALIAS_LINES) {
        assert.ok(out.includes(aliasLine), `expected alias line to survive: ${aliasLine}`);
    }

    assert.ok(!out.includes('ktorClientCore = "3.5.0"'), out);
    assert.ok(!/^ktor-client-android\s*=/m.test(out), out);
    assert.ok(!/^ktor-client-content-negotiation\s*=/m.test(out), out);
    assert.ok(!/^ktor-client-core\s*=/m.test(out), out);
    assert.ok(!/^ktor-client-darwin\s*=/m.test(out), out);
    assert.ok(!/^ktor-client-logging\s*=/m.test(out), out);
    assert.ok(!/^ktor-client-mock\s*=/m.test(out), out);
    assert.ok(!/^ktor-serialization-kotlinx-json\s*=/m.test(out), out);
    assert.ok(!/^coil-network-ktor3\s*=/m.test(out), out);

    // Unrelated content (networkMonitor, datastore, detekt, kermit, coil) is untouched.
    assert.ok(out.includes('networkMonitor = "0.1.1"'), out);
    assert.ok(out.includes('datastore = "1.2.1"'), out);
    assert.ok(out.includes('detekt = "2.0.0-alpha.3"'), out);
    assert.ok(out.includes('kermit = "2.2.0"'), out);
    assert.ok(out.includes('coil = "3.4.0"'), out);
    assert.ok(/^coil-compose\s*=/m.test(out), out);

    assert.equal(content.split('\n').length - out.split('\n').length, 9, 'exactly 9 lines removed (1 version + 8 libraries)');
});

test('removing detekt removes the detekt keys in versions/libraries/plugins but not the *-plugin convention aliases', async () => {
    const content = await readDoktorToml();
    const out = removeTomlEntries(content, DETEKT_KEYS);

    assert.ok(!/^detekt\s*=\s*"2\.0\.0-alpha\.3"/m.test(out), out);
    assert.ok(!/^detekt-plugin\s*=/m.test(out), out);
    assert.ok(!/^detekt-formatting\s*=/m.test(out), out);
    assert.ok(!/^detekt\s*=\s*\{\s*id\s*=\s*"dev\.detekt"/m.test(out), out);

    for (const aliasLine of PLUGIN_ALIAS_LINES) {
        assert.ok(out.includes(aliasLine), `expected alias line to survive: ${aliasLine}`);
    }

    // Unrelated content untouched.
    assert.ok(out.includes('ktorClientCore = "3.5.0"'), out);
    assert.ok(out.includes('networkMonitor = "0.1.1"'), out);
    assert.ok(out.includes('datastore = "1.2.1"'), out);
});

test('removing networkMonitor removes exactly its version/library lines', async () => {
    const content = await readDoktorToml();
    const out = removeTomlEntries(content, NETWORK_MONITOR_KEYS);

    assert.ok(!/^networkMonitor\s*=\s*"0\.1\.1"/m.test(out), out);
    assert.ok(!/^networkMonitor-debug\s*=/m.test(out), out);
    assert.ok(!/^networkMonitor-release\s*=/m.test(out), out);

    for (const aliasLine of PLUGIN_ALIAS_LINES) {
        assert.ok(out.includes(aliasLine), `expected alias line to survive: ${aliasLine}`);
    }
    assert.ok(out.includes('ktorClientCore = "3.5.0"'), out);
});

test('removing datastore removes exactly its version/library lines', async () => {
    const content = await readDoktorToml();
    const out = removeTomlEntries(content, DATASTORE_KEYS);

    assert.ok(!/^datastore\s*=\s*"1\.2\.1"/m.test(out), out);
    assert.ok(!/^androidx-datastore\s*=/m.test(out), out);
    assert.ok(!/^androidx-datastore-preferences\s*=/m.test(out), out);

    for (const aliasLine of PLUGIN_ALIAS_LINES) {
        assert.ok(out.includes(aliasLine), `expected alias line to survive: ${aliasLine}`);
    }
    assert.ok(out.includes('ktorClientCore = "3.5.0"'), out);
});

// --- Equivalence: for a neutral package the new key lists must remove the same
// lines the old substring filters removed (no regression for the common case) ---

test('for a neutral package (dev.cmpose.app), removeTomlEntries matches the old substring filter output', async () => {
    const content = await readNeutralToml();

    const cases = [
        { keys: NETWORK_MONITOR_KEYS, keyword: 'networkmonitor' },
        { keys: KTOR_KEYS, keyword: 'ktor' },
        { keys: DATASTORE_KEYS, keyword: 'datastore' },
        { keys: DETEKT_KEYS, keyword: 'detekt' }
    ];

    for (const { keys, keyword } of cases) {
        const oldResult = oldSubstringFilter(content, keyword);
        const newResult = removeTomlEntries(content, keys);
        assert.equal(newResult, oldResult, `mismatch for keyword "${keyword}"`);
    }
});

// --- Regression guard through the real call sites -----------------------------
// The tests above only exercise removeTomlEntries directly with key lists copied
// into this file; they would keep passing even if a call site in fileService.js
// regressed to a substring filter, or a key list picked up a typo (e.g.
// 'ktor-client-darwn'), since removeTomlEntries itself would still behave
// correctly. These two tests run the real gradle/libs.versions.toml through the
// full processBlankApp -> processCoreFeatures pipeline, so they fail if any of
// the five call sites stop matching the real catalog.

// The exact 19 lines the real catalog's four disabled features (networkMonitor,
// ktor, datastore, detekt) must remove - transcribed independently from the
// fixture, not derived from the same key-list constants processCoreFeatures uses,
// so a typo in either place is caught.
const REMOVED_LINES_DOKTOR = [
    'datastore = "1.2.1"',
    'detekt = "2.0.0-alpha.3"',
    'ktorClientCore = "3.5.0"',
    'networkMonitor = "0.1.1"',
    'androidx-datastore = { module = "androidx.datastore:datastore", version.ref = "datastore" }',
    'androidx-datastore-preferences = { module = "androidx.datastore:datastore-preferences", version.ref = "datastore" }',
    'detekt-plugin = { module = "dev.detekt:detekt-gradle-plugin", version.ref = "detekt" }',
    'detekt-formatting = { module = "dev.detekt:detekt-rules-ktlint-wrapper", version.ref = "detekt" }',
    'ktor-client-android = { module = "io.ktor:ktor-client-android", version.ref = "ktorClientCore" }',
    'ktor-client-content-negotiation = { module = "io.ktor:ktor-client-content-negotiation", version.ref = "ktorClientCore" }',
    'ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktorClientCore" }',
    'ktor-client-darwin = { module = "io.ktor:ktor-client-darwin", version.ref = "ktorClientCore" }',
    'ktor-client-logging = { module = "io.ktor:ktor-client-logging", version.ref = "ktorClientCore" }',
    'ktor-client-mock = { module = "io.ktor:ktor-client-mock", version.ref = "ktorClientCore" }',
    'ktor-serialization-kotlinx-json = { module = "io.ktor:ktor-serialization-kotlinx-json", version.ref = "ktorClientCore" }',
    'coil-network-ktor3 = { module = "io.coil-kt.coil3:coil-network-ktor3", version.ref = "coil" }',
    'networkMonitor-debug = { module = "com.kturker:networkmonitor", version.ref = "networkMonitor" }',
    'networkMonitor-release = { module = "com.kturker:networkmonitor-noop", version.ref = "networkMonitor" }',
    'detekt = { id = "dev.detekt", version.ref = "detekt" }'
];

// A fully normalized "everything off" featuresConfig (six real booleans, per the
// normalization contract processBlankApp relies on).
const ALL_OPTIONAL_FEATURES_OFF = {
    network: false,
    networkInspector: false,
    theming: false,
    multiLang: false,
    dataStore: false,
    detekt: false
};

// processBlankApp writes shared/.../MainScreen.kt directly (no ensureDir) when
// features is empty, and reads/writes gradle/libs.versions.toml when it exists;
// this creates only what's needed for those two paths to succeed, matching the
// minimal-fixture pattern already used in test/fileService.blank.test.js.
async function setupMinimalBlankAppDir(dir, packageName, fixturePath) {
    const packagePath = packageName.replace(/\./g, '/');
    await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath));
    await fs.ensureDir(path.join(dir, 'gradle'));
    await fs.copyFile(fixturePath, path.join(dir, 'gradle', 'libs.versions.toml'));
}

test('processBlankApp on a real gradle/libs.versions.toml (doktor fixture) removes the catalog keys without touching any *-plugin alias', async (t) => {
    t.mock.method(console, 'log', () => { });
    // network:false also looks for build-logic/.../FeatureDataConventionPlugin.kt, which
    // does not exist in this minimal fixture; that logs a benign console.warn.
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);
        const originalContent = await readDoktorToml();

        await processBlankApp(dir, packageName, [], ALL_OPTIONAL_FEATURES_OFF);

        const out = await fs.readFile(path.join(dir, 'gradle', 'libs.versions.toml'), 'utf8');

        for (const aliasLine of PLUGIN_ALIAS_LINES) {
            assert.ok(out.includes(aliasLine), `expected alias line to survive: ${aliasLine}`);
        }

        const originalLines = originalContent.split('\n');
        const outLines = out.split('\n');
        assert.equal(originalLines.length - outLines.length, 19, 'exactly 19 catalog lines must be removed');

        const expected = originalLines.filter(line => !REMOVED_LINES_DOKTOR.includes(line)).join('\n');
        assert.equal(out, expected);
    });
});

// Kermit: every Ktor key goes with network (ktor-client-logging included, or the catalog no longer
// resolves its ktorClientCore reference), but no removal path touches the kermit keys
test('network off removes ktor-client-logging but keeps [versions] kermit, kermit and kermit-test', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);

        await processBlankApp(dir, packageName, [], ALL_OPTIONAL_FEATURES_OFF);

        const out = await fs.readFile(path.join(dir, 'gradle', 'libs.versions.toml'), 'utf8');
        assert.ok(!/^ktor-client-logging\s*=/m.test(out), out);
    assert.ok(!/^ktor-client-mock\s*=/m.test(out), out);
        assert.ok(!/^\s*(?:ktorClientCore|ktor-[A-Za-z0-9-]+)\s*=/m.test(out), out);
        assert.ok(/\[versions\][^[]*^kermit = "2\.2\.0"$/m.test(out), out);
        assert.ok(out.includes('kermit = { module = "co.touchlab:kermit", version.ref = "kermit" }'), out);
        assert.ok(out.includes('kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }'), out);
    });
});

// Coil: the network fetcher lives in core:network and goes with it; the loader (coil, coil-compose) stays
test('network off removes coil-network-ktor3 but keeps [versions] coil and coil-compose', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);

        await processBlankApp(dir, packageName, [], ALL_OPTIONAL_FEATURES_OFF);

        const out = await fs.readFile(path.join(dir, 'gradle', 'libs.versions.toml'), 'utf8');
        assert.ok(!/^coil-network-ktor3\s*=/m.test(out), out);
        assert.ok(/\[versions\][^[]*^coil = "3\.4\.0"$/m.test(out), out);
        assert.ok(out.includes('coil-compose = { module = "io.coil-kt.coil3:coil-compose", version.ref = "coil" }'), out);
    });
});

test('network on keeps coil, coil-compose and coil-network-ktor3', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);

        await processBlankApp(dir, packageName, [], { ...ALL_OPTIONAL_FEATURES_OFF, network: true });

        const out = await fs.readFile(path.join(dir, 'gradle', 'libs.versions.toml'), 'utf8');
        assert.ok(/\[versions\][^[]*^coil = "3\.4\.0"$/m.test(out), out);
        assert.ok(out.includes('coil-compose = { module = "io.coil-kt.coil3:coil-compose", version.ref = "coil" }'), out);
        assert.ok(out.includes('coil-network-ktor3 = { module = "io.coil-kt.coil3:coil-network-ktor3", version.ref = "coil" }'), out);
    });
});

test('processBlankApp on the neutral fixture (dev.cmpose.app) matches chaining the old substring filters through the real pipeline', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.cmpose.app';
        await setupMinimalBlankAppDir(dir, packageName, NEUTRAL_TOML_PATH);
        const originalContent = await readNeutralToml();

        await processBlankApp(dir, packageName, [], ALL_OPTIONAL_FEATURES_OFF);

        const out = await fs.readFile(path.join(dir, 'gradle', 'libs.versions.toml'), 'utf8');

        // Mirrors processCoreFeatures' real order: networkInspector -> network -> dataStore -> detekt.
        let expected = originalContent;
        expected = oldSubstringFilter(expected, 'networkmonitor');
        expected = oldSubstringFilter(expected, 'ktor');
        expected = oldSubstringFilter(expected, 'datastore');
        expected = oldSubstringFilter(expected, 'detekt');

        assert.equal(out, expected);
    });
});

// --- initKoin.kt: `import <pkg>.core.network.` exact match --------------------

test('processBlankApp removes only the exact core.network import from initKoin.kt, leaving package/@ComponentScan/other imports untouched', async (t) => {
    t.mock.method(console, 'log', () => { });
    // network:false also looks for build-logic/.../FeatureDataConventionPlugin.kt; that
    // file does not exist in this minimal fixture, which is expected and logs a benign
    // console.warn - silence it so the test's own signal stays the only output.
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        const packagePath = packageName.replace(/\./g, '/');
        const diDir = path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di');
        await fs.ensureDir(diDir);
        const initKoinPath = path.join(diDir, 'initKoin.kt');

        const initKoinContent = [
            'package dev.doktor.app.di',
            '',
            'import dev.doktor.app.core.network.di.NetworkModule',
            'import dev.doktor.app.legacycore.network.LegacyThing',
            'import org.koin.core.context.startKoin',
            '',
            '@ComponentScan("dev.doktor.app")',
            'fun initKoin() {',
            '    startKoin {',
            '        modules(appModule)',
            '    }',
            '}'
        ].join('\n');
        await fs.writeFile(initKoinPath, initKoinContent);

        await processBlankApp(dir, packageName, [], {
            network: false,
            networkInspector: true,
            theming: true,
            multiLang: true,
            dataStore: true,
            detekt: true
        });

        const out = await fs.readFile(initKoinPath, 'utf8');

        assert.ok(!out.includes('import dev.doktor.app.core.network.di.NetworkModule'), out);
        // Anchored/escaped: a different import that merely contains the substring
        // "core.network" (via "...legacycore.network...") must survive.
        assert.ok(out.includes('import dev.doktor.app.legacycore.network.LegacyThing'), out);
        assert.ok(out.includes('import org.koin.core.context.startKoin'), out);
        assert.ok(out.includes('package dev.doktor.app.di'), out);
        assert.ok(out.includes('@ComponentScan("dev.doktor.app")'), out);
    });
});

// --- core/network/build.gradle.kts fallback cleanup (2nd "networkmonitor" site) ---
// Not TOML, but was also a naive substring filter; now an exact-line match so a
// coincidental "networkmonitor" substring elsewhere in the file can't delete it.

test('core/network/build.gradle.kts networkMonitor fallback cleanup only removes the known reference lines', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        const packagePath = packageName.replace(/\./g, '/');
        // processBlankApp writes shared/.../MainScreen.kt directly (no ensureDir) when
        // features is empty; the fixture must pre-create that directory.
        await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath));
        const networkDir = path.join(dir, 'core', 'network');
        await fs.ensureDir(networkDir);
        const buildGradlePath = path.join(networkDir, 'build.gradle.kts');

        // Deliberately not the exact commented block the primary regex expects,
        // so the fallback line filter is the one doing the work here.
        const buildGradleContent = [
            'plugins {',
            '    alias(libs.plugins.kmp.library.plugin)',
            '}',
            '',
            'kotlin {',
            '    sourceSets {',
            '        commonMain {',
            '            dependencies {',
            '                implementation(libs.networkMonitor.debug)',
            '                implementation(libs.ktor.client.core)',
            '            }',
            '        }',
            '    }',
            '}'
        ].join('\n');
        await fs.writeFile(buildGradlePath, buildGradleContent);

        await processBlankApp(dir, packageName, [], {
            network: true,
            networkInspector: false,
            theming: true,
            multiLang: true,
            dataStore: true,
            detekt: true
        });

        const out = await fs.readFile(buildGradlePath, 'utf8');
        assert.ok(!out.includes('implementation(libs.networkMonitor.debug)'), out);
        // Unrelated ktor dependency line must survive.
        assert.ok(out.includes('implementation(libs.ktor.client.core)'), out);
    });
});

// Review: the Play In-App Review keys sit right after the ads keys. ads off removes
// adsMobileSdk and ump by name; no removal path touches playReview, play-review or play-review-ktx.
const ADS_VERSION_LINES = ['adsMobileSdk = "1.5.0"', 'ump = "4.0.0"'];
const ADS_LIBRARY_LINES = [
    'adsMobileSdk = { module = "com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk", version.ref = "adsMobileSdk" }',
    'ump = { module = "com.google.android.ump:user-messaging-platform", version.ref = "ump" }'
];
const PLAY_REVIEW_VERSION_LINE = 'playReview = "2.0.2"';
const PLAY_REVIEW_LIBRARY_LINES = [
    'play-review = { module = "com.google.android.play:review", version.ref = "playReview" }',
    'play-review-ktx = { module = "com.google.android.play:review-ktx", version.ref = "playReview" }'
];

test('ads off removes adsMobileSdk and ump but keeps playReview, play-review and play-review-ktx', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);
        const tomlPath = path.join(dir, 'gradle', 'libs.versions.toml');
        const original = await fs.readFile(tomlPath, 'utf8');
        const withReview = original
            .replace('kermit = "2.2.0"\n', ['kermit = "2.2.0"', ...ADS_VERSION_LINES, PLAY_REVIEW_VERSION_LINE, ''].join('\n'))
            .replace('kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }\n',
                ['kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }', ...ADS_LIBRARY_LINES, ...PLAY_REVIEW_LIBRARY_LINES, ''].join('\n'));
        assert.ok(withReview.includes(PLAY_REVIEW_VERSION_LINE) && withReview.includes(ADS_LIBRARY_LINES[1]), 'seed has the ads and review keys');
        await fs.writeFile(tomlPath, withReview);

        await processBlankApp(dir, packageName, [], { ...ALL_OPTIONAL_FEATURES_OFF, purchases: false, ads: false, room: false });

        const out = await fs.readFile(tomlPath, 'utf8');
        assert.doesNotMatch(out, /^(adsMobileSdk|ump)\s*=/m, out);
        assert.ok(/\[versions\][^[]*^playReview = "2\.0\.2"$/m.test(out), out);
        for (const line of PLAY_REVIEW_LIBRARY_LINES) assert.ok(out.split('\n').includes(line), `catalog keeps ${line}:\n${out}`);
    });
});

// Store-ready: core/about's AboutLibraries keys have no flag. The ads, purchases, network and detekt
// removals delete their own keys by name; none of them touches aboutLibraries (versions and plugins)
// or aboutlibraries-core / aboutlibraries-compose-m3.
const ABOUT_VERSION_LINE = 'aboutLibraries = "14.2.1"';
const ABOUT_LIBRARY_LINES = [
    'aboutlibraries-core = { module = "com.mikepenz:aboutlibraries-core", version.ref = "aboutLibraries" }',
    'aboutlibraries-compose-m3 = { module = "com.mikepenz:aboutlibraries-compose-m3", version.ref = "aboutLibraries" }'
];
const ABOUT_PLUGIN_LINE = 'aboutLibraries = { id = "com.mikepenz.aboutlibraries.plugin", version.ref = "aboutLibraries" }';
const REVENUECAT_VERSION_LINE = 'revenuecat = "2.2.0+17.10.0"';
const REVENUECAT_LIBRARY_LINES = [
    'revenuecat-core = { module = "com.revenuecat.purchases:purchases-kmp-core", version.ref = "revenuecat" }',
    'revenuecat-ui = { module = "com.revenuecat.purchases:purchases-kmp-ui", version.ref = "revenuecat" }'
];

test('ads, purchases, network and detekt off keep aboutLibraries (versions, plugins) and the aboutlibraries-* libraries', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);
        const tomlPath = path.join(dir, 'gradle', 'libs.versions.toml');
        const original = await fs.readFile(tomlPath, 'utf8');
        const withAbout = original
            .replace('kermit = "2.2.0"\n',
                ['kermit = "2.2.0"', ...ADS_VERSION_LINES, REVENUECAT_VERSION_LINE, ABOUT_VERSION_LINE, ''].join('\n'))
            .replace('kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }\n',
                ['kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }', ...ADS_LIBRARY_LINES,
                    ...REVENUECAT_LIBRARY_LINES, ...ABOUT_LIBRARY_LINES, ''].join('\n'))
            .replace('detekt = { id = "dev.detekt", version.ref = "detekt" }\n',
                ['detekt = { id = "dev.detekt", version.ref = "detekt" }', ABOUT_PLUGIN_LINE, ''].join('\n'));
        for (const line of [ABOUT_VERSION_LINE, ABOUT_PLUGIN_LINE, ...ABOUT_LIBRARY_LINES, REVENUECAT_VERSION_LINE, ADS_LIBRARY_LINES[1]]) {
            assert.ok(withAbout.includes(line), `seed has ${line}`);
        }
        await fs.writeFile(tomlPath, withAbout);

        await processBlankApp(dir, packageName, [], { ...ALL_OPTIONAL_FEATURES_OFF, purchases: false, ads: false, room: false });

        const out = await fs.readFile(tomlPath, 'utf8');
        assert.doesNotMatch(out, /^(adsMobileSdk|ump|revenuecat|revenuecat-core|revenuecat-ui|ktorClientCore|detekt)\s*=/m, out);
        assert.ok(/\[versions\][^[]*^aboutLibraries = "14\.2\.1"$/m.test(out), out);
        assert.ok(/\[plugins\][^[]*^aboutLibraries = \{ id = "com\.mikepenz\.aboutlibraries\.plugin"/m.test(out), out);
        for (const line of ABOUT_LIBRARY_LINES) assert.ok(out.split('\n').includes(line), `catalog keeps ${line}:\n${out}`);
    });
});

// network-ux: core/update's Play In-App Updates keys have no flag. They sit right after the review keys;
// the ads, purchases, network and detekt removals delete their own keys by name and none of them
// touches playAppUpdate, play-app-update or play-app-update-ktx.
const PLAY_APP_UPDATE_VERSION_LINE = 'playAppUpdate = "2.1.0"';
const PLAY_APP_UPDATE_LIBRARY_LINES = [
    'play-app-update = { module = "com.google.android.play:app-update", version.ref = "playAppUpdate" }',
    'play-app-update-ktx = { module = "com.google.android.play:app-update-ktx", version.ref = "playAppUpdate" }'
];

test('every removal keeps playAppUpdate, play-app-update and play-app-update-ktx', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await setupMinimalBlankAppDir(dir, packageName, DOKTOR_TOML_PATH);
        const tomlPath = path.join(dir, 'gradle', 'libs.versions.toml');
        const original = await fs.readFile(tomlPath, 'utf8');
        const withUpdate = original
            .replace('kermit = "2.2.0"\n',
                ['kermit = "2.2.0"', ...ADS_VERSION_LINES, REVENUECAT_VERSION_LINE, PLAY_REVIEW_VERSION_LINE, PLAY_APP_UPDATE_VERSION_LINE, ''].join('\n'))
            .replace('kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }\n',
                ['kermit-test = { module = "co.touchlab:kermit-test", version.ref = "kermit" }', ...ADS_LIBRARY_LINES,
                    ...REVENUECAT_LIBRARY_LINES, ...PLAY_REVIEW_LIBRARY_LINES, ...PLAY_APP_UPDATE_LIBRARY_LINES, ''].join('\n'));
        for (const line of [PLAY_APP_UPDATE_VERSION_LINE, ...PLAY_APP_UPDATE_LIBRARY_LINES, REVENUECAT_VERSION_LINE, ADS_LIBRARY_LINES[1]]) {
            assert.ok(withUpdate.includes(line), `seed has ${line}`);
        }
        await fs.writeFile(tomlPath, withUpdate);

        await processBlankApp(dir, packageName, [], { ...ALL_OPTIONAL_FEATURES_OFF, purchases: false, ads: false, room: false });

        const out = await fs.readFile(tomlPath, 'utf8');
        assert.doesNotMatch(out, /^(adsMobileSdk|ump|revenuecat|revenuecat-core|revenuecat-ui|ktorClientCore|detekt)\s*=/m, out);
        assert.ok(/\[versions\][^[]*^playAppUpdate = "2\.1\.0"$/m.test(out), out);
        for (const line of PLAY_APP_UPDATE_LIBRARY_LINES) assert.ok(out.split('\n').includes(line), `catalog keeps ${line}:\n${out}`);
    });
});
