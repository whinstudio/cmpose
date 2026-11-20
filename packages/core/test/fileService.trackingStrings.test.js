const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processCoreFeatures, removeTrackingStrings } = require('../src/fileService');
const { verifyGeneratedProject } = require('../src/generationVerifier');

// The template's localized ATT purpose strings (iosApp/iosApp/<lang>.lproj/InfoPlist.strings)
const TRACKING_TEXTS = {
    en: 'This identifier is used to show you more relevant ads.',
    tr: 'Bu tanımlayıcı, size daha ilgili reklamlar göstermek için kullanılır.',
    es: 'Este identificador se usa para mostrarte anuncios más relevantes.',
    it: 'Questo identificatore viene usato per mostrarti annunci più pertinenti.',
    fr: 'Cet identifiant est utilisé pour vous montrer des publicités plus pertinentes.'
};
const LANGS = Object.keys(TRACKING_TEXTS);
const stringsRel = (lang) => `iosApp/iosApp/${lang}.lproj/InfoPlist.strings`;
const stringsContent = (lang) => `"NSUserTrackingUsageDescription" = "${TRACKING_TEXTS[lang]}";\n`;

const NEW_PACKAGE = 'dev.cmpose.app';
const PKG = 'dev/cmpose/app';
const INFO_PLIST = 'iosApp/iosApp/Info.plist';
// Info.plist with the English fallback of the ATT text (and the AdMob keys ads off strips)
const PLIST = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>CFBundleDisplayName</key>',
    '\t<string>$(PRODUCT_NAME)</string>',
    '\t<key>GADApplicationIdentifier</key>',
    '\t<string>ca-app-pub-3940256099942544~1458002511</string>',
    '\t<key>NSUserTrackingUsageDescription</key>',
    '\t<string>$(PRODUCT_NAME) uses this identifier to show you more relevant ads.</string>',
    '</dict>',
    '</plist>',
    ''
].join('\n');

async function tmpDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-tracking-strings-'));
}

async function seedStrings(dir) {
    for (const lang of LANGS) await fs.outputFile(path.join(dir, stringsRel(lang)), stringsContent(lang));
}

const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));
const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

test('removeTrackingStrings deletes the five InfoPlist.strings and their emptied .lproj folders', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedStrings(dir);
    await fs.outputFile(path.join(dir, INFO_PLIST), PLIST);
    // Not a localization folder: an InfoPlist.strings outside a .lproj folder is not the template's
    await fs.outputFile(path.join(dir, 'iosApp/iosApp/Assets.xcassets/Contents.json'), '{}\n');

    await removeTrackingStrings(dir);

    for (const lang of LANGS) assert.equal(await exists(dir, `iosApp/iosApp/${lang}.lproj`), false, lang);
    assert.equal(await read(dir, INFO_PLIST), PLIST);
    assert.ok(await exists(dir, 'iosApp/iosApp/Assets.xcassets/Contents.json'));
});

test('removeTrackingStrings keeps an .lproj folder that holds other files and deletes only InfoPlist.strings', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedStrings(dir);
    const localizable = '"greeting" = "Merhaba";\n';
    await fs.outputFile(path.join(dir, 'iosApp/iosApp/tr.lproj/Localizable.strings'), localizable);

    await removeTrackingStrings(dir);

    assert.equal(await exists(dir, stringsRel('tr')), false);
    assert.equal(await read(dir, 'iosApp/iosApp/tr.lproj/Localizable.strings'), localizable);
    for (const lang of LANGS.filter((l) => l !== 'tr')) assert.equal(await exists(dir, `iosApp/iosApp/${lang}.lproj`), false, lang);
});

test('removeTrackingStrings does nothing without iosApp and is idempotent', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'include(":shared")\n');
    await removeTrackingStrings(dir);
    assert.deepEqual(await fs.readdir(dir), ['settings.gradle.kts']);

    await seedStrings(dir);
    await removeTrackingStrings(dir);
    await removeTrackingStrings(dir);
    assert.deepEqual(await fs.readdir(path.join(dir, 'iosApp/iosApp')), []);
});

// Every other flag on: only the ads and multiLang blocks act on the strings
const ALL_ON = { network: true, networkInspector: true, theming: true, dataStore: true, detekt: true, purchases: true };

