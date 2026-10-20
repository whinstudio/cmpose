const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const {
    verifyGeneratedProject, verifyBackend, checkServerImage, resolveServerImageCheck, SERVER_IMAGE_ENV
} = require('../src/generationVerifier');
const { setLogger } = require('../src/log');

const INPUT = { projectName: 'Demo', appName: 'Demo App', packageName: 'dev.cmpose.demo', templateType: 'blank', features: [] };
const PKG = 'dev/cmpose/demo';

async function withProject(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-verifier-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// A minimal but complete generated project for INPUT
async function seedValid(dir, input = INPUT, modules = []) {
    const pkg = input.packageName.replace(/\./g, '/');
    const includes = modules.map((m) => ['contract', 'data', 'domain', 'presentation'].map((l) => `include(":feature:${m}:${l}")`).join('\n')).join('\n');
    const files = {
        'settings.gradle.kts': `rootProject.name = "${input.projectName}"\ninclude(":shared")\n${includes}\n`,
        'gradle/libs.versions.toml': '[versions]\nkotlin = "2.3.21"\n',
        'androidApp/build.gradle.kts': 'plugins { }\n',
        'shared/build.gradle.kts': modules.map((m) => `implementation(projects.feature.${m}.presentation)`).join('\n') + '\n',
        'iosApp/Configuration/Config.xcconfig': `PRODUCT_BUNDLE_IDENTIFIER=${input.packageName}\n`,
        [`shared/src/commonMain/kotlin/${pkg}/MainScreen.kt`]: `package ${input.packageName}\n`,
        [`shared/src/commonMain/kotlin/${pkg}/di/initKoin.kt`]: modules.map((m) => ['Presentation', 'Data', 'Domain'].map((l) => `add(${m[0].toUpperCase()}${m.slice(1)}${l}Module().module)`).join('\n')).join('\n') + '\n'
    };
    for (const m of modules) {
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            files[`feature/${m}/${layer}/build.gradle.kts`] = 'plugins { }\n';
        }
    }
    for (const [rel, content] of Object.entries(files)) {
        await fs.outputFile(path.join(dir, rel), content);
    }
}

test('a complete project passes', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await verifyGeneratedProject(dir, INPUT);
    });
});

test('stale template identifiers are rejected, naming file and identifier', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'shared/src/commonMain/kotlin', PKG, 'Leak.kt'), 'import com.kturker.multiplatform.core.Foo\n');
        await fs.appendFile(path.join(dir, 'iosApp/Configuration/Config.xcconfig'), 'X=com.kturker.composemultiplatform.ComposeMultiplatform\n');
        await fs.writeFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "Multiplatform"\n');
        await assert.rejects(verifyGeneratedProject(dir, INPUT), (err) => {
            assert.match(err.message, /Leak\.kt: com\.kturker\.multiplatform/);
            assert.match(err.message, /Config\.xcconfig: com\.kturker\.composemultiplatform/);
            assert.match(err.message, /settings\.gradle\.kts: rootProject\.name = "Multiplatform"/);
            return true;
        });
    });
});

test('a hard-coded Apple team is rejected', async () => {
    for (const line of ['DEVELOPMENT_TEAM = ABCDE12345;', 'DEVELOPMENT_TEAM = "ABCDE12345";']) {
        await withProject(async (dir) => {
            await seedValid(dir);
            await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), `\t\t\t\t${line}\n`);
            await assert.rejects(verifyGeneratedProject(dir, INPUT), /project\.pbxproj: hard-coded DEVELOPMENT_TEAM/);
        });
    }
});

test('an empty Apple team passes', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), '\t\t\t\tDEVELOPMENT_TEAM = "";\n');
        await verifyGeneratedProject(dir, INPUT);
    });
});

test('an Apple team taken from TEAM_ID passes', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), '\t\t\t\tDEVELOPMENT_TEAM = "$(TEAM_ID)";\n');
        await verifyGeneratedProject(dir, INPUT);
    });
});

test('the Apple team rule only looks at Xcode project files, not user-supplied text such as detekt.yml', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'detekt/detekt.yml'), '# DEVELOPMENT_TEAM = ABCDE12345\n');
        await verifyGeneratedProject(dir, INPUT);
    });
});

test('an old template package directory is rejected', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'shared/src/commonMain/kotlin/com/kturker/multiplatform/Old.kt'), 'package x\n');
        await assert.rejects(verifyGeneratedProject(dir, INPUT), /shared\/src\/commonMain\/kotlin\/com\/kturker\/multiplatform: old template package directory/);
    });
});

test('valid user input that looks like a template identifier is not rejected', async () => {
    const cases = [
        { ...INPUT, appName: 'com.kturker.multiplatform' },
        { ...INPUT, projectName: 'Multiplatform' },
        { ...INPUT, packageName: 'com.kturker.composemultiplatform.app' },
        { ...INPUT, packageName: 'com.kturker.multiplatformx' },
        // ProjectValidator only reserves packages that START WITH com.kturker.multiplatform -
        // these carry the old package name as a LATER segment and are valid user input whose
        // sources land under .../kotlin/dev/com/kturker/multiplatform/...
        { ...INPUT, packageName: 'dev.com.kturker.multiplatform' },
        { ...INPUT, packageName: 'app.com.kturker.multiplatform.core' }
    ];
    for (const input of cases) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            // The user's own values land in these files, as the real pipeline writes them
            await fs.outputFile(path.join(dir, 'androidApp/src/main/res/values/strings.xml'), `<string name="app_name">${input.appName}</string>\n`);
            await verifyGeneratedProject(dir, input);
        });
    }
});

test('a real leftover is still caught for a user package that contains the old package as a later segment', async () => {
    // The old-package-directory check is anchored to a source root (kotlin/ or java/), so
    // it must still catch a genuine leftover of the template's own root package even when the
    // user's chosen package (dev.com.kturker.multiplatform) legitimately contains the same segments.
    const input = { ...INPUT, packageName: 'dev.com.kturker.multiplatform' };
    await withProject(async (dir) => {
        await seedValid(dir, input);
        await fs.outputFile(path.join(dir, 'shared/src/commonMain/kotlin/com/kturker/multiplatform/Old.kt'), 'package x\n');
        await assert.rejects(verifyGeneratedProject(dir, input), /shared\/src\/commonMain\/kotlin\/com\/kturker\/multiplatform: old template package directory/);
    });
});

test('a contrived-but-valid package + module combination that spells out the old identifier as a substring is not rejected', async () => {
    // packageName "x.com.kturker" + module "multiplatform" makes the generator emit the literal
    // string "x.com.kturker.multiplatform.presentation" (feature package) in real source files.
    // Without a lookbehind, the STALE_IDENTIFIER regex matches "com.kturker.multiplatform" as a
    // substring of that (preceded by "x.", not by a package/identifier boundary) and rejects a
    // perfectly valid generated project.
    const input = { ...INPUT, packageName: 'x.com.kturker', features: ['multiplatform'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['multiplatform']);
        await fs.outputFile(
            path.join(dir, 'feature/multiplatform/presentation/src/commonMain/kotlin/Marker.kt'),
            'package x.com.kturker.multiplatform.presentation\n'
        );
        await verifyGeneratedProject(dir, input);
    });
});

test('a contrived-but-valid package embedding "composemultiplatform" as a substring is not rejected', async () => {
    const input = { ...INPUT, packageName: 'x.com.kturker', features: ['composemultiplatform'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['composemultiplatform']);
        await fs.outputFile(
            path.join(dir, 'feature/composemultiplatform/presentation/src/commonMain/kotlin/Marker.kt'),
            'package x.com.kturker.composemultiplatform.presentation\n'
        );
        await verifyGeneratedProject(dir, input);
    });
});

test('a user package literally containing "kotlin" as a segment ahead of the old package name is not rejected as an old package directory', async () => {
    // The source-root anchor must require kotlin/ or java/ to be the actual source-set root
    // (immediately under src/<sourceSet>/), not just any directory named "kotlin" or "java"
    // appearing deeper in the path as a package segment.
    const input = { ...INPUT, packageName: 'dev.kotlin.com.kturker.multiplatform' };
    await withProject(async (dir) => {
        await seedValid(dir, input);
        await fs.outputFile(
            path.join(dir, 'shared/src/commonMain/kotlin/dev/kotlin/com/kturker/multiplatform/Marker.kt'),
            'package dev.kotlin.com.kturker.multiplatform\n'
        );
        await verifyGeneratedProject(dir, input);
    });
});

test('the error message is capped at 20 problems, with a summary count of the rest', async () => {
    const input = { ...INPUT, features: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] };
    await withProject(async (dir) => {
        await seedValid(dir); // none of the 6 modules are wired -> well over 20 problems
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            const lines = err.message.split('\n  ').slice(1); // drop the header line
            assert.equal(lines.length, 21, `expected 20 problems + 1 summary line, got:\n${err.message}`);
            assert.match(lines[20], /^…and \d+ more$/);
            return true;
        });
    });
});

test('missing key files are rejected', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.remove(path.join(dir, 'gradle/libs.versions.toml'));
        await fs.remove(path.join(dir, 'shared/src/commonMain/kotlin', PKG, 'MainScreen.kt'));
        await assert.rejects(verifyGeneratedProject(dir, INPUT), (err) => {
            assert.match(err.message, /gradle\/libs\.versions\.toml: missing/);
            assert.match(err.message, /MainScreen\.kt: missing/);
            return true;
        });
    });
});

test('a blank module that is not wired is rejected (layer, settings, shared, initKoin)', async () => {
    const input = { ...INPUT, features: ['profile', 'cart'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['profile', 'cart']);
        await verifyGeneratedProject(dir, input);

        await fs.remove(path.join(dir, 'feature/cart/data/build.gradle.kts'));
        await fs.writeFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "Demo"\ninclude(":feature:profile:presentation")\n');
        await fs.writeFile(path.join(dir, 'shared/build.gradle.kts'), 'implementation(projects.feature.profile.presentation)\n');
        await fs.writeFile(path.join(dir, 'shared/src/commonMain/kotlin', PKG, 'di/initKoin.kt'), '// no feature modules registered\n');
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.match(err.message, /feature\/cart\/data\/build\.gradle\.kts: missing/);
            assert.match(err.message, /settings\.gradle\.kts: :feature:cart not included/);
            assert.match(err.message, /shared\/build\.gradle\.kts: feature cart not a dependency/);
            assert.match(err.message, /initKoin\.kt: ProfilePresentationModule not registered/);
            assert.match(err.message, /initKoin\.kt: CartDomainModule not registered/);
            return true;
        });
    });
});

