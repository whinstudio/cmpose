const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const {
    applyBlankShell, cloneFeatureModules, wrapLongSingleParamSignatures,
    assertTemplateCapabilities, missingTemplateCapabilities, TemplateCapabilityError
} = require('../src/featureModules');

const PKG = 'com/kturker/multiplatform';
// Ads without purchases: nothing makes the user ad-free (the ads-without-purchases layer)
const NO_PREMIUM_REL = `feature/monetization/presentation/src/commonMain/kotlin/${PKG}/feature/monetization/presentation/ads/NoPremiumAdFreeSource.kt`;
const SRC = (layer) => `feature/sample/${layer}/src/commonMain/kotlin/${PKG}/feature/sample/${layer}`;

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-feature-modules-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// A slice of the template: the sample module (with a test), the blank overlay, the showcase shell.
async function seedTemplate(dir) {
    const files = {
        'settings.gradle.kts': [
            'rootProject.name = "Multiplatform"',
            'include(":shared")',
            'include(":feature:home")',
            'include(":feature:sample")',
            'include(":feature:sample:contract")',
            'include(":feature:sample:data")',
            'include(":feature:sample:domain")',
            'include(":feature:sample:presentation")',
            'includeBuild("build-logic")',
            ''
        ].join('\n'),
        [`shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`]: 'package com.kturker.multiplatform\n// showcase\n',
        [`blank/shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`]: 'package com.kturker.multiplatform\n// blank\n',
        [`blank/shared/src/commonMain/kotlin/${PKG}/GuideScreen.kt`]: 'package com.kturker.multiplatform\n// guide\n',
        // The shell's conditional layers
        [`blank/layers/theming-off/shared/src/commonMain/kotlin/${PKG}/AppTheme.kt`]: 'package com.kturker.multiplatform\n// plain theme\n',
        [`blank/layers/multilang/shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`]: 'package com.kturker.multiplatform\n// blank + language\n',
        [`blank/layers/multilang/core/multilang/src/commonMain/kotlin/${PKG}/core/multilang/resource/StringResourcesUiModel.kt`]:
            'package com.kturker.multiplatform.core.multilang.resource\n// generic keys\n',
        [`blank/layers/ads-without-purchases/${NO_PREMIUM_REL}`]:
            'package com.kturker.multiplatform.feature.monetization.presentation.ads\n// no premium\n',
        // The showcase's own files the layers replace
        [`shared/src/commonMain/kotlin/${PKG}/AppTheme.kt`]: 'package com.kturker.multiplatform\n// themed\n',
        [`core/multilang/src/commonMain/kotlin/${PKG}/core/multilang/resource/StringResourcesUiModel.kt`]:
            'package com.kturker.multiplatform.core.multilang.resource\n// showcase keys\n',
        [`feature/home/presentation/src/commonMain/kotlin/${PKG}/feature/home/presentation/ui/HomeScreen.kt`]:
            'package com.kturker.multiplatform.feature.home.presentation.ui\n// showcase home\n',
        'feature/sample/presentation/build.gradle.kts':
            'plugins {\n    alias(libs.plugins.feature.presentation.plugin)\n}\n\nkotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(dependencyNotation = projects.feature.sample.contract)\n            implementation(dependencyNotation = projects.feature.sample.domain)\n        }\n    }\n}\n',
        [`${SRC('contract')}/Screens.kt`]:
            'package com.kturker.multiplatform.feature.sample.contract\n\n@Serializable\ndata object SampleDestination : NavigationCommand.Destination\n',
        [`${SRC('presentation')}/ui/SampleViewModel.kt`]:
            'package com.kturker.multiplatform.feature.sample.presentation.ui\n\ninternal class SampleViewModel : CoreViewModel(), SampleActions\n',
        [`${SRC('presentation')}/ui/SampleScreen.kt`]:
            'package com.kturker.multiplatform.feature.sample.presentation.ui\n\n@Composable\ninternal fun SampleScreenRoute(viewModel: SampleViewModel = koinViewModel()) {\n    SampleScreen()\n}\n',
        [`${SRC('presentation')}/navigation/SampleEntry.kt`]:
            'package com.kturker.multiplatform.feature.sample.presentation.navigation\n\nimport com.kturker.multiplatform.feature.sample.contract.SampleDestination\n\n@Named("SampleEntry")\ninternal class SampleEntry : FeatureEntry {\n    override val title: String = "Sample"\n}\n',
        [`${SRC('presentation')}/navigation/SampleDeepLink.kt`]:
            'package com.kturker.multiplatform.feature.sample.presentation.navigation\n\nimport com.kturker.multiplatform.feature.sample.contract.SampleDestination\n\n@Single(binds = [DeepLinkRoute::class])\n@Named("SampleDeepLink")\ninternal class SampleDeepLink : DeepLinkRoute {\n    override val pattern: String = "sample"\n}\n',
        [`${SRC('presentation')}/di/SamplePresentationModule.kt`]:
            'package com.kturker.multiplatform.feature.sample.presentation.di\n\n@ComponentScan("com.kturker.multiplatform.feature.sample.presentation")\nclass SamplePresentationModule\n',
        [`feature/sample/presentation/src/commonTest/kotlin/${PKG}/feature/sample/presentation/ui/SampleViewModelTest.kt`]:
            'package com.kturker.multiplatform.feature.sample.presentation.ui\n\nclass SampleViewModelTest\n'
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function read(dir, rel) {
    return fs.readFile(path.join(dir, rel), 'utf8');
}

test('blank: the overlay replaces the showcase shell, adds the guide screen and drops blank/ and the showcase features', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await applyBlankShell(dir, 'blank');
        assert.equal(await read(dir, `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`), 'package com.kturker.multiplatform\n// blank\n');
        assert.ok(await fs.pathExists(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/GuideScreen.kt`)));
        assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature/home'))));
    });
});

test('showcase: the shell and showcase features stay, blank/ is dropped', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await applyBlankShell(dir, 'showcase');
        assert.equal(await read(dir, `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`), 'package com.kturker.multiplatform\n// showcase\n');
        assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
        assert.ok(await fs.pathExists(path.join(dir, 'feature/home')));
    });
});

test('blank against a template without the overlay fails loudly', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await fs.remove(path.join(dir, 'blank'));
        await assert.rejects(applyBlankShell(dir, 'blank'), /no blank\/layers\//);
    });
});

test('every requested module is cloned from feature/sample, renamed, without test sources', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await cloneFeatureModules(dir, ['profile', 'cart']);

        const profile = `feature/profile/presentation/src/commonMain/kotlin/${PKG}/feature/profile/presentation`;
        assert.equal(await read(dir, `${profile}/ui/ProfileViewModel.kt`),
            'package com.kturker.multiplatform.feature.profile.presentation.ui\n\ninternal class ProfileViewModel : CoreViewModel(), ProfileActions\n');
        const entry = await read(dir, `${profile}/navigation/ProfileEntry.kt`);
        assert.match(entry, /import com\.kturker\.multiplatform\.feature\.profile\.contract\.ProfileDestination/);
        assert.match(entry, /@Named\("ProfileEntry"\)/);
        assert.match(entry, /title: String = "Profile"/);
        assert.match(await read(dir, `${profile}/di/ProfilePresentationModule.kt`), /@ComponentScan\("com\.kturker\.multiplatform\.feature\.profile\.presentation"\)/);
        assert.match(await read(dir, 'feature/profile/presentation/build.gradle.kts'), /projects\.feature\.profile\.contract/);
        assert.ok(await fs.pathExists(path.join(dir, `feature/cart/contract/src/commonMain/kotlin/${PKG}/feature/cart/contract/Screens.kt`)));
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature/profile/presentation/src/commonTest'))));
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature/sample'))));

        const settings = await read(dir, 'settings.gradle.kts');
        assert.ok(!/feature:sample/.test(settings), settings);
        assert.match(settings, /include\(":feature:home"\)/);
        assert.match(settings, /includeBuild\("build-logic"\)/);
    });
});

test('the deep link route of a clone takes the module name as its path', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await cloneFeatureModules(dir, ['orders']);
        const route = await read(dir, `feature/orders/presentation/src/commonMain/kotlin/${PKG}/feature/orders/presentation/navigation/OrdersDeepLink.kt`);
        assert.match(route, /override val pattern: String = "orders"/);
        assert.match(route, /@Named\("OrdersDeepLink"\)/);
        assert.match(route, /internal class OrdersDeepLink : DeepLinkRoute/);
        assert.match(route, /package com\.kturker\.multiplatform\.feature\.orders\.presentation\.navigation/);
        assert.match(route, /import com\.kturker\.multiplatform\.feature\.orders\.contract\.OrdersDestination/);
        assert.ok(!/sample/i.test(route), route);
    });
});

test('a module named "sample" or "samples" is cloned correctly', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await cloneFeatureModules(dir, ['sample', 'samples']);
        const sample = `feature/sample/presentation/src/commonMain/kotlin/${PKG}/feature/sample/presentation/ui/SampleViewModel.kt`;
        const samples = `feature/samples/presentation/src/commonMain/kotlin/${PKG}/feature/samples/presentation/ui/SamplesViewModel.kt`;
        assert.match(await read(dir, sample), /class SampleViewModel/);
        assert.match(await read(dir, samples), /package com\.kturker\.multiplatform\.feature\.samples\.presentation\.ui/);
        assert.match(await read(dir, samples), /class SamplesViewModel : CoreViewModel\(\), SamplesActions/);
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature/sample/presentation/src/commonTest'))));
    });
});

test('no modules: feature/sample and its includes are removed; a missing sample is fine', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await cloneFeatureModules(dir, []);
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature/sample'))));
        assert.ok(!/feature:sample/.test(await read(dir, 'settings.gradle.kts')));
        await cloneFeatureModules(dir, []);   // second run: nothing left to remove, no error
    });
});

test('modules requested from a template without feature/sample fail loudly', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await fs.remove(path.join(dir, 'feature/sample'));
        await assert.rejects(cloneFeatureModules(dir, ['profile']), /no feature\/sample module/);
    });
});

const APP_THEME = `shared/src/commonMain/kotlin/${PKG}/AppTheme.kt`;
const MAIN_SCREEN = `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`;
const STRINGS = `core/multilang/src/commonMain/kotlin/${PKG}/core/multilang/resource/StringResourcesUiModel.kt`;

// The four Theming × Multi-Language shells, file by file
for (const [theming, multiLang, appTheme, mainScreen, strings] of [
    [false, false, '// plain theme', '// blank', '// showcase keys'],
    [true, false, '// themed', '// blank', '// showcase keys'],
    [false, true, '// plain theme', '// blank + language', '// generic keys'],
    [true, true, '// themed', '// blank + language', '// generic keys']
]) {
    test(`blank, theming ${theming} + multiLang ${multiLang}: the shell and its layers`, async () => {
        await withTempDir(async (dir) => {
            await seedTemplate(dir);
            await applyBlankShell(dir, 'blank', { theming, multiLang });
            // Plain string checks: '// blank + language' holds a regex metacharacter
            assert.ok((await read(dir, APP_THEME)).includes(appTheme));
            assert.ok((await read(dir, MAIN_SCREEN)).endsWith(`${mainScreen}\n`));
            assert.ok((await read(dir, STRINGS)).includes(strings));
            assert.ok(await fs.pathExists(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/GuideScreen.kt`)));
            assert.ok(!(await fs.pathExists(path.join(dir, 'layers'))), 'layers/ must not land in the project root');
            assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
        });
    });
}

