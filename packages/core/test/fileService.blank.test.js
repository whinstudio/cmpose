const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processBlankApp, wireFeatureModules, assertNoNetworkResidue } = require('../src/fileService');
const { applyBlankShell, cloneFeatureModules } = require('../src/featureModules');

const NEW_PACKAGE = 'dev.cmpose.app';
const PKG = 'dev/cmpose/app';
const DS = `core/designsystem/src/commonMain/kotlin/${PKG}/core/designsystem`;
const DB = `core/database/src/commonMain/kotlin/${PKG}/core/database`;

// The theme is two packages; Theming off removes both, in every source set
const THEME_DIRS = [
    `${DS}/theme`,
    `core/designsystem/src/commonTest/kotlin/${PKG}/core/designsystem/theme`,
    `${DB}/theme`,
    `core/database/src/commonTest/kotlin/${PKG}/core/database/theme`
];

// core/designsystem/build.gradle.kts of the template: Theming off leaves it as it is
const DESIGNSYSTEM_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            implementation(projects.core.multilang)',
    '            implementation(projects.core.image)',
    '        }',
    '    }',
    '}'
].join('\n');

// iosApp/iosApp/ContentView.swift of the template: no theme code for the generator to clean
const CONTENT_VIEW = [
    'import UIKit',
    'import SwiftUI',
    'import Shared',
    'import UserNotifications',
    '',
    'struct ComposeView: UIViewControllerRepresentable {',
    '    func makeUIViewController(context: Context) -> UIViewController {',
    '        MainViewControllerKt.MainViewController()',
    '    }',
    '',
    '    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}',
    '}',
    '',
    'struct ContentView: View {',
    '    var body: some View {',
    '        ComposeView()',
    '        .ignoresSafeArea()',
    '        .task {',
    '            requestNotificationPermission()',
    '        }',
    '    }',
    '}',
    ''
].join('\n');

const PALETTE_HEAD = [
    '@file:Suppress("MagicNumber")',
    '',
    `package ${NEW_PACKAGE}.core.designsystem.theme`,
    '',
    'import androidx.compose.runtime.Immutable',
    'import androidx.compose.runtime.staticCompositionLocalOf',
    'import androidx.compose.ui.graphics.Color',
    ''
];

// CustomColorsPalette.kt of the template, after the package move
const PALETTE = [
    ...PALETTE_HEAD,
    '@Immutable',
    'data class CustomColorsPalette(',
    '    val backgroundColor: Color = Color.Unspecified,',
    '    val textBlack: Color = Color.Unspecified,',
    '    val textGray: Color = Color.Unspecified,',
    '    val tintBlack: Color = Color.Unspecified,',
    '    val tintGrey: Color = Color.Unspecified,',
    '    val toggleBackground: Color = Color.Unspecified,',
    '    val toggleSelectedBackground: Color = Color.Unspecified,',
    '    val toggleUnSelectedText: Color = Color.Unspecified,',
    '    val toggleSelectedText: Color = Color.Unspecified,',
    '    val textFieldFocusedBorder: Color = Color.Unspecified,',
    '    val textFieldUnFocusedBorder: Color = Color.Unspecified,',
    '    val textFieldLabelColor: Color = Color.Unspecified,',
    '    val textFieldTextColor: Color = Color.Unspecified,',
    '    val textFieldCursorColor: Color = Color.Unspecified',
    ')',
    '',
    'val LocalColorsPalette = staticCompositionLocalOf { CustomColorsPalette() }',
    '',
    'val OnLightColorsPalette = CustomColorsPalette(',
    '    backgroundColor = Color(color = 0xFFFFFFFF),',
    '    textBlack = Color(color = 0xFF080B0E),',
    '    textGray = Color(color = 0xFF8B959E),',
    '    tintGrey = Color(color = 0xFF8B959E),',
    '    tintBlack = Color(color = 0xFF080B0E),',
    '    toggleBackground = Color(color = 0xFFF2F2F2),',
    '    toggleSelectedBackground = Color.Black,',
    '    toggleUnSelectedText = Color.Black,',
    '    toggleSelectedText = Color.White,',
    '    textFieldFocusedBorder = Color(color = 0xFFCCCCCC),',
    '    textFieldUnFocusedBorder = Color(color = 0xFFCCCCCC),',
    '    textFieldLabelColor = Color(color = 0xFF666666),',
    '    textFieldTextColor = Color(color = 0xFF000000),',
    '    textFieldCursorColor = Color(color = 0xFF000000)',
    ')',
    '',
    'val OnDarkColorsPalette = CustomColorsPalette(',
    '    backgroundColor = Color(color = 0xFF202326),',
    '    textBlack = Color(color = 0xFFFFFFFF),',
    '    textGray = Color(color = 0x80FFFFFF),',
    '    tintBlack = Color(color = 0xFFFFFFFF),',
    '    tintGrey = Color(color = 0xFF8B959E),',
    '    toggleBackground = Color(color = 0xFF2A2A2A),',
    '    toggleSelectedBackground = Color.White,',
    '    toggleUnSelectedText = Color.White,',
    '    toggleSelectedText = Color.Black,',
    '    textFieldFocusedBorder = Color(color = 0xFF555555),',
    '    textFieldUnFocusedBorder = Color(color = 0xFF555555),',
    '    textFieldLabelColor = Color(color = 0xFF888888),',
    '    textFieldTextColor = Color(color = 0xFFFFFFFF),',
    '    textFieldCursorColor = Color(color = 0xFFFFFFFF)',
    ')',
    ''
].join('\n');

// What blank + Theming ships: exactly the colours KtTheme maps to Material roles
const SIMPLIFIED_PALETTE = [
    ...PALETTE_HEAD,
    '@Immutable',
    'data class CustomColorsPalette(',
    '    val backgroundColor: Color = Color.Unspecified,',
    '    val textBlack: Color = Color.Unspecified,',
    '    val textGray: Color = Color.Unspecified,',
    '    val tintBlack: Color = Color.Unspecified,',
    '    val textFieldUnFocusedBorder: Color = Color.Unspecified',
    ')',
    '',
    'val LocalColorsPalette = staticCompositionLocalOf { CustomColorsPalette() }',
    '',
    'val OnLightColorsPalette = CustomColorsPalette(',
    '    backgroundColor = Color(color = 0xFFFFFFFF),',
    '    textBlack = Color(color = 0xFF080B0E),',
    '    textGray = Color(color = 0xFF8B959E),',
    '    tintBlack = Color(color = 0xFF080B0E),',
    '    textFieldUnFocusedBorder = Color(color = 0xFFCCCCCC)',
    ')',
    '',
    'val OnDarkColorsPalette = CustomColorsPalette(',
    '    backgroundColor = Color(color = 0xFF202326),',
    '    textBlack = Color(color = 0xFFFFFFFF),',
    '    textGray = Color(color = 0x80FFFFFF),',
    '    tintBlack = Color(color = 0xFFFFFFFF),',
    '    textFieldUnFocusedBorder = Color(color = 0xFF555555)',
    ')',
    ''
].join('\n');

// FeatureDataConventionPlugin.kt of the template (no engine lines); the package holds "ktor"
const FEATURE_DATA_PLUGIN = (commonMainLines, extra = []) => [
    'package convention',
    '',
    'import org.gradle.api.Plugin',
    'import org.gradle.api.Project',
    'import org.jetbrains.kotlin.gradle.dsl.KotlinMultiplatformExtension',
    '',
    'class FeatureDataConventionPlugin : Plugin<Project> {',
    '    override fun apply(target: Project) {',
    '        with(target) {',
    '            with(pluginManager) {',
    '                apply("dev.doktor.app.kmp.library")',
    '            }',
    '',
    '            extensions.configure(KotlinMultiplatformExtension::class.java) {',
    '                sourceSets.getByName("commonMain").dependencies {',
    ...commonMainLines,
    '                }',
    ...extra,
    '            }',
    '        }',
    '    }',
    '}'
].join('\n');

function config(overrides) {
    return { network: true, networkInspector: true, theming: true, multiLang: true, dataStore: true, detekt: true, ...overrides };
}

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-blank-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

const NOTES_LAYERS = ['contract', 'presentation'];
const NOTES_FILE = (layer, sourceSet) =>
    `feature/notes/${layer}/src/${sourceSet}/kotlin/${PKG}/feature/notes/${layer}/Marker${sourceSet === 'commonTest' ? 'Test' : ''}.kt`;

async function seed(dir) {
    const files = {
        'core/designsystem/build.gradle.kts': DESIGNSYSTEM_BUILD,
        [`${DS}/theme/CustomColorsPalette.kt`]: PALETTE,
        [`${DS}/theme/KtTheme.kt`]: `package ${NEW_PACKAGE}.core.designsystem.theme\n`,
        [`${DS}/language/LocalStringResources.kt`]: `package ${NEW_PACKAGE}.core.designsystem.language\n`,
        [`${DS}/di/DesignSystemModule.kt`]: `package ${NEW_PACKAGE}.core.designsystem.di\n`,
        [`core/designsystem/src/commonTest/kotlin/${PKG}/core/designsystem/theme/ColorSchemeForTest.kt`]: `package ${NEW_PACKAGE}.core.designsystem.theme\n`,
        'core/database/build.gradle.kts': 'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n',
        [`${DB}/theme/DarkModeManagerImpl.kt`]: `package ${NEW_PACKAGE}.core.database.theme\n`,
        [`${DB}/datastore/DataStore.kt`]: `package ${NEW_PACKAGE}.core.database.datastore\n`,
        [`core/database/src/commonTest/kotlin/${PKG}/core/database/theme/ThemeModeTest.kt`]: `package ${NEW_PACKAGE}.core.database.theme\n`,
        [`shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`]: `package ${NEW_PACKAGE}\n`,
        [`shared/src/androidHostTest/kotlin/${PKG}/di/KoinGraphTest.kt`]: `package ${NEW_PACKAGE}.di\n`,
        'iosApp/iosApp/ContentView.swift': CONTENT_VIEW
    };
    // Room: the template's feature/notes (two layers, with its template tests)
    for (const layer of NOTES_LAYERS) {
        for (const sourceSet of ['commonMain', 'commonTest']) files[NOTES_FILE(layer, sourceSet)] = `package ${NEW_PACKAGE}.feature.notes.${layer}\n`;
    }
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));
const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

test('Theming off: both theme packages go in every source set; Gradle files and ContentView stay as they are', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false }));

        for (const rel of THEME_DIRS) assert.equal(await exists(dir, rel), false, `${rel} must be removed`);
        assert.ok(await exists(dir, `${DS}/language/LocalStringResources.kt`), 'language/ stays (Multi-Language on)');
        assert.ok(await exists(dir, `${DB}/datastore/DataStore.kt`), 'datastore/ stays');
        assert.equal(await read(dir, 'core/designsystem/build.gradle.kts'), DESIGNSYSTEM_BUILD);
        assert.equal(await read(dir, 'iosApp/iosApp/ContentView.swift'), CONTENT_VIEW);
    });
});

test('Theming on: the theme packages stay and the palette keeps exactly the colours KtTheme maps', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ multiLang: false }));

        assert.ok(await exists(dir, `${DS}/theme/KtTheme.kt`));
        assert.ok(await exists(dir, `${DB}/theme/DarkModeManagerImpl.kt`));
        assert.equal(await read(dir, `${DS}/theme/CustomColorsPalette.kt`), SIMPLIFIED_PALETTE);
        assert.equal(await exists(dir, `${DS}/language`), false, 'language/ goes with Multi-Language off');
    });
});

