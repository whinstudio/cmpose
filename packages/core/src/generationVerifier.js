const fs = require('fs-extra');
const path = require('path');
const { execFile } = require('child_process');
const { log } = require('./log');
const { listTextFiles } = require('./projectFiles');
const { escapeRegExp, findResidue, backendResidueTokens, INSIGHTS_DIR, INSIGHTS_FIREBASE_PRODUCTS } = require('./fileService');
const { TEST_SOURCE_SET_REGEX, BLANK_KEPT_TEST_DIRS } = require('./featureModules');
const { OLD_PACKAGE_NAME } = require('./templateIdentity');
const { SERVER_DIR, INCLUDE_SERVER_BUILD, serverPackageOf } = require('./serverFromBackend');

// The template's own identity: if it is left in a generated project, the rename missed a spot.
// The user's input can carry the same text (appName accepts dots and letters, ≤30; the project name
// "Multiplatform" is valid) — then the rule is skipped (an appName can look like any token).
const STALE_IDENTIFIER_RULES = [
    {
        label: 'com.kturker.multiplatform',
        // Lookbehind excludes ".", so a valid package + module combination that merely spells the
        // old identifier out as a LATER substring (e.g. package "x.com.kturker" + module
        // "multiplatform" -> "x.com.kturker.multiplatform.presentation") is not a match: real leaks
        // are always preceded by a word boundary (import/package keyword, quote, newline, etc.),
        // never by another identifier segment.
        regex: /(?<![A-Za-z0-9_.])com\.kturker\.multiplatform(?![A-Za-z0-9_])/,
        skip: (input) => [input.packageName, input.appName].some((value) => value.includes('com.kturker.multiplatform'))
    },
    {
        label: 'com.kturker.composemultiplatform',
        regex: /(?<![A-Za-z0-9_.])com\.kturker\.composemultiplatform(?![A-Za-z0-9_])/,
        skip: (input) => [input.packageName, input.appName].some((value) => value.includes('com.kturker.composemultiplatform'))
    },
    {
        label: 'rootProject.name = "Multiplatform"',
        regex: /rootProject\.name\s*=\s*"Multiplatform"/,
        skip: (input) => input.projectName === 'Multiplatform'
    },
    {
        // A hard-coded Apple team (the template takes it from $(TEAM_ID)): if left, a device build
        // fails with "No Account for Team". Only Xcode project files are checked: user text
        // (e.g. detektYamlContent -> detekt.yml) can carry the same string and is harmless there.
        label: 'hard-coded DEVELOPMENT_TEAM',
        regex: /DEVELOPMENT_TEAM\s*=\s*"?[A-Z0-9]{10}\b/,
        appliesTo: (rel) => rel.endsWith('.pbxproj'),
        skip: () => false
    },
    {
        // Kermit: the log tag prefix is the project name (replaceInContent)
        label: 'LOG_TAG_PREFIX = "Multiplatform"',
        regex: /\bLOG_TAG_PREFIX\s*=\s*"Multiplatform"/,
        skip: (input) => input.projectName === 'Multiplatform'
    },
    // Deep link: the scheme is the project name in lower case (replaceInContent)
    {
        label: 'android:scheme="multiplatform"',
        regex: /\bandroid:scheme\s*=\s*"multiplatform"/,
        skip: (input) => input.projectName.toLowerCase() === 'multiplatform'
    },
    {
        label: 'DEEP_LINK_SCHEME = "multiplatform"',
        regex: /\bDEEP_LINK_SCHEME\s*=\s*"multiplatform"/,
        skip: (input) => input.projectName.toLowerCase() === 'multiplatform'
    },
    {
        label: 'CFBundleURLSchemes multiplatform',
        regex: /<key>CFBundleURLSchemes<\/key>\s*<array>(?:(?!<\/array>)[\s\S])*<string>multiplatform<\/string>/,
        appliesTo: (rel) => rel.endsWith('.plist'),
        skip: (input) => input.projectName.toLowerCase() === 'multiplatform'
    }
];
const OLD_PACKAGE_DIR = 'com/kturker/multiplatform';
// ProjectValidator reserves only the PREFIX (packages starting with com.kturker.multiplatform),
// not a deeper segment - "dev.com.kturker.multiplatform" or
// "app.com.kturker.multiplatform.core" are valid user packages, and their sources land under
// .../kotlin/dev/com/kturker/multiplatform/... Without a root anchor (kotlin/ or java/ RIGHT
// under the source set) this valid input would be rejected; anchoring to the root still catches
// a real leftover (the old template's own root package directory).
// The anchor counts only when "kotlin/" or "java/" is the source set's ROOT (src/<sourceSet>/kotlin
// or .../java) - if the user's package has a SEGMENT named "kotlin" (e.g. packageName
// "dev.kotlin.com.kturker.multiplatform" -> .../kotlin/dev/kotlin/com/kturker/
// multiplatform/...) that is not a source root and must not match.
const OLD_PACKAGE_DIR_REGEX = new RegExp(`(?:^|/)src/[^/]+/(?:kotlin|java)/${OLD_PACKAGE_DIR}/`);
const MODULE_LAYERS = ['contract', 'data', 'domain', 'presentation'];