test('every blank module needs all three Koin registrations, not only the first', async () => {
    const input = { ...INPUT, features: ['profile', 'cart'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['profile', 'cart']);
        const initKoin = path.join(dir, 'shared/src/commonMain/kotlin', PKG, 'di/initKoin.kt');
        const full = await fs.readFile(initKoin, 'utf8');
        await fs.writeFile(initKoin, full.replace('add(CartDataModule().module)\n', ''));
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.match(err.message, /initKoin\.kt: CartDataModule not registered/);
            assert.doesNotMatch(err.message, /ProfileDataModule|CartPresentationModule|CartDomainModule/);
            return true;
        });
    });
});

test('showcase modules need all three Koin registrations too', async () => {
    const input = { ...INPUT, templateType: 'showcase', features: ['profile'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['profile']);
        await verifyGeneratedProject(dir, input);
        await fs.writeFile(path.join(dir, 'shared/src/commonMain/kotlin', PKG, 'di/initKoin.kt'), 'add(ProfilePresentationModule().module)\n');
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.match(err.message, /initKoin\.kt: ProfileDataModule not registered/);
            assert.match(err.message, /initKoin\.kt: ProfileDomainModule not registered/);
            return true;
        });
    });
});

test('a blank/ shell overlay left in the project is rejected', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'blank/shared/MainScreen.kt'), 'x\n');
        await assert.rejects(verifyGeneratedProject(dir, INPUT), /blank\/: template shell overlay left in the project/);
    });
});

test('a feature/sample leftover is rejected unless "sample" was requested', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, 'feature/sample/presentation/build.gradle.kts'), 'plugins { }\n');
        await fs.appendFile(path.join(dir, 'settings.gradle.kts'), 'include(":feature:sample:presentation")\n');
        await assert.rejects(verifyGeneratedProject(dir, INPUT), (err) => {
            assert.match(err.message, /feature\/sample: template sample module left in the project/);
            assert.match(err.message, /settings\.gradle\.kts: :feature:sample still included/);
            return true;
        });
    });
    const input = { ...INPUT, features: ['sample'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['sample']);
        await verifyGeneratedProject(dir, input);
    });
});

test('a clone that keeps a Sample-prefixed identifier is rejected, a module named samples is not', async () => {
    const input = { ...INPUT, features: ['profile'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['profile']);
        await fs.outputFile(path.join(dir, 'feature/profile/presentation/src/commonMain/kotlin/ui/ProfileScreen.kt'), 'class SampleViewModel\n');
        await assert.rejects(verifyGeneratedProject(dir, input), /feature\/profile\/presentation\/src\/commonMain\/kotlin\/ui\/ProfileScreen\.kt: sample module name left in a clone/);
    });
    const samples = { ...INPUT, features: ['samples'] };
    await withProject(async (dir) => {
        await seedValid(dir, samples, ['samples']);
        await fs.outputFile(path.join(dir, 'feature/samples/presentation/src/commonMain/kotlin/ui/SamplesViewModel.kt'), 'class SamplesViewModel\n');
        await verifyGeneratedProject(dir, samples);
    });
});

// Blank's theme and language wiring, theme leftovers, template tests
const BLANK_T1 = { ...INPUT, featuresConfig: { theming: true, multiLang: false } };
const BLANK_L1 = { ...INPUT, featuresConfig: { theming: false, multiLang: true } };
const BLANK_T0 = { ...INPUT, featuresConfig: { theming: false, multiLang: false } };
const SHARED = `shared/src/commonMain/kotlin/${PKG}`;
const KT_THEME = `core/designsystem/src/commonMain/kotlin/${PKG}/core/designsystem/theme/KtTheme.kt`;
const THEMED_APP_THEME = 'val m: DarkModeManager = koinInject()\nKtTheme(darkTheme = dark, content = content)\n';

test('blank + Theming: AppTheme applies the saved choice through KtTheme, and KtTheme.kt exists (B)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, SHARED, 'AppTheme.kt'), THEMED_APP_THEME);
        await fs.outputFile(path.join(dir, KT_THEME), 'fun KtTheme() = Unit\n');
        await verifyGeneratedProject(dir, BLANK_T1);

        await fs.outputFile(path.join(dir, SHARED, 'AppTheme.kt'), 'MaterialTheme(content = content)\n');
        await assert.rejects(verifyGeneratedProject(dir, BLANK_T1), /AppTheme\.kt: does not apply the saved theme through KtTheme/);

        await fs.outputFile(path.join(dir, SHARED, 'AppTheme.kt'), THEMED_APP_THEME);
        await fs.remove(path.join(dir, KT_THEME));
        await assert.rejects(verifyGeneratedProject(dir, BLANK_T1), /theme\/KtTheme\.kt: missing/);
    });
});

test('blank without Theming: an import of a removed theme package is rejected; another .theme. package is not (B)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, SHARED, 'Feature.kt'), 'import dev.cmpose.demo.feature.theme.presentation.ThemeScreen\n');
        await verifyGeneratedProject(dir, BLANK_T0);

        await fs.outputFile(path.join(dir, SHARED, 'Leak.kt'), 'import dev.cmpose.demo.core.designsystem.theme.LocalColorsPalette\n');
        await fs.outputFile(path.join(dir, SHARED, 'Leak2.kt'), 'import dev.cmpose.demo.core.database.theme.DarkModeManager\n');
        await assert.rejects(verifyGeneratedProject(dir, BLANK_T0), (err) => {
            assert.match(err.message, /Leak\.kt: imports a theme package that Theming off removes/);
            assert.match(err.message, /Leak2\.kt: imports a theme package that Theming off removes/);
            return true;
        });
    });
});

test('blank + Multi-Language: MainScreen provides LocalStringResources and calls setSystemLanguage() (B)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, SHARED, 'MainScreen.kt'),
            'package dev.cmpose.demo\nCompositionLocalProvider(LocalStringResources provides resources) { }\nlanguageManager.setSystemLanguage()\n');
        await verifyGeneratedProject(dir, BLANK_L1);

        await fs.outputFile(path.join(dir, SHARED, 'MainScreen.kt'), 'package dev.cmpose.demo\n');
        await assert.rejects(verifyGeneratedProject(dir, BLANK_L1), /MainScreen\.kt: does not provide LocalStringResources or call setSystemLanguage\(\)/);
    });
});

test('blank carries no template tests except the Android-host Koin graph check; showcase keeps them (B)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await fs.outputFile(path.join(dir, `shared/src/androidHostTest/kotlin/${PKG}/di/KoinGraphTest.kt`), 'class KoinGraphTest\n');
        await verifyGeneratedProject(dir, BLANK_T0);

        await fs.outputFile(path.join(dir, `core/database/src/commonTest/kotlin/${PKG}/core/database/theme/ThemeModeTest.kt`), 'class ThemeModeTest\n');
        await assert.rejects(verifyGeneratedProject(dir, BLANK_T0), /core\/database\/src\/commonTest: template tests in a blank project/);

        await verifyGeneratedProject(dir, { ...INPUT, templateType: 'showcase', featuresConfig: null });
    });
});

// Monetization (spec §10): blank keeps exactly the modules its purchases/ads flags ask for
const MONETIZATION = (purchases, ads) => ({ ...INPUT, featuresConfig: { theming: false, multiLang: false, purchases, ads } });
const INIT_KOIN = `shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt`;
const ANDROID_MANIFEST = 'androidApp/src/main/AndroidManifest.xml';
const IOS_APP = 'iosApp/iosApp/iOSApp.swift';
const ADS_DIR = `feature/monetization/presentation/src/commonMain/kotlin/${PKG}/feature/monetization/presentation/ads`;

async function seedMonetization(dir, purchases, ads) {
    const koin = [];
    if (purchases) {
        await fs.outputFile(path.join(dir, 'core/purchases/build.gradle.kts'), 'plugins { }\n');
        koin.push('add(PurchasesModule().module)');
    }
    if (ads) {
        await fs.outputFile(path.join(dir, 'core/ads/build.gradle.kts'), 'plugins { }\n');
        await fs.outputFile(path.join(dir, 'iosApp/iosApp/AdsBridge.swift'), 'import GoogleMobileAds\n');
        await fs.outputFile(path.join(dir, 'iosApp/iosApp/Info.plist'), '<key>GADApplicationIdentifier</key>\n');
        await fs.outputFile(path.join(dir, ANDROID_MANIFEST),
            '<meta-data\n    android:name="com.google.android.gms.ads.APPLICATION_ID"\n    android:value="ca-app-pub-3940256099942544~3347511713" />\n');
        await fs.outputFile(path.join(dir, IOS_APP), 'AdsBridgeRegistrationKt.registerAdsBridge(bridge: AdsBridge())\n');
        await fs.appendFile(path.join(dir, 'shared/build.gradle.kts'), 'export(projects.core.ads)\n');
        await fs.outputFile(path.join(dir, ADS_DIR, purchases ? 'PremiumAdFreeSource.kt' : 'NoPremiumAdFreeSource.kt'), 'class X\n');
    }
    if (purchases || ads) {
        await fs.outputFile(path.join(dir, 'feature/monetization/presentation/build.gradle.kts'), 'plugins { }\n');
        koin.push('add(MonetizationPresentationModule().module)');
    }
    await fs.appendFile(path.join(dir, INIT_KOIN), koin.join('\n') + '\n');
}