test('Theming and Multi-Language off: core/designsystem goes; core/database keeps DataStore without theme/', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false, multiLang: false }));

        assert.equal(await exists(dir, 'core/designsystem'), false);
        assert.equal(await exists(dir, `${DB}/theme`), false);
        assert.ok(await exists(dir, `${DB}/datastore/DataStore.kt`));
    });
});

test("blank drops the template's core tests but keeps shared's Koin graph check (Compass counts iOS tests)", async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config());

        assert.equal(await exists(dir, 'core/designsystem/src/commonTest'), false);
        assert.equal(await exists(dir, 'core/database/src/commonTest'), false);
        assert.ok(await exists(dir, `shared/src/androidHostTest/kotlin/${PKG}/di/KoinGraphTest.kt`));
    });
});

// core/api is there only with the backend (applyBackendOption deletes it otherwise). Its Android-host contract
// test checks the app's models and routes against the server/ next to it, so it stays; its commonTest (an iOS
// test too, which Compass would count as the agent's) goes like every other template test.
test("blank with the backend keeps core/api's Android-host contract test and drops its common tests", async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        const contractTest = `core/api/src/androidHostTest/kotlin/${PKG}/core/api/ApiContractTest.kt`;
        const models = `core/api/src/commonMain/kotlin/${PKG}/core/api/ApiModels.kt`;
        await fs.outputFile(path.join(dir, 'core/api/build.gradle.kts'), 'plugins { }\n');
        await fs.outputFile(path.join(dir, contractTest), `package ${NEW_PACKAGE}.core.api\n`);
        await fs.outputFile(path.join(dir, `core/api/src/commonTest/kotlin/${PKG}/core/api/ApiModelsTest.kt`), `package ${NEW_PACKAGE}.core.api\n`);
        await fs.outputFile(path.join(dir, models), `package ${NEW_PACKAGE}.core.api\n`);

        await processBlankApp(dir, NEW_PACKAGE, [], config({ backend: true }));

        assert.ok(await exists(dir, contractTest), 'ApiContractTest stays');
        assert.equal(await exists(dir, 'core/api/src/commonTest'), false, 'core/api commonTest goes');
        assert.ok(await exists(dir, models));
        assert.equal(await exists(dir, 'core/database/src/commonTest'), false, 'the other core tests still go');
    });
});

test('Network off: FeatureDataConventionPlugin loses exactly core:network and ktor-client-core', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        const pluginPath = path.join(dir, 'build-logic/src/main/kotlin/convention/FeatureDataConventionPlugin.kt');
        await fs.outputFile(pluginPath, FEATURE_DATA_PLUGIN([
            '                    implementation(project(":core:domain"))',
            '                    implementation(project(":core:network"))',
            '                    implementation(libs.ktor.client.core.get())'
        ]));

        await processBlankApp(dir, 'dev.doktor.app', [], config({ network: false, networkInspector: false }));

        assert.equal(await fs.readFile(pluginPath, 'utf8'), FEATURE_DATA_PLUGIN([
            '                    implementation(project(":core:domain"))'
        ]));
    });
});

test('Network off: a plugin that still names a Ktor engine is rejected, not shipped half-edited', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        const pluginPath = path.join(dir, 'build-logic/src/main/kotlin/convention/FeatureDataConventionPlugin.kt');
        await fs.outputFile(pluginPath, FEATURE_DATA_PLUGIN([
            '                    implementation(project(":core:domain"))',
            '                    implementation(project(":core:network"))',
            '                    implementation(libs.ktor.client.core.get())'
        ], [
            '',
            '                sourceSets.findByName("androidMain")?.dependencies {',
            '                    implementation(libs.ktor.client.android.get())',
            '                }'
        ]));

        await assert.rejects(
            processBlankApp(dir, 'dev.doktor.app', [], config({ network: false, networkInspector: false })),
            /FeatureDataConventionPlugin\.kt: network references left/
        );
    });
});

// Monetization: feature/monetization is part of the blank shell; its template tests never ship
const MONETIZATION_LAYERS = ['contract', 'presentation'];
const MONETIZATION_MAIN = (layer) =>
    `feature/monetization/${layer}/src/commonMain/kotlin/${PKG}/feature/monetization/${layer}/Marker.kt`;
const MONETIZATION_TEST = (layer) =>
    `feature/monetization/${layer}/src/commonTest/kotlin/${PKG}/feature/monetization/${layer}/MarkerTest.kt`;
const SAMPLE_MAIN = `feature/sample/presentation/src/commonMain/kotlin/${PKG}/feature/sample/presentation/SampleScreen.kt`;
const ORDERS_MAIN = `feature/orders/presentation/src/commonMain/kotlin/${PKG}/feature/orders/presentation/OrdersScreen.kt`;

async function seedMonetization(dir) {
    const files = { [SAMPLE_MAIN]: `package ${NEW_PACKAGE}.feature.sample.presentation\n` };
    for (const layer of MONETIZATION_LAYERS) {
        files[MONETIZATION_MAIN(layer)] = `package ${NEW_PACKAGE}.feature.monetization.${layer}\n`;
        files[MONETIZATION_TEST(layer)] = `package ${NEW_PACKAGE}.feature.monetization.${layer}\n`;
    }
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

test('no custom modules + purchases: feature/ keeps only monetization, without its tests', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedMonetization(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ purchases: true, ads: false }));

        assert.deepEqual(await fs.readdir(path.join(dir, 'feature')), ['monetization']);
        for (const layer of MONETIZATION_LAYERS) {
            assert.ok(await exists(dir, MONETIZATION_MAIN(layer)), `${layer} commonMain stays`);
            assert.equal(await exists(dir, `feature/monetization/${layer}/src/commonTest`), false, `${layer} commonTest goes`);
        }
    });
});

test('no custom modules + ads only: feature/ keeps only monetization, without its tests', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedMonetization(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ purchases: false, ads: true }));

        assert.deepEqual(await fs.readdir(path.join(dir, 'feature')), ['monetization']);
        for (const layer of MONETIZATION_LAYERS) {
            assert.equal(await exists(dir, `feature/monetization/${layer}/src/commonTest`), false);
        }
    });
});

test('no custom modules, purchases and ads off: no feature/ directory at all', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedMonetization(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ purchases: false, ads: false }));

        assert.equal(await exists(dir, 'feature'), false);
    });
});

test('custom modules + ads: monetization loses its tests, the custom module is untouched', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedMonetization(dir);
        await fs.outputFile(path.join(dir, ORDERS_MAIN), `package ${NEW_PACKAGE}.feature.orders.presentation\n`);
        await processBlankApp(dir, NEW_PACKAGE, ['orders'], config({ purchases: false, ads: true }));

        assert.ok(await exists(dir, ORDERS_MAIN));
        for (const layer of MONETIZATION_LAYERS) {
            assert.ok(await exists(dir, MONETIZATION_MAIN(layer)));
            assert.equal(await exists(dir, `feature/monetization/${layer}/src/commonTest`), false);
        }
    });
});

// Room: blank keeps the template's feature/notes when room is on, never with its tests
async function assertNotesKeptWithoutTests(dir) {
    for (const layer of NOTES_LAYERS) {
        assert.ok(await exists(dir, NOTES_FILE(layer, 'commonMain')), `notes ${layer} commonMain stays`);
        assert.equal(await exists(dir, `feature/notes/${layer}/src/commonTest`), false, `notes ${layer} commonTest goes`);
    }
}

test('no custom modules + room: feature/ keeps only notes, without its tests; feature/sample goes', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await fs.outputFile(path.join(dir, SAMPLE_MAIN), `package ${NEW_PACKAGE}.feature.sample.presentation\n`);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ room: true }));

        assert.deepEqual(await fs.readdir(path.join(dir, 'feature')), ['notes']);
        await assertNotesKeptWithoutTests(dir);
    });
});

test('no custom modules + room + ads: feature/ keeps notes and monetization, both without tests', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedMonetization(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ room: true, ads: true }));

        assert.deepEqual((await fs.readdir(path.join(dir, 'feature'))).sort(), ['monetization', 'notes']);
        await assertNotesKeptWithoutTests(dir);
        for (const layer of MONETIZATION_LAYERS) {
            assert.equal(await exists(dir, `feature/monetization/${layer}/src/commonTest`), false);
        }
    });
});

test('no custom modules, every flag off (room included): no feature/ directory at all', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedMonetization(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ room: false, purchases: false, ads: false }));

        assert.equal(await exists(dir, 'feature'), false);
    });
});

test('custom modules + room: notes loses its tests, the custom module is untouched', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await fs.outputFile(path.join(dir, ORDERS_MAIN), `package ${NEW_PACKAGE}.feature.orders.presentation\n`);
        await processBlankApp(dir, NEW_PACKAGE, ['orders'], config({ room: true }));

        assert.ok(await exists(dir, ORDERS_MAIN));
        await assertNotesKeptWithoutTests(dir);
    });
});

// Kermit: core/logging has no flag. No removal path deletes it, its include, the convention line
// that gives every module the dependency, or initKoin's set-up and start-up lines; blank drops only
// its tests, like every core/* module's.
const LOGGING_MAIN = `core/logging/src/commonMain/kotlin/${PKG}/core/logging/LoggingConfig.kt`;
const LOGGING_TEST = `core/logging/src/commonTest/kotlin/${PKG}/core/logging/LoggingConfigTest.kt`;
const LOGGING_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            api(libs.kermit)',
    '        }',
    '        commonTest.dependencies {',
    '            implementation(libs.kermit.test)',
    '        }',
    '    }',
    '}',
    ''
].join('\n');
const LOGGING_CONFIG = [
    `package ${NEW_PACKAGE}.core.logging`,
    '',
    'internal const val LOG_TAG_PREFIX = "Demo"',
    ''
].join('\n');
const KMP_CONVENTION_PATH = 'build-logic/src/main/kotlin/convention/configureKotlinMultiplatform.kt';
const KMP_CONVENTION = [
    'package convention',
    '',
    'import org.gradle.api.Project',
    'import org.jetbrains.kotlin.gradle.dsl.KotlinMultiplatformExtension',
    '',
    'internal fun Project.configureKotlinMultiplatform(extension: KotlinMultiplatformExtension) = extension.apply {',
    '    sourceSets.apply {',
    '        commonMain {',
    '            dependencies {',
    '                implementation(libs.kotlinx.serialization.json.get())',
    '                if (project.path != LOGGING_MODULE) {',
    '                    implementation(project(LOGGING_MODULE))',
    '                }',
    '            }',
    '        }',
    '    }',
    '}',
    '',
    '// Every KMP module logs through Kermit (core:logging); core:logging itself is the one exception',
    'private const val LOGGING_MODULE = ":core:logging"',
    ''
].join('\n');
const PRESENTATION_PLUGIN_PATH = 'build-logic/src/main/kotlin/convention/FeaturePresentationConventionPlugin.kt';
const DESIGNSYSTEM_DEPENDENCY = '                    implementation(project(":core:designsystem"))';
const PRESENTATION_PLUGIN = FEATURE_DATA_PLUGIN([
    DESIGNSYSTEM_DEPENDENCY,
    '                    implementation(project(":core:domain"))'
]).replace('FeatureDataConventionPlugin', 'FeaturePresentationConventionPlugin');
const INIT_KOIN_PATH = `shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt`;
const INIT_KOIN_LOGGING_LINES = [
    'import co.touchlab.kermit.Logger',
    `import ${NEW_PACKAGE}.core.logging.configureLogging`,
    '    configureLogging(isDebug = isDebug)',
    '    Logger.withTag("App").i { "Koin started (debug build: $isDebug)" }'
];
const INIT_KOIN = [
    `package ${NEW_PACKAGE}.di`,
    '',
    INIT_KOIN_LOGGING_LINES[0],
    INIT_KOIN_LOGGING_LINES[1],
    `import ${NEW_PACKAGE}.core.network.di.NetworkModule`,
    'import org.koin.core.context.startKoin',
    '',
    'fun initKoin(isDebug: Boolean) {',
    INIT_KOIN_LOGGING_LINES[2],
    '    startKoin {',
    '        modules(appModules())',
    '    }',
    INIT_KOIN_LOGGING_LINES[3],
    '}',
    ''
].join('\n');
const SETTINGS = [
    'rootProject.name = "Demo"',
    'include(":core:domain")',
    'include(":core:logging")',
    'include(":core:network")',
    ''
].join('\n');