function capitalize(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

const relPath = (projectPath, file) => path.relative(projectPath, file).split(path.sep).join('/');

// Blank's shell wires the theme and the strings through its layers; Theming off leaves
// no reference to the theme packages it removes; no template test ships (Compass's test gate).
async function verifyBlankShell(projectPath, input, problems) {
    const cfg = input.featuresConfig || {};
    const packagePath = input.packageName.replace(/\./g, '/');
    const sharedDir = `shared/src/commonMain/kotlin/${packagePath}`;
    const files = await listTextFiles(projectPath);

    if (cfg.theming === true) {
        const appTheme = await readIfExists(path.join(projectPath, sharedDir, 'AppTheme.kt'));
        if (!/\bDarkModeManager\b/.test(appTheme) || !/\bKtTheme\(/.test(appTheme)) {
            problems.add(`${sharedDir}/AppTheme.kt: does not apply the saved theme through KtTheme`);
        }
        const ktTheme = `core/designsystem/src/commonMain/kotlin/${packagePath}/core/designsystem/theme/KtTheme.kt`;
        if (!(await fs.pathExists(path.join(projectPath, ktTheme)))) problems.add(`${ktTheme}: missing`);
    } else {
        const themeImport = new RegExp(`^import ${escapeRegExp(input.packageName)}\\.core\\.(?:database|designsystem)\\.theme\\.`, 'm');
        for (const file of files) {
            if (file.endsWith('.kt') && themeImport.test(await fs.readFile(file, 'utf8'))) {
                problems.add(`${relPath(projectPath, file)}: imports a theme package that Theming off removes`);
            }
        }
    }

    if (cfg.multiLang === true) {
        const mainScreen = await readIfExists(path.join(projectPath, sharedDir, 'MainScreen.kt'));
        if (!mainScreen.includes('LocalStringResources provides') || !mainScreen.includes('setSystemLanguage()')) {
            problems.add(`${sharedDir}/MainScreen.kt: does not provide LocalStringResources or call setSystemLanguage()`);
        }
    }

    for (const file of files) {
        const filePath = relPath(projectPath, file);
        const match = filePath.match(TEST_SOURCE_SET_REGEX);
        if (!match || BLANK_KEPT_TEST_DIRS.some((dir) => filePath.startsWith(dir))) continue;
        const dir = filePath.slice(0, match.index + match[0].length - 1);
        problems.add(`${dir}: template tests in a blank project (Compass counts every iOS test as the agent's)`);
    }

    await verifyMonetization(projectPath, packagePath, cfg, problems);
}

// Spec §10: blank keeps exactly the monetization modules its purchases/ads flags ask for. Existence
// only — residue of a removed flag inside kept files is assertNoMonetizationResidue's job.
async function verifyMonetization(projectPath, packagePath, cfg, problems) {
    const purchases = cfg.purchases === true;
    const ads = cfg.ads === true;
    const exists = (rel) => fs.pathExists(path.join(projectPath, rel));
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));

    if (purchases) {
        if (!(await exists('core/purchases/build.gradle.kts'))) problems.add('core/purchases: missing although purchases is on');
        if (!/\bPurchasesModule\b/.test(initKoin)) problems.add(`${initKoinRel}: PurchasesModule not registered`);
    } else if (await exists('core/purchases')) {
        problems.add('core/purchases: present although purchases is off');
    }

    if (ads) {
        if (!(await exists('core/ads/build.gradle.kts'))) problems.add('core/ads: missing although ads is on');
        if (!(await exists('iosApp/iosApp/AdsBridge.swift'))) problems.add('iosApp/iosApp/AdsBridge.swift: missing although ads is on');
        const plist = await readIfExists(path.join(projectPath, 'iosApp/iosApp/Info.plist'));
        if (!plist.includes('GADApplicationIdentifier')) {
            problems.add('iosApp/iosApp/Info.plist: no GADApplicationIdentifier although ads is on');
        }
        // GMA reads the app ID from the manifest at start-up; the Swift bridge must be registered and
        // core:ads exported to the framework, or iOS has no ads (comment lines do not count)
        const manifestRel = 'androidApp/src/main/AndroidManifest.xml';
        const manifest = await readIfExists(path.join(projectPath, manifestRel));
        if (!/android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"/.test(manifest)) {
            problems.add(`${manifestRel}: no com.google.android.gms.ads.APPLICATION_ID although ads is on`);
        }
        const iosApp = await readIfExists(path.join(projectPath, 'iosApp/iosApp/iOSApp.swift'));
        if (!/^(?![ \t]*\/\/).*\bregisterAdsBridge\(/m.test(iosApp)) {
            problems.add('iosApp/iosApp/iOSApp.swift: registerAdsBridge not called although ads is on');
        }
        const shared = await readIfExists(path.join(projectPath, 'shared/build.gradle.kts'));
        if (!/^[ \t]*export\(projects\.core\.ads\)/m.test(shared)) {
            problems.add('shared/build.gradle.kts: export(projects.core.ads) missing although ads is on');
        }
        const adsDir = `feature/monetization/presentation/src/commonMain/kotlin/${packagePath}/feature/monetization/presentation/ads`;
        const state = purchases ? 'on' : 'off';
        const [kept, removed] = purchases
            ? ['PremiumAdFreeSource.kt', 'NoPremiumAdFreeSource.kt']
            : ['NoPremiumAdFreeSource.kt', 'PremiumAdFreeSource.kt'];
        if (!(await exists(`${adsDir}/${kept}`))) problems.add(`${adsDir}/${kept}: missing although purchases is ${state}`);
        if (await exists(`${adsDir}/${removed}`)) problems.add(`${adsDir}/${removed}: present although purchases is ${state}`);
    } else if (await exists('core/ads')) {
        problems.add('core/ads: present although ads is off');
    }

    if (purchases || ads) {
        if (!(await exists('feature/monetization/presentation/build.gradle.kts'))) {
            problems.add('feature/monetization/presentation: missing although purchases or ads is on');
        }
        if (!/\bMonetizationPresentationModule\b/.test(initKoin)) {
            problems.add(`${initKoinRel}: MonetizationPresentationModule not registered`);
        }
    } else if (await exists('feature/monetization')) {
        problems.add('feature/monetization: present although purchases and ads are off');
    }
}

// Room: blank keeps core/room (Notes only) and feature/notes exactly when its room flag is on; showcase
// keeps core/room (favorites) only if the template has it and never the Notes demo. Existence and the
// entity list only — residue inside kept files is assertNoRoomResidue's job.
async function verifyRoom(projectPath, input, cfg, problems) {
    const blank = input.templateType === 'blank';
    const exists = (rel) => fs.pathExists(path.join(projectPath, rel));
    const hasRoom = await exists('core/room');
    const hasNotes = await exists('feature/notes');
    const roomOn = blank ? cfg.room === true : hasRoom;

    // The schema directory moves with the package; one left under the template's is a missed rename
    const schemasRel = 'core/room/schemas';
    if (await exists(schemasRel)) {
        for (const name of await fs.readdir(path.join(projectPath, schemasRel))) {
            if (name.startsWith(`${OLD_PACKAGE_NAME}.`)) problems.add(`${schemasRel}/${name}: stale Room schema directory`);
        }
    }

    if (!blank && hasNotes) problems.add('feature/notes: present in a showcase project');
    if (blank && !roomOn) {
        if (hasRoom) problems.add('core/room: present although room is off');
        if (hasNotes) problems.add('feature/notes: present although room is off');
    }
    if (!roomOn) return;

    const packagePath = input.packageName.replace(/\./g, '/');
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    const schemaRel = `${schemasRel}/${input.packageName}.core.room.AppDatabase/1.json`;
    const expected = blank ? 'NoteEntity' : 'FavoriteUserEntity';

    if (blank) {
        if (!hasRoom) problems.add('core/room: missing although room is on');
        if (!/\bRoomModule\b/.test(initKoin)) problems.add(`${initKoinRel}: RoomModule not registered`);
        if (!(await exists('feature/notes/presentation/build.gradle.kts'))) {
            problems.add('feature/notes/presentation: missing although room is on');
        }
        if (!/\bNotesPresentationModule\b/.test(initKoin)) problems.add(`${initKoinRel}: NotesPresentationModule not registered`);
    }

    const roomPackageDir = `core/room/src/commonMain/kotlin/${packagePath}/core/room`;
    const databaseRel = `${roomPackageDir}/AppDatabase.kt`;
    const database = await readIfExists(path.join(projectPath, databaseRel));
    const list = database.match(/entities\s*=\s*\[([^\]]*)\]/);
    if (!list) {
        problems.add(`${databaseRel}: missing or has no entities list`);
    } else {
        const entities = list[1].split(',').map((e) => e.replace(/::class/, '').trim()).filter(Boolean);
        if (entities.length !== 1 || entities[0] !== expected) {
            problems.add(`${databaseRel}: entities are [${entities.join(', ')}], expected [${expected}]`);
        }
    }
    if (!(await exists(schemaRel))) problems.add(`${schemaRel}: missing`);
    const stray = blank ? 'favorites' : 'notes';
    if (await exists(`${roomPackageDir}/${stray}`)) {
        problems.add(`${roomPackageDir}/${stray}: present in a ${blank ? 'blank' : 'showcase'} project`);
    }
}

