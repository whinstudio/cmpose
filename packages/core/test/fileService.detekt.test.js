const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processBlankApp, removeCiDetektStep } = require('../src/fileService');

const NEW_PACKAGE = 'dev.cmpose.app';

// The template's real detekt/detekt.yml is 667 lines (Compose FunctionNaming exception +
// ktlint-wrapper settings); this fixture only needs to be non-empty and distinguishable
// from both "" and a custom upload, so a short marker stands in for it.
const TEMPLATE_DETEKT_YML = '# template\nstyle:\n  active: true\n';

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-detekt-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// processBlankApp writes shared/.../MainScreen.kt directly (no ensureDir) when
// features is empty; this creates only what that path plus the detekt block need,
// matching the minimal-fixture pattern used in fileService.blank.test.js /
// fileService.toml.test.js.
async function setupDetektFixture(dir, packageName) {
    const packagePath = packageName.replace(/\./g, '/');
    await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath));

    const detektDir = path.join(dir, 'detekt');
    await fs.ensureDir(detektDir);
    const detektYamlPath = path.join(detektDir, 'detekt.yml');
    await fs.writeFile(detektYamlPath, TEMPLATE_DETEKT_YML);

    return { detektYamlPath };
}

// A fully-enabled featuresConfig (detekt:true) whose other five booleans are all
// `true`, so every other processCoreFeatures block is a no-op (they only act when
// their flag is `!== true`) and the detekt block is the only one under test.
function detektConfig(overrides) {
    return {
        network: true,
        networkInspector: true,
        theming: true,
        multiLang: true,
        dataStore: true,
        detekt: true,
        ...overrides
    };
}

test('processBlankApp leaves the template detekt.yml untouched when detektYamlContent is null', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        const { detektYamlPath } = await setupDetektFixture(dir, NEW_PACKAGE);

        await processBlankApp(dir, NEW_PACKAGE, [], detektConfig({ detektYamlContent: null }));

        const out = await fs.readFile(detektYamlPath, 'utf8');
        assert.equal(out, TEMPLATE_DETEKT_YML, 'template detekt.yml must survive when no custom YAML is uploaded');
    });
});

test('processBlankApp leaves the template detekt.yml untouched when detektYamlContent is whitespace-only', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        const { detektYamlPath } = await setupDetektFixture(dir, NEW_PACKAGE);

        await processBlankApp(dir, NEW_PACKAGE, [], detektConfig({ detektYamlContent: '  ' }));

        const out = await fs.readFile(detektYamlPath, 'utf8');
        assert.equal(out, TEMPLATE_DETEKT_YML, 'template detekt.yml must survive a whitespace-only upload');
    });
});

test('processBlankApp leaves the template detekt.yml untouched when detektYamlContent is omitted entirely', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        const { detektYamlPath } = await setupDetektFixture(dir, NEW_PACKAGE);

        const config = detektConfig();
        delete config.detektYamlContent;
        await processBlankApp(dir, NEW_PACKAGE, [], config);

        const out = await fs.readFile(detektYamlPath, 'utf8');
        assert.equal(out, TEMPLATE_DETEKT_YML, 'template detekt.yml must survive when detektYamlContent is not provided at all');
    });
});

test('processBlankApp writes a real custom detektYamlContent over the template', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        const { detektYamlPath } = await setupDetektFixture(dir, NEW_PACKAGE);

        await processBlankApp(dir, NEW_PACKAGE, [], detektConfig({ detektYamlContent: 'a: 1' }));

        const out = await fs.readFile(detektYamlPath, 'utf8');
        assert.equal(out, 'a: 1', 'custom detekt.yml content must replace the template');
    });
});

const CI_YML = [
    '      - uses: gradle/actions/setup-gradle@v5',
    '      - name: detekt',
    '        run: ./gradlew detekt',
    '      - name: Unit tests (JVM)',
    '        run: ./gradlew testAndroidHostTest'
].join('\n');

test('removeCiDetektStep drops only the detekt step', () => {
    assert.equal(removeCiDetektStep(CI_YML), [
        '      - uses: gradle/actions/setup-gradle@v5',
        '      - name: Unit tests (JVM)',
        '        run: ./gradlew testAndroidHostTest'
    ].join('\n'));
});

test('removeCiDetektStep leaves a workflow without the step unchanged', () => {
    const other = '      - name: Unit tests (JVM)\n        run: ./gradlew testAndroidHostTest\n';
    assert.equal(removeCiDetektStep(other), other);
});

test('processBlankApp with detekt off removes the detekt step from ci.yml; with detekt on keeps it', async (t) => {
    t.mock.method(console, 'log', () => { });

    for (const detekt of [false, true]) {
        await withTempDir(async (dir) => {
            await setupDetektFixture(dir, NEW_PACKAGE);
            const ci = path.join(dir, '.github', 'workflows', 'ci.yml');
            await fs.outputFile(ci, CI_YML + '\n');

            await processBlankApp(dir, NEW_PACKAGE, [], detektConfig({ detekt }));

            const out = await fs.readFile(ci, 'utf8');
            assert.equal(out.includes('gradlew detekt'), detekt, out);
        });
    }
});

test('removeCiDetektStep also removes the step from a CRLF ci.yml', () => {
    const lf = '      - name: build\n        run: ./gradlew build\n      - name: detekt\n        run: ./gradlew detekt\n      - name: tests\n';
    assert.equal(removeCiDetektStep(lf), '      - name: build\n        run: ./gradlew build\n      - name: tests\n');
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.equal(removeCiDetektStep(crlf), '      - name: build\r\n        run: ./gradlew build\r\n      - name: tests\r\n');
});

test('processBlankApp with detekt off drops the plugin id from core/api; with detekt on keeps it', async (t) => {
    t.mock.method(console, 'log', () => { });

    for (const detekt of [false, true]) {
        await withTempDir(async (dir) => {
            await setupDetektFixture(dir, NEW_PACKAGE);
            const plugins = `plugins {\n    id("${NEW_PACKAGE}.detekt")\n    alias(libs.plugins.kotlinMultiplatform)\n}\n`;
            const build = path.join(dir, 'core/api/build.gradle.kts');
            await fs.outputFile(build, plugins);

            await processBlankApp(dir, NEW_PACKAGE, [], detektConfig({ detekt, backend: true, network: true, multiLang: true, dataStore: true }));

            const out = await fs.readFile(build, 'utf8');
            assert.equal(out.includes(`id("${NEW_PACKAGE}.detekt")`), detekt, out);
            assert.ok(out.includes('alias(libs.plugins.kotlinMultiplatform)'));
        });
    }
});

test('processBlankApp with detekt off leaves server/build.gradle.kts alone (the backend template keeps its own detekt)', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        await setupDetektFixture(dir, NEW_PACKAGE);
        const server = path.join(dir, 'server', 'build.gradle.kts');
        const content = 'plugins {\n    alias(libs.plugins.detekt)\n    application\n}\n\n'
            + 'detekt {\n    source.setFrom(files("src/main/kotlin", "src/local/kotlin"))\n}\n';
        await fs.outputFile(server, content);

        await processBlankApp(dir, NEW_PACKAGE, [], detektConfig({ detekt: false, backend: true, network: true, multiLang: true, dataStore: true }));

        assert.equal(await fs.readFile(server, 'utf8'), content);
    });
});
