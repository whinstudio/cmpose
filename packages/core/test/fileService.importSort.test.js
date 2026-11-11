const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const {
    sortImportsLikeKtlint,
    sortKotlinImports,
    processAllFiles,
    movePackageStructure,
    processBlankApp,
    wireFeatureModules,
    updateiOSProject,
    updateiOSConfigFiles
} = require('../src/fileService');
const { applyBlankShell, cloneFeatureModules } = require('../src/featureModules');
const { applyBackendOption } = require('../src/backendOption');
const { applyFeatureMarkers } = require('../src/featureMarkers');
const CONFIG = { oldPackageName: require('../src/templateIdentity').OLD_PACKAGE_NAME, oldProjectName: require('../src/templateIdentity').OLD_PROJECT_NAME };

// Real template: a checkout named by CMP_REAL_TEMPLATE_DIR; skipped when it is unset or absent
const REAL = process.env.CMP_REAL_TEMPLATE_DIR;
const HAS_TEMPLATE = Boolean(REAL) && fs.existsSync(path.join(REAL, 'settings.gradle.kts'))
    && fs.existsSync(path.join(REAL, 'blank', 'layers')) && fs.existsSync(path.join(REAL, 'feature', 'sample'));
const NO_TEMPLATE = { skip: REAL ? `no current real template at ${REAL} (CMP_REAL_TEMPLATE_DIR)` : 'CMP_REAL_TEMPLATE_DIR is not set' };

const IMPORT_LINE = /^import /;

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-import-sort-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

async function kotlinFiles(root) {
    const found = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (['build-logic', '.git', 'build', 'node_modules'].includes(entry.name)) continue;
            found.push(...await kotlinFiles(full));
        } else if (entry.name.endsWith('.kt')) {
            found.push(full);
        }
    }
    return found;
}

// The import blocks of a file (runs of consecutive import lines)
function importBlocks(content) {
    const blocks = [];
    let current = [];
    for (const line of content.split('\n')) {
        if (IMPORT_LINE.test(line)) {
            current.push(line);
        } else if (current.length) {
            blocks.push(current);
            current = [];
        }
    }
    if (current.length) blocks.push(current);
    return blocks;
}

test('sortImportsLikeKtlint puts java, javax and kotlin after the rest, aliases last', () => {
    const sorted = sortImportsLikeKtlint([
        'import kotlin.coroutines.CoroutineContext',
        'import java.util.Locale',
        'import org.example.app.Thing as Alias',
        'import kotlinx.coroutines.flow.Flow',
        'import javax.inject.Inject',
        'import androidx.compose.runtime.Composable',
        'import org.example.app.core.CoreViewModel'
    ]);
    assert.deepEqual(sorted, [
        'import androidx.compose.runtime.Composable',
        'import kotlinx.coroutines.flow.Flow',
        'import org.example.app.core.CoreViewModel',
        'import java.util.Locale',
        'import javax.inject.Inject',
        'import kotlin.coroutines.CoroutineContext',
        'import org.example.app.Thing as Alias'
    ]);
});

test('sortImportsLikeKtlint still puts an aliased import last when the lines end in CRLF', () => {
    const sorted = sortImportsLikeKtlint([
        'import org.example.app.Thing as Alias\r',
        'import kotlin.coroutines.CoroutineContext\r',
        'import androidx.compose.runtime.Composable\r'
    ]);
    assert.deepEqual(sorted, [
        'import androidx.compose.runtime.Composable\r',
        'import kotlin.coroutines.CoroutineContext\r',
        'import org.example.app.Thing as Alias\r'
    ]);
});

test('sortKotlinImports sorts a CRLF file without changing its line endings', async () => {
    await withTempDir(async (dir) => {
        const crlf = (text) => text.replace(/\n/g, '\r\n');
        const unsorted = crlf('package a.b\n\nimport org.x.Y as Alias\nimport java.util.Locale\nimport kotlinx.coroutines.flow.Flow\n\nclass C\n');
        const sortedText = crlf('package a.b\n\nimport kotlinx.coroutines.flow.Flow\nimport java.util.Locale\nimport org.x.Y as Alias\n\nclass C\n');
        await fs.outputFile(path.join(dir, 'shared', 'C.kt'), unsorted);

        assert.equal(await sortKotlinImports(dir), 1);

        assert.equal(await fs.readFile(path.join(dir, 'shared', 'C.kt'), 'utf8'), sortedText);
        assert.equal(await sortKotlinImports(dir), 0, 'second run changes nothing');
    });
});

