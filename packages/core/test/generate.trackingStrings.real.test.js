'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');
const { listTextFiles } = require('../src/projectFiles');
const { copyRealTemplate } = require('./realTemplate-helpers');

// The localized ATT purpose strings through the whole pipeline against the REAL CMP template (CMP_REAL_TEMPLATE_DIR).
// Skipped, not failed, when it is unset or the template predates the strings.
const REAL = process.env.CMP_REAL_TEMPLATE_DIR;
const LANGS = ['en', 'tr', 'es', 'it', 'fr'];
const stringsRel = (lang) => `iosApp/iosApp/${lang}.lproj/InfoPlist.strings`;
const HAS_TEMPLATE = Boolean(REAL) && LANGS.every((lang) => fs.existsSync(path.join(REAL, stringsRel(lang))));
const OPTIONS = HAS_TEMPLATE ? {}
    : { skip: !REAL ? 'CMP_REAL_TEMPLATE_DIR is not set' : `the template at CMP_REAL_TEMPLATE_DIR (${REAL}) predates the localized ATT strings` };
// What the template's sync keeps out of the template: an upstream archive still has them
const MAINTAINER_ONLY = ['gradle/wizard.gradle.kts', 'MAINTAINING.md', 'scripts/ios-add-packages.rb', 'scripts-maintainer'];
const INFO_PLIST = 'iosApp/iosApp/Info.plist';

async function generate(t, request) {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-tracking-real-'));
    t.after(() => fs.remove(projectDir));
    await copyRealTemplate(REAL, projectDir, (src) => {
        const rel = path.relative(REAL, src).split(path.sep).join('/');
        return !MAINTAINER_ONLY.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
    });
    const { ok, value, error } = validate({ appName: 'Demo App', minSdk: '24', iosVersion: '16.0', projectName: 'Demo',
        packageName: 'com.example.demo', ...request });
    assert.ok(ok, error);
    await generateCmpProject(value, { projectDir, generatorVersion: 'test' });
    return projectDir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

async function assertNoStrings(projectDir) {
    for (const lang of LANGS) assert.equal(await fs.pathExists(path.join(projectDir, stringsRel(lang))), false, stringsRel(lang));
}

test('real template, showcase: the five InfoPlist.strings survive the package move and renames byte for byte', OPTIONS, async (t) => {
    const projectDir = await generate(t, {});
    for (const lang of LANGS) {
        const generated = await fs.readFile(path.join(projectDir, stringsRel(lang)));
        assert.ok(generated.equals(await fs.readFile(path.join(REAL, stringsRel(lang)))), stringsRel(lang));
    }
    assert.match(await read(projectDir, INFO_PLIST), /<key>NSUserTrackingUsageDescription<\/key>/);
});

test('real template, blank with ads on and multiLang off: no InfoPlist.strings, Info.plist keeps the English text', OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { ads: true, multiLang: false } });
    await assertNoStrings(projectDir);
    assert.match(await read(projectDir, INFO_PLIST), /<key>NSUserTrackingUsageDescription<\/key>/);
});

test('real template, blank with ads off and multiLang on: no InfoPlist.strings and no NSUserTrackingUsageDescription anywhere', OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { ads: false, multiLang: true } });
    await assertNoStrings(projectDir);
    for (const file of await listTextFiles(projectDir)) {
        assert.doesNotMatch(await fs.readFile(file, 'utf8'), /NSUserTrackingUsageDescription/, path.relative(projectDir, file));
    }
});

test('real template, blank with ads and multiLang on: the five InfoPlist.strings stay byte for byte', OPTIONS, async (t) => {
    const projectDir = await generate(t, { templateType: 'blank', featuresConfig: { ads: true, multiLang: true } });
    for (const lang of LANGS) {
        const generated = await fs.readFile(path.join(projectDir, stringsRel(lang)));
        assert.ok(generated.equals(await fs.readFile(path.join(REAL, stringsRel(lang)))), stringsRel(lang));
    }
});
