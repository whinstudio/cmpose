const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { seedGameTemplate, THEME_ASSETS } = require('./support/seedGameTemplate');
const { tmpDir } = require('./support/gameFixtures');
const { validateGame } = require('../src/game/validate');
const { generateGame } = require('../src/game/generate');
const { describeGame } = require('../src/game/describe');
const { readThemes } = require('../src/game/themes');
const { GAME_SCHEMA, gameContractFacts, gameContractVersion } = require('../src/game/contract');
const game = require('../src/game');
const pins = require('../src/pins');

const P = 'Assets/_Project';
const NOW = new Date('2026-10-14T08:30:00.000Z');
const TEMPLATE = { repo: 'whinstudio/cmpose-game-template', ref: 'game-template-test', commit: 'abc123' };
const ADMOB_APP = 'ca-app-pub-1234567890123456~1234567890';
const ADMOB_UNIT = 'ca-app-pub-1234567890123456/1234567890';
const ADMOB = {
    androidAppId: ADMOB_APP, iosAppId: ADMOB_APP,
    androidBanner: ADMOB_UNIT, androidInterstitial: ADMOB_UNIT, androidRewarded: ADMOB_UNIT,
    iosBanner: ADMOB_UNIT, iosInterstitial: ADMOB_UNIT, iosRewarded: ADMOB_UNIT
};
const BASE = { projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper' };
const W = {
    admob: 'Ads use AdMob test IDs: replace them with your own before release.',
    revenueCat: 'Purchases use the RevenueCat Test Store key: replace it before release.',
    gameServices: 'Leaderboard and achievement IDs are placeholders: game services stay off until you set them.',
    unity: 'Open the project with Unity 6000.3.25f1 (Android and iOS Build Support); the first import takes a few minutes.'
};

const value = (input) => {
    const r = validateGame({ ...BASE, ...input });
    assert.ok(r.ok, r.error);
    return r.value;
};
const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));

async function seeded(t, { legacyCi = false, themes = false } = {}) {
    const dir = await tmpDir(t);
    await seedGameTemplate(dir, { full: true, legacyCi, themes });
    // A cache's markers and Unity's local state, which never reach the project
    await fs.outputFile(path.join(dir, '.template-ref'), 'game-template-test\n');
    await fs.outputFile(path.join(dir, '.template-commit'), 'abc123\n');
    await fs.outputFile(path.join(dir, '.git/HEAD'), 'ref: refs/heads/main\n');
    await fs.outputFile(path.join(dir, 'LICENSE'), 'MIT License\n');
    for (const local of ['Library', 'Temp', 'Logs', 'UserSettings']) await fs.outputFile(path.join(dir, local, 'x.txt'), 'UnityBase\n');
    return dir;
}

async function tree(dir) {
    const out = {};
    async function walk(abs, rel) {
        for (const e of (await fs.readdir(abs, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) await walk(path.join(abs, e.name), r);
            else out[r] = await fs.readFile(path.join(abs, e.name));
        }
    }
    await walk(dir, '');
    return out;
}

async function grepTree(dir, token) {
    const hits = [];
    for (const [rel, bytes] of Object.entries(await tree(dir))) if (bytes.toString('utf8').includes(token) || rel.includes(token)) hits.push(rel);
    return hits;
}

const blankShop = () => value({ templateType: 'blank', features: ['shop'], flags: [] });

test('blank with a module and no flags: the module stays, every flag part goes, the record is written', async (t) => {
    const dir = await seeded(t);
    const result = await generateGame(blankShop(), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });

    assert.ok(await exists(dir, `${P}/Features/Shop`));
    assert.equal(await exists(dir, `${P}/Features/Shop/Ads`), false);
    assert.equal(await exists(dir, `${P}/Core/Ads`), false);
    assert.equal(await exists(dir, `${P}/Features/Showcase`), false);
    assert.deepEqual(await grepTree(dir, 'Kturker.UnityBase'), []);
    for (const gone of ['.git', '.template-ref', '.template-commit', 'LICENSE', 'Library', 'Temp', 'Logs', 'UserSettings',
        '.cmpose/package-guids.txt', '.cmpose/flags.json', '.github']) {
        assert.equal(await exists(dir, gone), false, gone);
    }

    const record = JSON.parse(await fs.readFile(path.join(dir, '.cmpose/generation.json'), 'utf8'));
    assert.equal(record.ids.admob, 'off');
    assert.equal(record.generatedAt, NOW.toISOString());
    assert.deepEqual(record.template, TEMPLATE);
    assert.equal(record.coreVersion, '0.2.0');

    assert.deepEqual(result, {
        templateType: 'blank', render: '2d', flags: [], features: ['shop'],
        ids: { admob: 'off', revenueCat: 'off', gameServices: 'off' },
        theme: null,
        warnings: [W.unity]
    });
});