for (const [purchases, ads] of [[false, false], [true, false], [false, true], [true, true]]) {
    test(`blank monetization purchases=${purchases} ads=${ads}: a matching project passes (monetization)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir);
            await seedMonetization(dir, purchases, ads);
            await verifyGeneratedProject(dir, MONETIZATION(purchases, ads));
        });
    });
}

test('blank monetization: a module missing although its flag is on is rejected (monetization)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, true, true);
        await fs.remove(path.join(dir, 'core/purchases'));
        await fs.remove(path.join(dir, 'core/ads'));
        await fs.remove(path.join(dir, 'iosApp/iosApp/AdsBridge.swift'));
        await fs.outputFile(path.join(dir, 'iosApp/iosApp/Info.plist'), '<plist/>\n');
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(true, true)), (err) => {
            assert.match(err.message, /core\/purchases: missing although purchases is on/);
            assert.match(err.message, /core\/ads: missing although ads is on/);
            assert.match(err.message, /iosApp\/iosApp\/AdsBridge\.swift: missing although ads is on/);
            assert.match(err.message, /iosApp\/iosApp\/Info\.plist: no GADApplicationIdentifier although ads is on/);
            return true;
        });
    });

    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, true, false);
        await fs.remove(path.join(dir, 'feature/monetization'));
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(true, false)),
            /feature\/monetization\/presentation: missing although purchases or ads is on/);
    });
});

test('blank monetization: ads on without the manifest app ID, the bridge registration or the framework export is rejected (monetization)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, false, true);
        await fs.outputFile(path.join(dir, ANDROID_MANIFEST), '<manifest>\n    <!-- com.google.android.gms.ads.APPLICATION_ID -->\n</manifest>\n');
        await fs.outputFile(path.join(dir, IOS_APP), '// registerAdsBridge\nstruct iOSApp {}\n');
        await fs.writeFile(path.join(dir, 'shared/build.gradle.kts'), 'api(projects.core.ads)\n// export(projects.core.ads)\n');
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(false, true)), (err) => {
            assert.match(err.message, /androidApp\/src\/main\/AndroidManifest\.xml: no com\.google\.android\.gms\.ads\.APPLICATION_ID although ads is on/);
            assert.match(err.message, /iosApp\/iosApp\/iOSApp\.swift: registerAdsBridge not called although ads is on/);
            assert.match(err.message, /shared\/build\.gradle\.kts: export\(projects\.core\.ads\) missing although ads is on/);
            return true;
        });
    });
});

test('blank monetization: a module present although its flag is off is rejected (monetization)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, true, true);
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(false, false)), (err) => {
            assert.match(err.message, /core\/purchases: present although purchases is off/);
            assert.match(err.message, /core\/ads: present although ads is off/);
            assert.match(err.message, /feature\/monetization: present although purchases and ads are off/);
            return true;
        });
    });
});

test('blank monetization: the AdFreeSource variant follows purchases (monetization)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, false, true);
        await fs.outputFile(path.join(dir, ADS_DIR, 'PremiumAdFreeSource.kt'), 'class X\n');
        await fs.remove(path.join(dir, ADS_DIR, 'NoPremiumAdFreeSource.kt'));
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(false, true)), (err) => {
            assert.match(err.message, /ads\/NoPremiumAdFreeSource\.kt: missing although purchases is off/);
            assert.match(err.message, /ads\/PremiumAdFreeSource\.kt: present although purchases is off/);
            return true;
        });
    });

    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, true, true);
        await fs.outputFile(path.join(dir, ADS_DIR, 'NoPremiumAdFreeSource.kt'), 'class X\n');
        await fs.remove(path.join(dir, ADS_DIR, 'PremiumAdFreeSource.kt'));
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(true, true)), (err) => {
            assert.match(err.message, /ads\/PremiumAdFreeSource\.kt: missing although purchases is on/);
            assert.match(err.message, /ads\/NoPremiumAdFreeSource\.kt: present although purchases is on/);
            return true;
        });
    });
});

test('blank monetization: a missing Koin module line is rejected (monetization)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, true, true);
        await fs.outputFile(path.join(dir, INIT_KOIN), '\n');
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(true, true)), (err) => {
            assert.match(err.message, /di\/initKoin\.kt: PurchasesModule not registered/);
            assert.match(err.message, /di\/initKoin\.kt: MonetizationPresentationModule not registered/);
            return true;
        });
    });
});

// Room: blank keeps core/room (Notes only) and feature/notes when the flag is on; showcase keeps
// core/room with the favorites entity and never the Notes demo (room)
const ROOM_INPUT = (room) => ({ ...INPUT, featuresConfig: { theming: false, multiLang: false, room } });
const SHOWCASE_INPUT = { ...INPUT, templateType: 'showcase' };
const ROOM_PKG_DIR = `core/room/src/commonMain/kotlin/${PKG}/core/room`;
const ROOM_SCHEMA = `core/room/schemas/${INPUT.packageName}.core.room.AppDatabase/1.json`;

async function seedRoom(dir, { entity = 'NoteEntity', blank = true, schema = ROOM_SCHEMA } = {}) {
    await fs.outputFile(path.join(dir, 'core/room/build.gradle.kts'), 'plugins { }\n');
    await fs.outputFile(path.join(dir, ROOM_PKG_DIR, 'AppDatabase.kt'), `@Database(\n    entities = [${entity}::class],\n    version = 1\n)\nabstract class AppDatabase\n`);
    await fs.outputFile(path.join(dir, schema), '{}\n');
    await fs.appendFile(path.join(dir, INIT_KOIN), 'add(RoomModule().module)\n');
    if (blank) {
        await fs.outputFile(path.join(dir, 'feature/notes/presentation/build.gradle.kts'), 'plugins { }\n');
        await fs.appendFile(path.join(dir, INIT_KOIN), 'add(NotesPresentationModule().module)\n');
    }
}

test('blank room=true: a matching project passes (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedRoom(dir);
        await verifyGeneratedProject(dir, ROOM_INPUT(true));
    });
});

test('blank room=true: every missing piece is rejected with a short message (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await assert.rejects(verifyGeneratedProject(dir, ROOM_INPUT(true)), (err) => {
            assert.match(err.message, /core\/room: missing although room is on/);
            assert.match(err.message, /initKoin\.kt: RoomModule not registered/);
            assert.match(err.message, /initKoin\.kt: NotesPresentationModule not registered/);
            assert.match(err.message, /feature\/notes\/presentation: missing although room is on/);
            assert.match(err.message, /AppDatabase\.kt: missing/);
            assert.match(err.message, /core\/room\/schemas\/dev\.cmpose\.demo\.core\.room\.AppDatabase\/1\.json: missing/);
            return true;
        });
    });
});

test('blank room=true: the entity list must be exactly NoteEntity; favorites must be gone (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedRoom(dir, { entity: 'FavoriteUserEntity' });
        await fs.outputFile(path.join(dir, ROOM_PKG_DIR, 'favorites/FavoriteUserDao.kt'), 'interface X\n');
        await assert.rejects(verifyGeneratedProject(dir, ROOM_INPUT(true)), (err) => {
            assert.match(err.message, /AppDatabase\.kt: entities are \[FavoriteUserEntity\], expected \[NoteEntity\]/);
            assert.match(err.message, /favorites: present in a blank project/);
            return true;
        });
    });
});

test('blank room=false: core/room or feature/notes left behind is rejected (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedRoom(dir);
        await assert.rejects(verifyGeneratedProject(dir, ROOM_INPUT(false)), (err) => {
            assert.match(err.message, /core\/room: present although room is off/);
            assert.match(err.message, /feature\/notes: present although room is off/);
            return true;
        });
    });
});

test('blank room=false without Room passes (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await verifyGeneratedProject(dir, ROOM_INPUT(false));
    });
});

test('showcase with core/room: favorites entity, no notes package, schema in the new package (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await seedRoom(dir, { entity: 'FavoriteUserEntity', blank: false });
        await verifyGeneratedProject(dir, SHOWCASE_INPUT);
    });
});

test('showcase with core/room: Notes leftovers, wrong entity and a missing schema are rejected (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await seedRoom(dir, { entity: 'NoteEntity', blank: true, schema: 'core/room/schemas/other/1.json' });
        await fs.outputFile(path.join(dir, ROOM_PKG_DIR, 'notes/NoteDao.kt'), 'interface X\n');
        await assert.rejects(verifyGeneratedProject(dir, SHOWCASE_INPUT), (err) => {
            assert.match(err.message, /feature\/notes: present in a showcase project/);
            assert.match(err.message, /AppDatabase\.kt: entities are \[NoteEntity\], expected \[FavoriteUserEntity\]/);
            assert.match(err.message, /core\/room\/.*\/notes: present in a showcase project/);
            assert.match(err.message, /1\.json: missing/);
            return true;
        });
    });
});

test('showcase without core/room (pre-Room template) is not checked for Room (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await verifyGeneratedProject(dir, SHOWCASE_INPUT);
    });
});

test('showcase without core/room still rejects a feature/notes leftover (room)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await fs.outputFile(path.join(dir, 'feature/notes/presentation/build.gradle.kts'), 'plugins { }\n');
        await assert.rejects(verifyGeneratedProject(dir, SHOWCASE_INPUT), /feature\/notes: present in a showcase project/);
    });
});

test('a schema directory still under the template package is rejected for both templates (room)', async () => {
    for (const [input, room] of [[ROOM_INPUT(true), true], [SHOWCASE_INPUT, false]]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedRoom(dir, { entity: room ? 'NoteEntity' : 'FavoriteUserEntity', blank: room });
            await fs.outputFile(path.join(dir, 'core/room/schemas/com.kturker.multiplatform.core.room.AppDatabase/1.json'), '{}\n');
            await assert.rejects(verifyGeneratedProject(dir, input), /stale Room schema directory/);
        });
    }
});

// Kermit: a template whose catalog has the kermit key keeps core/logging, wired, in every project
const LOGGING_RULES = 'build-logic/src/main/kotlin/convention/configureKotlinMultiplatform.kt';

async function seedLogging(dir, input = INPUT) {
    const pkg = input.packageName.replace(/\./g, '/');
    await fs.appendFile(path.join(dir, 'gradle/libs.versions.toml'), 'kermit = "2.2.0"\n');
    await fs.appendFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:logging")\n');
    await fs.appendFile(path.join(dir, `shared/src/commonMain/kotlin/${pkg}/di/initKoin.kt`), 'configureLogging(isDebug)\n');
    await fs.outputFile(path.join(dir, 'core/logging/build.gradle.kts'), 'plugins { }\n');
    await fs.outputFile(path.join(dir, LOGGING_RULES), 'if (path != ":core:logging") implementation(project(":core:logging"))\n');
    await fs.outputFile(
        path.join(dir, `core/logging/src/commonMain/kotlin/${pkg}/core/logging/LoggingConfig.kt`),
        `internal const val LOG_TAG_PREFIX = "${input.projectName}"\n`
    );
}

for (const input of [INPUT, SHOWCASE_INPUT]) {
    test(`${input.templateType} with kermit: a wired core/logging passes (kermit)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedLogging(dir, input);
            await verifyGeneratedProject(dir, input);
        });
    });

    test(`${input.templateType} with kermit: every missing piece is rejected (kermit)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedLogging(dir, input);
            await fs.remove(path.join(dir, 'core/logging/build.gradle.kts'));
            await fs.writeFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${input.projectName}"\n`);
            await fs.writeFile(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt`), 'startKoin { }\n');
            await fs.writeFile(path.join(dir, LOGGING_RULES), 'implementation(libs.kotlinx.coroutines.core)\n');
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.match(err.message, /core\/logging: missing \(every project keeps it\)/);
                assert.match(err.message, /settings\.gradle\.kts: :core:logging not included/);
                assert.ok(err.message.includes(`shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt: configureLogging not called`));
                assert.match(err.message, /configureKotlinMultiplatform\.kt: core:logging not wired/);
                return true;
            });
        });
    });
}

test('with kermit: println( in Kotlin code is rejected, in comments and KDoc it is not (kermit)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedLogging(dir);
        const comments = `shared/src/commonMain/kotlin/${PKG}/Comments.kt`;
        await fs.outputFile(path.join(dir, comments), '// println("x")\n/**\n * println(it)\n */\n/* println(1) */\nval logPrintln = 1\n');
        await verifyGeneratedProject(dir, INPUT);

        const leak = `core/network/src/commonMain/kotlin/${PKG}/core/network/Leak.kt`;
        await fs.outputFile(path.join(dir, leak), 'fun f() {\n    println("token")\n}\n');
        await assert.rejects(verifyGeneratedProject(dir, INPUT), (err) => {
            assert.ok(err.message.includes(`${leak}: println( (use the Kermit Logger)`));
            assert.ok(!err.message.includes('Comments.kt'));
            return true;
        });
    });
});

test('without kermit in the catalog (pre-Kermit template): no core/logging and println( raise no logging problem (kermit)', async () => {
    for (const input of [INPUT, SHOWCASE_INPUT]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/Old.kt`), 'fun f() = println("x")\n');
            await verifyGeneratedProject(dir, input);
        });
    }
});