async function seedCoreTree(dir) {
    await seedStrings(dir);
    await fs.outputFile(path.join(dir, INFO_PLIST), PLIST);
    await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'include(":shared")\n');
    await fs.outputFile(path.join(dir, 'shared/build.gradle.kts'), 'plugins { }\n');
    await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`), `package ${NEW_PACKAGE}\n`);
}

test('ads on + multiLang off: no InfoPlist.strings left, Info.plist keeps the English ATT text', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedCoreTree(dir);

    await processCoreFeatures(dir, { ...ALL_ON, ads: true, multiLang: false }, NEW_PACKAGE);

    for (const lang of LANGS) assert.equal(await exists(dir, `iosApp/iosApp/${lang}.lproj`), false, lang);
    assert.equal(await read(dir, INFO_PLIST), PLIST);
});

test('ads off + multiLang on: no InfoPlist.strings left and no NSUserTrackingUsageDescription anywhere', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedCoreTree(dir);

    await processCoreFeatures(dir, { ...ALL_ON, ads: false, multiLang: true }, NEW_PACKAGE);

    for (const lang of LANGS) assert.equal(await exists(dir, `iosApp/iosApp/${lang}.lproj`), false, lang);
    assert.doesNotMatch(await read(dir, INFO_PLIST), /NSUserTrackingUsageDescription/);
});

test('ads and multiLang on: the five InfoPlist.strings stay byte for byte', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedCoreTree(dir);

    await processCoreFeatures(dir, { ...ALL_ON, ads: true, multiLang: true }, NEW_PACKAGE);

    for (const lang of LANGS) assert.equal(await read(dir, stringsRel(lang)), stringsContent(lang), lang);
});

// A minimal generated project the verifier accepts for the input, the strings aside
async function seedVerifiable(dir, input) {
    const pkg = input.packageName.replace(/\./g, '/');
    const files = {
        'settings.gradle.kts': `rootProject.name = "${input.projectName}"\ninclude(":shared")\n`,
        'gradle/libs.versions.toml': '[versions]\nkotlin = "2.3.21"\n',
        'androidApp/build.gradle.kts': 'plugins { }\n',
        'shared/build.gradle.kts': 'plugins { }\n',
        'iosApp/Configuration/Config.xcconfig': `PRODUCT_BUNDLE_IDENTIFIER=${input.packageName}\n`,
        [`shared/src/commonMain/kotlin/${pkg}/MainScreen.kt`]:
            `package ${input.packageName}\n\nfun mainScreen() {\n    LocalStringResources provides strings\n    setSystemLanguage()\n}\n`,
        [`shared/src/commonMain/kotlin/${pkg}/di/initKoin.kt`]: '\n'
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
}

const BLANK = { projectName: 'Demo', appName: 'Demo App', packageName: 'dev.cmpose.demo', templateType: 'blank', features: [] };

async function verifierProblems(dir, input) {
    try {
        await verifyGeneratedProject(dir, input);
        return [];
    } catch (err) {
        return err.message.split('\n').slice(1).map((line) => line.trim());
    }
}

const missing = (lang) => `${stringsRel(lang)}: missing although ads and multiLang are on`;
const present = (lang) => `${stringsRel(lang)}: present although ads or multiLang is off`;

test('the verifier reports each InfoPlist.strings left with ads or multiLang off', async (t) => {
    for (const featuresConfig of [{ ads: false, multiLang: true }, { ads: false, multiLang: false }]) {
        const dir = await tmpDir();
        t.after(() => fs.remove(dir));
        await seedVerifiable(dir, BLANK);
        await seedStrings(dir);
        const problems = await verifierProblems(dir, { ...BLANK, featuresConfig });
        for (const lang of LANGS) assert.ok(problems.includes(present(lang)), `${lang}: ${problems.join(' | ')}`);
        assert.ok(!problems.some((p) => p.includes('missing although ads and multiLang')), problems.join(' | '));
    }
});

test('the verifier reports an InfoPlist.strings in another .lproj folder left with ads or multiLang off', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedVerifiable(dir, BLANK);
    await fs.outputFile(path.join(dir, stringsRel('de')), '"NSUserTrackingUsageDescription" = "x";\n');
    const problems = await verifierProblems(dir, { ...BLANK, featuresConfig: { ads: false, multiLang: true } });
    assert.ok(problems.includes(present('de')), problems.join(' | '));
});

test('the verifier passes a blank project with ads or multiLang off and no InfoPlist.strings', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedVerifiable(dir, BLANK);
    // a Localizable.strings the user adds is not the ATT text
    await fs.outputFile(path.join(dir, 'iosApp/iosApp/tr.lproj/Localizable.strings'), '"a" = "b";\n');
    const problems = await verifierProblems(dir, { ...BLANK, featuresConfig: { ads: false, multiLang: true } });
    assert.ok(!problems.some((p) => p.includes('InfoPlist.strings')), problems.join(' | '));
});

test('the verifier reports each InfoPlist.strings missing with ads and multiLang on (showcase)', async (t) => {
    const showcase = { ...BLANK, templateType: 'showcase' };
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedVerifiable(dir, showcase);
    await fs.outputFile(path.join(dir, stringsRel('en')), stringsContent('en'));
    let problems = await verifierProblems(dir, showcase);
    for (const lang of LANGS.filter((l) => l !== 'en')) assert.ok(problems.includes(missing(lang)), `${lang}: ${problems.join(' | ')}`);
    assert.ok(!problems.includes(missing('en')), problems.join(' | '));

    await seedStrings(dir);
    await fs.remove(path.join(dir, stringsRel('it')));
    problems = await verifierProblems(dir, showcase);
    assert.ok(problems.includes(missing('it')), problems.join(' | '));
    for (const lang of LANGS.filter((l) => l !== 'it')) assert.ok(!problems.includes(missing(lang)), lang);
    assert.ok(!problems.some((p) => p.includes('present although')), problems.join(' | '));
});

test('the verifier reports a missing InfoPlist.strings for blank with ads and multiLang on', async (t) => {
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedVerifiable(dir, BLANK);
    await seedStrings(dir);
    await fs.remove(path.join(dir, stringsRel('fr')));
    const problems = await verifierProblems(dir, { ...BLANK, featuresConfig: { ads: true, multiLang: true } });
    assert.ok(problems.includes(missing('fr')), problems.join(' | '));
    assert.ok(!problems.some((p) => p.includes('present although')), problems.join(' | '));
});

test('the verifier does not check a template that predates the localized ATT strings (none of the five)', async (t) => {
    const showcase = { ...BLANK, templateType: 'showcase' };
    const dir = await tmpDir();
    t.after(() => fs.remove(dir));
    await seedVerifiable(dir, showcase);
    const problems = await verifierProblems(dir, showcase);
    assert.ok(!problems.some((p) => p.includes('InfoPlist.strings')), problems.join(' | '));
});

// The whole pipeline on the seeded template slice: the package move and renames leave the strings byte for byte,
// blank's removal paths leave none
const { seedTemplate, OLD_PACKAGE_PATH } = require('./support/seedTemplate');
const { OLD_PACKAGE_NAME } = require('../src/templateIdentity');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');

async function generateSlice(t, request) {
    const projectDir = await tmpDir();
    t.after(() => fs.remove(projectDir));
    await seedTemplate(projectDir);
    await seedStrings(projectDir);
    // The multilang shell the verifier expects of blank with multiLang on
    await fs.outputFile(path.join(projectDir, 'blank/layers/multilang/shared/src/commonMain/kotlin', OLD_PACKAGE_PATH, 'MainScreen.kt'),
        [`package ${OLD_PACKAGE_NAME}`, '', 'fun mainScreen() {', '    LocalStringResources provides strings', '    setSystemLanguage()', '}', ''].join('\n'));
    const { value, error } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0',
        ...request });
    assert.ok(value, error);
    await generateCmpProject(value, { projectDir });
    return projectDir;
}

test('showcase generation keeps the five InfoPlist.strings byte for byte', async (t) => {
    const projectDir = await generateSlice(t, {});
    for (const lang of LANGS) assert.equal(await read(projectDir, stringsRel(lang)), stringsContent(lang), lang);
});

test('blank generation with ads off and multiLang on leaves no InfoPlist.strings', async (t) => {
    const projectDir = await generateSlice(t, { templateType: 'blank', featuresConfig: { multiLang: true, ads: false } });
    for (const lang of LANGS) assert.equal(await exists(projectDir, `iosApp/iosApp/${lang}.lproj`), false, lang);
});

test('blank generation with ads off and multiLang off leaves no InfoPlist.strings', async (t) => {
    const projectDir = await generateSlice(t, { templateType: 'blank', featuresConfig: { multiLang: false, ads: false } });
    for (const lang of LANGS) assert.equal(await exists(projectDir, `iosApp/iosApp/${lang}.lproj`), false, lang);
});