test('blank with ads and real AdMob ids: the ids are written, no AdMob warning', async (t) => {
    const dir = await seeded(t);
    const v = value({ templateType: 'blank', flags: ['ads'], ids: { admob: ADMOB } });
    const result = await generateGame(v, { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });

    const ads = await fs.readFile(path.join(dir, `${P}/Core/Ads/AdsConfig.cs`), 'utf8');
    assert.match(ads, /BannerAndroid = "ca-app-pub-1234567890123456\/1234567890"/);
    assert.doesNotMatch(ads, /3940256099942544/);
    const settings = await fs.readFile(path.join(dir, 'Assets/GoogleMobileAds/Resources/GoogleMobileAdsSettings.asset'), 'utf8');
    assert.match(settings, /adMobAndroidAppId: ca-app-pub-1234567890123456~1234567890/);
    assert.match(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), /## Ads/);
    assert.equal(result.ids.admob, 'custom');
    assert.ok(!result.warnings.includes(W.admob));
    assert.deepEqual(result.warnings, [W.unity]);
});

test('an older template with a GameCI workflow: .github and the README CI section never ship', async (t) => {
    const dir = await seeded(t, { legacyCi: true });
    assert.ok(await exists(dir, '.github/workflows/ci.yml'));
    await generateGame(value({ templateType: 'showcase' }), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    assert.equal(await exists(dir, '.github'), false);
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /cmpose:ci|GameCI/);
    const record = JSON.parse(await fs.readFile(path.join(dir, '.cmpose/generation.json'), 'utf8'));
    assert.ok(!('ci' in record));
});

test('showcase: the sample goes, every flag stays on and the test-id warnings come first', async (t) => {
    const dir = await seeded(t);
    const result = await generateGame(value({ templateType: 'showcase' }), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });

    assert.equal(await exists(dir, `${P}/Features/Sample`), false);
    assert.ok(await exists(dir, `${P}/Features/Showcase`));
    assert.ok(await exists(dir, `${P}/Core/Ads`));
    assert.deepEqual(result.flags, GAME_SCHEMA.flags);
    assert.deepEqual(result.ids, { admob: 'test', revenueCat: 'test', gameServices: 'test' });
    assert.deepEqual(result.warnings, [W.admob, W.revenueCat, W.gameServices, W.unity]);
    // The 2d render layer was applied
    assert.match(await fs.readFile(path.join(dir, `${P}/Scenes/Menu.unity`), 'utf8'), /Menu2D/);
});

