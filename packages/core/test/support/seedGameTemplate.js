const path = require('path');
const fs = require('fs-extra');

// The smallest Unity template the game pipeline accepts (flags, module clones, identity, IDs, README, verifier):
// a miniature of the real template's shapes. Every file and folder under Assets has a .meta with a fixed guid,
// and every guid a YAML file references has its .meta.
const G = (pair) => pair.repeat(16);

const GUIDS = {
    project: G('d0'), app: G('d1'), appAsmdef: G('d2'), game: G('d3'), gameInstaller: G('d4'),
    core: G('d5'), coreAds: G('d6'), adsConfig: G('d7'), coreAdsAsmdef: G('d8'),
    features: G('d9'), sample: G('da'), installer: G('db'), installerCs: G('dc'), installerAsmdef: G('dd'),
    ads: G('de'), adsPresenter: G('df'), bonusView: G('e0'), bonusPrefab: G('e1'), adsAsmdef: G('e2'),
    resources: G('e3'), strings: G('e4'), en: G('e5'), sampleJson: G('e6'),
    showcase: G('e7'), showcaseInstaller: G('e8'), showcaseInstallerCs: G('e9'), showcaseAsmdef: G('ea'),
    scenes: G('eb'), menu: G('ec'),
    // full: the other public flags' folders and Google Mobile Ads' settings
    gma: G('f0'), gmaResources: G('f1'), gmaSettings: G('f2')
};

// full: every public flag the contract knows, each with one Core folder holding one script
const EXTRA_FLAGS = {
    saveSystem: { define: 'CMPOSE_SAVESYSTEM', dir: 'Save', guid: G('f3'), cs: G('f4') },
    uiTheme: { define: 'CMPOSE_UITHEME', dir: 'Theme', guid: G('f5'), cs: G('f6') },
    multiLang: { define: 'CMPOSE_MULTILANG', dir: 'Language', guid: G('f7'), cs: G('f8') },
    network: { define: 'CMPOSE_NETWORK', dir: 'Network', guid: G('f9'), cs: G('fa') },
    networkInspector: { define: 'CMPOSE_NETWORKINSPECTOR', dir: 'NetworkInspector', guid: G('fb'), cs: G('fc'), requires: ['network'] },
    purchases: { define: 'CMPOSE_PURCHASES', dir: 'Purchases', guid: G('fd'), cs: G('fe') },
    leaderboards: { define: 'CMPOSE_LEADERBOARDS', dir: 'Leaderboards', guid: G('c2'), cs: G('c3') }
};

const meta = (guid, folder = false) => `fileFormatVersion: 2\nguid: ${guid}\n${folder ? 'folderAsset: yes\n' : ''}`;
const json = (value, indent = 4) => `${JSON.stringify(value, null, indent)}\n`;
const asmdef = (name, references = []) => json({ name, rootNamespace: name, references, autoReferenced: true });

const PROJECT_SETTINGS = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!129 &1
PlayerSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 28
  productGUID: 0123456789abcdef0123456789abcdef
  defaultScreenOrientation: 4
  companyName: Kturker
  productName: UnityBase
  bundleVersion: 1.0.0
  overrideDefaultApplicationIdentifier: 0
  AndroidBundleVersionCode: 1
  AndroidMinSdkVersion: 25
  AndroidTargetSdkVersion: 0
  iOSTargetOSVersionString: 15.0
  applicationIdentifier:
    Android: com.kturker.unitybase
    iPhone: com.kturker.unitybase
  iOSURLSchemes: []
  scriptingDefineSymbols:
    Android: CMPOSE_ADS;CMPOSE_SAMPLE;CMPOSE_SHOWCASE
    iPhone: CMPOSE_ADS;CMPOSE_SAMPLE;CMPOSE_SHOWCASE
  additionalCompilerArguments: {}
  scriptingBackend:
    Android: 1
  AndroidTargetArchitectures: 2
`;

const EDITOR_BUILD_SETTINGS = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1045 &1
EditorBuildSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Scenes:
  - enabled: 1
    path: Assets/_Project/Scenes/Menu.unity
    guid: ${GUIDS.menu}
  m_configObjects: {}
  m_UseUCBPForAssetBundles: 0
`;