test('showcase: no layer is applied, whatever featuresConfig says', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await applyBlankShell(dir, 'showcase', { theming: false, multiLang: true });
        assert.match(await read(dir, APP_THEME), /\/\/ themed/);
        assert.match(await read(dir, MAIN_SCREEN), /\/\/ showcase/);
        assert.match(await read(dir, STRINGS), /\/\/ showcase keys/);
        assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
    });
});

test('blank against a template with blank/ but no blank/layers/ (a template older than the B release) fails loudly', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await fs.remove(path.join(dir, 'blank', 'layers'));
        await assert.rejects(applyBlankShell(dir, 'blank', {}), /Template has no blank\/layers\/ \(template older than the B release\)/);
        assert.match(await read(dir, MAIN_SCREEN), /\/\/ showcase/, 'nothing is copied before the check');
    });
});

test('blank fails loudly when a layer it needs is missing', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await fs.remove(path.join(dir, 'blank', 'layers', 'multilang'));
        await assert.rejects(applyBlankShell(dir, 'blank', { theming: true, multiLang: true }), /no blank\/layers\/multilang\//);
    });
});

test('blank fails loudly, naming the monetization release, when the ads-without-purchases layer is missing', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await fs.remove(path.join(dir, 'blank', 'layers', 'ads-without-purchases'));
        await assert.rejects(applyBlankShell(dir, 'blank', { theming: true, ads: true, purchases: false }),
            /Template has no blank\/layers\/ads-without-purchases\/ \(template older than the monetization release\)/);
        await fs.remove(path.join(dir, 'blank', 'layers', 'multilang'));
        await assert.rejects(applyBlankShell(dir, 'blank', { theming: true, multiLang: true }),
            /Template has no blank\/layers\/multilang\/ \(template older than the B release\)/);
    });
});