test('a stale LOG_TAG_PREFIX is rejected unless the project is named Multiplatform (kermit)', async () => {
    const configRel = `core/logging/src/commonMain/kotlin/${PKG}/core/logging/LoggingConfig.kt`;
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedLogging(dir);
        await fs.writeFile(path.join(dir, configRel), 'internal const val LOG_TAG_PREFIX = "Multiplatform"\n');
        await assert.rejects(verifyGeneratedProject(dir, INPUT), /LoggingConfig\.kt: LOG_TAG_PREFIX = "Multiplatform"/);
    });
    const multiplatform = { ...INPUT, projectName: 'Multiplatform' };
    await withProject(async (dir) => {
        await seedValid(dir, multiplatform);
        await seedLogging(dir, multiplatform);
        await verifyGeneratedProject(dir, multiplatform);
    });
});

// Review: a template whose catalog has the play-review key keeps core/review, wired, in every project
const REVIEW_CONVENTION = 'build-logic/src/main/kotlin/convention/FeaturePresentationConventionPlugin.kt';
const MAIN_SCREEN = `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`;

async function seedReview(dir, input = INPUT) {
    const pkg = input.packageName.replace(/\./g, '/');
    await fs.appendFile(path.join(dir, 'gradle/libs.versions.toml'), 'play-review = { module = "com.google.android.play:review", version.ref = "playReview" }\n');
    await fs.appendFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:review")\n');
    await fs.appendFile(path.join(dir, `shared/src/commonMain/kotlin/${pkg}/di/initKoin.kt`), 'add(ReviewModule().module)\n');
    await fs.appendFile(path.join(dir, `shared/src/commonMain/kotlin/${pkg}/MainScreen.kt`), 'fun MainScreen() {\n    ReviewRequestEffect()\n}\n');
    await fs.outputFile(path.join(dir, 'core/review/build.gradle.kts'), 'plugins { }\n');
    await fs.outputFile(path.join(dir, REVIEW_CONVENTION), 'implementation(project(":core:review"))\n');
}

for (const input of [INPUT, SHOWCASE_INPUT]) {
    test(`${input.templateType} with play-review: a wired core/review passes (review)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedReview(dir, input);
            await verifyGeneratedProject(dir, input);
        });
    });

    test(`${input.templateType} with play-review: every missing piece is rejected (review)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedReview(dir, input);
            await fs.remove(path.join(dir, 'core/review/build.gradle.kts'));
            await fs.writeFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${input.projectName}"\n`);
            await fs.writeFile(path.join(dir, INIT_KOIN), 'startKoin { }\n');
            await fs.writeFile(path.join(dir, MAIN_SCREEN), 'fun MainScreen() {\n    // ReviewRequestEffect()\n}\n');
            await fs.writeFile(path.join(dir, REVIEW_CONVENTION), 'implementation(project(":core:designsystem"))\n');
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.match(err.message, /core\/review: missing \(every project keeps it\)/);
                assert.match(err.message, /settings\.gradle\.kts: :core:review not included/);
                assert.ok(err.message.includes(`${INIT_KOIN}: ReviewModule not registered`));
                assert.ok(err.message.includes(`${MAIN_SCREEN}: ReviewRequestEffect not called`));
                assert.ok(err.message.includes(`${REVIEW_CONVENTION}: core:review not wired`));
                return true;
            });
        });
    });
}

test('without play-review in the catalog (pre-Review template): no core/review raises no review problem (review)', async () => {
    for (const input of [INPUT, SHOWCASE_INPUT]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await verifyGeneratedProject(dir, input);
        });
    }
});

test('with play-review: ReviewPresentationModule alone does not count as ReviewModule (review)', async () => {
    const input = { ...INPUT, features: ['review'] };
    await withProject(async (dir) => {
        await seedValid(dir, input, ['review']);
        await seedReview(dir, input);
        await fs.writeFile(
            path.join(dir, INIT_KOIN),
            ['Presentation', 'Data', 'Domain'].map((l) => `add(Review${l}Module().module)`).join('\n') + '\n'
        );
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.ok(err.message.includes(`${INIT_KOIN}: ReviewModule not registered`));
            return true;
        });
        await fs.appendFile(path.join(dir, INIT_KOIN), 'add(ReviewModule().module)\n');
        await verifyGeneratedProject(dir, input);
    });
});

// Store-ready: a project with core/about keeps it wired and ships a Privacy Manifest whose
// declarations follow the ads and purchases flags (showcase: both on)
const PRIVACY = 'iosApp/iosApp/PrivacyInfo.xcprivacy';
const PRIVACY_FIXTURES = path.join(__dirname, 'fixtures/privacy');
const STORE_INPUT = (ads, purchases) => ({ ...INPUT, featuresConfig: { theming: false, multiLang: false, ads, purchases } });

async function privacyFixture(ads, purchases) {
    const name = ads && purchases ? 'all' : ads ? 'ads' : purchases ? 'purchases' : 'none';
    return fs.readFile(path.join(PRIVACY_FIXTURES, `expected-${name}.xcprivacy`), 'utf8');
}

async function seedAbout(dir, input = INPUT, { ads = true, purchases = true } = {}) {
    const pkg = input.packageName.replace(/\./g, '/');
    await fs.appendFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:about")\n');
    await fs.appendFile(path.join(dir, `shared/src/commonMain/kotlin/${pkg}/di/initKoin.kt`), 'add(AboutModule().module)\n');
    await fs.outputFile(path.join(dir, 'core/about/build.gradle.kts'), 'plugins { }\n');
    await fs.outputFile(path.join(dir, PRIVACY), await privacyFixture(ads, purchases));
    // Blank keeps the monetization modules its flags ask for (verifyMonetization)
    const cfg = input.featuresConfig || {};
    if (input.templateType === 'blank') await seedMonetization(dir, cfg.purchases === true, cfg.ads === true);
}

for (const [ads, purchases] of [[false, false], [true, false], [false, true], [true, true]]) {
    test(`blank ads=${ads} purchases=${purchases} with core/about: the matching manifest passes (store-ready)`, async () => {
        const input = STORE_INPUT(ads, purchases);
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedAbout(dir, input, { ads, purchases });
            await verifyGeneratedProject(dir, input);
        });
    });
}

test('showcase with core/about: the full manifest passes, a manifest without ads or purchases is rejected (store-ready)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await seedAbout(dir, SHOWCASE_INPUT);
        await verifyGeneratedProject(dir, SHOWCASE_INPUT);
        await fs.writeFile(path.join(dir, PRIVACY), await privacyFixture(false, false));
        await assert.rejects(verifyGeneratedProject(dir, SHOWCASE_INPUT), (err) => {
            assert.ok(err.message.includes(`${PRIVACY}: ad data not declared although ads is on`));
            assert.ok(err.message.includes(`${PRIVACY}: purchase history not declared although purchases is on`));
            return true;
        });
    });
});

for (const input of [INPUT, SHOWCASE_INPUT]) {
    test(`${input.templateType} with core/about: missing settings include, AboutModule and manifest are rejected (store-ready)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedAbout(dir, input);
            await fs.writeFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${input.projectName}"\n`);
            await fs.writeFile(path.join(dir, INIT_KOIN), 'add(AboutPresentationModule().module)\n');
            await fs.remove(path.join(dir, PRIVACY));
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.match(err.message, /settings\.gradle\.kts: :core:about not included/);
                assert.ok(err.message.includes(`${INIT_KOIN}: AboutModule not registered`));
                assert.ok(err.message.includes(`${PRIVACY}: missing`));
                return true;
            });
        });
    });
}

test('with core/about: a cmpose marker left or the required reason APIs missing are rejected (store-ready)', async () => {
    const input = STORE_INPUT(true, true);
    await withProject(async (dir) => {
        await seedValid(dir, input);
        await seedAbout(dir, input);
        const manifest = await privacyFixture(true, true);
        await fs.writeFile(
            path.join(dir, PRIVACY),
            manifest.replace('NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPICategoryOther') + '<!-- cmpose:ads -->\n'
        );
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.ok(err.message.includes(`${PRIVACY}: cmpose marker left`));
            assert.ok(err.message.includes(`${PRIVACY}: required reason APIs missing`));
            return true;
        });
    });
});

test('blank ads=false: a device ID or NSPrivacyTracking true is rejected (store-ready)', async () => {
    const input = STORE_INPUT(false, false);
    const none = await privacyFixture(false, false);
    const variants = [
        await privacyFixture(true, false),
        none.replace(/(<key>NSPrivacyTracking<\/key>\s*)<false\/>/, '$1<true/>')
    ];
    for (const manifest of variants) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedAbout(dir, input, { ads: false, purchases: false });
            await fs.writeFile(path.join(dir, PRIVACY), manifest);
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.ok(err.message.includes(`${PRIVACY}: ad data declared although ads is off`));
                return true;
            });
        });
    }
});

