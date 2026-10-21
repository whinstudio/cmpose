const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { seedGameTemplate } = require('./support/seedGameTemplate');
const { cloneModules } = require('../src/game/modules');
const { applyFlags } = require('../src/game/flags');

async function project(t) {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'gmod-'));
    t.after(() => fs.remove(d));
    await seedGameTemplate(d);
    return d;
}
const read = (d, rel) => fs.readFile(path.join(d, rel), 'utf8');

test('clones Sample with new guids, renamed names, keys and string files', async (t) => {
    const d = await project(t);
    assert.deepStrictEqual(await cloneModules(d, ['shop'], { seed: 'com.acme.game' }), ['Assets/_Project/Features/Shop']);
    const inst = await read(d, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs');
    assert.match(inst, /namespace Kturker\.UnityBase\.Features\.Shop\.Installer/);
    assert.ok(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop/Resources/Strings/en/shop.json')));
    assert.match(await read(d, 'Assets/_Project/Features/Shop/Resources/Strings/en/shop.json'), /"shop\.greeting"/);
    const oldGuid = /guid: (\w+)/.exec(await read(d, 'Assets/_Project/Features/Sample/Installer/SampleInstaller.cs.meta'))[1];
    const newGuid = /guid: (\w+)/.exec(await read(d, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs.meta'))[1];
    assert.notStrictEqual(newGuid, oldGuid);
});

test('renames only the Sample localization keys, not C# members named sample', async (t) => {
    const d = await project(t);
    await cloneModules(d, ['shop'], { seed: 's' });
    const cs = await read(d, 'Assets/_Project/Features/Shop/Ads/ShopAdsPresenter.cs');
    assert.match(cs, /"shop\.title"/);
    assert.match(cs, /private readonly IShopView sample;/);
    assert.match(cs, / sample\.ShowCompleted\(count\.Value\);/);
    assert.ok(!cs.includes('shop.ShowCompleted'));
    assert.match(await read(d, 'Assets/_Project/Features/Shop/Ads/Bonus.prefab'), /^ {2}key: shop\.back$/m);
});

test('each copy gets its own save slot; Sample keeps "sample"', async (t) => {
    const d = await project(t);
    await cloneModules(d, ['shop'], { seed: 's' });
    assert.match(await read(d, 'Assets/_Project/Features/Shop/Ads/ShopAdsPresenter.cs'), /new SaveSchema<int>\("shop", 1\)/);
    assert.match(await read(d, 'Assets/_Project/Features/Sample/Ads/SampleAdsPresenter.cs'), /new SaveSchema<int>\("sample", 1\)/);
});

test('wires the installer, its using line and the App asmdef reference', async (t) => {
    const d = await project(t);
    await cloneModules(d, ['shop', 'quests'], { seed: 's' });
    const gi = await read(d, 'Assets/_Project/App/Game/GameInstaller.cs');
    assert.match(gi, /using Kturker\.UnityBase\.Features\.Shop\.Installer;/);
    assert.match(gi, /if \(registerViews\) new ShopInstaller\(registerViews\)\.Install\(builder\);\n\s*if \(registerViews\) new QuestsInstaller\(registerViews\)\.Install\(builder\);\n\s*\/\/ cmpose:features:end/);
    const app = JSON.parse(await read(d, 'Assets/_Project/App/Kturker.UnityBase.App.asmdef'));
    assert.ok(app.references.includes('Kturker.UnityBase.Features.Shop.Installer'));
    assert.ok(app.references.includes('Kturker.UnityBase.Features.Quests.Installer'));
});

test('clones lose the parts of turned-off flags', async (t) => {
    const d = await project(t);
    await cloneModules(d, ['shop'], { seed: 's' });
    const manifest = JSON.parse(await read(d, '.cmpose/flags.json'));
    assert.ok(manifest.flags.ads.paths.includes('Assets/_Project/Features/Shop/Ads'));
    assert.ok(manifest.flags.ads.asmdefs.includes('Kturker.UnityBase.Features.Shop.Ads'));
    assert.ok(!manifest.flags.sample.paths.some((p) => p.includes('/Shop')));
    await applyFlags(d, { kind: 'blank', off: ['ads'] });
    assert.ok(!(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop/Ads'))));
    assert.ok(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop/Installer')));
});

test('same seed, same guids; missing anchors fail clearly', async (t) => {
    const a = await project(t); const b = await project(t);
    await cloneModules(a, ['shop'], { seed: 'x' }); await cloneModules(b, ['shop'], { seed: 'x' });
    assert.strictEqual(await read(a, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs.meta'), await read(b, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs.meta'));
    const c = await project(t);
    await fs.remove(path.join(c, 'Assets/_Project/App/Game/GameInstaller.cs'));
    await assert.rejects(cloneModules(c, ['shop'], { seed: 'x' }), /module shop: .*GameInstaller/);
});

// Every anchor the wiring needs, removed one at a time: each fails before anything is written, naming all modules
const ANCHORS = [
    ['the Sample folder', (d) => fs.remove(path.join(d, 'Assets/_Project/Features/Sample')), /Assets\/_Project\/Features\/Sample not found/],
    ['the flag manifest', (d) => fs.remove(path.join(d, '.cmpose/flags.json')), /\.cmpose\/flags\.json not found/],
    ['the manifest flags', (d) => fs.writeFile(path.join(d, '.cmpose/flags.json'), '{}\n'), /\.cmpose\/flags\.json "flags" not found/],
    ['a broken manifest', (d) => fs.writeFile(path.join(d, '.cmpose/flags.json'), '{'), /modules shop, quests: .*JSON/],
    ['the GameInstaller', (d) => fs.remove(path.join(d, 'Assets/_Project/App/Game/GameInstaller.cs')), /GameInstaller\.cs not found/],
    ['the features markers', (d) => edit(d, GI, (s) => s.replace('// cmpose:features:end', '')), /cmpose:features:start … .*not found/],
    ['the SampleInstaller line', (d) => edit(d, GI, (s) => s.replace(/^.*new SampleInstaller\(.*$/m, '')), /the SampleInstaller line .*not found/],
    ['the Sample using line', (d) => edit(d, GI, (s) => s.replace('using Kturker.UnityBase.Features.Sample.Installer;', '')), /'using Kturker\.UnityBase\.Features\.Sample\.Installer;' .*not found/],
    ['the App asmdef', (d) => fs.remove(path.join(d, APP_ASMDEF)), /the asmdef owning .*not found/],
    ['the asmdef reference', (d) => edit(d, APP_ASMDEF, (s) => s.replace('"Kturker.UnityBase.Features.Sample.Installer"', '"Other.Installer"')), /the Kturker\.UnityBase\.Features\.Sample\.Installer reference .*not found/]
];
const GI = 'Assets/_Project/App/Game/GameInstaller.cs';
const APP_ASMDEF = 'Assets/_Project/App/Kturker.UnityBase.App.asmdef';
const edit = async (d, rel, fn) => fs.writeFile(path.join(d, rel), fn(await read(d, rel)));

for (const [what, remove, message] of ANCHORS) {
    test(`a missing anchor fails clearly: ${what}`, async (t) => {
        const d = await project(t);
        await remove(d);
        await assert.rejects(cloneModules(d, ['shop', 'quests'], { seed: 'x' }), (e) => {
            assert.match(e.message, /^modules shop, quests: /);
            assert.match(e.message, message);
            return true;
        });
        assert.ok(!(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop'))));
    });
}

test('the manifest and the App asmdef keep their own format', async (t) => {
    const d = await project(t);
    const manifest = JSON.parse(await read(d, '.cmpose/flags.json'));
    await fs.writeFile(path.join(d, '.cmpose/flags.json'), JSON.stringify(manifest, null, 4).replace(/\n/g, '\r\n') + '\r\n');
    const app = JSON.parse(await read(d, APP_ASMDEF));
    await fs.writeFile(path.join(d, APP_ASMDEF), JSON.stringify(app, null, '\t'));
    await cloneModules(d, ['shop'], { seed: 'x' });
    const m = await read(d, '.cmpose/flags.json');
    assert.match(m, /^\{\r\n {4}"flags": \{\r\n {8}"/);
    assert.ok(m.endsWith('}\r\n') && !/[^\r]\n/.test(m));
    const a = await read(d, APP_ASMDEF);
    assert.match(a, /^\{\n\t"name"/);
    assert.ok(a.endsWith('}'));
    assert.ok(JSON.parse(a).references.includes('Kturker.UnityBase.Features.Shop.Installer'));
});

test('a one-line, a blank-first-line and a leading-newline manifest keep their shape', async (t) => {
    const write = async (d, text) => fs.writeFile(path.join(d, '.cmpose/flags.json'), text);
    const oneLine = await project(t);
    await write(oneLine, `${JSON.stringify(JSON.parse(await read(oneLine, '.cmpose/flags.json')))}\n`);
    await cloneModules(oneLine, ['shop'], { seed: 'x' });
    const a = await read(oneLine, '.cmpose/flags.json');
    assert.ok(a.endsWith('}\n') && !a.slice(0, -1).includes('\n'), a.slice(0, 80));

    const leading = await project(t);
    await write(leading, `\n${JSON.stringify(JSON.parse(await read(leading, '.cmpose/flags.json')), null, 4)}\n`);
    await cloneModules(leading, ['shop'], { seed: 'x' });
    assert.match(await read(leading, '.cmpose/flags.json'), /^\{\n {4}"flags": \{\n {8}"/);

    const blankFirst = await project(t);
    const text = JSON.stringify(JSON.parse(await read(blankFirst, '.cmpose/flags.json')), null, 4);
    await write(blankFirst, `{\n\n${text.slice(2)}\n`);
    await cloneModules(blankFirst, ['shop'], { seed: 'x' });
    assert.match(await read(blankFirst, '.cmpose/flags.json'), /^\{\n {4}"flags": \{\n {8}"/);
});