async function seedLogging(dir) {
    const files = {
        'core/logging/build.gradle.kts': LOGGING_BUILD,
        [LOGGING_MAIN]: LOGGING_CONFIG,
        [LOGGING_TEST]: `package ${NEW_PACKAGE}.core.logging\n`,
        [KMP_CONVENTION_PATH]: KMP_CONVENTION,
        [PRESENTATION_PLUGIN_PATH]: PRESENTATION_PLUGIN,
        [INIT_KOIN_PATH]: INIT_KOIN,
        'settings.gradle.kts': SETTINGS,
        // What network off has to clean up for the residue check to pass
        'shared/build.gradle.kts': 'kotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(projects.core.network)\n            implementation(projects.core.domain)\n        }\n    }\n}\n',
        'core/network/build.gradle.kts': 'dependencies {\n    implementation(libs.ktor.client.core)\n    implementation(libs.ktor.client.logging)\n}\n'
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    await fs.copy(path.join(__dirname, 'fixtures', 'libs.versions.neutral.toml'), path.join(dir, 'gradle', 'libs.versions.toml'));
}

async function assertLoggingKept(dir) {
    assert.equal(await read(dir, 'core/logging/build.gradle.kts'), LOGGING_BUILD);
    assert.equal(await read(dir, LOGGING_MAIN), LOGGING_CONFIG);
    assert.equal(await exists(dir, 'core/logging/src/commonTest'), false, 'core/logging commonTest goes in blank');
    assert.ok((await read(dir, 'settings.gradle.kts')).includes('include(":core:logging")'));
    assert.equal(await read(dir, KMP_CONVENTION_PATH), KMP_CONVENTION, 'the convention file is byte for byte the same');
    const initKoin = await read(dir, INIT_KOIN_PATH);
    for (const line of INIT_KOIN_LOGGING_LINES) assert.ok(initKoin.split('\n').includes(line), `initKoin.kt keeps ${line}:\n${initKoin}`);
}

test('core/logging, every flag off (room included): the module, its include, the convention line and initKoin set-up stay; its tests go', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedLogging(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], {
            network: false,
            networkInspector: false,
            theming: false,
            multiLang: false,
            dataStore: false,
            detekt: false,
            purchases: false,
            ads: false,
            room: false
        });

        await assertLoggingKept(dir);
        assert.equal(await exists(dir, 'core/network'), false);
    });
});

test('core/logging, network off only: the logging module stays and the network residue check passes', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedLogging(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ network: false, networkInspector: false }));

        await assertLoggingKept(dir);
        const initKoin = await read(dir, INIT_KOIN_PATH);
        assert.ok(!initKoin.includes('NetworkModule'), initKoin);
        await assertNoNetworkResidue(dir);
    });
});

test('core/logging, theming and multi-language off: only the designsystem line of FeaturePresentationConventionPlugin goes', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedLogging(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false, multiLang: false }));

        await assertLoggingKept(dir);
        assert.equal(await read(dir, PRESENTATION_PLUGIN_PATH), PRESENTATION_PLUGIN.replace(DESIGNSYSTEM_DEPENDENCY, ''));
    });
});

test('core/logging, detekt off: configureKotlinMultiplatform.kt is untouched (the <pkg>.detekt filter finds nothing there)', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedLogging(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ detekt: false }));

        await assertLoggingKept(dir);
    });
});

// assertNoNetworkResidue: network off leaves no Ktor or core:network reference in a build script or the catalog
const KTOR_LOGGING_TOML_LINE = 'ktor-client-logging = { module = "io.ktor:ktor-client-logging", version.ref = "ktorClientCore" }';

test('assertNoNetworkResidue names a build script that still uses a Ktor library', async () => {
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'feature/x/build.gradle.kts'), 'dependencies {\n    implementation(libs.ktor.client.logging)\n}\n');
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "Demo"\n');
        await assert.rejects(
            assertNoNetworkResidue(dir),
            (error) => {
                assert.match(error.message, /^Network residue after removal:\n {2}/);
                assert.match(error.message, /feature\/x\/build\.gradle\.kts: libs\.ktor\./);
                assert.doesNotMatch(error.message, /settings\.gradle\.kts/);
                return true;
            }
        );
    });
});

test('assertNoNetworkResidue names core:network references left in a build script', async () => {
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'shared/build.gradle.kts'), '    implementation(projects.core.network)\n');
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:network")\n');
        await assert.rejects(
            assertNoNetworkResidue(dir),
            (error) => {
                assert.match(error.message, /^Network residue after removal:/);
                assert.match(error.message, /shared\/build\.gradle\.kts: projects\.core\.network/);
                assert.match(error.message, /settings\.gradle\.kts: ":core:network"/);
                return true;
            }
        );
    });
});

test('assertNoNetworkResidue names a Ktor key left in the catalog', async () => {
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'gradle/libs.versions.toml'), `[libraries]\nkermit = { module = "co.touchlab:kermit", version.ref = "kermit" }\n${KTOR_LOGGING_TOML_LINE}\n`);
        await assert.rejects(
            assertNoNetworkResidue(dir),
            /Network residue after removal[\s\S]*gradle\/libs\.versions\.toml: ktor key/
        );
    });
});

// Coil: the network fetcher (coil-network-ktor3) lives in core:network and goes with it
test('assertNoNetworkResidue names a build script that still uses Coil\'s network fetcher', async () => {
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'shared/build.gradle.kts'), '    implementation(libs.coil.network.ktor3)\n    implementation(libs.coil.compose)\n');
        await assert.rejects(
            assertNoNetworkResidue(dir),
            (error) => {
                assert.match(error.message, /^Network residue after removal:/);
                assert.match(error.message, /shared\/build\.gradle\.kts: libs\.coil\.network/);
                return true;
            }
        );
    });
});

test('assertNoNetworkResidue names coil-network-ktor3 left in the catalog', async () => {
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'gradle/libs.versions.toml'), [
            '[versions]',
            'coil = "3.4.0"',
            '',
            '[libraries]',
            'coil-compose = { module = "io.coil-kt.coil3:coil-compose", version.ref = "coil" }',
            'coil-network-ktor3 = { module = "io.coil-kt.coil3:coil-network-ktor3", version.ref = "coil" }',
            ''
        ].join('\n'));
        await assert.rejects(
            assertNoNetworkResidue(dir),
            /Network residue after removal[\s\S]*gradle\/libs\.versions\.toml: ktor key/
        );
    });
});

test('assertNoNetworkResidue accepts Coil without its network fetcher (coil, coil-compose, libs.coil.compose)', async () => {
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'gradle/libs.versions.toml'), [
            '[versions]',
            'coil = "3.4.0"',
            '',
            '[libraries]',
            'coil-compose = { module = "io.coil-kt.coil3:coil-compose", version.ref = "coil" }',
            ''
        ].join('\n'));
        await fs.outputFile(path.join(dir, 'core/image/build.gradle.kts'), '            api(libs.coil.compose)\n');

        await assertNoNetworkResidue(dir);
    });
});

test('assertNoNetworkResidue ignores look-alikes: package dev.doktor.app, projects.core.networking, kermit keys', async () => {
    await withTempDir(async (dir) => {
        await fs.copy(path.join(__dirname, 'fixtures', 'libs.versions.toml'), path.join(dir, 'gradle', 'libs.versions.toml'));
        const toml = await fs.readFile(path.join(dir, 'gradle', 'libs.versions.toml'), 'utf8');
        const withoutKtor = toml.split('\n').filter((line) => !/^(?:ktorClientCore|ktor-|coil-network-)/.test(line)).join('\n');
        await fs.writeFile(path.join(dir, 'gradle', 'libs.versions.toml'), withoutKtor);
        await fs.outputFile(path.join(dir, 'build-logic/build.gradle.kts'), [
            'gradlePlugin {',
            '    plugins {',
            '        register("kmpLibrary") {',
            '            id = "dev.doktor.app.kmp.library"',
            '        }',
            '    }',
            '}',
            ''
        ].join('\n'));
        await fs.outputFile(path.join(dir, 'shared/build.gradle.kts'), '    implementation(projects.core.networking)\n    implementation(libs.kermit)\n');
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:networking")\n');

        await assertNoNetworkResidue(dir);
    });
});

test('Network off with package dev.doktor.app: the pipeline passes its own network residue check', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        const packageName = 'dev.doktor.app';
        await fs.ensureDir(path.join(dir, 'shared/src/commonMain/kotlin/dev/doktor/app'));
        await fs.copy(path.join(__dirname, 'fixtures', 'libs.versions.toml'), path.join(dir, 'gradle', 'libs.versions.toml'));
        await fs.outputFile(path.join(dir, 'core/network/build.gradle.kts'), '    implementation(libs.ktor.client.logging)\n');
        await fs.outputFile(path.join(dir, 'build-logic/build.gradle.kts'), '            id = "dev.doktor.app.kmp.library"\n');

        await processBlankApp(dir, packageName, [], config({ network: false, networkInspector: false }));
        await assertNoNetworkResidue(dir);
    });
});

test('Network on: the network residue check is not run (Ktor references are expected)', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedLogging(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config());

        assert.ok((await read(dir, 'core/network/build.gradle.kts')).includes('implementation(libs.ktor.client.logging)'));
        await assert.rejects(assertNoNetworkResidue(dir), /Network residue after removal/);
    });
});