// Monetization: ads without purchases gets the layer that makes no one ad-free
for (const [ads, purchases, copied] of [
    [true, false, true],
    [true, true, false],
    [false, true, false],
    [false, false, false]
]) {
    test(`blank, ads ${ads} + purchases ${purchases}: the ads-without-purchases layer is ${copied ? '' : 'not '}copied`, async () => {
        await withTempDir(async (dir) => {
            await seedTemplate(dir);
            await applyBlankShell(dir, 'blank', { theming: true, multiLang: false, ads, purchases });
            assert.equal(await fs.pathExists(path.join(dir, NO_PREMIUM_REL)), copied);
            assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
        });
    });
}

test('blank fails loudly when ads without purchases needs a missing ads-without-purchases layer', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await fs.remove(path.join(dir, 'blank', 'layers', 'ads-without-purchases'));
        await assert.rejects(
            applyBlankShell(dir, 'blank', { theming: true, ads: true, purchases: false }),
            /Template has no blank\/layers\/ads-without-purchases\//
        );
    });
});

// ktlint keeps a signature that fits in 100 columns on one line and wraps a longer one, one parameter per line
const SIG_100 = `internal fun ${'A'.repeat(100 - 'internal fun (x: Int) {'.length)}(x: Int) {`;

test('wrapLongSingleParamSignatures: a signature of exactly 100 characters is left alone, 101 is wrapped', () => {
    assert.equal(SIG_100.length, 100);
    assert.equal(wrapLongSingleParamSignatures(SIG_100), SIG_100);
    const long = SIG_100.replace('(x: Int)', '(xx: Int)');
    assert.equal(long.length, 101);
    assert.equal(wrapLongSingleParamSignatures(long),
        `${long.slice(0, long.indexOf('(') + 1)}\n    xx: Int\n) {`);
});