const FLAGS = {
    flags: {
        ads: {
            define: 'CMPOSE_ADS',
            paths: ['Assets/_Project/Core/Ads', 'Assets/_Project/Features/Sample/Ads'],
            asmdefs: ['Kturker.UnityBase.Core.Ads', 'Kturker.UnityBase.Features.Sample.Ads'],
            packages: ['com.google.ads.mobile']
        },
        sample: {
            define: 'CMPOSE_SAMPLE',
            paths: ['Assets/_Project/Features/Sample', 'Assets/_Project/App/Game'],
            asmdefs: ['Kturker.UnityBase.Features.Sample.Installer', 'Kturker.UnityBase.Features.Sample.Ads'],
            packages: [],
            internal: true
        },
        showcase: {
            define: 'CMPOSE_SHOWCASE',
            paths: ['Assets/_Project/Features/Showcase'],
            asmdefs: ['Kturker.UnityBase.Features.Showcase.Installer'],
            packages: [],
            internal: true
        }
    },
    renders: { '3d': null },
    kinds: {
        blank: { off: ['showcase'] },
        showcase: { off: ['sample'], games: {} }
    }
};

const GAME_INSTALLER = `using Kturker.UnityBase.Core.Presentation;
using Kturker.UnityBase.Features.Sample.Installer;
using VContainer;
using VContainer.Unity;

namespace Kturker.UnityBase.App.Game
{
    // Game scene: the feature modules; the generator adds one line per cloned module inside the markers
    public sealed class GameInstaller : IInstaller
    {
        private readonly bool registerViews;

        public GameInstaller(bool registerViews) => this.registerViews = registerViews;

        public void Install(IContainerBuilder builder)
        {
            builder.RegisterEntryPoint<GameRenderMarker>();
            // cmpose:features:start
            new SampleInstaller(registerViews).Install(builder);
            // cmpose:features:end
        }
    }
}
`;

const SAMPLE_INSTALLER = `using VContainer;
using VContainer.Unity;
// cmpose:ads
using Kturker.UnityBase.Features.Sample.Ads;
// /cmpose:ads

namespace Kturker.UnityBase.Features.Sample.Installer
{
    // registerViews=false lets tests supply fake views instead of searching the scene
    public sealed class SampleInstaller : IInstaller
    {
        private readonly bool registerViews;

        public SampleInstaller(bool registerViews) => this.registerViews = registerViews;

        public void Install(IContainerBuilder builder)
        {
            // cmpose:ads
            if (registerViews) builder.RegisterComponentInHierarchy<BonusView>();
            builder.RegisterEntryPoint<SampleAdsPresenter>();
            // /cmpose:ads
        }
    }
}
`;

const ADS_CONFIG = `namespace Kturker.UnityBase.Core.Ads
{
    // Ad unit IDs per platform. The generator writes the six ID lines; the template ships Google's test IDs.
    public static class AdsConfig
    {
        public const string BannerAndroid = "ca-app-pub-3940256099942544/9214589741";
        public const string InterstitialAndroid = "ca-app-pub-3940256099942544/1033173712";
        public const string RewardedAndroid = "ca-app-pub-3940256099942544/5224354917";
        public const string BannerIos = "ca-app-pub-3940256099942544/2435281174";
        public const string InterstitialIos = "ca-app-pub-3940256099942544/4411468910";
        public const string RewardedIos = "ca-app-pub-3940256099942544/1712485313";
    }
}
`;

const README = `# UnityBase

A Unity game template.

<!-- cmpose:ads -->
## Ads

Banner, interstitial and rewarded ads through Google Mobile Ads.
<!-- /cmpose:ads -->

## Build from the command line

Open the project in Unity and build.
`;

// Older template pins (before GameCI was dropped) shipped a GameCI workflow and a README CI section
const LEGACY_CI_README = `
<!-- cmpose:ci -->
**CI:** \`.github/workflows/ci.yml\` runs the EditMode tests and an Android build with GameCI.
<!-- /cmpose:ci -->
`;

const CI = `name: CI
on:
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: game-ci/unity-test-runner@v4
        with:
          testMode: editmode
`;

const PACKAGES = {
    dependencies: {
        'com.google.ads.mobile': '10.4.2',
        'com.unity.ugui': '2.0.0',
        'jp.hadashikick.vcontainer': '1.17.0'
    }
};

const ns = (namespace, body) => `namespace ${namespace}\n{\n${body}}\n`;