// Review: core/review has no flag. No removal path deletes it, its include, the convention line that
// gives every feature screen the dependency, shared's dependency, initKoin's ReviewModule or the
// ReviewRequestEffect() call of MainScreen; blank drops only its tests, like every core/* module's.
const REVIEW_SRC = (sourceSet) => `core/review/src/${sourceSet}/kotlin/${PKG}/core/review`;
const REVIEW_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        androidMain.dependencies {',
    '            implementation(libs.play.review)',
    '            implementation(libs.play.review.ktx)',
    '        }',
    '    }',
    '}',
    ''
].join('\n');
const REVIEW_FILES = {
    'core/review/build.gradle.kts': REVIEW_BUILD,
    [`${REVIEW_SRC('commonMain')}/ReviewPrompter.kt`]:
        `package ${NEW_PACKAGE}.core.review\n\nimport co.touchlab.kermit.Logger\nimport org.koin.core.annotation.Single\n\n@Single\nclass ReviewPrompter(private val store: ReviewCounterStore)\n`,
    [`${REVIEW_SRC('commonMain')}/ReviewRequestEffect.kt`]:
        `package ${NEW_PACKAGE}.core.review\n\nimport androidx.compose.runtime.Composable\n\n@Composable\nfun ReviewRequestEffect(prompter: ReviewPrompter = koinInject()) {\n}\n`,
    [`${REVIEW_SRC('commonMain')}/di/ReviewModule.kt`]:
        `package ${NEW_PACKAGE}.core.review.di\n\n@Module\n@ComponentScan("${NEW_PACKAGE}.core.review")\nclass ReviewModule\n`,
    [`${REVIEW_SRC('androidMain')}/AndroidReviewRequester.kt`]:
        `package ${NEW_PACKAGE}.core.review\n\nimport com.google.android.play.core.review.ReviewManagerFactory\nimport com.google.android.play.core.ktx.launchReview\n\ninternal class AndroidReviewRequester : ReviewRequester\n`,
    [`${REVIEW_SRC('iosMain')}/IosReviewRequester.kt`]:
        `package ${NEW_PACKAGE}.core.review\n\nimport platform.StoreKit.SKStoreReviewController\nimport platform.UIKit.UIApplication\n\ninternal class IosReviewRequester : ReviewRequester\n`,
    [`${REVIEW_SRC('iosMain')}/AppStoreId.kt`]: `package ${NEW_PACKAGE}.core.review\n\ninternal const val APP_STORE_ID = ""\n`
};
const REVIEW_TEST = `${REVIEW_SRC('commonTest')}/ReviewPrompterTest.kt`;
const REVIEW_CONVENTION_LINES = [
    '                    // Every screen can ask for a review: ReviewPrompter.recordPositiveEvent()',
    '                    implementation(project(":core:review"))'
];
// FeaturePresentationConventionPlugin.kt after the review package
const REVIEW_PRESENTATION_PLUGIN = FEATURE_DATA_PLUGIN([
    DESIGNSYSTEM_DEPENDENCY,
    '                    implementation(project(":core:domain"))',
    '                    implementation(project(":core:multilang"))',
    '                    implementation(project(":core:presentation"))',
    ...REVIEW_CONVENTION_LINES
]).replace('FeatureDataConventionPlugin', 'FeaturePresentationConventionPlugin');
const REVIEW_SETTINGS = [
    'rootProject.name = "Demo"',
    'include(":core:designsystem")',
    'include(":core:domain")',
    'include(":core:logging")',
    'include(":core:network")',
    'include(":core:purchases")',
    'include(":core:review")',
    ''
].join('\n');
const REVIEW_SHARED_LINE = '            implementation(projects.core.review)';
const REVIEW_SHARED_BUILD = [
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            implementation(projects.core.designsystem)',
    '            implementation(projects.core.domain)',
    '            implementation(projects.core.navigation)',
    REVIEW_SHARED_LINE,
    '        }',
    '    }',
    '}',
    ''
].join('\n');
const REVIEW_INIT_KOIN_LINES = [`import ${NEW_PACKAGE}.core.review.di.ReviewModule`, '    add(ReviewModule().module)'];
const REVIEW_INIT_KOIN = [
    `package ${NEW_PACKAGE}.di`,
    '',
    `import ${NEW_PACKAGE}.core.designsystem.di.DesignSystemModule`,
    `import ${NEW_PACKAGE}.core.network.di.NetworkModule`,
    REVIEW_INIT_KOIN_LINES[0],
    'import org.koin.ksp.generated.module',
    'import org.koin.core.module.Module as KoinModule',
    '',
    'fun appModules(): List<KoinModule> = buildList {',
    '    add(NetworkModule().module)',
    '    add(DesignSystemModule().module)',
    REVIEW_INIT_KOIN_LINES[1],
    '}',
    ''
].join('\n');
const REVIEW_EFFECT_LINES = [
    '    // Passes ReviewPrompter\'s requests (a positive moment, "Rate the app") to the platform',
    '    ReviewRequestEffect()'
];
// blank/shared MainScreen.kt and its multilang layer: they differ only in the language lines
const BLANK_MAIN_SCREEN = (multiLang) => [
    `package ${NEW_PACKAGE}`,
    '',
    'import androidx.compose.runtime.Composable',
    ...(multiLang ? ['import androidx.compose.runtime.CompositionLocalProvider'] : []),
    `import ${NEW_PACKAGE}.core.navigation.NavigationLaunchedEffect`,
    `import ${NEW_PACKAGE}.core.review.ReviewRequestEffect`,
    ...(multiLang ? [`import ${NEW_PACKAGE}.core.designsystem.language.LocalStringResources`] : []),
    '',
    '@Composable',
    'fun MainScreen() {',
    '    NavigationLaunchedEffect(navigator = navigator, navController = navController)',
    ...REVIEW_EFFECT_LINES,
    ...(multiLang ? ['    CompositionLocalProvider(LocalStringResources provides strings) {', '    }'] : []),
    '}',
    ''
].join('\n');
const BLANK_GUIDE_SCREEN = [
    `package ${NEW_PACKAGE}`,
    '',
    'import androidx.compose.runtime.rememberCoroutineScope',
    `import ${NEW_PACKAGE}.core.review.rememberReviewRequester`,
    'import kotlinx.coroutines.launch',
    '',
    '@Composable',
    'internal fun GuideScreen() {',
    '    // A demo: in your app, call ReviewPrompter.recordPositiveEvent() after a moment the user wanted',
    '    val reviewRequester = rememberReviewRequester()',
    '    val scope = rememberCoroutineScope()',
    '    OutlinedButton(onClick = { scope.launch { reviewRequester.requestReview() } }) {',
    '        Text("Rate the app")',
    '    }',
    '}',
    ''
].join('\n');
const SHARED_SRC = `shared/src/commonMain/kotlin/${PKG}`;

// The template after applyBlankShell (multiLang off) and the package move, with core/review wired in
async function seedReview(dir) {
    await seedLogging(dir);
    const files = {
        ...REVIEW_FILES,
        [REVIEW_TEST]: `package ${NEW_PACKAGE}.core.review\n\nclass ReviewPrompterTest\n`,
        [PRESENTATION_PLUGIN_PATH]: REVIEW_PRESENTATION_PLUGIN,
        'settings.gradle.kts': REVIEW_SETTINGS,
        'shared/build.gradle.kts': REVIEW_SHARED_BUILD,
        [INIT_KOIN_PATH]: REVIEW_INIT_KOIN,
        [`${SHARED_SRC}/MainScreen.kt`]: BLANK_MAIN_SCREEN(false),
        [`${SHARED_SRC}/GuideScreen.kt`]: BLANK_GUIDE_SCREEN
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function assertReviewKept(dir) {
    for (const [rel, content] of Object.entries(REVIEW_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    assert.equal(await exists(dir, 'core/review/src/commonTest'), false, 'core/review commonTest goes in blank');
    assert.ok((await read(dir, 'settings.gradle.kts')).split('\n').includes('include(":core:review")'));
    assert.ok((await read(dir, 'shared/build.gradle.kts')).split('\n').includes(REVIEW_SHARED_LINE));
    const initKoin = await read(dir, INIT_KOIN_PATH);
    for (const line of REVIEW_INIT_KOIN_LINES) assert.ok(initKoin.split('\n').includes(line), `initKoin.kt keeps ${line}:\n${initKoin}`);
    const plugin = await read(dir, PRESENTATION_PLUGIN_PATH);
    for (const line of REVIEW_CONVENTION_LINES) assert.ok(plugin.split('\n').includes(line), `the convention keeps ${line}:\n${plugin}`);
    const mainScreen = await read(dir, `${SHARED_SRC}/MainScreen.kt`);
    for (const line of REVIEW_EFFECT_LINES) assert.ok(mainScreen.split('\n').includes(line), `MainScreen.kt keeps ${line}:\n${mainScreen}`);
}

test('core/review, every flag off (room included): the module, its include, shared, initKoin, the convention and MainScreen keep it; its tests go', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedReview(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], {
            network: false,
            networkInspector: false,
            theming: false,
            multiLang: false,
            dataStore: false,
            detekt: false,
            purchases: false,
            ads: false,
            room: false
        });

        await assertReviewKept(dir);
        assert.equal(await read(dir, `${SHARED_SRC}/MainScreen.kt`), BLANK_MAIN_SCREEN(false));
        assert.equal(await read(dir, `${SHARED_SRC}/GuideScreen.kt`), BLANK_GUIDE_SCREEN);
        assert.equal(await exists(dir, 'core/network'), false);
        assert.equal(await exists(dir, 'core/designsystem'), false);
    });
});

test('core/review, theming and multi-language off: only the designsystem line of the convention goes, no three blank lines', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedReview(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false, multiLang: false }));

        await assertReviewKept(dir);
        const plugin = await read(dir, PRESENTATION_PLUGIN_PATH);
        assert.ok(!plugin.includes('":core:designsystem"'), plugin);
        assert.doesNotMatch(plugin, /\n[ \t]*\n[ \t]*\n/, 'no three blank lines in a row');
        const expected = REVIEW_PRESENTATION_PLUGIN.split('\n')
            .filter((line) => !line.includes('project(":core:multilang")'))
            .join('\n')
            .replace(DESIGNSYSTEM_DEPENDENCY, '');
        assert.equal(plugin, expected);
    });
});

test('core/review, multi-language on: the layer\'s MainScreen.kt calls ReviewRequestEffect() and provides the strings', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        // The blank overlay of the template, copied over the seed (applyBlankShell copies by path, the
        // package does not matter): the multilang layer's MainScreen.kt replaces the shell's
        const overlay = {
            [`blank/${SHARED_SRC}/MainScreen.kt`]: BLANK_MAIN_SCREEN(false),
            [`blank/${SHARED_SRC}/GuideScreen.kt`]: BLANK_GUIDE_SCREEN,
            [`blank/layers/multilang/${SHARED_SRC}/MainScreen.kt`]: BLANK_MAIN_SCREEN(true)
        };
        await seed(dir);
        await seedReview(dir);
        for (const [rel, content] of Object.entries(overlay)) await fs.outputFile(path.join(dir, rel), content);
        await applyBlankShell(dir, 'blank', config());
        await processBlankApp(dir, NEW_PACKAGE, [], config());

        await assertReviewKept(dir);
        const mainScreen = await read(dir, `${SHARED_SRC}/MainScreen.kt`);
        assert.equal(mainScreen, BLANK_MAIN_SCREEN(true));
        assert.ok(mainScreen.includes('LocalStringResources provides'), mainScreen);
        assert.ok(mainScreen.includes('ReviewRequestEffect()'), mainScreen);
    });
});