test('wrapLongSingleParamSignatures: keeps the indentation and nested parentheses of the parameter', () => {
    const line = `    private fun ${'b'.repeat(70)}(viewModel: SomeViewModel = koinViewModel()): Unit {`;
    assert.ok(line.length > 100);
    assert.equal(wrapLongSingleParamSignatures(`class A {\n${line}\n}\n`),
        `class A {\n    private fun ${'b'.repeat(70)}(\n        viewModel: SomeViewModel = koinViewModel()\n    ): Unit {\n}\n`);
});

test('wrapLongSingleParamSignatures: multi-parameter, no-parameter and non-signature lines are untouched', () => {
    const two = `internal fun ${'c'.repeat(80)}(first: Int, second: Map<String, Int>) {`;
    const none = `internal fun ${'d'.repeat(100)}() {`;
    const call = `        val result = someFunction(${'e'.repeat(90)})`;
    const text = [two, none, call, ''].join('\n');
    assert.equal(wrapLongSingleParamSignatures(text), text);
});

test('wrapLongSingleParamSignatures: a generic parameter type with a comma is still one parameter', () => {
    const line = `internal fun ${'f'.repeat(70)}(items: Map<String, Int>) {`;
    assert.equal(wrapLongSingleParamSignatures(line),
        `internal fun ${'f'.repeat(70)}(\n    items: Map<String, Int>\n) {`);
});