test('the same input and time give byte-identical trees', async (t) => {
    const a = await seeded(t);
    const b = await seeded(t);
    await generateGame(blankShop(), { projectDir: a, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    await generateGame(blankShop(), { projectDir: b, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    const ta = await tree(a);
    const tb = await tree(b);
    assert.deepEqual(Object.keys(ta), Object.keys(tb));
    for (const rel of Object.keys(ta)) assert.ok(ta[rel].equals(tb[rel]), rel);
});

test('a project that fails verification is rejected', async (t) => {
    const dir = await seeded(t);
    await fs.outputFile(path.join(dir, 'Assets/stray.cs'), '// cmpose:unknownflag\n');
    await fs.outputFile(path.join(dir, 'Assets/stray.cs.meta'), `fileFormatVersion: 2\nguid: ${'ab'.repeat(16)}\n`);
    await assert.rejects(generateGame(blankShop(), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW }),
        /failed verification:\n- marker \/\/ cmpose: in Assets\/stray\.cs/);
});

test('without a template, the record names the pinned repo and the cache markers', async (t) => {
    const dir = await seeded(t);
    await generateGame(blankShop(), { projectDir: dir, coreVersion: '0.2.0', now: NOW });
    const record = JSON.parse(await fs.readFile(path.join(dir, '.cmpose/generation.json'), 'utf8'));
    assert.deepEqual(record.template, { repo: pins.game.repo, ref: 'game-template-test', commit: 'abc123' });
});

test('describeGame states the engine, the pin, the defaults and the contract', () => {
    assert.deepEqual(describeGame(), {
        engine: 'unity',
        unityVersion: '6000.3.25f1',
        contractVersion: gameContractVersion(),
        template: pins.game,
        defaults: {
            templateType: 'showcase', render: '2d', flags: { showcase: GAME_SCHEMA.flags.slice(), blank: [] },
            features: [], minSdk: 25, iosVersion: '15.0'
        },
        themes: { default: null, families: [] },
        contract: gameContractFacts()
    });
    assert.equal(describeGame().defaults.flags.showcase.length, 8);
});

test('describeGame lists the template families for a planner: id, title, suits and font pair ids only', async (t) => {
    const themes = await readThemes(await seeded(t, { themes: true }));
    const facts = describeGame({ themes });
    assert.equal(facts.themes.default, 'clean');
    assert.deepEqual(facts.themes.families.map((f) => f.id), ['bright', 'neon', 'pastel', 'bold', 'nature', 'clean']);
    const clean = facts.themes.families.find((f) => f.id === 'clean');
    assert.deepEqual(clean, {
        id: 'clean', title: 'Clean', suits: themes.families.find((f) => f.id === 'clean').suits,
        fontPairs: ['outfit-inter', 'montserrat-inter']
    });
    assert.match(clean.suits, /default/);
    // The families stay outside the hashed contract: the same contractVersion with or without a template
    assert.equal(facts.contractVersion, describeGame().contractVersion);
    assert.equal(facts.contract.themes, undefined);
});

test('describeGame of a template without themes.json has no families', async (t) => {
    const themes = await readThemes(await seeded(t));
    assert.deepEqual(describeGame({ themes }).themes, { default: null, families: [] });
});

test('pins.game names the game template repo', () => {
    assert.equal(pins.game.repo, 'whinstudio/cmpose-game-template');
    assert.equal(typeof pins.game.ref, 'string');
    assert.ok(Object.isFrozen(pins.game));
});

test('the game index exposes the pipeline and its parts', () => {
    for (const name of ['validateGame', 'generateGame', 'describeGame', 'GAME_SCHEMA', 'gameContractVersion', 'cloneModules',
        'applyGameIdentity', 'writeGameIds', 'applyGameReadme', 'buildGameRecord', 'writeGameRecord', 'verifyGameProject',
        'readThemes', 'validateTheme', 'applyTheme', 'derivePalette']) {
        assert.ok(game[name] !== undefined, name);
    }
    assert.equal(game.generateGame, generateGame);
    assert.equal(require('../src').game.describeGame, describeGame);
});

test('a build scene the template lists but does not have is dropped from the build list', async (t) => {
    const dir = await seeded(t);
    const scenes = path.join(dir, 'ProjectSettings/EditorBuildSettings.asset');
    const before = await fs.readFile(scenes, 'utf8');
    assert.ok(before.includes('  m_configObjects'));
    await fs.writeFile(scenes, before.replace('  m_configObjects',
        `  - enabled: 1\n    path: ${P}/Scenes/Gone.unity\n    guid: ${'e7'.repeat(16)}\n  m_configObjects`));
    await generateGame(value({ templateType: 'blank' }), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    const after = await fs.readFile(scenes, 'utf8');
    assert.ok(!after.includes('Gone.unity'));
    assert.ok(!after.includes('e7'.repeat(16)));
});

const readRecord = async (dir) => JSON.parse(await fs.readFile(path.join(dir, '.cmpose/generation.json'), 'utf8'));
const themeAssets = (dir) => Promise.all(Object.values(THEME_ASSETS).map((rel) => fs.readFile(path.join(dir, rel), 'utf8')));

test('no theme asked: the template default (clean) is applied, its three assets byte-identical, the record names it', async (t) => {
    const dir = await seeded(t, { themes: true });
    const before = await themeAssets(dir);
    const result = await generateGame(value({ templateType: 'showcase' }), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    // Only the identity step's namespace rename touches them
    assert.deepEqual(await themeAssets(dir), before.map((text) => text.replaceAll('Kturker.UnityBase', 'Acme.SkyHopper')));
    assert.deepEqual(result.theme, { family: 'clean', fontPair: 'outfit-inter' });
    assert.deepEqual((await readRecord(dir)).theme, { family: 'clean', fontPair: 'outfit-inter' });
    // themes.json stays in the project (the generator applied it; the template documents it)
    assert.ok(await exists(dir, '.cmpose/themes.json'));
});

test('neon with uiTheme on: both palettes are written, the record and result carry the theme', async (t) => {
    const dir = await seeded(t, { themes: true });
    const before = await themeAssets(dir);
    const v = value({ templateType: 'showcase', theme: { family: 'neon', primary: '#e91e63' } });
    const result = await generateGame(v, { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    const after = await themeAssets(dir);
    for (let i = 0; i < after.length; i++) assert.notEqual(after[i], before[i], Object.values(THEME_ASSETS)[i]);
    assert.match(await fs.readFile(path.join(dir, THEME_ASSETS.style), 'utf8'), /^  familyId: neon$/m);
    const theme = { family: 'neon', primary: '#E91E63', fontPair: 'chakrapetch-exo2' };
    assert.deepEqual(result.theme, theme);
    assert.deepEqual((await readRecord(dir)).theme, theme);
    assert.deepEqual(result.warnings, [W.admob, W.revenueCat, W.gameServices, W.unity]);
});

test('uiTheme off: the flag removed Dark.asset and the theme step does not bring it back', async (t) => {
    const dir = await seeded(t, { themes: true });
    const result = await generateGame(value({ templateType: 'blank', flags: [], theme: { family: 'bold' } }),
        { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    assert.equal(await exists(dir, THEME_ASSETS.dark), false);
    assert.equal(await exists(dir, `${P}/Core/Theme`), false);
    assert.match(await fs.readFile(path.join(dir, THEME_ASSETS.style), 'utf8'), /^  familyId: bold$/m);
    assert.equal(result.theme.family, 'bold');
});

test('a theme the template cannot honour fails before the project is touched', async (t) => {
    const old = await seeded(t);
    await assert.rejects(generateGame(value({ templateType: 'blank', theme: { family: 'neon' } }),
        { projectDir: old, template: TEMPLATE, coreVersion: '0.2.0', now: NOW }), /this template has no theme families/);
    assert.ok(await exists(old, '.template-ref'));

    const dir = await seeded(t, { themes: true });
    await assert.rejects(generateGame(value({ templateType: 'blank', theme: { family: 'neon', fontPair: 'comic-sans' } }),
        { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW }), /theme\.fontPair must be one of neon's font pairs: chakrapetch-exo2, outfit-exo2/);
    await assert.rejects(generateGame(value({ templateType: 'blank', theme: { family: 'sepia' } }),
        { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW }), /theme\.family must be one of this template's families: bright, neon, pastel, bold, nature, clean/);
    assert.ok(await exists(dir, '.template-ref'));
});

test('an older template without themes.json and no theme asked: nothing themed, record theme null', async (t) => {
    const dir = await seeded(t);
    const result = await generateGame(value({ templateType: 'blank' }), { projectDir: dir, template: TEMPLATE, coreVersion: '0.2.0', now: NOW });
    assert.equal(result.theme, null);
    assert.equal((await readRecord(dir)).theme, null);
});