test('custom module named review: feature/review gets four layers and its Koin modules, next to core/review and ReviewModule', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedReview(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            const src = `feature/sample/${layer}/src/commonMain/kotlin/${PKG}/feature/sample/${layer}`;
            await fs.outputFile(path.join(dir, `feature/sample/${layer}/build.gradle.kts`), 'plugins {\n}\n');
            await fs.outputFile(path.join(dir, src, 'di', `Sample${layer.charAt(0).toUpperCase()}${layer.slice(1)}Module.kt`),
                `package ${NEW_PACKAGE}.feature.sample.${layer}.di\n`);
        }
        await cloneFeatureModules(dir, ['review']);
        await processBlankApp(dir, NEW_PACKAGE, ['review'], config());
        await wireFeatureModules(dir, NEW_PACKAGE, ['review']);

        await assertReviewKept(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            assert.ok(await exists(dir, `feature/review/${layer}/build.gradle.kts`), `feature/review/${layer}`);
        }
        assert.ok(await exists(dir, `feature/review/presentation/src/commonMain/kotlin/${PKG}/feature/review/presentation/di/ReviewPresentationModule.kt`));
        assert.equal(await exists(dir, 'feature/sample'), false);
        const initKoin = (await read(dir, INIT_KOIN_PATH)).split('\n');
        for (const koinModule of ['ReviewModule', 'ReviewPresentationModule', 'ReviewDataModule', 'ReviewDomainModule']) {
            assert.ok(initKoin.includes(`    add(${koinModule}().module)`), `initKoin.kt adds ${koinModule}:\n${initKoin.join('\n')}`);
        }
        assert.ok(initKoin.includes(`import ${NEW_PACKAGE}.feature.review.presentation.di.ReviewPresentationModule`));
        const settings = (await read(dir, 'settings.gradle.kts')).split('\n');
        assert.ok(settings.includes('include(":core:review")'));
        assert.ok(settings.some((line) => line.includes('feature:review:presentation')), settings.join('\n'));
    });
});

// Store-ready: core/about has no flag. No removal path deletes it, its include, shared's plugin,
// dependency and aboutLibraries block, initKoin's AboutModule or shared's ComposeResourcesLicensesSource;
// blank drops only its tests, like every core/* module's.
const ABOUT_SRC = (sourceSet) => `core/about/src/${sourceSet}/kotlin/${PKG}/core/about`;
const ABOUT_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            implementation(libs.aboutlibraries.core)',
    '            implementation(libs.aboutlibraries.compose.m3)',
    '        }',
    '    }',
    '}',
    ''
].join('\n');
const ABOUT_FILES = {
    'core/about/build.gradle.kts': ABOUT_BUILD,
    [`${ABOUT_SRC('commonMain')}/AppVersion.kt`]:
        `package ${NEW_PACKAGE}.core.about\n\ndata class AppVersion(val name: String, val code: Long)\n\nexpect fun currentAppVersion(): AppVersion\n`,
    [`${ABOUT_SRC('commonMain')}/LegalUrls.kt`]:
        `package ${NEW_PACKAGE}.core.about\n\nconst val PRIVACY_POLICY_URL = ""\nconst val TERMS_URL = ""\n`,
    [`${ABOUT_SRC('commonMain')}/licenses/LicensesNavGraphProvider.kt`]:
        `package ${NEW_PACKAGE}.core.about.licenses\n\n@Single(binds = [NavGraphProvider::class])\n@Named("core.about.licenses")\ninternal class LicensesNavGraphProvider : NavGraphProvider\n`,
    [`${ABOUT_SRC('commonMain')}/di/AboutModule.kt`]:
        `package ${NEW_PACKAGE}.core.about.di\n\n@Module\n@ComponentScan("${NEW_PACKAGE}.core.about")\nclass AboutModule\n`,
    [`${ABOUT_SRC('androidMain')}/AppVersion.android.kt`]:
        `package ${NEW_PACKAGE}.core.about\n\nimport android.content.Context\n\nactual fun currentAppVersion(): AppVersion = TODO()\n`,
    [`${ABOUT_SRC('iosMain')}/AppVersion.ios.kt`]:
        `package ${NEW_PACKAGE}.core.about\n\nimport platform.Foundation.NSBundle\n\nactual fun currentAppVersion(): AppVersion = TODO()\n`
};
const ABOUT_TEST = `${ABOUT_SRC('commonTest')}/LegalLinksTest.kt`;
const ABOUT_INCLUDE = 'include(":core:about")';
const ABOUT_SHARED_LINES = [
    '    alias(libs.plugins.aboutLibraries)',
    '            implementation(projects.core.about)',
    'aboutLibraries {',
    '        outputFile = file("src/commonMain/composeResources/files/aboutlibraries.json")'
];
const ABOUT_SHARED_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kotlin.multiplatform)',
    ABOUT_SHARED_LINES[0],
    '}',
    '',
    REVIEW_SHARED_BUILD.replace(REVIEW_SHARED_LINE, `${REVIEW_SHARED_LINE}\n${ABOUT_SHARED_LINES[1]}`).trimEnd(),
    '',
    ABOUT_SHARED_LINES[2],
    '    export {',
    ABOUT_SHARED_LINES[3],
    '    }',
    '}',
    ''
].join('\n');
const ABOUT_INIT_KOIN_LINES = [`import ${NEW_PACKAGE}.core.about.di.AboutModule`, '    add(AboutModule().module)'];
const ABOUT_LICENSES_SOURCE = `${SHARED_SRC}/about/ComposeResourcesLicensesSource.kt`;
const ABOUT_LICENSES_SOURCE_CONTENT = [
    `package ${NEW_PACKAGE}.about`,
    '',
    `import ${NEW_PACKAGE}.core.about.licenses.LicensesSource`,
    'import org.koin.core.annotation.Single',
    '',
    '@Single(binds = [LicensesSource::class])',
    'internal class ComposeResourcesLicensesSource : LicensesSource',
    ''
].join('\n');

// The template after applyBlankShell (multiLang off) and the package move, with core/about wired in
async function seedAbout(dir) {
    await seedReview(dir);
    const files = {
        ...ABOUT_FILES,
        [ABOUT_TEST]: `package ${NEW_PACKAGE}.core.about\n\nclass LegalLinksTest\n`,
        [ABOUT_LICENSES_SOURCE]: ABOUT_LICENSES_SOURCE_CONTENT,
        'settings.gradle.kts': REVIEW_SETTINGS.replace('include(":core:designsystem")', `${ABOUT_INCLUDE}\ninclude(":core:designsystem")`),
        'shared/build.gradle.kts': ABOUT_SHARED_BUILD,
        [INIT_KOIN_PATH]: REVIEW_INIT_KOIN
            .replace(`import ${NEW_PACKAGE}.core.designsystem.di.DesignSystemModule`,
                `${ABOUT_INIT_KOIN_LINES[0]}\nimport ${NEW_PACKAGE}.core.designsystem.di.DesignSystemModule`)
            .replace(REVIEW_INIT_KOIN_LINES[1], `${REVIEW_INIT_KOIN_LINES[1]}\n${ABOUT_INIT_KOIN_LINES[1]}`)
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function assertAboutKept(dir) {
    for (const [rel, content] of Object.entries(ABOUT_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    assert.equal(await exists(dir, 'core/about/src/commonTest'), false, 'core/about commonTest goes in blank');
    assert.ok((await read(dir, 'settings.gradle.kts')).split('\n').includes(ABOUT_INCLUDE));
    const shared = (await read(dir, 'shared/build.gradle.kts')).split('\n');
    for (const line of ABOUT_SHARED_LINES) assert.ok(shared.includes(line), `shared keeps ${line}:\n${shared.join('\n')}`);
    const initKoin = (await read(dir, INIT_KOIN_PATH)).split('\n');
    for (const line of ABOUT_INIT_KOIN_LINES) assert.ok(initKoin.includes(line), `initKoin.kt keeps ${line}:\n${initKoin.join('\n')}`);
    assert.equal(await read(dir, ABOUT_LICENSES_SOURCE), ABOUT_LICENSES_SOURCE_CONTENT);
}

test('core/about, every flag off (room included): the module, its include, shared, initKoin and the licenses source keep it; its tests go', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedAbout(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], {
            network: false,
            networkInspector: false,
            theming: false,
            multiLang: false,
            dataStore: false,
            detekt: false,
            purchases: false,
            ads: false,
            room: false
        });

        await assertAboutKept(dir);
        await assertReviewKept(dir);
        assert.equal(await exists(dir, 'core/network'), false);
        assert.equal(await exists(dir, 'core/designsystem'), false);
    });
});

test('core/about, theming and multi-language off: the designsystem removal path leaves core/about alone', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedAbout(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false, multiLang: false }));

        await assertAboutKept(dir);
    });
});

test('custom modules named about and licenses: their Koin names do not clash with AboutModule and core.about.licenses', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedAbout(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            const src = `feature/sample/${layer}/src/commonMain/kotlin/${PKG}/feature/sample/${layer}`;
            await fs.outputFile(path.join(dir, `feature/sample/${layer}/build.gradle.kts`), 'plugins {\n}\n');
            await fs.outputFile(path.join(dir, src, 'di', `Sample${layer.charAt(0).toUpperCase()}${layer.slice(1)}Module.kt`),
                `package ${NEW_PACKAGE}.feature.sample.${layer}.di\n`);
        }
        await fs.outputFile(
            path.join(dir, `feature/sample/presentation/src/commonMain/kotlin/${PKG}/feature/sample/presentation/navigation/SampleProvider.kt`),
            `package ${NEW_PACKAGE}.feature.sample.presentation.navigation\n\n@Single(binds = [NavGraphProvider::class])\n@Named("SampleProvider")\ninternal class SampleProvider : NavGraphProvider\n`
        );
        await cloneFeatureModules(dir, ['about', 'licenses']);
        await processBlankApp(dir, NEW_PACKAGE, ['about', 'licenses'], config());
        await wireFeatureModules(dir, NEW_PACKAGE, ['about', 'licenses']);

        await assertAboutKept(dir);
        for (const name of ['about', 'licenses']) {
            for (const layer of ['contract', 'data', 'domain', 'presentation']) {
                assert.ok(await exists(dir, `feature/${name}/${layer}/build.gradle.kts`), `feature/${name}/${layer}`);
            }
        }
        const licensesProvider = await read(dir,
            `feature/licenses/presentation/src/commonMain/kotlin/${PKG}/feature/licenses/presentation/navigation/LicensesProvider.kt`);
        assert.ok(licensesProvider.includes('@Named("LicensesProvider")'), licensesProvider);
        assert.ok((await read(dir, `${ABOUT_SRC('commonMain')}/licenses/LicensesNavGraphProvider.kt`)).includes('@Named("core.about.licenses")'));
        assert.ok(await exists(dir, `feature/about/presentation/src/commonMain/kotlin/${PKG}/feature/about/presentation/di/AboutPresentationModule.kt`));
        const initKoin = (await read(dir, INIT_KOIN_PATH)).split('\n');
        for (const koinModule of ['AboutModule', 'AboutPresentationModule', 'LicensesPresentationModule']) {
            assert.ok(initKoin.includes(`    add(${koinModule}().module)`), `initKoin.kt adds ${koinModule}:\n${initKoin.join('\n')}`);
        }
        const settings = (await read(dir, 'settings.gradle.kts')).split('\n');
        assert.ok(settings.includes(ABOUT_INCLUDE));
        assert.ok(settings.some((line) => line.includes('feature:about:presentation')), settings.join('\n'));
        assert.ok(settings.some((line) => line.includes('feature:licenses:presentation')), settings.join('\n'));
    });
});

// --- network-ux: the connectivity banner's permission goes with core:network; its files stay ---

const MANIFEST_PATH = 'androidApp/src/main/AndroidManifest.xml';
const NETWORK_STATE = '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />';
const NETWORK_STATE_COMMENT = '<!-- Connectivity banner and retry (core/network ConnectivityMonitor) -->';
const INTERNET_PERMISSION = '<uses-permission android:name="android.permission.INTERNET" />';
const CONNECTIVITY_DOMAIN = `core/domain/src/commonMain/kotlin/${PKG}/core/domain/ConnectivityMonitor.kt`;
const OFFLINE_BANNER = `shared/src/commonMain/kotlin/${PKG}/OfflineBanner.kt`;
const CONNECTIVITY_NETWORK = [
    `core/network/src/commonMain/kotlin/${PKG}/core/network/connectivity/ConnectivityMonitorFactory.kt`,
    `core/network/src/androidMain/kotlin/${PKG}/core/network/connectivity/AndroidConnectivityMonitor.kt`,
    `core/network/src/iosMain/kotlin/${PKG}/core/network/connectivity/IosConnectivityMonitor.kt`
];