test('wrapLongSingleParamSignatures: no trailing comma after the wrapped parameter (intellij_idea style)', () => {
    const out = wrapLongSingleParamSignatures(`internal fun ${'g'.repeat(90)}(viewModel: VM = koinViewModel()) {`);
    assert.doesNotMatch(out, /,\n\)/);
});

test('wrapLongSingleParamSignatures: a comparison operator in a default argument is never mis-split', () => {
    for (const op of ['>', '<', '>=', '<=']) {
        const line = `internal fun ${'h'.repeat(80)}(flag: Boolean = a ${op} b) {`;
        assert.ok(line.length > 100);
        assert.equal(wrapLongSingleParamSignatures(line), line, op);
    }
    const lambda = `internal fun ${'i'.repeat(80)}(cb: (Int) -> Boolean = { it > 1 }) {`;
    assert.equal(wrapLongSingleParamSignatures(lambda), lambda);
});

test('wrapLongSingleParamSignatures: nested generics still count as one parameter', () => {
    const line = `internal fun ${'j'.repeat(60)}(items: Map<String, List<Int>> = emptyMap()) {`;
    assert.equal(wrapLongSingleParamSignatures(line),
        `internal fun ${'j'.repeat(60)}(\n    items: Map<String, List<Int>> = emptyMap()\n) {`);
});

test('wrapLongSingleParamSignatures: CRLF - the \\r does not count toward the length and wrapped lines keep CRLF', () => {
    const crlf100 = `${SIG_100}\r\n`;
    assert.equal(wrapLongSingleParamSignatures(crlf100), crlf100);
    const long = SIG_100.replace('(x: Int)', '(xx: Int)');
    assert.equal(wrapLongSingleParamSignatures(`${long}\r\nbody\r\n`),
        `${long.slice(0, long.indexOf('(') + 1)}\r\n    xx: Int\r\n) {\r\nbody\r\n`);
});

test('a 20-character module name gets its ScreenRoute signature wrapped; a short name keeps one line', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        await cloneFeatureModules(dir, ['notificationsettings', 'profile']);
        const screen = (name, cap) =>
            read(dir, `feature/${name}/presentation/src/commonMain/kotlin/${PKG}/feature/${name}/presentation/ui/${cap}Screen.kt`);

        assert.match(await screen('notificationsettings', 'Notificationsettings'),
            /\ninternal fun NotificationsettingsScreenRoute\(\n    viewModel: NotificationsettingsViewModel = koinViewModel\(\)\n\) \{\n/);
        assert.match(await screen('profile', 'Profile'),
            /\ninternal fun ProfileScreenRoute\(viewModel: ProfileViewModel = koinViewModel\(\)\) \{\n/);
    });
});