test('sortKotlinImports sorts the import block, rewrites only changed files, skips build-logic', async () => {
    await withTempDir(async (dir) => {
        const unsorted = 'package a.b\n\nimport org.x.Y\nimport kotlinx.coroutines.flow.Flow\nimport java.util.Locale\n\nclass C\n';
        const sortedText = 'package a.b\n\nimport kotlinx.coroutines.flow.Flow\nimport org.x.Y\nimport java.util.Locale\n\nclass C\n';
        const noImports = 'package a.b\n\nclass D\n';
        await fs.outputFile(path.join(dir, 'shared', 'C.kt'), unsorted);
        await fs.outputFile(path.join(dir, 'shared', 'D.kt'), noImports);
        await fs.outputFile(path.join(dir, 'build-logic', 'convention', 'E.kt'), unsorted);

        const changed = await sortKotlinImports(dir);

        assert.equal(await fs.readFile(path.join(dir, 'shared', 'C.kt'), 'utf8'), sortedText);
        assert.equal(await fs.readFile(path.join(dir, 'shared', 'D.kt'), 'utf8'), noImports);
        assert.equal(await fs.readFile(path.join(dir, 'build-logic', 'convention', 'E.kt'), 'utf8'), unsorted);
        assert.equal(changed, 1);
        assert.equal(await sortKotlinImports(dir), 0, 'second run changes nothing');
    });
});

test('sortKotlinImports leaves the real template (package com.kturker.multiplatform) unchanged', HAS_TEMPLATE ? {} : NO_TEMPLATE, async () => {
    await withTempDir(async (dir) => {
        await fs.copy(REAL, dir, { filter: (src) => path.basename(src) !== '.git' });
        const files = await kotlinFiles(dir);
        const before = new Map(await Promise.all(files.map(async (f) => [f, await fs.readFile(f, 'utf8')])));
        assert.ok(files.length > 50, `expected many template .kt files, got ${files.length}`);

        assert.equal(await sortKotlinImports(dir), 0);

        const drifted = [];
        for (const f of files) {
            if ((await fs.readFile(f, 'utf8')) !== before.get(f)) drifted.push(path.relative(dir, f));
        }
        assert.deepEqual(drifted, []);
    });
});

// What the template's sync (updateTemplate) keeps out of the template: an upstream archive still has them
const MAINTAINER_ONLY = ['gradle/wizard.gradle.kts', 'MAINTAINING.md', 'scripts/ios-add-packages.rb', 'scripts-maintainer'];
const templateFiles = (src) => {
    const rel = path.relative(REAL, src).split(path.sep).join('/');
    return path.basename(src) !== '.git' && !MAINTAINER_ONLY.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
};

// The generator's order (src/generate.js): shell, backend, modules, feature markers, rename, move, blank, wire,
// iOS, then the import pass
async function generateLikeController(dir, { packageName, templateType, features, featuresConfig }) {
    await applyBlankShell(dir, templateType, featuresConfig);
    await applyBackendOption(dir, templateType === 'blank' && featuresConfig.backend === true);
    await cloneFeatureModules(dir, features);
    await applyFeatureMarkers(dir, templateType === 'blank'
        ? { purchases: featuresConfig.purchases === true, ads: featuresConfig.ads === true, insights: featuresConfig.insights === true }
        : { purchases: true, ads: true, insights: true });
    await processAllFiles(dir, CONFIG.oldPackageName, packageName, CONFIG.oldProjectName, 'Sorted', 'Sorted App',
        { minSdk: '24', iosVersion: '15.0' });
    await movePackageStructure(dir, CONFIG.oldPackageName, packageName);
    if (templateType === 'blank') await processBlankApp(dir, packageName, features, featuresConfig);
    if (features.length) await wireFeatureModules(dir, packageName, features);
    await updateiOSProject(dir, packageName, '15.0');
    await updateiOSConfigFiles(dir, packageName, 'Sorted App', '15.0');
}

const FULL_CONFIG = { network: true, networkInspector: true, theming: true, multiLang: true, dataStore: true, detekt: true };

for (const packageName of ['org.example.app', 'tr.com.example.app']) {
    for (const [templateType, features, featuresConfig] of [
        ['showcase', [], {}],
        ['blank', ['profile', 'cart'], FULL_CONFIG]
    ]) {
        test(`generated ${templateType} project with package ${packageName} has ktlint-ordered imports`, HAS_TEMPLATE ? {} : NO_TEMPLATE, async (t) => {
            t.mock.method(console, 'log', () => { });
            t.mock.method(console, 'warn', () => { });
            await withTempDir(async (dir) => {
                await fs.copy(REAL, dir, { filter: templateFiles });
                await generateLikeController(dir, { packageName, templateType, features, featuresConfig });

                await sortKotlinImports(dir);

                const files = await kotlinFiles(dir);
                for (const f of files) {
                    for (const block of importBlocks(await fs.readFile(f, 'utf8'))) {
                        assert.deepEqual(block, sortImportsLikeKtlint(block), `${path.relative(dir, f)} imports are not in ktlint order`);
                    }
                }

                const coreViewModel = files.find((f) => path.basename(f) === 'CoreViewModel.kt');
                assert.ok(coreViewModel, 'CoreViewModel.kt exists');
                const lines = (await fs.readFile(coreViewModel, 'utf8')).split('\n').filter((l) => IMPORT_LINE.test(l));
                const own = lines.findIndex((l) => l.startsWith(`import ${packageName}.`));
                const lastKotlinx = lines.map((l) => l.startsWith('import kotlinx.')).lastIndexOf(true);
                assert.ok(own !== -1 && lastKotlinx !== -1, lines.join('\n'));
                assert.ok(own > lastKotlinx, `own import must follow kotlinx.*:\n${lines.join('\n')}`);
            });
        });
    }
}