// The template's manifest: the comment and the permission right below INTERNET
const CONNECTIVITY_MANIFEST = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '',
    `    ${INTERNET_PERMISSION}`,
    `    ${NETWORK_STATE_COMMENT}`,
    `    ${NETWORK_STATE}`,
    '',
    '    <application',
    '        android:name=".App"',
    '        android:allowBackup="true">',
    '    </application>',
    '',
    '</manifest>',
    ''
].join('\n');

async function seedConnectivity(dir) {
    await fs.outputFile(path.join(dir, MANIFEST_PATH), CONNECTIVITY_MANIFEST);
    await fs.outputFile(path.join(dir, CONNECTIVITY_DOMAIN), `package ${NEW_PACKAGE}.core.domain\n`);
    await fs.outputFile(path.join(dir, OFFLINE_BANNER), `package ${NEW_PACKAGE}\n`);
    for (const rel of CONNECTIVITY_NETWORK) await fs.outputFile(path.join(dir, rel), `package ${NEW_PACKAGE}.core.network.connectivity\n`);
}

async function assertConnectivityFilesKept(dir) {
    assert.ok(await exists(dir, CONNECTIVITY_DOMAIN), CONNECTIVITY_DOMAIN);
    assert.ok(await exists(dir, OFFLINE_BANNER), OFFLINE_BANNER);
}

function assertNoBlankLinePileUp(manifest) {
    assert.doesNotMatch(manifest, /\n[ \t]*\n[ \t]*\n/, `two blank lines in a row:\n${manifest}`);
}

test('network-ux, network and monetization off: INTERNET, ACCESS_NETWORK_STATE and its comment go, no blank lines pile up', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedConnectivity(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ network: false, networkInspector: false, purchases: false, ads: false }));

        const manifest = await read(dir, MANIFEST_PATH);
        for (const gone of ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'Connectivity banner']) {
            assert.ok(!manifest.includes(gone), `${gone} stays:\n${manifest}`);
        }
        assertNoBlankLinePileUp(manifest);
        assert.ok(manifest.includes('    <application'), manifest);
        await assertConnectivityFilesKept(dir);
        for (const rel of CONNECTIVITY_NETWORK) assert.equal(await exists(dir, rel), false, rel);
    });
});

test('network-ux, network off and ads on: INTERNET stays, ACCESS_NETWORK_STATE and its comment go', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedConnectivity(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ network: false, networkInspector: false, purchases: false, ads: true }));

        const manifest = await read(dir, MANIFEST_PATH);
        assert.ok(manifest.split('\n').includes(`    ${INTERNET_PERMISSION}`), manifest);
        assert.ok(!manifest.includes('android.permission.ACCESS_NETWORK_STATE'), manifest);
        assert.ok(!manifest.includes(NETWORK_STATE_COMMENT), manifest);
        assertNoBlankLinePileUp(manifest);
        await assertConnectivityFilesKept(dir);
    });
});

test('network-ux, network on: the permission, its comment and the monitor files stay', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedConnectivity(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ networkInspector: false }));

        const lines = (await read(dir, MANIFEST_PATH)).split('\n');
        for (const kept of [INTERNET_PERMISSION, NETWORK_STATE_COMMENT, NETWORK_STATE]) {
            assert.ok(lines.includes(`    ${kept}`), `${kept} goes:\n${lines.join('\n')}`);
        }
        await assertConnectivityFilesKept(dir);
        for (const rel of CONNECTIVITY_NETWORK) assert.ok(await exists(dir, rel), rel);
    });
});

// --- network-ux: core/update has no flag. No removal path deletes it, its include, shared's dependency,
// initKoin's UpdateModule or the AppUpdateEffect() / OfflineBanner( calls of MainScreen; blank drops
// only its tests, like every core/* module's.
const UPDATE_SRC = (sourceSet) => `core/update/src/${sourceSet}/kotlin/${PKG}/core/update`;
// core/update/build.gradle.kts of the template
const UPDATE_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            implementation(projects.core.about)',
    '            implementation(libs.kotlinx.coroutines.core)',
    '        }',
    '        androidMain.dependencies {',
    '            implementation(libs.play.app.update)',
    '            implementation(libs.play.app.update.ktx)',
    '        }',
    '    }',
    '}',
    ''
].join('\n');
const UPDATE_FILES = {
    'core/update/build.gradle.kts': UPDATE_BUILD,
    [`${UPDATE_SRC('commonMain')}/UpdateConfig.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\n// A JSON file you host, read at launch to force an update\nconst val MIN_VERSION_URL = ""\n`,
    [`${UPDATE_SRC('commonMain')}/AppStoreLookup.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\ndata class StoreRelease(val version: String, val storeUrl: String)\n\ninternal fun appStoreLookupUrl(bundleId: String): String = "https://itunes.apple.com/lookup?bundleId=$bundleId"\n`,
    [`${UPDATE_SRC('commonMain')}/UpdateChecker.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport ${NEW_PACKAGE}.core.about.currentAppVersion\nimport org.koin.core.annotation.Single\n\n@Single\nclass UpdateChecker(private val store: UpdateCheckStore)\n`,
    [`${UPDATE_SRC('commonMain')}/AppUpdateEffect.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport androidx.compose.runtime.Composable\n\n@Composable\nfun AppUpdateEffect(texts: UpdateTexts = UpdateTexts(), checker: UpdateChecker = koinInject()) {\n}\n`,
    [`${UPDATE_SRC('commonMain')}/di/UpdateModule.kt`]:
        `package ${NEW_PACKAGE}.core.update.di\n\n@Module\n@ComponentScan("${NEW_PACKAGE}.core.update")\nclass UpdateModule\n`,
    [`${UPDATE_SRC('commonMain')}/di/UpdateCheckStoreModule.kt`]:
        `package ${NEW_PACKAGE}.core.update.di\n\n@Single\nfun provideUpdateCheckStore(): UpdateCheckStore = getPlatformUpdateCheckStore()\n`,
    [`${UPDATE_SRC('androidMain')}/Http.android.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport java.net.HttpURLConnection\n\ninternal actual suspend fun fetchText(url: String): String? = null\n`,
    [`${UPDATE_SRC('androidMain')}/PlatformUpdater.android.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport com.google.android.play.core.appupdate.AppUpdateManagerFactory\nimport com.google.android.play.core.install.model.AppUpdateType\n\nactual val currentUpdatePlatform: UpdatePlatform = UpdatePlatform.Android\n`,
    [`${UPDATE_SRC('iosMain')}/Http.ios.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport platform.Foundation.NSURLSession\n\ninternal actual suspend fun fetchText(url: String): String? = null\n`,
    [`${UPDATE_SRC('iosMain')}/PlatformUpdater.ios.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport platform.UIKit.UIApplication\n\nactual val currentUpdatePlatform: UpdatePlatform = UpdatePlatform.Ios\n`
};
const UPDATE_TEST = `${UPDATE_SRC('commonTest')}/VersionComparisonTest.kt`;
const UPDATE_INCLUDE = 'include(":core:update")';
const UPDATE_SHARED_LINE = '            implementation(projects.core.update)';
const UPDATE_INIT_KOIN_LINES = [`import ${NEW_PACKAGE}.core.update.di.UpdateModule`, '    add(UpdateModule().module)'];
const UPDATE_EFFECT_LINES = [
    '    // Update available / required (core/update): at most one check a day',
    '    AppUpdateEffect()'
];
const UPDATE_BANNER_LINE = '    Scaffold(topBar = { OfflineBanner(text = "No connection") }) {';
// blank/shared MainScreen.kt and its multilang layer of the template
const UPDATE_MAIN_SCREEN = (multiLang) => BLANK_MAIN_SCREEN(multiLang)
    .replace('import androidx.compose.runtime.Composable', 'import androidx.compose.material3.Scaffold\nimport androidx.compose.runtime.Composable')
    .replace(`import ${NEW_PACKAGE}.core.review.ReviewRequestEffect`,
        `import ${NEW_PACKAGE}.core.review.ReviewRequestEffect\nimport ${NEW_PACKAGE}.core.update.AppUpdateEffect`)
    .replace(REVIEW_EFFECT_LINES[1], [REVIEW_EFFECT_LINES[1], ...UPDATE_EFFECT_LINES, UPDATE_BANNER_LINE, '    }'].join('\n'));
const UPDATE_OFFLINE_BANNER = `${SHARED_SRC}/OfflineBanner.kt`;
const UPDATE_OFFLINE_BANNER_CONTENT = [
    `package ${NEW_PACKAGE}`,
    '',
    `import ${NEW_PACKAGE}.core.domain.ConnectivityMonitor`,
    'import org.koin.compose.getKoin',
    '',
    '@Composable',
    'internal fun OfflineBanner(text: String) {',
    '    val monitor = getKoin().getOrNull<ConnectivityMonitor>() ?: return',
    '}',
    ''
].join('\n');

// The template after applyBlankShell (multiLang off) and the package move, with core/update wired in
async function seedUpdate(dir) {
    await seedAbout(dir);
    const settings = await read(dir, 'settings.gradle.kts');
    const shared = await read(dir, 'shared/build.gradle.kts');
    const initKoin = await read(dir, INIT_KOIN_PATH);
    const files = {
        ...UPDATE_FILES,
        [UPDATE_TEST]: `package ${NEW_PACKAGE}.core.update\n\nclass VersionComparisonTest\n`,
        'settings.gradle.kts': settings.replace('include(":core:review")', `include(":core:review")\n${UPDATE_INCLUDE}`),
        'shared/build.gradle.kts': shared.replace(REVIEW_SHARED_LINE, `${REVIEW_SHARED_LINE}\n${UPDATE_SHARED_LINE}`),
        [INIT_KOIN_PATH]: initKoin
            .replace(REVIEW_INIT_KOIN_LINES[0], `${REVIEW_INIT_KOIN_LINES[0]}\n${UPDATE_INIT_KOIN_LINES[0]}`)
            .replace(REVIEW_INIT_KOIN_LINES[1], `${REVIEW_INIT_KOIN_LINES[1]}\n${UPDATE_INIT_KOIN_LINES[1]}`),
        [`${SHARED_SRC}/MainScreen.kt`]: UPDATE_MAIN_SCREEN(false),
        [UPDATE_OFFLINE_BANNER]: UPDATE_OFFLINE_BANNER_CONTENT
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function assertUpdateKept(dir) {
    for (const [rel, content] of Object.entries(UPDATE_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    assert.equal(await exists(dir, 'core/update/src/commonTest'), false, 'core/update commonTest goes in blank');
    assert.ok((await read(dir, 'settings.gradle.kts')).split('\n').includes(UPDATE_INCLUDE));
    assert.ok((await read(dir, 'shared/build.gradle.kts')).split('\n').includes(UPDATE_SHARED_LINE));
    const initKoin = (await read(dir, INIT_KOIN_PATH)).split('\n');
    for (const line of UPDATE_INIT_KOIN_LINES) assert.ok(initKoin.includes(line), `initKoin.kt keeps ${line}:\n${initKoin.join('\n')}`);
    const mainScreen = (await read(dir, `${SHARED_SRC}/MainScreen.kt`)).split('\n');
    for (const line of [...UPDATE_EFFECT_LINES, UPDATE_BANNER_LINE]) {
        assert.ok(mainScreen.includes(line), `MainScreen.kt keeps ${line}:\n${mainScreen.join('\n')}`);
    }
    assert.equal(await read(dir, UPDATE_OFFLINE_BANNER), UPDATE_OFFLINE_BANNER_CONTENT);
}

test('core/update, every flag off (room included): the module, its include, shared, initKoin and MainScreen keep it; its tests go', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedUpdate(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], {
            network: false,
            networkInspector: false,
            theming: false,
            multiLang: false,
            dataStore: false,
            detekt: false,
            purchases: false,
            ads: false,
            room: false
        });

        await assertUpdateKept(dir);
        await assertReviewKept(dir);
        await assertAboutKept(dir);
        assert.equal(await read(dir, `${SHARED_SRC}/MainScreen.kt`), UPDATE_MAIN_SCREEN(false));
        assert.equal(await exists(dir, 'core/network'), false);
    });
});

test('core/update, theming and multi-language off: the designsystem removal path leaves core/update alone', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedUpdate(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false, multiLang: false }));

        await assertUpdateKept(dir);
        assert.equal(await read(dir, `${SHARED_SRC}/MainScreen.kt`), UPDATE_MAIN_SCREEN(false));
    });
});

test('custom module named update: feature/update gets four layers and UpdatePresentationModule, next to core/update and UpdateModule', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedUpdate(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            const src = `feature/sample/${layer}/src/commonMain/kotlin/${PKG}/feature/sample/${layer}`;
            await fs.outputFile(path.join(dir, `feature/sample/${layer}/build.gradle.kts`), 'plugins {\n}\n');
            await fs.outputFile(path.join(dir, src, 'di', `Sample${layer.charAt(0).toUpperCase()}${layer.slice(1)}Module.kt`),
                `package ${NEW_PACKAGE}.feature.sample.${layer}.di\n`);
        }
        await cloneFeatureModules(dir, ['update']);
        await processBlankApp(dir, NEW_PACKAGE, ['update'], config());
        await wireFeatureModules(dir, NEW_PACKAGE, ['update']);

        await assertUpdateKept(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            assert.ok(await exists(dir, `feature/update/${layer}/build.gradle.kts`), `feature/update/${layer}`);
        }
        assert.ok(await exists(dir, `feature/update/presentation/src/commonMain/kotlin/${PKG}/feature/update/presentation/di/UpdatePresentationModule.kt`));
        assert.equal(await exists(dir, 'feature/sample'), false);
        const initKoin = (await read(dir, INIT_KOIN_PATH)).split('\n');
        for (const koinModule of ['UpdateModule', 'UpdatePresentationModule', 'UpdateDataModule', 'UpdateDomainModule']) {
            assert.ok(initKoin.includes(`    add(${koinModule}().module)`), `initKoin.kt adds ${koinModule}:\n${initKoin.join('\n')}`);
        }
        assert.ok(initKoin.includes(`import ${NEW_PACKAGE}.feature.update.presentation.di.UpdatePresentationModule`));
        const settings = (await read(dir, 'settings.gradle.kts')).split('\n');
        assert.ok(settings.includes(UPDATE_INCLUDE));
        assert.ok(settings.some((line) => line.includes('feature:update:presentation')), settings.join('\n'));
    });
});