test('blank: ads on without ad data, purchases off with purchase history, purchases on without it are rejected (store-ready)', async () => {
    const cases = [
        [STORE_INPUT(true, false), await privacyFixture(false, false), 'ad data not declared although ads is on'],
        [STORE_INPUT(false, false), await privacyFixture(false, true), 'purchase history declared although purchases is off'],
        [STORE_INPUT(false, true), await privacyFixture(false, false), 'purchase history not declared although purchases is on']
    ];
    for (const [input, manifest, message] of cases) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedAbout(dir, input);
            await fs.writeFile(path.join(dir, PRIVACY), manifest);
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.ok(err.message.includes(`${PRIVACY}: ${message}`), err.message);
                return true;
            });
        });
    }
});

test('without core/about (pre-store-ready template): no manifest raises no store problem (store-ready)', async () => {
    for (const input of [INPUT, SHOWCASE_INPUT]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await verifyGeneratedProject(dir, input);
        });
    }
});

test('a stale template package in PrivacyInfo.xcprivacy is caught by the identifier rule (store-ready)', async () => {
    const input = STORE_INPUT(false, false);
    await withProject(async (dir) => {
        await seedValid(dir, input);
        await seedAbout(dir, input, { ads: false, purchases: false });
        await fs.appendFile(path.join(dir, PRIVACY), '<!-- com.kturker.multiplatform -->\n');
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.ok(err.message.includes(`${PRIVACY}: com.kturker.multiplatform`));
            return true;
        });
    });
});

// Network UX: a template whose catalog has the play-app-update key keeps core/update, wired, and the
// offline banner in every project; the network state permission follows the network flag (showcase: on)
const NETWORK_INPUT = (network) => ({ ...INPUT, featuresConfig: { theming: false, multiLang: false, network } });
const NETWORK_STATE = '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n';

async function seedNetworkUx(dir, input = INPUT, { networkState = true } = {}) {
    const pkg = input.packageName.replace(/\./g, '/');
    await fs.appendFile(path.join(dir, 'gradle/libs.versions.toml'), 'play-app-update = { module = "com.google.android.play:app-update", version.ref = "playAppUpdate" }\n');
    await fs.appendFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:update")\n');
    await fs.appendFile(path.join(dir, `shared/src/commonMain/kotlin/${pkg}/di/initKoin.kt`), 'add(UpdateModule().module)\n');
    await fs.appendFile(
        path.join(dir, `shared/src/commonMain/kotlin/${pkg}/MainScreen.kt`),
        'fun MainScreen() {\n    Scaffold(topBar = { OfflineBanner("No connection") }) { }\n    AppUpdateEffect()\n}\n'
    );
    await fs.outputFile(path.join(dir, 'core/update/build.gradle.kts'), 'plugins { }\n');
    await fs.outputFile(path.join(dir, ANDROID_MANIFEST), `<manifest>\n${networkState ? NETWORK_STATE : ''}</manifest>\n`);
}

for (const [input, networkState] of [[NETWORK_INPUT(true), true], [NETWORK_INPUT(false), false], [SHOWCASE_INPUT, true]]) {
    const label = input.templateType === 'blank' ? `blank network=${input.featuresConfig.network}` : 'showcase';
    test(`${label} with play-app-update: a wired core/update and banner pass (network-ux)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedNetworkUx(dir, input, { networkState });
            await verifyGeneratedProject(dir, input);
        });
    });
}

for (const input of [INPUT, SHOWCASE_INPUT]) {
    test(`${input.templateType} with play-app-update: every missing piece is rejected (network-ux)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedNetworkUx(dir, input, { networkState: input.templateType !== 'blank' });
            await fs.remove(path.join(dir, 'core/update/build.gradle.kts'));
            await fs.writeFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${input.projectName}"\n`);
            await fs.writeFile(path.join(dir, INIT_KOIN), 'add(UpdatePresentationModule().module)\n');
            await fs.writeFile(path.join(dir, MAIN_SCREEN), 'fun MainScreen() {\n    // AppUpdateEffect()\n    // OfflineBanner("No connection")\n}\n');
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.match(err.message, /core\/update: missing \(every project keeps it\)/);
                assert.match(err.message, /settings\.gradle\.kts: :core:update not included/);
                assert.ok(err.message.includes(`${INIT_KOIN}: UpdateModule not registered`));
                assert.ok(err.message.includes(`${MAIN_SCREEN}: AppUpdateEffect not called`));
                assert.ok(err.message.includes(`${MAIN_SCREEN}: OfflineBanner not shown`));
                return true;
            });
        });
    });
}

test('with play-app-update: ACCESS_NETWORK_STATE must follow the network flag; showcase always needs it (network-ux)', async () => {
    const cases = [
        [NETWORK_INPUT(true), false, 'ACCESS_NETWORK_STATE missing although network is on'],
        [SHOWCASE_INPUT, false, 'ACCESS_NETWORK_STATE missing although network is on'],
        [NETWORK_INPUT(false), true, 'ACCESS_NETWORK_STATE present although network is off']
    ];
    for (const [input, networkState, message] of cases) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedNetworkUx(dir, input, { networkState });
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.ok(err.message.includes(`${ANDROID_MANIFEST}: ${message}`), err.message);
                return true;
            });
        });
    }
});

test('without play-app-update in the catalog (pre-network-ux template): no core/update, banner or permission raises no problem (network-ux)', async () => {
    for (const input of [NETWORK_INPUT(true), NETWORK_INPUT(false), SHOWCASE_INPUT]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await fs.outputFile(path.join(dir, ANDROID_MANIFEST), `<manifest>\n${NETWORK_STATE}</manifest>\n`);
            await verifyGeneratedProject(dir, input);
        });
    }
});

// Coil: a template whose catalog has the coil-compose key keeps core/image, included, and calls
// ImageLoaderSetup() in MainScreen in every project; no Kamel is left anywhere, and a blank project
// with network off carries no Coil network library
const IMAGE_SETTINGS = 'include(":core:image")\n';

async function seedImages(dir, input = INPUT, { network = true } = {}) {
    const pkg = input.packageName.replace(/\./g, '/');
    const toml = 'coil-compose = { module = "io.coil-kt.coil3:coil-compose", version.ref = "coil" }\n'
        + (network ? 'coil-network-ktor3 = { module = "io.coil-kt.coil3:coil-network-ktor3", version.ref = "coil" }\n' : '');
    await fs.appendFile(path.join(dir, 'gradle/libs.versions.toml'), toml);
    await fs.appendFile(path.join(dir, 'settings.gradle.kts'), IMAGE_SETTINGS);
    await fs.appendFile(path.join(dir, `shared/src/commonMain/kotlin/${pkg}/MainScreen.kt`), 'fun MainScreen() {\n    ImageLoaderSetup()\n}\n');
    await fs.outputFile(path.join(dir, 'core/image/build.gradle.kts'), 'dependencies { api(libs.coil.compose) }\n');
}

for (const [input, network] of [[NETWORK_INPUT(true), true], [NETWORK_INPUT(false), false], [SHOWCASE_INPUT, true]]) {
    const label = input.templateType === 'blank' ? `blank network=${input.featuresConfig.network}` : 'showcase';
    test(`${label} with coil-compose: core/image, the include and ImageLoaderSetup pass (coil)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedImages(dir, input, { network });
            await verifyGeneratedProject(dir, input);
        });
    });
}

for (const input of [INPUT, SHOWCASE_INPUT]) {
    test(`${input.templateType} with coil-compose: every missing piece is rejected (coil)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedImages(dir, input);
            await fs.remove(path.join(dir, 'core/image/build.gradle.kts'));
            await fs.writeFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${input.projectName}"\n`);
            await fs.writeFile(path.join(dir, MAIN_SCREEN), 'fun MainScreen() {\n    // ImageLoaderSetup()\n}\n');
            await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
                assert.match(err.message, /core\/image: missing \(every project keeps it\)/);
                assert.match(err.message, /settings\.gradle\.kts: :core:image not included/);
                assert.ok(err.message.includes(`${MAIN_SCREEN}: ImageLoaderSetup not called`), err.message);
                return true;
            });
        });
    });
}

test('with coil-compose: Kamel left in a .kts, .toml or .kt file is rejected (coil)', async () => {
    const leftovers = [
        ['core/designsystem/build.gradle.kts', 'dependencies { implementation(libs.kamel.image) }\n'],
        ['gradle/libs.versions.toml', 'kamel-image = { module = "media.kamel:kamel-image", version.ref = "kamelImage" }\n'],
        [`core/designsystem/src/commonMain/kotlin/${PKG}/core/designsystem/component/KtAsyncImage.kt`, 'import io.kamel.image.KamelImage\n']
    ];
    for (const [rel, content] of leftovers) {
        await withProject(async (dir) => {
            await seedValid(dir, SHOWCASE_INPUT);
            await seedImages(dir, SHOWCASE_INPUT);
            await fs.outputFile(path.join(dir, rel), content, { flag: 'a' });
            await assert.rejects(verifyGeneratedProject(dir, SHOWCASE_INPUT), (err) => {
                assert.ok(err.message.includes(`${rel}: Kamel left (the template uses Coil)`), err.message);
                return true;
            });
        });
    }
});

test('blank network=false with coil-compose: the Coil network library left in the catalog or a build file is rejected (coil)', async () => {
    const input = NETWORK_INPUT(false);
    await withProject(async (dir) => {
        await seedValid(dir, input);
        await seedImages(dir, input, { network: true });
        await fs.outputFile(path.join(dir, 'shared/build.gradle.kts'), 'implementation(libs.coil.network.ktor3)\n', { flag: 'a' });
        await assert.rejects(verifyGeneratedProject(dir, input), (err) => {
            assert.ok(err.message.includes('gradle/libs.versions.toml: coil-network-ktor3 although network is off'), err.message);
            assert.ok(err.message.includes('shared/build.gradle.kts: libs.coil.network although network is off'), err.message);
            return true;
        });
    });
});

test('without coil-compose in the catalog (pre-Coil template): Kamel and no core/image raise no problem (coil)', async () => {
    for (const input of [NETWORK_INPUT(true), NETWORK_INPUT(false), SHOWCASE_INPUT]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await fs.appendFile(path.join(dir, 'gradle/libs.versions.toml'), 'kamel-image = { module = "media.kamel:kamel-image", version.ref = "kamelImage" }\n');
            await fs.outputFile(path.join(dir, 'core/designsystem/build.gradle.kts'), 'dependencies { implementation(libs.kamel.image) }\n');
            await verifyGeneratedProject(dir, input);
        });
    }
});

