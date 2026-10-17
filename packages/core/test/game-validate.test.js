const test = require('node:test');
const assert = require('node:assert');
const { validateGame } = require('../src/game/validate');

const base = { projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper' };
const ok = (input) => { const r = validateGame(input); assert.strictEqual(r.ok, true, r.error); return r.value; };
const bad = (input, field) => { const r = validateGame(input); assert.strictEqual(r.ok, false); assert.match(r.error, new RegExp(field)); };
const ADMOB = { androidAppId: 'ca-app-pub-1234567890123456~1234567890', iosAppId: 'ca-app-pub-1234567890123456~0987654321',
    androidBanner: 'ca-app-pub-1234567890123456/1111111111', androidInterstitial: 'ca-app-pub-1234567890123456/2222222222',
    androidRewarded: 'ca-app-pub-1234567890123456/3333333333', iosBanner: 'ca-app-pub-1234567890123456/4444444444',
    iosInterstitial: 'ca-app-pub-1234567890123456/5555555555', iosRewarded: 'ca-app-pub-1234567890123456/6666666666' };

test('defaults for showcase', () => {
    const v = ok(base);
    assert.deepStrictEqual([v.templateType, v.render, v.minSdk, v.iosVersion, v.companyName], ['showcase', '2d', 25, '15.0', 'Acme']);
    assert.ok(!('ci' in v));
    assert.deepStrictEqual(v.flags, ['saveSystem', 'uiTheme', 'multiLang', 'network', 'networkInspector', 'purchases', 'ads', 'leaderboards']);
    assert.deepStrictEqual([v.features, v.ids], [[], {}]);
});
test('blank flags: requires are added, order follows the schema', () => {
    assert.deepStrictEqual(ok({ ...base, templateType: 'blank', flags: ['networkInspector', 'ads'] }).flags, ['network', 'networkInspector', 'ads']);
});
test('showcase rejects flags and features', () => {
    bad({ ...base, flags: ['ads'] }, 'flags');
    bad({ ...base, features: ['shop'] }, 'features');
});
test('reserved and colliding project names', () => {
    for (const projectName of ['UnityBase', 'Kturker', 'class', '1Game', 'Sky Hopper', 'A'.repeat(31)]) bad({ ...base, projectName }, 'projectName');
    for (const projectName of ['Sample', 'Shell', 'Showcase', 'App', 'Core', 'Unity']) ok({ ...base, projectName });
});
test('company name: derived, overridable, validated', () => {
    assert.strictEqual(ok({ ...base, packageName: 'io.my2company.game' }).companyName, 'My2company');
    assert.strictEqual(ok({ ...base, companyName: 'Studio' }).companyName, 'Studio');
    bad({ ...base, companyName: 'Kturker' }, 'companyName');
    bad({ ...base, companyName: 'my studio' }, 'companyName');
});
test('package name rules', () => {
    for (const packageName of ['com.acme', 'Com.acme.game', 'com.kturker.game', 'com.in.game', 'com.acme.' + 'a'.repeat(45)]) bad({ ...base, packageName }, 'packageName');
});
test('features: count, names, duplicates, reserved', () => {
    const b = { ...base, templateType: 'blank' };
    ok({ ...b, features: ['shop', 'quests', 'daily2'] });
    for (const features of [['a', 'b', 'c', 'd'], ['Shop'], ['shop', 'shop'], ['sample'], ['class'], ['x'.repeat(21)]]) bad({ ...b, features }, 'features');
});
test('minSdk and iosVersion ranges, numbers accepted', () => {
    assert.strictEqual(ok({ ...base, minSdk: '30' }).minSdk, 30);
    assert.strictEqual(ok({ ...base, iosVersion: 16 }).iosVersion, '16.0');
    bad({ ...base, minSdk: 24 }, 'minSdk');
    bad({ ...base, iosVersion: '14.0' }, 'iosVersion');
});
test('ids: full groups only, matching formats, flag must be on', () => {
    const b = { ...base, templateType: 'blank', flags: ['ads', 'purchases', 'leaderboards'] };
    ok({ ...b, ids: { admob: ADMOB, revenueCat: { appleApiKey: 'appl_' + 'a'.repeat(24), googleApiKey: 'goog_' + 'b'.repeat(24) } } });
    const { iosRewarded, ...partial } = ADMOB;
    bad({ ...b, ids: { admob: partial } }, 'ids.admob');
    bad({ ...b, ids: { admob: { ...ADMOB, androidBanner: 'ca-app-pub-1/2' } } }, 'ids.admob.androidBanner');
    bad({ ...base, templateType: 'blank', ids: { admob: ADMOB } }, 'ids.admob');
    bad({ ...b, ids: { unknown: {} } }, 'ids');
});
test('id values that would break C#, XML or YAML', () => {
    const b = { ...base, templateType: 'blank', flags: ['leaderboards'] };
    const gs = { androidAppId: '123456789012', leaderboardAndroid: 'CgkI_abc', firstCompletionAndroid: 'CgkI_def', tenCompletionsAndroid: 'CgkI_ghi',
        leaderboardIos: 'com.acme.high', firstCompletionIos: 'com.acme.first', tenCompletionsIos: 'com.acme.ten' };
    ok({ ...b, ids: { gameServices: gs } });
    for (const v of ['a"b', 'a\\b', 'a$b', 'a\nb', 'replace_me.x']) bad({ ...b, ids: { gameServices: { ...gs, leaderboardIos: v } } }, 'ids.gameServices.leaderboardIos');
});
test('inherited keys and non-object ids never throw', () => {
    const b = { ...base, templateType: 'blank', flags: ['ads'] };
    for (const ids of [JSON.parse('{"constructor":{}}'), JSON.parse('{"__proto__":{}}'), { toString: {} }, 'x', []]) bad({ ...b, ids }, 'ids');
    bad({ ...b, flags: ['constructor'] }, 'flags');
});
test('module names whose copy would clash with the template are reserved', () => {
    const b = { ...base, templateType: 'blank' };
    // C#: game (GameInstaller calls itself), action/i (VContainer ActionInstaller/IInstaller), bonus/leaderboard
    // (Sample's BonusView/LeaderboardView); a namespace hiding a type the Sample code uses; the template's string-key prefixes
    const reserved = ['game', 'action', 'i', 'bonus', 'leaderboard',
        'button', 'lifetime', 'object', 'preserve', 'resources', 'serializable', 'transform',
        'about', 'ads', 'boot', 'common', 'guide', 'inspector', 'leaderboards', 'menu', 'network', 'pause',
        'purchases', 'runner2d', 'settings', 'theme', 'track3d', 'update'];
    for (const name of reserved) bad({ ...b, features: ['shop', name] }, 'features');
    const { describeGame } = require('../src/game/describe');
    for (const name of reserved) assert.ok(describeGame().contract.reservedModuleNames.includes(name), name);
    ok({ ...b, features: ['app', 'core', 'save'] });
});
test('iosVersion is normalized to major.minor', () => {
    for (const [given, want] of [['015.0', '15.0'], ['15.0.0', '15.0'], ['15', '15.0'], ['16.04', '16.4'], ['016', '16.0'], [16.4, '16.4']]) {
        assert.strictEqual(ok({ ...base, iosVersion: given }).iosVersion, want, String(given));
    }
    // (four parts joined at run time: the privacy scan reads a dotted quad in the source as an IPv4 address)
    const fourParts = ['15.0', '0.0'].join('.');
    for (const iosVersion of ['15.1.2', '15.0.1', 'abc', '15.', '.5', fourParts, '', ' 15.0', '14.9.0', '99']) bad({ ...base, iosVersion }, 'iosVersion');
});
test('a derived companyName error points at packageName', () => {
    const r = validateGame({ ...base, packageName: `com.${'a'.repeat(31)}.game` });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /derived from packageName/);
    assert.match(r.error, /companyName/);
});
test('ids: missing and unknown fields are reported separately', () => {
    const b = { ...base, templateType: 'blank', flags: ['ads'] };
    const { iosRewarded, iosBanner, ...partial } = ADMOB;
    let r = validateGame({ ...b, ids: { admob: { ...partial, extra: 'x' } } });
    assert.match(r.error, /ids\.admob is missing: iosBanner, iosRewarded$/);
    r = validateGame({ ...b, ids: { admob: { ...ADMOB, extra: 'x', other: 'y' } } });
    assert.match(r.error, /^ids\.admob has unknown fields: extra, other \(known: /);
});
test('id errors say what is wrong', () => {
    const b = { ...base, templateType: 'blank', flags: ['ads', 'purchases'] };
    const msg = (ids) => validateGame({ ...b, ids }).error;
    assert.match(msg({ admob: { ...ADMOB, androidBanner: 'ca-app-pub-1/2' } }), /^ids\.admob\.androidBanner must look like ca-app-pub-<16 digits>\/<10 digits>/);
    assert.match(msg({ admob: { ...ADMOB, iosAppId: 'x' } }), /^ids\.admob\.iosAppId must look like ca-app-pub-<16 digits>~<10 digits>/);
    assert.match(msg({ admob: { ...ADMOB, iosAppId: 5 } }), /^ids\.admob\.iosAppId must be a string/);
    assert.match(msg({ admob: { ...ADMOB, iosAppId: 'a"b' } }), /^ids\.admob\.iosAppId must not contain/);
    assert.match(msg({ admob: { ...ADMOB, iosAppId: 'REPLACE_ME' } }), /^ids\.admob\.iosAppId is a placeholder/);
    assert.match(msg({ revenueCat: { appleApiKey: 'appl_x', googleApiKey: 'goog_' + 'b'.repeat(24) } }), /^ids\.revenueCat\.appleApiKey must look like appl_/);
});
test('wrongly typed ids, ci and flags are rejected with a clear message', () => {
    const b = { ...base, templateType: 'blank' };
    for (const ids of ['x', [], 5, null]) assert.strictEqual(validateGame({ ...b, ids }).error, 'ids must be an object');
    for (const ci of ['true', 1, null]) assert.strictEqual(validateGame({ ...base, ci }).error, 'ci must be a boolean');
    for (const flags of ['ads', { ads: true }, null]) assert.match(validateGame({ ...b, flags }).error, /^flags must be an array of: /);
});
test('ci is not offered for Unity games: true is refused, false is accepted and dropped', () => {
    assert.strictEqual(validateGame({ ...base, ci: true }).error, 'ci is not offered for Unity games');
    assert.ok(!('ci' in ok({ ...base, ci: false })));
    assert.ok(!('ci' in ok(base)));
});

test('a malformed iosVersion gets a format message, an out-of-range one the range', () => {
    for (const iosVersion of ['15.1.2', '15.0.1', 'abc', ' 15.0']) {
        assert.strictEqual(validateGame({ ...base, iosVersion }).error, 'iosVersion must look like 15.0 (major.minor; a third part must be 0)');
    }
    for (const iosVersion of ['14.0', '99', '26.20']) assert.match(validateGame({ ...base, iosVersion }).error, /^iosVersion must be from 15\.0 to /);
});

test('theme: optional, an object of known fields, colours as #RRGGBB (uppercased)', () => {
    assert.strictEqual(ok(base).theme, null);
    assert.deepStrictEqual(ok({ ...base, theme: { family: 'neon', primary: '#ff00aa', fontPair: 'outfit-exo2' } }).theme,
        { family: 'neon', primary: '#FF00AA', fontPair: 'outfit-exo2' });
    assert.deepStrictEqual(ok({ ...base, templateType: 'blank', theme: {} }).theme, {});
    for (const theme of ['clean', [], null, 5]) assert.strictEqual(validateGame({ ...base, theme }).error, 'theme must be an object');
    bad({ ...base, theme: { primary: '#FF0' } }, 'theme\\.primary');
    bad({ ...base, theme: { accent: 'blue' } }, 'theme\\.accent');
    bad({ ...base, theme: { family: 7 } }, 'theme\\.family');
    bad({ ...base, theme: { fontPair: 7 } }, 'theme\\.fontPair');
    bad({ ...base, theme: { mood: 'happy' } }, 'theme has unknown fields: mood');
});