// --- Coil: core/image has no flag. No removal path deletes its main sources, its include, the
// convention line that gives every feature screen the dependency, shared's dependency, designsystem's
// dependency or the ImageLoaderSetup() call of MainScreen; blank drops only its tests, like every
// core/* module's. It has no Koin module, so initKoin is not touched.
const IMAGE_SRC = (sourceSet) => `core/image/src/${sourceSet}/kotlin/${PKG}/core/image`;
// core/image/build.gradle.kts of the template
const IMAGE_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            api(libs.coil.compose)',
    '            implementation(projects.core.domain)',
    '            implementation(projects.core.logging)',
    '        }',
    '    }',
    '}',
    ''
].join('\n');
const IMAGE_FILES = {
    'core/image/build.gradle.kts': IMAGE_BUILD,
    [`${IMAGE_SRC('commonMain')}/ImageCacheConfig.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\ninternal const val MEMORY_CACHE_PERCENT = 0.25\ninternal const val DISK_CACHE_MAX_BYTES = 50L * 1024 * 1024\ninternal const val DISK_CACHE_DIRECTORY = "image_cache"\n`,
    [`${IMAGE_SRC('commonMain')}/ImageLoaderFactory.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport coil3.ImageLoader\nimport coil3.PlatformContext\n\nfun newImageLoader(context: PlatformContext, isDebug: Boolean): ImageLoader = TODO()\n\nexpect fun imageCacheDirectory(context: PlatformContext): String\n`,
    [`${IMAGE_SRC('commonMain')}/KermitImageLogger.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport co.touchlab.kermit.Logger as KermitLogger\nimport coil3.util.Logger\n\ninternal class KermitImageLogger : Logger\n`,
    [`${IMAGE_SRC('commonMain')}/ImageLoaderSetup.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport androidx.compose.runtime.Composable\nimport coil3.compose.setSingletonImageLoaderFactory\nimport ${NEW_PACKAGE}.core.domain.BuildEnvironment\nimport org.koin.compose.koinInject\n\n@Composable\nfun ImageLoaderSetup(environment: BuildEnvironment = koinInject()) {\n}\n`,
    [`${IMAGE_SRC('androidMain')}/ImageCacheDirectory.android.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport coil3.PlatformContext\n\nactual fun imageCacheDirectory(context: PlatformContext): String = context.cacheDir.absolutePath\n`,
    [`${IMAGE_SRC('iosMain')}/ImageCacheDirectory.ios.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport coil3.PlatformContext\nimport platform.Foundation.NSCachesDirectory\n\nactual fun imageCacheDirectory(context: PlatformContext): String = TODO()\n`
};
const IMAGE_TESTS = [`${IMAGE_SRC('commonTest')}/ImageCacheConfigTest.kt`, `${IMAGE_SRC('commonTest')}/KermitImageLoggerTest.kt`];
const IMAGE_INCLUDE = 'include(":core:image")';
// FeaturePresentationConventionPlugin.kt of the template: under the core/review line
const IMAGE_CONVENTION_LINES = [
    '                    // Every screen can show images: Coil\'s AsyncImage through the app\'s loader',
    '                    implementation(project(":core:image"))'
];
const IMAGE_SHARED_LINE = '            implementation(projects.core.image)';
const IMAGE_DESIGNSYSTEM_LINE = '            implementation(projects.core.image)';
const IMAGE_SETUP_LINES = [
    '    // Coil\'s one image loader (core/image): caches, and Kermit logs in debug builds',
    '    ImageLoaderSetup()'
];
const IMAGE_SETUP_IMPORT = `import ${NEW_PACKAGE}.core.image.ImageLoaderSetup`;
// blank/shared MainScreen.kt and its multilang layer of the template: ImageLoaderSetup() opens the body
const IMAGE_MAIN_SCREEN = (multiLang) => UPDATE_MAIN_SCREEN(multiLang)
    .replace(`import ${NEW_PACKAGE}.core.navigation.NavigationLaunchedEffect`,
        `${IMAGE_SETUP_IMPORT}\nimport ${NEW_PACKAGE}.core.navigation.NavigationLaunchedEffect`)
    .replace('fun MainScreen() {', ['fun MainScreen() {', ...IMAGE_SETUP_LINES].join('\n'));

// The template after applyBlankShell (multiLang off) and the package move, with core/image wired in
async function seedImage(dir) {
    await seedUpdate(dir);
    const settings = await read(dir, 'settings.gradle.kts');
    const shared = await read(dir, 'shared/build.gradle.kts');
    const plugin = await read(dir, PRESENTATION_PLUGIN_PATH);
    const files = {
        ...IMAGE_FILES,
        ...Object.fromEntries(IMAGE_TESTS.map((rel) => [rel, `package ${NEW_PACKAGE}.core.image\n\nclass ${path.basename(rel, '.kt')}\n`])),
        'settings.gradle.kts': settings.replace('include(":core:domain")', `include(":core:domain")\n${IMAGE_INCLUDE}`),
        'shared/build.gradle.kts': shared.replace('            implementation(projects.core.domain)',
            `            implementation(projects.core.domain)\n${IMAGE_SHARED_LINE}`),
        [PRESENTATION_PLUGIN_PATH]: plugin.replace(REVIEW_CONVENTION_LINES[1], [REVIEW_CONVENTION_LINES[1], ...IMAGE_CONVENTION_LINES].join('\n')),
        [`${SHARED_SRC}/MainScreen.kt`]: IMAGE_MAIN_SCREEN(false)
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function assertImageKept(dir) {
    for (const [rel, content] of Object.entries(IMAGE_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    assert.equal(await exists(dir, 'core/image/src/commonTest'), false, 'core/image commonTest goes in blank');
    assert.ok((await read(dir, 'settings.gradle.kts')).split('\n').includes(IMAGE_INCLUDE));
    assert.ok((await read(dir, 'shared/build.gradle.kts')).split('\n').includes(IMAGE_SHARED_LINE));
    const plugin = (await read(dir, PRESENTATION_PLUGIN_PATH)).split('\n');
    for (const line of IMAGE_CONVENTION_LINES) assert.ok(plugin.includes(line), `the convention keeps ${line}:\n${plugin.join('\n')}`);
    const mainScreen = (await read(dir, `${SHARED_SRC}/MainScreen.kt`)).split('\n');
    for (const line of [IMAGE_SETUP_IMPORT, ...IMAGE_SETUP_LINES]) {
        assert.ok(mainScreen.includes(line), `MainScreen.kt keeps ${line}:\n${mainScreen.join('\n')}`);
    }
    assert.ok(!(await read(dir, INIT_KOIN_PATH)).includes('core.image'), 'core/image has no Koin module in initKoin');
}

const EVERY_FLAG_OFF = {
    network: false,
    networkInspector: false,
    theming: false,
    multiLang: false,
    dataStore: false,
    detekt: false,
    purchases: false,
    ads: false,
    room: false
};

test('core/image, every flag off (room included): main sources, include, shared, the convention and ImageLoaderSetup() stay; its tests go', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedImage(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], EVERY_FLAG_OFF);

        await assertImageKept(dir);
        await assertUpdateKept(dir);
        await assertReviewKept(dir);
        for (const rel of IMAGE_TESTS) assert.equal(await exists(dir, rel), false, `${rel} goes`);
        assert.equal(await read(dir, `${SHARED_SRC}/MainScreen.kt`), IMAGE_MAIN_SCREEN(false));
        assert.equal(await exists(dir, 'core/network'), false);
        assert.equal(await exists(dir, 'core/designsystem'), false);
        await assertNoNetworkResidue(dir);
    });
});

test('core/image, every flag off but theming: designsystem keeps implementation(projects.core.image)', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedImage(dir);
        await processBlankApp(dir, NEW_PACKAGE, [], { ...EVERY_FLAG_OFF, theming: true });

        await assertImageKept(dir);
        const designsystem = await read(dir, 'core/designsystem/build.gradle.kts');
        assert.ok(designsystem.split('\n').includes(IMAGE_DESIGNSYSTEM_LINE), designsystem);
    });
});

test('core/image, theming and multi-language off: only the designsystem line of the convention goes, core:image stays, no three blank lines', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedImage(dir);
        const before = await read(dir, PRESENTATION_PLUGIN_PATH);
        await processBlankApp(dir, NEW_PACKAGE, [], config({ theming: false, multiLang: false }));

        await assertImageKept(dir);
        assert.equal(await exists(dir, 'core/designsystem'), false);
        const plugin = await read(dir, PRESENTATION_PLUGIN_PATH);
        assert.ok(!plugin.includes('":core:designsystem"'), plugin);
        assert.ok(plugin.includes('":core:image"'), plugin);
        assert.doesNotMatch(plugin, /\n[ \t]*\n[ \t]*\n/, 'no three blank lines in a row');
        const expected = before.split('\n')
            .filter((line) => !line.includes('project(":core:multilang")'))
            .join('\n')
            .replace(DESIGNSYSTEM_DEPENDENCY, '');
        assert.equal(plugin, expected);
    });
});