test('with coil-compose: a project or app named Kamel is not taken for a Kamel leftover (coil)', async () => {
    const cases = [
        { ...SHOWCASE_INPUT, projectName: 'Kamel' },
        { ...SHOWCASE_INPUT, appName: 'kamel' },
        { ...SHOWCASE_INPUT, appName: 'io.kamel' }
    ];
    for (const input of cases) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedImages(dir, input);
            // The user's own values land in these files, as the real pipeline writes them
            await fs.outputFile(path.join(dir, 'androidApp/src/main/res/values/strings.xml'), `<string name="app_name">${input.appName}</string>\n`);
            await fs.appendFile(path.join(dir, 'iosApp/Configuration/Config.xcconfig'), `APP_NAME=${input.appName}\n`);
            await verifyGeneratedProject(dir, input);
        });
    }
});

// Deep link: a template with core/navigation's DeepLinkHandler registers the project's scheme on both
// platforms and calls handleDeepLink from MainActivity and .onOpenURL; showcase keeps its two routes
const MANIFEST = 'androidApp/src/main/AndroidManifest.xml';
const INFO_PLIST = 'iosApp/iosApp/Info.plist';
const MAIN_ACTIVITY = `androidApp/src/main/kotlin/${PKG}/MainActivity.kt`;
const DEEP_LINKS = `shared/src/commonMain/kotlin/${PKG}/DeepLinks.kt`;
const USER_DEEP_LINK = `feature/home/presentation/src/commonMain/kotlin/${PKG}/feature/home/presentation/navigation/UserDeepLink.kt`;
const SETTINGS_DEEP_LINK = `feature/onboarding/presentation/src/commonMain/kotlin/${PKG}/feature/onboarding/presentation/navigation/SettingsDeepLink.kt`;

const deepLinkManifest = (scheme) => '<manifest>\n'
    + '    <!-- Deep links: ' + scheme + '://user/octocat, ' + scheme + '://settings (core/navigation DeepLinkHandler) -->\n'
    + '    <intent-filter>\n'
    + '        <action android:name="android.intent.action.VIEW" />\n'
    + '        <category android:name="android.intent.category.BROWSABLE" />\n'
    + `        <data android:scheme="${scheme}" />\n`
    + '    </intent-filter>\n'
    + '</manifest>\n';
const deepLinkPlist = (scheme) => '<plist><dict>\n'
    + '    <key>CFBundleURLTypes</key>\n    <array>\n        <dict>\n'
    + '            <key>CFBundleURLSchemes</key>\n'
    + `            <array>\n                <string>${scheme}</string>\n            </array>\n`
    + '        </dict>\n    </array>\n</dict></plist>\n';

async function seedDeepLinks(dir, input = INPUT) {
    const pkg = input.packageName.replace(/\./g, '/');
    const scheme = input.projectName.toLowerCase();
    const files = {
        [`core/navigation/src/commonMain/kotlin/${pkg}/core/navigation/DeepLinkHandler.kt`]: 'class DeepLinkHandler\n',
        [`core/navigation/src/commonMain/kotlin/${pkg}/core/navigation/DeepLinkConfig.kt`]: `const val DEEP_LINK_SCHEME = "${scheme}"\n`,
        [`shared/src/commonMain/kotlin/${pkg}/DeepLinks.kt`]: 'fun handleDeepLink(uri: String): Boolean = true\n',
        [`androidApp/src/main/kotlin/${pkg}/MainActivity.kt`]: '    override fun onNewIntent(intent: Intent) {\n        intent.data?.let { handleDeepLink(it.toString()) }\n    }\n',
        [MANIFEST]: deepLinkManifest(scheme),
        [INFO_PLIST]: deepLinkPlist(scheme),
        [IOS_APP]: 'ContentView()\n    .onOpenURL { url in DeepLinksKt.handleDeepLink(uri: url.absoluteString) }\n'
    };
    if (input.templateType === 'showcase') {
        files[`feature/home/presentation/src/commonMain/kotlin/${pkg}/feature/home/presentation/navigation/UserDeepLink.kt`] = 'class UserDeepLink\n';
        files[`feature/onboarding/presentation/src/commonMain/kotlin/${pkg}/feature/onboarding/presentation/navigation/SettingsDeepLink.kt`] = 'class SettingsDeepLink\n';
    }
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

for (const input of [INPUT, SHOWCASE_INPUT, { ...SHOWCASE_INPUT, projectName: 'Multiplatform' }]) {
    test(`${input.templateType} ${input.projectName} with DeepLinkHandler: the scheme on both platforms and both calls pass (deeplink)`, async () => {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await seedDeepLinks(dir, input);
            await verifyGeneratedProject(dir, input);
        });
    });
}

test('a stale deep link scheme in the manifest, DEEP_LINK_SCHEME or CFBundleURLSchemes is rejected (deeplink)', async () => {
    const configRel = `core/navigation/src/commonMain/kotlin/${PKG}/core/navigation/DeepLinkConfig.kt`;
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedDeepLinks(dir);
        await fs.writeFile(path.join(dir, configRel), 'const val DEEP_LINK_SCHEME = "multiplatform"\n');
        await fs.appendFile(path.join(dir, MANIFEST), '<data android:scheme="multiplatform" />\n');
        await fs.writeFile(path.join(dir, INFO_PLIST), deepLinkPlist('demo').replace('<string>demo</string>', '<string>demo</string>\n<string>multiplatform</string>'));
        await assert.rejects(verifyGeneratedProject(dir, INPUT), (err) => {
            assert.ok(err.message.includes(`${configRel}: DEEP_LINK_SCHEME = "multiplatform"`), err.message);
            assert.ok(err.message.includes(`${MANIFEST}: android:scheme="multiplatform"`), err.message);
            assert.ok(err.message.includes(`${INFO_PLIST}: CFBundleURLSchemes multiplatform`), err.message);
            return true;
        });
    });
});

test('a project named Multiplatform keeps the multiplatform scheme without a stale scheme problem (deeplink)', async () => {
    const input = { ...INPUT, projectName: 'Multiplatform' };
    await withProject(async (dir) => {
        await seedValid(dir, input);
        await seedDeepLinks(dir, input);
        await verifyGeneratedProject(dir, input);
    });
});

test('with DeepLinkHandler: MainActivity may pass handleDeepLink as a function reference, as the template does (deeplink)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await seedDeepLinks(dir, SHOWCASE_INPUT);
        await fs.writeFile(path.join(dir, MAIN_ACTIVITY), [
            '        if (savedInstanceState == null) intent?.dataString?.let(::handleDeepLink)',
            '    override fun onNewIntent(intent: Intent) {',
            '        intent.dataString?.let(::handleDeepLink)',
            '    }',
            ''
        ].join('\n'));
        await verifyGeneratedProject(dir, SHOWCASE_INPUT);
    });
});

test('with DeepLinkHandler: every missing registration or call is rejected (deeplink)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir, SHOWCASE_INPUT);
        await seedDeepLinks(dir, SHOWCASE_INPUT);
        // The scheme only in a comment and VIEW only in the commented App Link filter do not count
        await fs.writeFile(path.join(dir, MANIFEST), '<manifest>\n    <!-- <action android:name="android.intent.action.VIEW" /> <data android:scheme="demo" /> -->\n</manifest>\n');
        await fs.writeFile(path.join(dir, INFO_PLIST), '<plist><dict>\n    <key>CFBundleName</key>\n    <string>demo</string>\n</dict></plist>\n');
        await fs.writeFile(path.join(dir, MAIN_ACTIVITY), '    // handleDeepLink(intent.dataString)\n');
        await fs.writeFile(path.join(dir, IOS_APP), 'ContentView()\n    // .onOpenURL { url in }\n');
        for (const rel of [DEEP_LINKS, USER_DEEP_LINK, SETTINGS_DEEP_LINK]) await fs.remove(path.join(dir, rel));
        await assert.rejects(verifyGeneratedProject(dir, SHOWCASE_INPUT), (err) => {
            for (const expected of [
                `${MANIFEST}: deep link scheme demo not registered`,
                `${INFO_PLIST}: URL scheme demo not registered`,
                `${MAIN_ACTIVITY}: handleDeepLink not called`,
                `${IOS_APP}: onOpenURL not handled`,
                `${DEEP_LINKS}: missing`,
                `${USER_DEEP_LINK}: missing`,
                `${SETTINGS_DEEP_LINK}: missing`
            ]) assert.ok(err.message.includes(expected), `${expected}\n${err.message}`);
            return true;
        });
    });
});

test('blank with DeepLinkHandler needs no showcase routes (deeplink)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedDeepLinks(dir);
        await verifyGeneratedProject(dir, INPUT);
    });
});

test('without DeepLinkHandler (pre-deeplink template): no scheme, calls or routes raise no problem (deeplink)', async () => {
    for (const input of [INPUT, SHOWCASE_INPUT]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await fs.outputFile(path.join(dir, MANIFEST), '<manifest>\n</manifest>\n');
            await fs.outputFile(path.join(dir, MAIN_ACTIVITY), 'class MainActivity\n');
            await verifyGeneratedProject(dir, input);
        });
    }
});

// Paywall: keyed on core/purchases' PurchaseResult.kt (purchases) and core/ads' InterstitialPacer.kt (ads), which a
// pre-paywall template lacks
const PURCHASES_SRC = `core/purchases/src/commonMain/kotlin/${PKG}/core/purchases`;
const PAYWALL_SRC = `feature/monetization/presentation/src/commonMain/kotlin/${PKG}/feature/monetization/presentation/paywall`;

async function seedPaywall(dir, { purchases = true, ads = false } = {}) {
    await seedMonetization(dir, purchases, ads);
    if (purchases) {
        await fs.outputFile(path.join(dir, PURCHASES_SRC, 'PurchaseResult.kt'), 'sealed interface PurchaseResult\n');
        await fs.outputFile(path.join(dir, PAYWALL_SRC, 'FirstLaunchPaywall.kt'), 'fun FirstLaunchPaywall() { }\n');
        await fs.writeFile(path.join(dir, MAIN_SCREEN), `package ${INPUT.packageName}\n\nfun MainScreen() {\n    FirstLaunchPaywall()\n}\n`);
    }
    if (ads) {
        await fs.outputFile(path.join(dir, `core/ads/src/commonMain/kotlin/${PKG}/core/ads/InterstitialPacer.kt`), 'class InterstitialPacer\n');
        await fs.outputFile(path.join(dir, ADS_DIR, 'InterstitialPacerProvider.kt'), 'fun provideInterstitialPacer(): InterstitialPacer = InterstitialPacer()\n');
    }
}