const GMA_SETTINGS = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_Name: GoogleMobileAdsSettings
  adMobAndroidAppId: ca-app-pub-3940256099942544~3347511713
  adMobIOSAppId: ca-app-pub-3940256099942544~1458002511
`;

// full: true adds what the whole game pipeline (generateGame) needs on top of the default miniature: every
// public flag of the contract (with its define), Google Mobile Ads' settings asset under the ads flag, and a 2d
// render overlay (the real template's shape: 3d upstream, 2d a layer). Without it the seed stays as it was.
function fullFlags(flags) {
    const out = JSON.parse(JSON.stringify(flags));
    for (const [name, x] of Object.entries(EXTRA_FLAGS)) {
        out.flags[name] = {
            define: x.define, paths: [`Assets/_Project/Core/${x.dir}`], asmdefs: [`Kturker.UnityBase.Core.${x.dir}`], packages: [],
            ...(x.requires ? { requires: x.requires } : {})
        };
    }
    out.flags.ads.paths.push('Assets/GoogleMobileAds');
    out.renders = { '3d': null, '2d': '.cmpose/layers/render-2d' };
    return out;
}

// themes: true copies the real template's .cmpose/themes.json (the six style families); older pins have none
const THEMES_JSON = path.join(__dirname, '..', 'fixtures', 'game', 'themes.json');

async function seedGameTemplate(dir, { full = false, legacyCi = false, themes = false } = {}) {
    const f = (rel, content) => fs.outputFile(path.join(dir, rel), content);
    const folder = (rel, guid) => f(`${rel}.meta`, meta(guid, true));
    const asset = async (rel, guid, content) => { await f(rel, content); await f(`${rel}.meta`, meta(guid)); };
    const P = 'Assets/_Project';
    const S = `${P}/Features/Sample`;

    const defines = ['CMPOSE_ADS', 'CMPOSE_SAMPLE', 'CMPOSE_SHOWCASE', ...(full ? Object.values(EXTRA_FLAGS).map((x) => x.define) : [])].join(';');
    await f('ProjectSettings/ProjectSettings.asset', PROJECT_SETTINGS.replace(/CMPOSE_ADS;CMPOSE_SAMPLE;CMPOSE_SHOWCASE/g, defines));
    await f('ProjectSettings/EditorBuildSettings.asset', EDITOR_BUILD_SETTINGS);
    await f('.cmpose/flags.json', json(full ? fullFlags(FLAGS) : FLAGS, 2));
    await f('.cmpose/package-guids.txt', '');
    await f('Packages/manifest.json', json(PACKAGES, 2));
    await f('README.md', legacyCi ? README + LEGACY_CI_README : README);
    if (legacyCi) await f('.github/workflows/ci.yml', CI);
    if (themes) await fs.copy(THEMES_JSON, path.join(dir, '.cmpose', 'themes.json'));

    await folder(P, GUIDS.project);

    await folder(`${P}/App`, GUIDS.app);
    await asset(`${P}/App/Kturker.UnityBase.App.asmdef`, GUIDS.appAsmdef, asmdef('Kturker.UnityBase.App', [
        'Kturker.UnityBase.Core.Presentation',
        'Kturker.UnityBase.Features.Sample.Installer',
        'Kturker.UnityBase.Features.Showcase.Installer',
        'VContainer'
    ]));
    await folder(`${P}/App/Game`, GUIDS.game);
    await asset(`${P}/App/Game/GameInstaller.cs`, GUIDS.gameInstaller, GAME_INSTALLER);

    await folder(`${P}/Core`, GUIDS.core);
    await folder(`${P}/Core/Ads`, GUIDS.coreAds);
    await asset(`${P}/Core/Ads/AdsConfig.cs`, GUIDS.adsConfig, ADS_CONFIG);
    await asset(`${P}/Core/Ads/Kturker.UnityBase.Core.Ads.asmdef`, GUIDS.coreAdsAsmdef, asmdef('Kturker.UnityBase.Core.Ads'));

    await folder(`${P}/Features`, GUIDS.features);
    await folder(S, GUIDS.sample);
    await folder(`${S}/Installer`, GUIDS.installer);
    await asset(`${S}/Installer/SampleInstaller.cs`, GUIDS.installerCs, SAMPLE_INSTALLER);
    await asset(`${S}/Installer/Kturker.UnityBase.Features.Sample.Installer.asmdef`, GUIDS.installerAsmdef,
        asmdef('Kturker.UnityBase.Features.Sample.Installer', ['Kturker.UnityBase.Features.Sample.Ads', 'VContainer']));
    await folder(`${S}/Ads`, GUIDS.ads);
    await asset(`${S}/Ads/SampleAdsPresenter.cs`, GUIDS.adsPresenter, ns('Kturker.UnityBase.Features.Sample.Ads',
        ['    public sealed class SampleAdsPresenter',
            '    {',
            '        public const string TitleKey = "sample.title";',
            '        public static readonly SaveSchema<int> Schema = new SaveSchema<int>("sample", 1);',
            '        private readonly ISampleView sample;',
            '        public void Start() => sample.CompleteClicked += OnComplete;',
            '    }', ''].join('\n')));
    await asset(`${S}/Ads/BonusView.cs`, GUIDS.bonusView, ns('Kturker.UnityBase.Features.Sample.Ads',
        '    public sealed class BonusView : UnityEngine.MonoBehaviour { }\n'));
    await asset(`${S}/Ads/Bonus.prefab`, GUIDS.bonusPrefab, [
        '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:', '--- !u!1 &100', 'GameObject:', '  m_Name: Bonus',
        '--- !u!114 &200', 'MonoBehaviour:', `  m_Script: {fileID: 11500000, guid: ${GUIDS.bonusView}, type: 3}`, '  key: sample.back', ''
    ].join('\n'));
    await asset(`${S}/Ads/Kturker.UnityBase.Features.Sample.Ads.asmdef`, GUIDS.adsAsmdef,
        asmdef('Kturker.UnityBase.Features.Sample.Ads', ['Kturker.UnityBase.Core.Ads']));
    await folder(`${S}/Resources`, GUIDS.resources);
    await folder(`${S}/Resources/Strings`, GUIDS.strings);
    await folder(`${S}/Resources/Strings/en`, GUIDS.en);
    await asset(`${S}/Resources/Strings/en/sample.json`, GUIDS.sampleJson, '{"sample.greeting":"Hi"}\n');

    await folder(`${P}/Features/Showcase`, GUIDS.showcase);
    await folder(`${P}/Features/Showcase/Installer`, GUIDS.showcaseInstaller);
    await asset(`${P}/Features/Showcase/Installer/ShowcaseInstaller.cs`, GUIDS.showcaseInstallerCs,
        ns('Kturker.UnityBase.Features.Showcase.Installer', '    public sealed class ShowcaseInstaller { }\n'));
    await asset(`${P}/Features/Showcase/Installer/Kturker.UnityBase.Features.Showcase.Installer.asmdef`, GUIDS.showcaseAsmdef,
        asmdef('Kturker.UnityBase.Features.Showcase.Installer', ['VContainer']));

    await folder(`${P}/Scenes`, GUIDS.scenes);
    await asset(`${P}/Scenes/Menu.unity`, GUIDS.menu, [
        '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:', '--- !u!1 &1', 'GameObject:', '  m_Name: Menu', ''
    ].join('\n'));

    if (full) {
        for (const x of Object.values(EXTRA_FLAGS)) {
            await folder(`${P}/Core/${x.dir}`, x.guid);
            await asset(`${P}/Core/${x.dir}/${x.dir}Service.cs`, x.cs, ns(`Kturker.UnityBase.Core.${x.dir}`,
                `    public sealed class ${x.dir}Service { }\n`));
        }
        await folder('Assets/GoogleMobileAds', GUIDS.gma);
        await folder('Assets/GoogleMobileAds/Resources', GUIDS.gmaResources);
        await asset('Assets/GoogleMobileAds/Resources/GoogleMobileAdsSettings.asset', GUIDS.gmaSettings, GMA_SETTINGS);
        // The 2d layer replaces the menu scene, keeping its guid
        await f('.cmpose/layers/render-2d/Assets/_Project/Scenes/Menu.unity', [
            '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:', '--- !u!1 &1', 'GameObject:', '  m_Name: Menu2D', ''
        ].join('\n'));
        await f('.cmpose/layers/render-2d/Assets/_Project/Scenes/Menu.unity.meta', meta(GUIDS.menu));
    }
    return dir;
}

module.exports = { seedGameTemplate, SEED_GUIDS: GUIDS, THEMES_JSON };