test('core/image, multi-language on: the layer\'s MainScreen.kt calls ImageLoaderSetup() and provides the strings', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        // The blank overlay of the template: the shell's MainScreen.kt and the multilang layer's both call it
        const overlay = {
            [`blank/${SHARED_SRC}/MainScreen.kt`]: IMAGE_MAIN_SCREEN(false),
            [`blank/${SHARED_SRC}/GuideScreen.kt`]: BLANK_GUIDE_SCREEN,
            [`blank/layers/multilang/${SHARED_SRC}/MainScreen.kt`]: IMAGE_MAIN_SCREEN(true)
        };
        await seed(dir);
        await seedImage(dir);
        for (const [rel, content] of Object.entries(overlay)) await fs.outputFile(path.join(dir, rel), content);
        await applyBlankShell(dir, 'blank', config());
        await processBlankApp(dir, NEW_PACKAGE, [], config());

        await assertImageKept(dir);
        const mainScreen = await read(dir, `${SHARED_SRC}/MainScreen.kt`);
        assert.equal(mainScreen, IMAGE_MAIN_SCREEN(true));
        assert.ok(mainScreen.includes('LocalStringResources provides'), mainScreen);
    });
});

test('custom module named image: feature/image gets four layers and ImagePresentationModule, next to core/image', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedImage(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            const src = `feature/sample/${layer}/src/commonMain/kotlin/${PKG}/feature/sample/${layer}`;
            await fs.outputFile(path.join(dir, `feature/sample/${layer}/build.gradle.kts`), 'plugins {\n}\n');
            await fs.outputFile(path.join(dir, src, 'di', `Sample${layer.charAt(0).toUpperCase()}${layer.slice(1)}Module.kt`),
                `package ${NEW_PACKAGE}.feature.sample.${layer}.di\n`);
        }
        await cloneFeatureModules(dir, ['image']);
        await processBlankApp(dir, NEW_PACKAGE, ['image'], config());
        await wireFeatureModules(dir, NEW_PACKAGE, ['image']);

        await assertImageKept(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            assert.ok(await exists(dir, `feature/image/${layer}/build.gradle.kts`), `feature/image/${layer}`);
        }
        assert.ok(await exists(dir, `feature/image/presentation/src/commonMain/kotlin/${PKG}/feature/image/presentation/di/ImagePresentationModule.kt`));
        assert.equal(await exists(dir, 'feature/sample'), false);
        const initKoin = (await read(dir, INIT_KOIN_PATH)).split('\n');
        for (const koinModule of ['ImagePresentationModule', 'ImageDataModule', 'ImageDomainModule']) {
            assert.ok(initKoin.includes(`    add(${koinModule}().module)`), `initKoin.kt adds ${koinModule}:\n${initKoin.join('\n')}`);
        }
        assert.ok(!initKoin.includes('    add(ImageModule().module)'), 'core/image has no Koin module');
        assert.ok(initKoin.includes(`import ${NEW_PACKAGE}.feature.image.presentation.di.ImagePresentationModule`));
        const settings = (await read(dir, 'settings.gradle.kts')).split('\n');
        assert.ok(settings.includes(IMAGE_INCLUDE));
        assert.ok(settings.some((line) => line.includes('feature:image:presentation')), settings.join('\n'));
    });
});

// --- Deep links: no flag. Blank drops the showcase routes with feature/home and feature/onboarding;
// core/navigation's handler and shared's handleDeepLink stay; each custom module gets the sample's route
// with its own name as the path.
const NAVIGATION_SRC = `core/navigation/src/commonMain/kotlin/${PKG}/core/navigation`;
const DEEP_LINK_HANDLER = `${NAVIGATION_SRC}/DeepLinkHandler.kt`;
const DEEP_LINKS = `${SHARED_SRC}/DeepLinks.kt`;
const USER_DEEP_LINK = `feature/home/presentation/src/commonMain/kotlin/${PKG}/feature/home/presentation/navigation/UserDeepLink.kt`;
const SETTINGS_DEEP_LINK = `feature/onboarding/presentation/src/commonMain/kotlin/${PKG}/feature/onboarding/presentation/navigation/SettingsDeepLink.kt`;
const SAMPLE_DEEP_LINK = `feature/sample/presentation/src/commonMain/kotlin/${PKG}/feature/sample/presentation/navigation/SampleDeepLink.kt`;
const ORDERS_DEEP_LINK = `feature/orders/presentation/src/commonMain/kotlin/${PKG}/feature/orders/presentation/navigation/OrdersDeepLink.kt`;
const DEEP_LINK_FILES = {
    [DEEP_LINK_HANDLER]: [
        `package ${NEW_PACKAGE}.core.navigation`,
        '',
        '@Single',
        'class DeepLinkHandler(private val navigationManager: NavigationManager)',
        ''
    ].join('\n'),
    [DEEP_LINKS]: [
        '@file:Suppress("Filename")',
        '',
        `package ${NEW_PACKAGE}`,
        '',
        `import ${NEW_PACKAGE}.core.navigation.DeepLinkHandler`,
        'import org.koin.mp.KoinPlatform.getKoin',
        '',
        'fun handleDeepLink(uri: String): Boolean = getKoin().get<DeepLinkHandler>().handle(uri)',
        ''
    ].join('\n'),
    [USER_DEEP_LINK]: [
        `package ${NEW_PACKAGE}.feature.home.presentation.navigation`,
        '',
        '@Single(binds = [DeepLinkRoute::class])',
        '@Named("deeplink.user")',
        'internal class UserDeepLink : DeepLinkRoute {',
        '    override val pattern: String = "user/{username}"',
        '}',
        ''
    ].join('\n'),
    [SETTINGS_DEEP_LINK]: [
        `package ${NEW_PACKAGE}.feature.onboarding.presentation.navigation`,
        '',
        '@Single(binds = [DeepLinkRoute::class])',
        '@Named("deeplink.settings")',
        'internal class SettingsDeepLink : DeepLinkRoute {',
        '    override val pattern: String = "settings"',
        '}',
        ''
    ].join('\n'),
    [SAMPLE_DEEP_LINK]: [
        `package ${NEW_PACKAGE}.feature.sample.presentation.navigation`,
        '',
        `import ${NEW_PACKAGE}.core.navigation.DeepLinkRoute`,
        `import ${NEW_PACKAGE}.core.navigation.NavigationCommand`,
        `import ${NEW_PACKAGE}.feature.sample.contract.SampleDestination`,
        'import org.koin.core.annotation.Named',
        'import org.koin.core.annotation.Single',
        '',
        '// <scheme>://sample opens this module. A generated module gets its own name as the path; add a',
        '// "{id}" segment and read it from arguments to open one item.',
        '@Single(binds = [DeepLinkRoute::class])',
        '@Named("SampleDeepLink")',
        'internal class SampleDeepLink : DeepLinkRoute {',
        '    override val pattern: String = "sample"',
        '',
        '    override fun destination(arguments: Map<String, String>): NavigationCommand.Destination = SampleDestination',
        '}',
        ''
    ].join('\n')
};

async function seedDeepLinks(dir) {
    for (const [rel, content] of Object.entries(DEEP_LINK_FILES)) await fs.outputFile(path.join(dir, rel), content);
}

async function listFilesUnder(root) {
    const out = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) out.push(...await listFilesUnder(full));
        else out.push(full);
    }
    return out;
}

test('deep links, blank without custom modules: feature/ and both showcase routes go, the handler and handleDeepLink stay', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedDeepLinks(dir);
        await cloneFeatureModules(dir, []);
        await processBlankApp(dir, NEW_PACKAGE, [], EVERY_FLAG_OFF);

        assert.equal(await exists(dir, 'feature'), false);
        assert.equal(await exists(dir, USER_DEEP_LINK), false);
        assert.equal(await exists(dir, SETTINGS_DEEP_LINK), false);
        assert.equal(await read(dir, DEEP_LINK_HANDLER), DEEP_LINK_FILES[DEEP_LINK_HANDLER]);
        assert.equal(await read(dir, DEEP_LINKS), DEEP_LINK_FILES[DEEP_LINKS]);
    });
});

test('deep links, blank with features [orders]: OrdersDeepLink has the path "orders" and its own Koin name; no SampleDeepLink anywhere', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });
    await withTempDir(async (dir) => {
        await seed(dir);
        await seedDeepLinks(dir);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            const src = `feature/sample/${layer}/src/commonMain/kotlin/${PKG}/feature/sample/${layer}`;
            await fs.outputFile(path.join(dir, `feature/sample/${layer}/build.gradle.kts`), 'plugins {\n}\n');
            await fs.outputFile(path.join(dir, src, 'di', `Sample${layer.charAt(0).toUpperCase()}${layer.slice(1)}Module.kt`),
                `package ${NEW_PACKAGE}.feature.sample.${layer}.di\n`);
        }
        // The blank overlay of the template: applyBlankShell drops feature/home and feature/onboarding
        await fs.outputFile(path.join(dir, `blank/${SHARED_SRC}/MainScreen.kt`), `package ${NEW_PACKAGE}\n`);
        await fs.outputFile(path.join(dir, `blank/layers/multilang/${SHARED_SRC}/MainScreen.kt`), `package ${NEW_PACKAGE}\n`);
        await applyBlankShell(dir, 'blank', config());
        await cloneFeatureModules(dir, ['orders']);
        await processBlankApp(dir, NEW_PACKAGE, ['orders'], config());
        await wireFeatureModules(dir, NEW_PACKAGE, ['orders']);

        const route = await read(dir, ORDERS_DEEP_LINK);
        assert.ok(route.includes('    override val pattern: String = "orders"'), route);
        assert.ok(route.split('\n').includes('@Named("OrdersDeepLink")'), route);
        assert.ok(route.includes('internal class OrdersDeepLink : DeepLinkRoute {'), route);
        assert.ok(route.includes(`package ${NEW_PACKAGE}.feature.orders.presentation.navigation`), route);
        assert.equal(await exists(dir, 'feature/sample'), false);
        assert.equal(await exists(dir, USER_DEEP_LINK), false);
        assert.equal(await exists(dir, SETTINGS_DEEP_LINK), false);
        assert.ok(await exists(dir, DEEP_LINK_HANDLER));
        assert.ok(await exists(dir, DEEP_LINKS));
        for (const file of await listFilesUnder(dir)) {
            const rel = path.relative(dir, file);
            assert.ok(!rel.includes('SampleDeepLink'), rel);
            assert.ok(!(await fs.readFile(file, 'utf8')).includes('SampleDeepLink'), `${rel} mentions SampleDeepLink`);
        }
    });
});