test('blank paywall: a custom paywall project passes (paywall)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedPaywall(dir, { purchases: true, ads: true });
        await verifyGeneratedProject(dir, MONETIZATION(true, true));
    });
});

test('blank paywall: RevenueCatUI, a missing FirstLaunchPaywall call or file are rejected (paywall)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedPaywall(dir);
        await fs.appendFile(path.join(dir, 'gradle/libs.versions.toml'), 'revenuecat-ui = { module = "com.revenuecat.purchases:purchases-kmp-ui", version.ref = "revenuecat" }\n');
        await fs.outputFile(path.join(dir, PAYWALL_SRC, 'PaywallScreen.kt'), 'import com.revenuecat.purchases.kmp.ui.revenuecatui.Paywall\n');
        await fs.writeFile(path.join(dir, MAIN_SCREEN), `package ${INPUT.packageName}\n\n// FirstLaunchPaywall()\n`);
        await fs.remove(path.join(dir, PAYWALL_SRC, 'FirstLaunchPaywall.kt'));
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(true, false)), (err) => {
            assert.match(err.message, /libs\.versions\.toml: revenuecat-ui left/);
            assert.match(err.message, /PaywallScreen\.kt: RevenueCatUI/);
            assert.match(err.message, /MainScreen\.kt: FirstLaunchPaywall not called although purchases is on/);
            assert.match(err.message, /FirstLaunchPaywall\.kt: missing although purchases is on/);
            return true;
        });
    });
});

test('blank paywall: ads on without the pacer provider is rejected (paywall)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedPaywall(dir, { purchases: false, ads: true });
        await fs.remove(path.join(dir, ADS_DIR, 'InterstitialPacerProvider.kt'));
        await assert.rejects(verifyGeneratedProject(dir, MONETIZATION(false, true)),
            /InterstitialPacerProvider\.kt: InterstitialPacer not provided although ads is on/);
    });
});

test('blank paywall: a pre-paywall template (no PurchaseResult.kt, no InterstitialPacer.kt) is not checked (paywall)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        await seedMonetization(dir, true, true);
        await verifyGeneratedProject(dir, MONETIZATION(true, true));
    });
});

// Backend (featuresConfig.backend): blank keeps the server and the backend's modules exactly when it is on
const BACKEND_INPUT = (backend) => ({ ...INPUT, featuresConfig: { theming: false, multiLang: backend, backend } });
const BACKEND_PLIST = '<key>CFBundleURLSchemes</key>\n<array>\n<string>demo</string>\n</array>\n'
    + '<key>CFBundleURLSchemes</key>\n<array>\n<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>\n</array>\n';
const BACKEND_BUILD_FILES = ['core/api', 'core/auth', 'feature/account/contract', 'feature/account/presentation',
    'feature/sharing/contract', 'feature/sharing/presentation'].map((dir) => `${dir}/build.gradle.kts`);
// server/: the backend template as an included build
const INCLUDE_SERVER = '// server/ is generated from the cmpose backend template (an included build)\n'
    + 'if (file("server/settings.gradle.kts").exists()) includeBuild("server")\n';
const SERVER_FILES = {
    'server/settings.gradle.kts': 'rootProject.name = "demo"\n',
    'server/build.gradle.kts': `application { mainClass.set("${INPUT.packageName}.server.MainKt") }\n`,
    'server/gradle.properties': 'kotlin.code.style=official\nlocalServerDir=../.local-server\n',
    [`server/src/main/kotlin/${PKG}/server/Main.kt`]: `package ${INPUT.packageName}.server\n`,
    [`server/src/local/kotlin/${PKG}/server/local/LocalMain.kt`]: `package ${INPUT.packageName}.server.local\n`
};
const NO_DOCKER = async () => ({ status: 'SKIP', detail: 'test' });

async function seedBackend(dir) {
    await seedValid(dir);
    const files = {
        'settings.gradle.kts': 'rootProject.name = "Demo"\ninclude(":shared")\ninclude(":core:api")\ninclude(":core:auth")\n'
            + 'include(":feature:account:contract")\ninclude(":feature:account:presentation")\n'
            + `include(":feature:sharing:contract")\ninclude(":feature:sharing:presentation")\n${INCLUDE_SERVER}`,
        'shared/build.gradle.kts': 'implementation(projects.core.auth)\nimplementation(projects.feature.account.presentation)\n'
            + 'implementation(projects.feature.sharing.presentation)\n',
        [INIT_KOIN]: 'add(AuthModule().module)\nadd(AccountModule().module)\nadd(SharingModule().module)\n',
        [INFO_PLIST]: BACKEND_PLIST,
        ...SERVER_FILES
    };
    for (const rel of BACKEND_BUILD_FILES) files[rel] = 'plugins { }\n';
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

async function backendProblems(dir, input) {
    const problems = new Set();
    await verifyBackend(dir, input, input.featuresConfig || {}, problems);
    return [...problems];
}

test('blank backend=true: a complete backend project passes (backend)', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(true)), []);
    });
});

test('blank backend=true: a missing server/build.gradle.kts, include or registration is rejected (backend)', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        await fs.remove(path.join(dir, 'server', 'build.gradle.kts'));
        await fs.outputFile(path.join(dir, INIT_KOIN), 'add(AuthModule().module)\nadd(AccountModule().module)\n');
        const settings = path.join(dir, 'settings.gradle.kts');
        await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace('include(":core:api")\n', ''));
        const problems = await backendProblems(dir, BACKEND_INPUT(true));
        assert.ok(problems.includes('server/build.gradle.kts: missing although backend is on'), problems.join('\n'));
        assert.ok(problems.includes('settings.gradle.kts: :core:api not included'), problems.join('\n'));
        assert.ok(problems.includes(`${INIT_KOIN}: SharingModule not registered`), problems.join('\n'));
    });
});

test('blank backend=true: Info.plist without $(GOOGLE_REVERSED_CLIENT_ID) is rejected (backend)', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        await fs.outputFile(path.join(dir, INFO_PLIST), BACKEND_PLIST.replace('$(GOOGLE_REVERSED_CLIENT_ID)', 'com.googleusercontent.apps.x'));
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(true)),
            [`${INFO_PLIST}: the $(GOOGLE_REVERSED_CLIENT_ID) URL scheme is missing`]);
    });
});

test('a cmpose:backend marker left in a backend project is rejected (backend)', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        await fs.appendFile(path.join(dir, 'shared', 'build.gradle.kts'), '// cmpose:backend\n');
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(true)), ['shared/build.gradle.kts: cmpose:backend marker left']);
    });
});

test('blank backend=false: a leftover core/auth and its references are rejected (backend)', async () => {
    await withProject(async (dir) => {
        await seedValid(dir);
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(false)), []);
        await fs.outputFile(path.join(dir, 'core', 'auth', 'build.gradle.kts'), 'plugins { }\n');
        await fs.outputFile(path.join(dir, INIT_KOIN), `import ${INPUT.packageName}.core.auth.AuthModule\n`);
        const problems = await backendProblems(dir, BACKEND_INPUT(false));
        assert.ok(problems.includes('core/auth: present although backend is off'), problems.join('\n'));
        assert.ok(problems.includes(`${INIT_KOIN}: core.auth`), problems.join('\n'));
        // Through the whole verifier too
        await assert.rejects(verifyGeneratedProject(dir, BACKEND_INPUT(false)), /core\/auth: present although backend is off/);
    });
});

test('backend off: Firebase in the Xcode project, google-services or BACKEND_CLIENT is rejected; showcase too (backend)', async () => {
    for (const input of [BACKEND_INPUT(false), { ...INPUT, templateType: 'showcase' }]) {
        await withProject(async (dir) => {
            await seedValid(dir, input);
            await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'),
                'repositoryURL = "https://github.com/firebase/firebase-ios-sdk";\nproductName = FirebaseAuth;\n');
            await fs.outputFile(path.join(dir, 'androidApp/build.gradle.kts'), 'plugins { alias(libs.plugins.googleServices) }\n');
            await fs.outputFile(path.join(dir, `core/network/src/commonMain/kotlin/${PKG}/core/network/Client.kt`),
                `package ${INPUT.packageName}.core.network\nval c = BACKEND_CLIENT\n`);
            await fs.outputFile(path.join(dir, 'server/build.gradle.kts'), 'plugins { }\n');
            const problems = await backendProblems(dir, input);
            const where = input.templateType === 'showcase' ? 'in a showcase project' : 'although backend is off';
            for (const expected of [
                'iosApp/iosApp.xcodeproj/project.pbxproj: FirebaseAuth',
                'androidApp/build.gradle.kts: googleServices',
                `core/network/src/commonMain/kotlin/${PKG}/core/network/Client.kt: BACKEND_CLIENT`,
                `server: present ${where}`
            ]) assert.ok(problems.includes(expected), `${expected} in\n${problems.join('\n')}`);
        });
    }
});

test('a custom module named api or auth is not backend residue (backend)', async () => {
    await withProject(async (dir) => {
        const input = { ...BACKEND_INPUT(false), features: ['api', 'auth'] };
        await seedValid(dir, input, ['api', 'auth']);
        await fs.outputFile(path.join(dir, `feature/auth/presentation/src/commonMain/kotlin/${PKG}/feature/auth/presentation/AuthEntry.kt`),
            `package ${INPUT.packageName}.feature.auth.presentation\nimport ${INPUT.packageName}.feature.api.contract.ApiDestination\n`);
        assert.deepEqual(await backendProblems(dir, input), []);
    });
});

