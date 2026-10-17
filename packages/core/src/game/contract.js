'use strict';
const { hashContract } = require('../contract');
const limits = require('../limits');
const { THEME_FIELDS } = require('./themes');

// The Unity game generator's contract: what the game_* tools accept. Published facts feed contractVersion.
const GAME_SCHEMA = Object.freeze({
    engine: 'unity',
    unityVersion: '6000.3.25f1',
    templateTypes: ['showcase', 'blank'],
    renders: ['2d', '3d'],
    flags: ['saveSystem', 'uiTheme', 'multiLang', 'network', 'networkInspector', 'purchases', 'ads', 'leaderboards'],
    flagRequires: { networkInspector: ['network'] },
    idGroups: {
        admob: { flag: 'ads', fields: ['androidAppId', 'iosAppId', 'androidBanner', 'androidInterstitial', 'androidRewarded', 'iosBanner', 'iosInterstitial', 'iosRewarded'] },
        revenueCat: { flag: 'purchases', fields: ['appleApiKey', 'googleApiKey'] },
        gameServices: { flag: 'leaderboards', fields: ['androidAppId', 'leaderboardAndroid', 'firstCompletionAndroid', 'tenCompletionsAndroid', 'leaderboardIos', 'firstCompletionIos', 'tenCompletionsIos'] }
    },
    limits: { minSdkMin: 25, minSdkMax: 36, iosVersionMin: '15.0', maxModules: 3, nameMax: 30, appNameMax: 30, packageNameMax: 50, moduleNameMax: 20 },
    reservedNames: ['UnityBase', 'Kturker'],
    // Module names a copy of Sample cannot take: the template's own folders; names whose copy breaks C# binding
    // (game: GameInstaller would call itself; action, i: VContainer's ActionInstaller/IInstaller; bonus, leaderboard:
    // Sample's own BonusView/LeaderboardView); names whose namespace would hide a type the Sample code uses
    // (Button, Lifetime, Object, ...); and the template's string-key prefixes (a duplicate key is dropped)
    reservedModuleNames: ['sample', 'shell', 'showcase', 'build',
        'game', 'action', 'i', 'bonus', 'leaderboard',
        'button', 'lifetime', 'object', 'preserve', 'resources', 'serializable', 'transform',
        'about', 'ads', 'boot', 'common', 'guide', 'inspector', 'leaderboards', 'menu', 'network', 'pause',
        'purchases', 'runner2d', 'settings', 'theme', 'track3d', 'update'],
    reservedPackagePrefix: 'com.kturker',
    // The theme request's fields; the families themselves come from the template (game_describe themes)
    theme: { fields: THEME_FIELDS.slice(), colorFormat: '#RRGGBB' }
});

function gameContractFacts() {
    return { ...GAME_SCHEMA, limits: { ...GAME_SCHEMA.limits, iosVersionMax: limits.iosVersionMax } };
}

function gameContractVersion() {
    return hashContract(gameContractFacts());
}

module.exports = { GAME_SCHEMA, gameContractFacts, gameContractVersion };