// Kermit: every project keeps core/logging, wired through settings, initKoin and the KMP convention,
// and no Kotlin code calls println(. Keyed on the catalog's kermit entry, which no removal path
// deletes, so a pre-Kermit template (staging, an older tag) is not checked.
async function verifyLogging(projectPath, packagePath, problems) {
    const toml = await readIfExists(path.join(projectPath, 'gradle/libs.versions.toml'));
    if (!/^\s*kermit\s*=/m.test(toml)) return;

    if (!(await fs.pathExists(path.join(projectPath, 'core/logging/build.gradle.kts')))) {
        problems.add('core/logging: missing (every project keeps it)');
    }
    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    if (!settings.includes('":core:logging"')) problems.add('settings.gradle.kts: :core:logging not included');
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    if (!initKoin.includes('configureLogging(')) problems.add(`${initKoinRel}: configureLogging not called`);
    const conventionRel = 'build-logic/src/main/kotlin/convention/configureKotlinMultiplatform.kt';
    const convention = await readIfExists(path.join(projectPath, conventionRel));
    if (!convention.includes(':core:logging')) problems.add(`${conventionRel}: core:logging not wired`);

    // Comment and KDoc lines do not count; user input cannot produce println( (appName has no "(",
    // the project name is letters only)
    for (const file of await listTextFiles(projectPath)) {
        if (!file.endsWith('.kt')) continue;
        const lines = (await fs.readFile(file, 'utf8')).split('\n');
        const calls = lines.some((line) => !/^\s*(\/\/|\/\*|\*)/.test(line) && /(?<![A-Za-z0-9_.])println\(/.test(line));
        if (calls) problems.add(`${relPath(projectPath, file)}: println( (use the Kermit Logger)`);
    }
}

// Review: every project keeps core/review, wired through settings, initKoin, MainScreen and the
// feature presentation convention. Keyed on the catalog's play-review entry, which no removal path
// deletes, so a pre-Review template (staging, an older tag) is not checked.
async function verifyReview(projectPath, packagePath, problems) {
    const toml = await readIfExists(path.join(projectPath, 'gradle/libs.versions.toml'));
    if (!/^\s*play-review\s*=/m.test(toml)) return;

    if (!(await fs.pathExists(path.join(projectPath, 'core/review/build.gradle.kts')))) {
        problems.add('core/review: missing (every project keeps it)');
    }
    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    if (!settings.includes('":core:review"')) problems.add('settings.gradle.kts: :core:review not included');
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    // Word match: a custom module named "review" brings ReviewPresentationModule, not ReviewModule
    if (!/\bReviewModule\b/.test(initKoin)) problems.add(`${initKoinRel}: ReviewModule not registered`);
    const mainScreenRel = `shared/src/commonMain/kotlin/${packagePath}/MainScreen.kt`;
    const mainScreen = await readIfExists(path.join(projectPath, mainScreenRel));
    if (!/^(?![ \t]*\/\/).*\bReviewRequestEffect\(/m.test(mainScreen)) {
        problems.add(`${mainScreenRel}: ReviewRequestEffect not called`);
    }
    const conventionRel = 'build-logic/src/main/kotlin/convention/FeaturePresentationConventionPlugin.kt';
    const convention = await readIfExists(path.join(projectPath, conventionRel));
    if (!convention.includes('":core:review"')) problems.add(`${conventionRel}: core:review not wired`);
}

// Store-ready: a project with core/about keeps it wired and ships a Privacy Manifest whose data
// declarations follow the ads, purchases, backend and insights flags (showcase: ads and purchases on,
// insights when its template has core/insights). Keyed on core/about, which no removal path deletes,
// so a pre-store-ready template (staging, an older tag) is not checked.
async function verifyStoreReady(projectPath, input, packagePath, problems) {
    if (!(await fs.pathExists(path.join(projectPath, 'core/about/build.gradle.kts')))) return;

    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    if (!settings.includes('":core:about"')) problems.add('settings.gradle.kts: :core:about not included');
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    // Word match: a custom module named "about" brings AboutPresentationModule, not AboutModule
    if (!/\bAboutModule\b/.test(initKoin)) problems.add(`${initKoinRel}: AboutModule not registered`);

    const manifestRel = 'iosApp/iosApp/PrivacyInfo.xcprivacy';
    const manifestPath = path.join(projectPath, manifestRel);
    if (!(await fs.pathExists(manifestPath))) {
        problems.add(`${manifestRel}: missing`);
        return;
    }
    const manifest = await fs.readFile(manifestPath, 'utf8');
    if (manifest.includes('cmpose:')) problems.add(`${manifestRel}: cmpose marker left`);
    if (!manifest.includes('NSPrivacyAccessedAPICategoryUserDefaults')) problems.add(`${manifestRel}: required reason APIs missing`);

    const flags = input.featuresConfig ? input.featuresConfig : { ads: true, purchases: true, backend: false };
    const insights = await insightsOn(projectPath, input);
    if (flags.ads === true) {
        if (!manifest.includes('NSPrivacyCollectedDataTypeAdvertisingData')) {
            problems.add(`${manifestRel}: ad data not declared although ads is on`);
        }
    } else if (manifest.includes('NSPrivacyCollectedDataTypeAdvertisingData')
        || manifest.includes('NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising')
        // Insights declares a device ID too (for analytics, not advertising)
        || (!insights && manifest.includes('NSPrivacyCollectedDataTypeDeviceID'))
        || /<key>NSPrivacyTracking<\/key>\s*<true\/>/.test(manifest)) {
        problems.add(`${manifestRel}: ad data declared although ads is off`);
    }
    const purchaseHistory = manifest.includes('NSPrivacyCollectedDataTypePurchaseHistory');
    if (flags.purchases === true && !purchaseHistory) {
        problems.add(`${manifestRel}: purchase history not declared although purchases is on`);
    } else if (flags.purchases !== true && purchaseHistory) {
        problems.add(`${manifestRel}: purchase history declared although purchases is off`);
    }
    const accountData = manifest.includes('NSPrivacyCollectedDataTypeEmailAddress');
    if (flags.backend === true && !accountData) {
        problems.add(`${manifestRel}: account data not declared although backend is on`);
    } else if (flags.backend !== true && accountData) {
        problems.add(`${manifestRel}: account data declared although backend is off`);
    }
    const crashData = manifest.includes('NSPrivacyCollectedDataTypeCrashData');
    const analyticsData = manifest.includes('NSPrivacyCollectedDataTypePurposeAnalytics');
    if (insights) {
        if (!crashData) problems.add(`${manifestRel}: crash data not declared although insights is on`);
        if (!analyticsData) problems.add(`${manifestRel}: analytics data not declared although insights is on`);
    } else {
        if (crashData) problems.add(`${manifestRel}: crash data declared although insights is off`);
        if (analyticsData) problems.add(`${manifestRel}: analytics data declared although insights is off`);
    }
}

// Whether the project keeps core/insights: blank's flag; showcase when its template has it (an older one never had it)
async function insightsOn(projectPath, input) {
    if (input.templateType === 'blank') return (input.featuresConfig || {}).insights === true;
    return fs.pathExists(path.join(projectPath, INSIGHTS_DIR));
}

// Insights: core/insights, included, its iOS bridge and the firebase-ios-sdk Crashlytics and Analytics products
// exactly when it is on (insightsOn); none of them otherwise. Its privacy declarations are verifyStoreReady's.
async function verifyInsights(projectPath, input, packagePath, problems) {
    const on = await insightsOn(projectPath, input);
    const state = on ? 'missing although insights is on' : 'present although insights is off';
    const files = [
        { rel: 'core/insights', check: 'core/insights/build.gradle.kts' },
        { rel: `shared/src/iosMain/kotlin/${packagePath}/InsightsBridgeRegistration.kt` },
        { rel: 'iosApp/iosApp/InsightsBridge.swift' }
    ];
    for (const { rel, check = rel } of files) {
        if ((await fs.pathExists(path.join(projectPath, on ? check : rel))) !== on) problems.add(`${rel}: ${state}`);
    }
    if (on && !(await readIfExists(path.join(projectPath, 'settings.gradle.kts'))).includes('":core:insights"')) {
        problems.add('settings.gradle.kts: :core:insights not included');
    }
    const pbxprojRel = 'iosApp/iosApp.xcodeproj/project.pbxproj';
    const pbxproj = await readIfExists(path.join(projectPath, pbxprojRel));
    for (const product of INSIGHTS_FIREBASE_PRODUCTS) {
        const linked = new RegExp(`\\b${product}\\b`).test(pbxproj);
        if (on && !linked) problems.add(`${pbxprojRel}: ${product} not linked although insights is on`);
        if (!on && linked) problems.add(`${pbxprojRel}: ${product} linked although insights is off`);
    }
}

// Network UX: every project keeps core/update, wired through settings, initKoin and MainScreen, which
// also shows the offline banner; the network state permission stays exactly when core/network does
// (showcase: always). Keyed on the catalog's play-app-update entry, which no removal path deletes, so
// a pre-network-ux template (staging, an older tag) is not checked.
async function verifyNetworkUx(projectPath, input, packagePath, problems) {
    const toml = await readIfExists(path.join(projectPath, 'gradle/libs.versions.toml'));
    if (!/^\s*play-app-update\s*=/m.test(toml)) return;

    if (!(await fs.pathExists(path.join(projectPath, 'core/update/build.gradle.kts')))) {
        problems.add('core/update: missing (every project keeps it)');
    }
    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    if (!settings.includes('":core:update"')) problems.add('settings.gradle.kts: :core:update not included');
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    // Word match: a custom module named "update" brings UpdatePresentationModule, not UpdateModule
    if (!/\bUpdateModule\b/.test(initKoin)) problems.add(`${initKoinRel}: UpdateModule not registered`);
    const mainScreenRel = `shared/src/commonMain/kotlin/${packagePath}/MainScreen.kt`;
    const mainScreen = await readIfExists(path.join(projectPath, mainScreenRel));
    if (!/^(?![ \t]*\/\/).*\bAppUpdateEffect\(/m.test(mainScreen)) problems.add(`${mainScreenRel}: AppUpdateEffect not called`);
    if (!/^(?![ \t]*\/\/).*\bOfflineBanner\(/m.test(mainScreen)) problems.add(`${mainScreenRel}: OfflineBanner not shown`);

    const network = input.templateType !== 'blank' || (input.featuresConfig || {}).network === true;
    const manifestRel = 'androidApp/src/main/AndroidManifest.xml';
    const manifest = await readIfExists(path.join(projectPath, manifestRel));
    const networkState = /android:name="android\.permission\.ACCESS_NETWORK_STATE"/.test(manifest);
    if (network && !networkState) {
        problems.add(`${manifestRel}: ACCESS_NETWORK_STATE missing although network is on`);
    } else if (!network && networkState) {
        problems.add(`${manifestRel}: ACCESS_NETWORK_STATE present although network is off`);
    }
}

// Coil: every project keeps core/image, included, and MainScreen calls ImageLoaderSetup(); no Kamel is
// left in the build or Kotlin code, and blank with network off carries no Coil network library. Keyed
// on the catalog's coil-compose entry, which no removal path deletes, so a pre-Coil (Kamel) template
// (staging, an older tag) is not checked.
async function verifyImages(projectPath, input, packagePath, problems) {
    const toml = await readIfExists(path.join(projectPath, 'gradle/libs.versions.toml'));
    if (!/^\s*coil-compose\s*=/m.test(toml)) return;

    if (!(await fs.pathExists(path.join(projectPath, 'core/image/build.gradle.kts')))) {
        problems.add('core/image: missing (every project keeps it)');
    }
    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    if (!settings.includes('":core:image"')) problems.add('settings.gradle.kts: :core:image not included');
    const mainScreenRel = `shared/src/commonMain/kotlin/${packagePath}/MainScreen.kt`;
    const mainScreen = await readIfExists(path.join(projectPath, mainScreenRel));
    if (!/^(?![ \t]*\/\/).*\bImageLoaderSetup\(/m.test(mainScreen)) problems.add(`${mainScreenRel}: ImageLoaderSetup not called`);

    // Only build and Kotlin files, and only dotted package/accessor forms: user input (appName may
    // be "kamel" or "io.kamel") lands in strings.xml and the xcconfig, and the letters-only project
    // name never forms a dotted path or "kamelImage"
    const network = input.templateType !== 'blank' || (input.featuresConfig || {}).network === true;
    for (const file of await listTextFiles(projectPath)) {
        if (!/\.(kt|kts|toml)$/.test(file)) continue;
        const rel = relPath(projectPath, file);
        const content = await fs.readFile(file, 'utf8');
        if (/(?<![A-Za-z0-9_])(media\.kamel|io\.kamel|libs\.kamel|kamelImage)(?![A-Za-z0-9_])/.test(content)) {
            problems.add(`${rel}: Kamel left (the template uses Coil)`);
        }
        if (network) continue;
        if (rel === 'gradle/libs.versions.toml') {
            if (/^\s*coil-network-ktor3\s*=/m.test(content)) problems.add(`${rel}: coil-network-ktor3 although network is off`);
        } else if (rel.endsWith('.kts') && /\blibs\.coil\.network\b/.test(content)) {
            problems.add(`${rel}: libs.coil.network although network is off`);
        }
    }
}

// Deep link: a project with core/navigation's DeepLinkHandler registers its scheme (the project name in
// lower case) in the manifest's VIEW filter and the plist's CFBundleURLSchemes, and both platforms hand
// the link to the shared handleDeepLink; showcase keeps its user and settings routes. Keyed on the
// handler, which no removal path deletes, so a pre-deeplink template (staging, an older tag) is not checked.
async function verifyDeepLinks(projectPath, input, packagePath, problems) {
    const handlerRel = `core/navigation/src/commonMain/kotlin/${packagePath}/core/navigation/DeepLinkHandler.kt`;
    if (!(await fs.pathExists(path.join(projectPath, handlerRel)))) return;

    const scheme = input.projectName.toLowerCase();
    const stripXmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, '');
    const manifestRel = 'androidApp/src/main/AndroidManifest.xml';
    const manifest = stripXmlComments(await readIfExists(path.join(projectPath, manifestRel)));
    if (!manifest.includes(`android:scheme="${scheme}"`) || !manifest.includes('android.intent.action.VIEW')) {
        problems.add(`${manifestRel}: deep link scheme ${scheme} not registered`);
    }
    const plistRel = 'iosApp/iosApp/Info.plist';
    const plist = stripXmlComments(await readIfExists(path.join(projectPath, plistRel)));
    const urlSchemes = new RegExp(`<key>CFBundleURLSchemes</key>\\s*<array>(?:(?!</array>)[\\s\\S])*<string>${escapeRegExp(scheme)}</string>`);
    if (!urlSchemes.test(plist)) problems.add(`${plistRel}: URL scheme ${scheme} not registered`);

    const mainActivityRel = `androidApp/src/main/kotlin/${packagePath}/MainActivity.kt`;
    const mainActivity = await readIfExists(path.join(projectPath, mainActivityRel));
    // A call or a function reference (the template: intent?.dataString?.let(::handleDeepLink))
    if (!/^(?![ \t]*\/\/).*\bhandleDeepLink\b/m.test(mainActivity)) problems.add(`${mainActivityRel}: handleDeepLink not called`);
    const iosAppRel = 'iosApp/iosApp/iOSApp.swift';
    const iosApp = await readIfExists(path.join(projectPath, iosAppRel));
    if (!/^(?![ \t]*\/\/).*\.onOpenURL\b/m.test(iosApp)) problems.add(`${iosAppRel}: onOpenURL not handled`);

    const required = [`shared/src/commonMain/kotlin/${packagePath}/DeepLinks.kt`];
    if (input.templateType !== 'blank') {
        required.push(
            `feature/home/presentation/src/commonMain/kotlin/${packagePath}/feature/home/presentation/navigation/UserDeepLink.kt`,
            `feature/onboarding/presentation/src/commonMain/kotlin/${packagePath}/feature/onboarding/presentation/navigation/SettingsDeepLink.kt`
        );
    }
    for (const rel of required) {
        if (!(await fs.pathExists(path.join(projectPath, rel)))) problems.add(`${rel}: missing`);
    }
}

// Paywall: with purchases on, the paywall is the template's own Compose screen (no RevenueCatUI anywhere) and
// MainScreen opens it once at the first launch; with ads on, Koin provides InterstitialPacer. Keyed on core/purchases'
// PurchaseResult.kt and core/ads' InterstitialPacer.kt, which no removal path deletes while their flag is on, so a
// pre-paywall template (staging, an older tag) is not checked. Showcase has both flags on.
async function verifyPaywall(projectPath, input, packagePath, problems) {
    const cfg = input.templateType === 'blank' ? (input.featuresConfig || {}) : { purchases: true, ads: true };
    const exists = (rel) => fs.pathExists(path.join(projectPath, rel));
    const presentationSrc = `feature/monetization/presentation/src/commonMain/kotlin/${packagePath}/feature/monetization/presentation`;

    if (cfg.purchases === true && (await exists(`core/purchases/src/commonMain/kotlin/${packagePath}/core/purchases/PurchaseResult.kt`))) {
        const toml = await readIfExists(path.join(projectPath, 'gradle/libs.versions.toml'));
        if (/^\s*revenuecat-ui\s*=/m.test(toml)) problems.add('gradle/libs.versions.toml: revenuecat-ui left (the paywall is the template\'s own screen)');
        for (const file of await listTextFiles(projectPath)) {
            if (!/\.(kt|kts)$/.test(file)) continue;
            const content = await fs.readFile(file, 'utf8');
            if (/^\s*import\s+com\.revenuecat\.purchases\.kmp\.ui\b/m.test(content) || /\blibs\.revenuecat\.ui\b/.test(content)) {
                problems.add(`${relPath(projectPath, file)}: RevenueCatUI (the paywall is the template's own screen)`);
            }
        }
        const firstLaunchRel = `${presentationSrc}/paywall/FirstLaunchPaywall.kt`;
        if (!(await exists(firstLaunchRel))) problems.add(`${firstLaunchRel}: missing although purchases is on`);
        const mainScreenRel = `shared/src/commonMain/kotlin/${packagePath}/MainScreen.kt`;
        const mainScreen = await readIfExists(path.join(projectPath, mainScreenRel));
        if (!/^(?![ \t]*\/\/).*\bFirstLaunchPaywall\(/m.test(mainScreen)) {
            problems.add(`${mainScreenRel}: FirstLaunchPaywall not called although purchases is on`);
        }
    }

    if (cfg.ads === true && (await exists(`core/ads/src/commonMain/kotlin/${packagePath}/core/ads/InterstitialPacer.kt`))) {
        const providerRel = `${presentationSrc}/ads/InterstitialPacerProvider.kt`;
        const provider = await readIfExists(path.join(projectPath, providerRel));
        if (!/\bfun provideInterstitialPacer\(/.test(provider)) problems.add(`${providerRel}: InterstitialPacer not provided although ads is on`);
    }
}

async function readIfExists(file) {
    return (await fs.pathExists(file)) ? fs.readFile(file, 'utf8') : '';
}

// Backend: blank keeps the server, core/api, core/auth, feature/account and feature/sharing exactly when its
// backend flag is on, wired, with the Google Sign-In URL scheme left to the build setting; otherwise (and
// always in showcase) none of them and no reference to them. No cmpose:backend marker is ever left.
// server/ is the backend template, an included build (includeBuild("server")), so it is checked apart from the modules.
const BACKEND_MODULES = [
    { dir: 'core/api', build: 'core/api/build.gradle.kts', include: ':core:api' },
    { dir: 'core/auth', build: 'core/auth/build.gradle.kts', include: ':core:auth' },
    { dir: 'feature/account', build: 'feature/account/presentation/build.gradle.kts', include: ':feature:account:presentation' },
    { dir: 'feature/sharing', build: 'feature/sharing/presentation/build.gradle.kts', include: ':feature:sharing:presentation' }
];
const BACKEND_SHARED_DEPENDENCIES = ['projects.core.auth', 'projects.feature.account.presentation', 'projects.feature.sharing.presentation'];
const BACKEND_KOIN_MODULES = ['AuthModule', 'AccountModule', 'SharingModule'];
const GOOGLE_URL_SCHEME = '<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>';
const BACKEND_MARKER = 'cmpose:backend';
const LOCAL_SERVER_DIR = /^[ \t]*localServerDir[ \t]*=[ \t]*\.\.\/\.local-server[ \t]*$/m;
const BACKEND_TEMPLATE_PACKAGE = 'io.cmpose.backendtemplate';
const SERVER_PRUNED = new Set(['.git', '.gradle', '.kotlin', 'build', '.local-server']);

// Every file under server/ (build output aside) holding the backend template's own package: the rename missed it
async function serverTemplateResidue(projectPath, rel = SERVER_DIR, out = []) {
    for (const entry of await fs.readdir(path.join(projectPath, rel), { withFileTypes: true })) {
        if (SERVER_PRUNED.has(entry.name)) continue;
        const child = `${rel}/${entry.name}`;
        if (child.includes(BACKEND_TEMPLATE_PACKAGE.replace(/\./g, '/'))) out.push(child);
        if (entry.isDirectory()) {
            await serverTemplateResidue(projectPath, child, out);
        } else if (entry.isFile()) {
            const buffer = await fs.readFile(path.join(projectPath, child));
            if (!buffer.includes(0) && buffer.toString('utf8').includes(BACKEND_TEMPLATE_PACKAGE)) out.push(child);
        }
    }
    return out;
}

async function verifyServer(projectPath, input, settings, problems) {
    const exists = (rel) => fs.pathExists(path.join(projectPath, rel));
    for (const rel of ['server/settings.gradle.kts', 'server/build.gradle.kts']) {
        if (!(await exists(rel))) problems.add(`${rel}: missing although backend is on`);
    }
    if (!INCLUDE_SERVER_BUILD.test(settings)) problems.add('settings.gradle.kts: includeBuild("server") missing although backend is on');
    if (!LOCAL_SERVER_DIR.test(await readIfExists(path.join(projectPath, SERVER_DIR, 'gradle.properties')))) {
        problems.add('server/gradle.properties: localServerDir=../.local-server missing (the local server lives in the root .local-server/)');
    }
    if (await exists('server/.github')) problems.add('server/.github: the backend template\'s CI left (the project\'s own CI builds server/)');
    const serverPath = serverPackageOf(input.packageName).replace(/\./g, '/');
    for (const rel of [`server/src/main/kotlin/${serverPath}`, `server/src/local/kotlin/${serverPath}/local/LocalMain.kt`]) {
        if (!(await exists(rel))) problems.add(`${rel}: missing although backend is on`);
    }
    // A package that spells the template's own (io.cmpose.backendtemplate.x) is the user's, not residue
    if (!(await exists(SERVER_DIR)) || input.packageName.includes(BACKEND_TEMPLATE_PACKAGE)) return;
    for (const rel of new Set(await serverTemplateResidue(projectPath))) problems.add(`${rel}: ${BACKEND_TEMPLATE_PACKAGE} left`);
}

async function verifyBackend(projectPath, input, cfg, problems) {
    const on = input.templateType === 'blank' && cfg.backend === true;
    const exists = (rel) => fs.pathExists(path.join(projectPath, rel));

    for (const file of await listTextFiles(projectPath)) {
        if ((await fs.readFile(file, 'utf8')).includes(BACKEND_MARKER)) problems.add(`${relPath(projectPath, file)}: ${BACKEND_MARKER} marker left`);
    }

    if (!on) {
        const where = input.templateType === 'blank' ? 'although backend is off' : 'in a showcase project';
        for (const dir of [SERVER_DIR, ...BACKEND_MODULES.map((m) => m.dir)]) {
            if (await exists(dir)) problems.add(`${dir}: present ${where}`);
        }
        // Showcase keeps core/insights (and the Firebase setup with it) when its template has it
        const tokens = backendResidueTokens({ insights: await insightsOn(projectPath, input) }).filter((token) => token.label !== BACKEND_MARKER);
        for (const problem of await findResidue(projectPath, input.packageName, { tokens, files: [] })) {
            problems.add(problem.split(path.sep).join('/'));
        }
        return;
    }

    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    for (const { build, include } of BACKEND_MODULES) {
        if (!(await exists(build))) problems.add(`${build}: missing although backend is on`);
        if (!settings.includes(`"${include}"`)) problems.add(`settings.gradle.kts: ${include} not included`);
    }
    await verifyServer(projectPath, input, settings, problems);
    const sharedBuild = await readIfExists(path.join(projectPath, 'shared', 'build.gradle.kts'));
    for (const dependency of BACKEND_SHARED_DEPENDENCIES) {
        if (!new RegExp(`\\b${escapeRegExp(dependency)}(?![A-Za-z0-9.])`).test(sharedBuild)) {
            problems.add(`shared/build.gradle.kts: ${dependency} not a dependency`);
        }
    }
    const packagePath = input.packageName.replace(/\./g, '/');
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    // Word match: a custom module named "auth" brings AuthPresentationModule, not AuthModule
    for (const module of BACKEND_KOIN_MODULES) {
        if (!new RegExp(`\\b${module}\\b`).test(initKoin)) problems.add(`${initKoinRel}: ${module} not registered`);
    }
    const plistRel = 'iosApp/iosApp/Info.plist';
    if (!(await readIfExists(path.join(projectPath, plistRel))).includes(GOOGLE_URL_SCHEME)) {
        problems.add(`${plistRel}: the $(GOOGLE_REVERSED_CLIENT_ID) URL scheme is missing`);
    }
}

// One version for both platforms (the server's X-Client-Version check compares it): the iOS MARKETING_VERSION equals
// AppConfig.versionName. Keyed on both values, so a template without them (staging, an older tag) is not checked.
async function verifyAppVersion(projectPath, problems) {
    const xcconfig = await readIfExists(path.join(projectPath, 'iosApp/Configuration/Config.xcconfig'));
    const marketing = xcconfig.match(/^[ \t]*MARKETING_VERSION[ \t]*=[ \t]*([^\s]+)[ \t]*$/m);
    const appConfig = await readIfExists(path.join(projectPath, 'build-logic/src/main/kotlin/config/AppConfig.kt'));
    const part = (name) => (appConfig.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)\\b`)) || [])[1];
    const [major, minor, patch] = ['versionMajor', 'versionMinor', 'versionPatch'].map(part);
    if (!marketing || major === undefined || minor === undefined || patch === undefined) return;
    const versionName = `${major}.${minor}.${patch}`;
    if (marketing[1] !== versionName) problems.add(`iOS MARKETING_VERSION (${marketing[1]}) must equal AppConfig.versionName (${versionName})`);
}

const run = (command, args, options) => new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
});
const DOCKER_INFO_TIMEOUT_MS = 20000;
const DOCKER_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

/** The server image check: docker build -f server/deploy/Dockerfile server. { status: 'PASS' | 'SKIP' | 'FAIL', detail };
 * SKIP when Docker (the docker command and its daemon) is not available */
async function checkServerImage(projectPath, { docker = 'docker' } = {}) {
    const info = await run(docker, ['info', '--format', '{{.ServerVersion}}'], { timeout: DOCKER_INFO_TIMEOUT_MS });
    if (info.error) return { status: 'SKIP', detail: 'Docker is not available' };
    const build = await run(docker, ['build', '--quiet', '-f', path.join(SERVER_DIR, 'deploy', 'Dockerfile'), SERVER_DIR],
        { cwd: projectPath, timeout: DOCKER_BUILD_TIMEOUT_MS });
    if (build.error) {
        const tail = `${build.stderr || build.error.message}`.trim().split('\n').slice(-5).join(' | ');
        return { status: 'FAIL', detail: tail };
    }
    // The image itself is not kept (the build cache is)
    const image = build.stdout.trim().split('\n').pop();
    if (image) await run(docker, ['image', 'rm', image], { timeout: DOCKER_INFO_TIMEOUT_MS });
    return { status: 'PASS', detail: image };
}

const SERVER_IMAGE_ENV = 'CMPOSE_SERVER_IMAGE_CHECK';
const NOT_REQUESTED = `not requested (set ${SERVER_IMAGE_ENV}=1)`;

/** Which server image check runs, null = none. Opt-in: the option (a check function, true for the Docker check, false
 * for none) wins; without it, CMPOSE_SERVER_IMAGE_CHECK=1 asks for the Docker check. Generation for an end user never
 * pays minutes for an image or loses a valid project to the network. */
function resolveServerImageCheck(option, env = process.env) {
    if (typeof option === 'function') return option;
    if (option === true) return checkServerImage;
    if (option === false) return null;
    return env[SERVER_IMAGE_ENV] === '1' ? checkServerImage : null;
}

// The server image builds (the backend template's own gate does not build it with the app's server package); skipped
// without Docker, and unless asked for
async function verifyServerImage(projectPath, serverImageCheck, problems) {
    const { status, detail } = serverImageCheck
        ? await serverImageCheck(projectPath)
        : { status: 'SKIP', detail: NOT_REQUESTED };
    if (status === 'FAIL') {
        problems.add(`server/deploy/Dockerfile: the server image does not build (docker build -f server/deploy/Dockerfile server): ${detail}`);
    } else {
        log.info(`${status === 'PASS' ? '✅' : '⏭️'} server image: ${status}${status === 'SKIP' && detail ? ` (${detail})` : ''}`);
    }
}

/**
 * Checks the generated project right before it is zipped; throws if anything is wrong (the request fails).
 * @param {string} projectPath
 * @param {{ projectName: string, appName: string, packageName: string, templateType: string, features: string[], featuresConfig?: object | null }} input
 * @param {{ serverImageCheck?: boolean | ((projectPath: string) => Promise<{ status: 'PASS' | 'SKIP' | 'FAIL', detail?: string }>),
 *   env?: object }} [options] the server image check (backend on; resolveServerImageCheck: opt-in, the option or
 *   CMPOSE_SERVER_IMAGE_CHECK=1 in env), run last and only when nothing else failed
 */
async function verifyGeneratedProject(projectPath, input, { serverImageCheck, env = process.env } = {}) {
    const packagePath = input.packageName.replace(/\./g, '/');
    const problems = new Set();

    // 1. Template identity leftovers
    const rules = STALE_IDENTIFIER_RULES.filter((rule) => !rule.skip(input));
    for (const file of await listTextFiles(projectPath)) {
        const rel = path.relative(projectPath, file).split(path.sep).join('/');
        const rootMatch = rel.match(OLD_PACKAGE_DIR_REGEX);
        if (rootMatch) {
            const dirEnd = rootMatch.index + rootMatch[0].length; // ends with '/'
            problems.add(`${rel.slice(0, dirEnd - 1)}: old template package directory`);
        }
        if (rules.length === 0) continue;
        const content = await fs.readFile(file, 'utf8');
        for (const rule of rules) {
            if (rule.appliesTo && !rule.appliesTo(rel)) continue;
            if (rule.regex.test(content)) problems.add(`${rel}: ${rule.label}`);
        }
    }

    // 2. Key files
    const keyFiles = [
        'settings.gradle.kts',
        'gradle/libs.versions.toml',
        'androidApp/build.gradle.kts',
        'shared/build.gradle.kts',
        'iosApp/Configuration/Config.xcconfig',
        `shared/src/commonMain/kotlin/${packagePath}/MainScreen.kt`
    ];
    for (const rel of keyFiles) {
        if (!(await fs.pathExists(path.join(projectPath, rel)))) problems.add(`${rel}: missing`);
    }

    // 3. Are the requested modules really wired
    const settings = await readIfExists(path.join(projectPath, 'settings.gradle.kts'));
    const sharedBuild = await readIfExists(path.join(projectPath, 'shared', 'build.gradle.kts'));
    const initKoinRel = `shared/src/commonMain/kotlin/${packagePath}/di/initKoin.kt`;
    const initKoin = await readIfExists(path.join(projectPath, initKoinRel));
    for (const moduleName of input.features || []) {
        for (const layer of MODULE_LAYERS) {
            const rel = `feature/${moduleName}/${layer}/build.gradle.kts`;
            if (!(await fs.pathExists(path.join(projectPath, rel)))) problems.add(`${rel}: missing`);
        }
        if (!settings.includes(`":feature:${moduleName}:presentation"`)) {
            problems.add(`settings.gradle.kts: :feature:${moduleName} not included`);
        }
        if (!sharedBuild.includes(`projects.feature.${moduleName}.presentation`)) {
            problems.add(`shared/build.gradle.kts: feature ${moduleName} not a dependency`);
        }
        for (const layer of ['Presentation', 'Data', 'Domain']) {
            const koinModule = `${capitalize(moduleName)}${layer}Module`;
            if (!initKoin.includes(`add(${koinModule}().module)`)) {
                problems.add(`${initKoinRel}: ${koinModule} not registered`);
            }
        }
    }

    // 4. Template skeleton leftovers
    if (await fs.pathExists(path.join(projectPath, 'blank'))) problems.add('blank/: template shell overlay left in the project');
    const requested = new Set(input.features || []);
    if (!requested.has('sample')) {
        if (await fs.pathExists(path.join(projectPath, 'feature', 'sample'))) problems.add('feature/sample: template sample module left in the project');
        if (/feature:sample(?![A-Za-z0-9_])/.test(settings)) problems.add('settings.gradle.kts: :feature:sample still included');
    }
    for (const moduleName of requested) {
        if (moduleName === 'sample') continue;
        const moduleDir = path.join(projectPath, 'feature', moduleName);
        if (!(await fs.pathExists(moduleDir))) continue;
        for (const file of await listTextFiles(moduleDir)) {
            // A clone keeps no Sample-prefixed identifier (SampleViewModel, SampleEntry, ...)
            if (/(?<![A-Za-z])Sample[A-Z]/.test(await fs.readFile(file, 'utf8'))) {
                problems.add(`${path.relative(projectPath, file).split(path.sep).join('/')}: sample module name left in a clone`);
            }
        }
    }

    // 5. Blank shell wiring, theme leftovers, template tests
    if (input.templateType === 'blank') await verifyBlankShell(projectPath, input, problems);

    // 6. Room and the Notes demo, for every template
    await verifyRoom(projectPath, input, input.featuresConfig || {}, problems);

    // 7. Kermit: core/logging and its wiring, no println(, for every template
    await verifyLogging(projectPath, packagePath, problems);

    // 8. Review: core/review and its wiring, for every template
    await verifyReview(projectPath, packagePath, problems);

    // 9. Store-ready: core/about wiring and the Privacy Manifest declarations, for every template
    await verifyStoreReady(projectPath, input, packagePath, problems);

    // 9b. Insights: core/insights, its iOS bridge and the Crashlytics and Analytics products exactly when it is on
    await verifyInsights(projectPath, input, packagePath, problems);

    // 10. Network UX: core/update, the offline banner and the network state permission, for every template
    await verifyNetworkUx(projectPath, input, packagePath, problems);

    // 11. Coil: core/image, ImageLoaderSetup, no Kamel and no Coil network library with network off
    await verifyImages(projectPath, input, packagePath, problems);

    // 12. Deep link: the scheme on both platforms, both entry points and the showcase routes
    await verifyDeepLinks(projectPath, input, packagePath, problems);

    // 13. Paywall: the template's own paywall, the first-launch call and the interstitial pacer
    await verifyPaywall(projectPath, input, packagePath, problems);

    // 14. Backend: the server and its modules exactly when blank's backend flag is on, no residue otherwise
    await verifyBackend(projectPath, input, input.featuresConfig || {}, problems);

    // 15. One app version for both platforms
    await verifyAppVersion(projectPath, problems);

    // 16. The server image, last: it takes minutes, so only a project that passed everything else is built
    const backendOn = input.templateType === 'blank' && (input.featuresConfig || {}).backend === true;
    if (backendOn && problems.size === 0) await verifyServerImage(projectPath, resolveServerImageCheck(serverImageCheck, env), problems);

    if (problems.size > 0) {
        // Cap the message: a badly broken generation (many unwired modules) can produce dozens of
        // lines, which is unreadable in an error response or a log line.
        const MAX_LISTED = 20;
        const list = [...problems];
        const shown = list.length > MAX_LISTED
            ? [...list.slice(0, MAX_LISTED), `…and ${list.length - MAX_LISTED} more`]
            : list;
        throw new Error(`Generated project verification failed:\n  ${shown.join('\n  ')}`);
    }
}

module.exports = { verifyGeneratedProject, verifyBackend, verifyAppVersion, checkServerImage, resolveServerImageCheck, SERVER_IMAGE_ENV };