test('the privacy manifest declares the account data exactly when backend is on (backend)', async () => {
    const manifest = (backend) => '<dict>\n<string>NSPrivacyAccessedAPICategoryUserDefaults</string>\n'
        + (backend ? '<string>NSPrivacyCollectedDataTypeEmailAddress</string>\n' : '') + '</dict>\n';
    const cases = [[false, false, null], [true, true, null], [false, true, 'account data declared although backend is off'],
        [true, false, 'account data not declared although backend is on']];
    for (const [backend, declared, expected] of cases) {
        await withProject(async (dir) => {
            await (backend ? seedBackend(dir) : seedValid(dir));
            await fs.outputFile(path.join(dir, 'core/about/build.gradle.kts'), 'plugins { }\n');
            await fs.appendFile(path.join(dir, 'settings.gradle.kts'), 'include(":core:about")\n');
            await fs.appendFile(path.join(dir, INIT_KOIN), 'add(AboutModule().module)\n');
            await fs.outputFile(path.join(dir, 'iosApp/iosApp/PrivacyInfo.xcprivacy'), manifest(declared));
            const input = { ...INPUT, featuresConfig: { theming: false, multiLang: false, backend } };
            if (expected) {
                await assert.rejects(verifyGeneratedProject(dir, input), new RegExp(`PrivacyInfo.xcprivacy: ${expected}`));
            } else {
                await verifyGeneratedProject(dir, input, { serverImageCheck: NO_DOCKER });
            }
        });
    }
});

test('serverMissingIncludeBuildIsAProblem', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        const settings = path.join(dir, 'settings.gradle.kts');
        // a commented-out includeBuild does not count
        await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace(/^if \(.*$/m, '// includeBuild("server")'));
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(true)),
            ['settings.gradle.kts: includeBuild("server") missing although backend is on']);
    });
});

test('serverWithGithubDirIsAProblem', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        await fs.outputFile(path.join(dir, 'server/.github/workflows/ci.yml'), 'name: ci\n');
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(true)),
            ['server/.github: the backend template\'s CI left (the project\'s own CI builds server/)']);
    });
});

test('serverWithoutLocalServerDirIsAProblem', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        await fs.outputFile(path.join(dir, 'server/gradle.properties'), 'kotlin.code.style=official\nlocalServerDir=.local-server\n');
        assert.deepEqual(await backendProblems(dir, BACKEND_INPUT(true)),
            ['server/gradle.properties: localServerDir=../.local-server missing (the local server lives in the root .local-server/)']);
    });
});

test('a server without its package dirs, its settings or with the backend template\'s package is rejected (backend)', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        await fs.remove(path.join(dir, `server/src/local/kotlin/${PKG}/server/local/LocalMain.kt`));
        await fs.remove(path.join(dir, 'server/settings.gradle.kts'));
        await fs.outputFile(path.join(dir, 'server/src/test/kotlin/io/cmpose/backendtemplate/AuthTest.kt'), 'package io.cmpose.backendtemplate\n');
        await fs.outputFile(path.join(dir, 'server/deploy/README.md'), 'Run io.cmpose.backendtemplate.MainKt\n');
        assert.deepEqual((await backendProblems(dir, BACKEND_INPUT(true))).sort(), [
            'server/deploy/README.md: io.cmpose.backendtemplate left',
            'server/settings.gradle.kts: missing although backend is on',
            `server/src/local/kotlin/${PKG}/server/local/LocalMain.kt: missing although backend is on`,
            'server/src/test/kotlin/io/cmpose/backendtemplate/AuthTest.kt: io.cmpose.backendtemplate left',
            'server/src/test/kotlin/io/cmpose/backendtemplate: io.cmpose.backendtemplate left'
        ]);
    });
});

test('the server image check runs last for a backend project: FAIL is a problem, SKIP and PASS are not (backend)', async () => {
    await withProject(async (dir) => {
        await seedBackend(dir);
        const input = { ...INPUT, featuresConfig: { theming: false, multiLang: false, backend: true } };
        const seen = [];
        const check = (status) => async (projectPath) => { seen.push(projectPath); return { status, detail: 'build log' }; };
        await verifyGeneratedProject(dir, input, { serverImageCheck: check('SKIP') });
        await verifyGeneratedProject(dir, input, { serverImageCheck: check('PASS') });
        await assert.rejects(verifyGeneratedProject(dir, input, { serverImageCheck: check('FAIL') }),
            /server\/deploy\/Dockerfile: the server image does not build \(docker build -f server\/deploy\/Dockerfile server\): build log/);
        assert.deepEqual(seen, [dir, dir, dir]);
        // not built when something else already failed, nor without the backend
        await fs.remove(path.join(dir, 'server/gradle.properties'));
        await assert.rejects(verifyGeneratedProject(dir, input, { serverImageCheck: check('FAIL') }), /localServerDir/);
        await withProject(async (plain) => {
            await seedValid(plain);
            await verifyGeneratedProject(plain, INPUT, { serverImageCheck: check('FAIL') });
        });
        assert.equal(seen.length, 3);
    });
});

test('marketingVersionMismatchIsAProblem', async () => {
    const appConfig = (major, minor, patch) => 'object AppConfig {\n    const val versionCode = 1\n\n'
        + `    private const val versionMajor = ${major}\n    private const val versionMinor = ${minor}\n    private const val versionPatch = ${patch}\n}\n`;
    await withProject(async (dir) => {
        await seedValid(dir);
        const xcconfig = path.join(dir, 'iosApp/Configuration/Config.xcconfig');
        await fs.appendFile(xcconfig, 'CURRENT_PROJECT_VERSION=1\nMARKETING_VERSION=1.0\n');
        // without AppConfig.kt (an older template) nothing is compared
        await verifyGeneratedProject(dir, INPUT);
        await fs.outputFile(path.join(dir, 'build-logic/src/main/kotlin/config/AppConfig.kt'), appConfig(0, 0, 1));
        await assert.rejects(verifyGeneratedProject(dir, INPUT), /iOS MARKETING_VERSION \(1\.0\) must equal AppConfig\.versionName \(0\.0\.1\)/);
        await fs.writeFile(xcconfig, (await fs.readFile(xcconfig, 'utf8')).replace('MARKETING_VERSION=1.0', 'MARKETING_VERSION=0.0.1'));
        await verifyGeneratedProject(dir, INPUT);
    });
});

test('the server image check is SKIP without Docker (backend)', async () => {
    await withProject(async (dir) => {
        assert.deepEqual(await checkServerImage(dir, { docker: path.join(dir, 'no-docker-here') }),
            { status: 'SKIP', detail: 'Docker is not available' });
    });
});

test('the server image check is opt-in: the option wins, then CMPOSE_SERVER_IMAGE_CHECK=1 (backend)', () => {
    const stub = async () => ({ status: 'PASS' });
    assert.equal(SERVER_IMAGE_ENV, 'CMPOSE_SERVER_IMAGE_CHECK');
    assert.equal(resolveServerImageCheck(undefined, {}), null);
    assert.equal(resolveServerImageCheck(undefined, { CMPOSE_SERVER_IMAGE_CHECK: '0' }), null);
    assert.equal(resolveServerImageCheck(undefined, { CMPOSE_SERVER_IMAGE_CHECK: '1' }), checkServerImage);
    assert.equal(resolveServerImageCheck(true, {}), checkServerImage);
    assert.equal(resolveServerImageCheck(stub, {}), stub);
    assert.equal(resolveServerImageCheck(stub, { CMPOSE_SERVER_IMAGE_CHECK: '1' }), stub);
    assert.equal(resolveServerImageCheck(false, { CMPOSE_SERVER_IMAGE_CHECK: '1' }), null);
});

test('without the option or the env var the server image is SKIP, not requested, and docker is not called (backend)', async (t) => {
    const logged = [];
    setLogger({ info: (...a) => logged.push(a.join(' ')), warn() { }, error() { } });
    t.after(() => setLogger(null));
    await withProject(async (dir) => {
        await seedBackend(dir);
        const input = { ...INPUT, featuresConfig: { theming: false, multiLang: false, backend: true } };
        // the seed has no Dockerfile: a real build would fail the verification
        await verifyGeneratedProject(dir, input, { env: {} });
        assert.ok(logged.includes('⏭️ server image: SKIP (not requested (set CMPOSE_SERVER_IMAGE_CHECK=1))'), logged.join('\n'));
        // the env var asks for it: the option still wins
        let called = 0;
        const stub = async () => { called++; return { status: 'FAIL', detail: 'x' }; };
        await assert.rejects(verifyGeneratedProject(dir, input, { serverImageCheck: stub, env: { CMPOSE_SERVER_IMAGE_CHECK: '1' } }), /server image/);
        await verifyGeneratedProject(dir, input, { serverImageCheck: false, env: { CMPOSE_SERVER_IMAGE_CHECK: '1' } });
        assert.equal(called, 1);
    });
});

// A docker stand-in: logs its arguments and directory, answers info, build and image rm
async function stubDocker(dir, { build }) {
    const script = path.join(dir, 'docker-stub');
    const log = path.join(dir, 'docker.log');
    await fs.writeFile(script, [
        '#!/bin/sh',
        `echo "$PWD|$*" >> '${log}'`,
        'case "$1" in',
        '  info) echo 27.0.0 ;;',
        `  build) ${build} ;;`,
        '  image) echo deleted ;;',
        'esac',
        ''
    ].join('\n'));
    await fs.chmod(script, 0o755);
    return { script, calls: async () => (await fs.readFile(log, 'utf8')).trim().split('\n') };
}

test('checkServerImage PASS: builds server/ from the project root, reads the image id and removes the image (backend)', async () => {
    await withProject(async (dir) => {
        const tools = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-docker-stub-'));
        try {
            const docker = await stubDocker(tools, { build: 'echo "#1 building" >&2; echo sha256:abc123' });
            assert.deepEqual(await checkServerImage(dir, { docker: docker.script }), { status: 'PASS', detail: 'sha256:abc123' });
            const calls = (await docker.calls()).map((line) => line.split('|'));
            assert.deepEqual(calls.map(([, args]) => args),
                ['info --format {{.ServerVersion}}', 'build --quiet -f server/deploy/Dockerfile server', 'image rm sha256:abc123']);
            // the build runs from the project root
            assert.equal(calls[1][0], await fs.realpath(dir));
        } finally {
            await fs.remove(tools);
        }
    });
});

test('checkServerImage FAIL: the last five stderr lines, joined with | (backend)', async () => {
    await withProject(async (dir) => {
        const tools = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-docker-stub-'));
        try {
            const docker = await stubDocker(tools, { build: 'for n in 1 2 3 4 5 6 7; do echo "line $n" >&2; done; exit 1' });
            assert.deepEqual(await checkServerImage(dir, { docker: docker.script }),
                { status: 'FAIL', detail: 'line 3 | line 4 | line 5 | line 6 | line 7' });
            // no image to remove after a failed build
            assert.equal((await docker.calls()).length, 2);
        } finally {
            await fs.remove(tools);
        }
    });
});