test('the sample source lives outside the project and is removed, also when cloning fails', async () => {
    // Private TMPDIR: other test files (run in parallel) also create cmp-sample-* dirs in the shared one
    const savedTmp = process.env.TMPDIR;
    const privateTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-private-tmp-'));
    process.env.TMPDIR = privateTmp;
    const tmpRoot = os.tmpdir();
    assert.equal(tmpRoot, privateTmp.replace(/\/$/, ''));
    const listSamples = async () => (await fs.readdir(tmpRoot)).filter((n) => n.startsWith('cmp-sample-')).sort();
    try {
      await withTempDir(async (dir) => {
        await seedTemplate(dir);
        const before = await listSamples();
        const original = fs.outputFile;
        let inProject = false;
        let calls = 0;
        fs.outputFile = async (...args) => {
            if (await fs.pathExists(path.join(dir, '.cmp-sample-source'))) inProject = true;
            if (++calls === 2) throw new Error('boom');
            return original.apply(fs, args);
        };
        try {
            await assert.rejects(cloneFeatureModules(dir, ['profile']), /boom/);
        } finally {
            fs.outputFile = original;
        }
        assert.equal(inProject, false, '.cmp-sample-source must never appear in the project');
        assert.equal(await fs.pathExists(path.join(dir, '.cmp-sample-source')), false);
        assert.deepEqual(await listSamples(), before, 'temporary sample dir must be removed after failure');
      });
    } finally {
        if (savedTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmp;
        await fs.remove(privateTmp);
    }
});

// A template pinned before the monetization release has none of its modules
const MONETIZATION_DIRS = ['core/purchases', 'core/ads', 'feature/monetization', 'blank/layers/ads-without-purchases'];

async function seedMonetization(dir, dirs = MONETIZATION_DIRS) {
    for (const rel of dirs) await fs.outputFile(path.join(dir, rel, 'build.gradle.kts'), '');
}

test('missingTemplateCapabilities lists every monetization directory the template lacks', async () => {
    await withTempDir(async (dir) => {
        assert.deepEqual(await missingTemplateCapabilities(dir), MONETIZATION_DIRS);
        await seedMonetization(dir, ['core/ads']);
        assert.deepEqual(await missingTemplateCapabilities(dir), MONETIZATION_DIRS.filter((d) => d !== 'core/ads'));
        await seedMonetization(dir);
        assert.deepEqual(await missingTemplateCapabilities(dir), []);
    });
});

test('purchases or ads against a template without the monetization modules fails with a clear 500 error', async () => {
    await withTempDir(async (dir) => {
        const cases = [
            [{ purchases: true, ads: false }, ['core/purchases', 'feature/monetization']],
            [{ purchases: false, ads: true }, ['core/ads', 'feature/monetization', 'blank/layers/ads-without-purchases']],
            [{ purchases: true, ads: true }, ['core/purchases', 'core/ads', 'feature/monetization']]
        ];
        for (const [config, missing] of cases) {
            await assert.rejects(assertTemplateCapabilities(dir, 'blank', config), (err) => {
                assert.ok(err instanceof TemplateCapabilityError, err.message);
                assert.equal(err.status, 500);
                assert.match(err.message, /template lacks .* \(older than the release that added them\)/i);
                assert.match(err.message, /update templateRef/);
                for (const rel of missing) assert.ok(err.message.includes(rel), `${rel} in ${err.message}`);
                return true;
            }, JSON.stringify(config));
        }
    });
});

test('the capability check passes without monetization flags, for showcase, and on a monetized template', async () => {
    await withTempDir(async (dir) => {
        await assertTemplateCapabilities(dir, 'blank', { purchases: false, ads: false });
        await assertTemplateCapabilities(dir, 'blank', {});
        await assertTemplateCapabilities(dir, 'showcase', null);
        await seedMonetization(dir, ['core/purchases', 'feature/monetization']);
        await assertTemplateCapabilities(dir, 'blank', { purchases: true, ads: false });
        await seedMonetization(dir);
        for (const purchases of [false, true]) {
            for (const ads of [false, true]) await assertTemplateCapabilities(dir, 'blank', { purchases, ads });
        }
    });
});

// A template pinned before the backend release has none of the backend's directories
// server/ is not the CMP template's: it comes from the backend template
const BACKEND_DIRS = ['core/api', 'core/auth', 'feature/account', 'feature/sharing'];

test('readiness (no config) does not need the backend directories; a backend request does', async () => {
    await withTempDir(async (dir) => {
        await seedMonetization(dir);
        assert.deepEqual(await missingTemplateCapabilities(dir), []);
        assert.deepEqual(await missingTemplateCapabilities(dir, { backend: false }), []);
        assert.deepEqual(await missingTemplateCapabilities(dir, { backend: true }), BACKEND_DIRS);
        await fs.outputFile(path.join(dir, 'core', 'auth', 'build.gradle.kts'), '');
        assert.deepEqual(await missingTemplateCapabilities(dir, { backend: true }), ['core/api', 'feature/account', 'feature/sharing']);
    });
});

test('backend against a template without the backend directories fails with a 500 that names them', async () => {
    await withTempDir(async (dir) => {
        await seedMonetization(dir);
        await assert.rejects(assertTemplateCapabilities(dir, 'blank', { backend: true }), (err) => {
            assert.ok(err instanceof TemplateCapabilityError, err.message);
            assert.equal(err.status, 500);
            assert.deepEqual(err.missing, BACKEND_DIRS);
            assert.equal(err.message, `Template lacks ${BACKEND_DIRS.join(', ')} (older than the release that added them); update templateRef`);
            return true;
        });
        // Showcase ignores featuresConfig, backend included
        await assertTemplateCapabilities(dir, 'showcase', { backend: true });
        await assertTemplateCapabilities(dir, 'blank', { backend: false });
    });
});

// Room (the template's room release): core/room with favorites and notes, feature/notes, its includes
// and README blocks, in the template's real formats
const ROOM = (set, part) => `core/room/src/${set}/kotlin/${PKG}/core/room/${part}`;
const APP_DATABASE = `core/room/src/commonMain/kotlin/${PKG}/core/room/AppDatabase.kt`;
const SCHEMA = 'core/room/schemas/com.kturker.multiplatform.core.room.AppDatabase/1.json';
const README_WITH_ROOM = [
    '# App',
    '',
    '<!-- cmpose:room -->',
    '## Local database (Room)',
    '',
    'Intro.',
    '<!-- cmpose:room-favorites -->',
    '- **Favorites**',
    '<!-- /cmpose:room-favorites -->',
    '<!-- cmpose:room-notes -->',
    '- **Notes demo**',
    '<!-- /cmpose:room-notes -->',
    '',
    'To add a table.',
    '<!-- /cmpose:room -->',
    '',
    '## Modules',
    ''
].join('\n');

async function seedRoom(dir) {
    await seedTemplate(dir);
    const settingsPath = path.join(dir, 'settings.gradle.kts');
    const settings = (await fs.readFile(settingsPath, 'utf8')).replace('include(":feature:sample")',
        'include(":feature:notes")\ninclude(":feature:notes:contract")\ninclude(":feature:notes:presentation")\ninclude(":feature:onboarding")\ninclude(":feature:sample")');
    await fs.writeFile(settingsPath, settings);
    const files = {
        'feature/notes/contract/build.gradle.kts': '// notes contract\n',
        'feature/notes/presentation/build.gradle.kts': '// notes presentation\n',
        [`${ROOM('commonMain', 'notes')}/NoteDao.kt`]: '// dao\n',
        [`${ROOM('commonMain', 'favorites')}/FavoriteUserDao.kt`]: '// fav dao\n',
        [`${ROOM('iosTest', 'favorites')}/FavoriteUserDaoTest.kt`]: '// fav test\n',
        [`${ROOM('iosTest', 'notes')}/NoteDaoTest.kt`]: '// note test\n',
        [APP_DATABASE]: '// favorites database\n',
        [SCHEMA]: '{"favorites": true}\n',
        // blank/layers/room: the Notes-only database and its schema
        [`blank/layers/room/${APP_DATABASE}`]: '// notes database\n',
        [`blank/layers/room/${SCHEMA}`]: '{"notes": true}\n',
        'README.md': README_WITH_ROOM
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

test('showcase: blank-only Notes parts go (module, entity/DAO, includes, README block), favorites stay', async () => {
    await withTempDir(async (dir) => {
        await seedRoom(dir);
        await applyBlankShell(dir, 'showcase', {});
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature/notes'))));
        assert.ok(!(await fs.pathExists(path.join(dir, ROOM('commonMain', 'notes')))));
        assert.ok(!(await fs.pathExists(path.join(dir, ROOM('iosTest', 'notes')))));
        assert.ok(await fs.pathExists(path.join(dir, `${ROOM('commonMain', 'favorites')}/FavoriteUserDao.kt`)));
        assert.ok(await fs.pathExists(path.join(dir, `${ROOM('iosTest', 'favorites')}/FavoriteUserDaoTest.kt`)));
        const settings = await read(dir, 'settings.gradle.kts');
        assert.doesNotMatch(settings, /feature:notes/);
        assert.match(settings, /include\(":feature:onboarding"\)/);
        assert.match(settings, /include\(":feature:sample"\)/);
        const readme = await read(dir, 'README.md');
        assert.doesNotMatch(readme, /room-notes|Notes demo/);
        assert.match(readme, /<!-- cmpose:room -->/);
        assert.match(readme, /<!-- cmpose:room-favorites -->/);
        assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
    });
});

test('showcase of a template without Room (no core/room, no notes) is a no-op', async () => {
    await withTempDir(async (dir) => {
        await seedTemplate(dir);
        const before = await read(dir, 'settings.gradle.kts');
        await applyBlankShell(dir, 'showcase', {});
        assert.equal(await read(dir, 'settings.gradle.kts'), before);
        assert.ok(await fs.pathExists(path.join(dir, 'feature/home')));
    });
});

test('blank keeps feature/notes (removeBlankOnlyParts runs for showcase only)', async () => {
    await withTempDir(async (dir) => {
        await seedRoom(dir);
        await applyBlankShell(dir, 'blank', { room: true });
        assert.ok(await fs.pathExists(path.join(dir, 'feature/notes/contract/build.gradle.kts')));
        assert.match(await read(dir, 'settings.gradle.kts'), /feature:notes/);
    });
});

// Room on: blank/layers/room puts the Notes-only database and its schema over the showcase's
for (const room of [true, false]) {
    test(`blank, room ${room}: the room layer is ${room ? '' : 'not '}copied`, async () => {
        await withTempDir(async (dir) => {
            await seedRoom(dir);
            await applyBlankShell(dir, 'blank', { theming: true, room });
            assert.equal(await read(dir, APP_DATABASE), room ? '// notes database\n' : '// favorites database\n');
            assert.equal(await read(dir, SCHEMA), room ? '{"notes": true}\n' : '{"favorites": true}\n');
            assert.ok(!(await fs.pathExists(path.join(dir, 'blank'))));
        });
    });
}

test('blank fails loudly, naming the room release, when room needs a missing room layer', async () => {
    await withTempDir(async (dir) => {
        await seedRoom(dir);
        await fs.remove(path.join(dir, 'blank', 'layers', 'room'));
        await assert.rejects(
            applyBlankShell(dir, 'blank', { theming: true, room: true }),
            /Template has no blank\/layers\/room\/ \(template older than the room release\)/
        );
        await applyBlankShell(dir, 'blank', { theming: true, room: false });
    });
});
