'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { execFileSync } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const core = require('@cmpose/core');
const { createServer } = require('../src/server');
const { seedGameTemplate } = require('../../core/test/support/seedGameTemplate');

// A local git repository holding the game seed template at the pinned tag; cloned by its directory path
async function makeGameTemplateRepo(tag = core.pins.game.ref, { edit = async () => { }, themes = false } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-repo-'));
    await seedGameTemplate(dir, { full: true, themes });
    await edit(dir);
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
    // No auto maintenance: a background repack after the commit would race the local clone's object copy
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'commit', '-q', '-m', 'seed');
    git('tag', tag);
    return { url: dir, commit: git('rev-parse', 'HEAD'), cleanup: () => fs.remove(dir) };
}

async function connect(options) {
    const server = createServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
    return { client, close: () => client.close() };
}

async function setup({ remoteUrl, edit, themes } = {}) {
    const remote = remoteUrl ? null : await makeGameTemplateRepo(undefined, { edit, themes });
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-cache-'));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-out-'));
    const conn = await connect({ cacheDir, remoteUrl: remoteUrl || remote.url });
    const cleanup = async () => {
        await conn.close();
        if (remote) await remote.cleanup();
        await fs.remove(cacheDir); await fs.remove(outputDir);
    };
    return { client: conn.client, remote, outputDir, cleanup };
}

const BASE = { projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper' };
const generate = (client, args) => client.callTool({ name: 'game_generate', arguments: { ...BASE, ...args } });
const leftovers = async (dir) => (await fs.readdir(dir)).filter((n) => n.startsWith('.cmpose-'));

test('lists game_describe and game_generate', async () => {
    const { client, close } = await connect({});
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('game_describe'), names.join(', '));
    assert.ok(names.includes('game_generate'), names.join(', '));
    await close();
});

test('game_generate does not offer ci (GameCI is not offered for games); cmp_generate keeps it', async () => {
    const { client, cleanup: close } = await setup();
    const { tools } = await client.listTools();
    const props = (name) => Object.keys(tools.find((t) => t.name === name).inputSchema.properties);
    assert.ok(!props('game_generate').includes('ci'), props('game_generate').join(', '));
    assert.ok(props('cmp_generate').includes('ci'));
    const r = await client.callTool({ name: 'game_describe', arguments: {} });
    assert.ok(!('ci' in r.structuredContent.defaults));
    await close();
});

test('game_generate drops an unknown ci argument (not in its schema) and ships no workflow', async () => {
    const { client, outputDir, cleanup } = await setup();
    const r = await generate(client, { outputDir, ci: true });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const projectDir = path.join(outputDir, 'SkyHopper');
    assert.equal(await fs.pathExists(path.join(projectDir, '.github')), false);
    assert.ok(!('ci' in await fs.readJson(path.join(projectDir, '.cmpose/generation.json'))));
    await cleanup();
});

test('game_describe returns unity 6000.3.25f1 and the pin', async () => {
    const { client, cleanup: close } = await setup();
    const r = await client.callTool({ name: 'game_describe', arguments: {} });
    assert.notStrictEqual(r.isError, true);
    assert.strictEqual(r.structuredContent.engine, 'unity');
    assert.strictEqual(r.structuredContent.unityVersion, '6000.3.25f1');
    assert.deepStrictEqual(r.structuredContent.template, { repo: core.pins.game.repo, ref: core.pins.game.ref });
    assert.deepStrictEqual(JSON.parse(r.content[0].text), r.structuredContent);
    await close();
});

test('generates a blank project with a module', async () => {
    const { client, remote, outputDir, cleanup } = await setup();
    const r = await generate(client, { outputDir, templateType: 'blank', features: ['shop'] });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const projectDir = path.join(outputDir, 'SkyHopper');
    const s = r.structuredContent;
    assert.strictEqual(s.projectDir, projectDir);
    assert.deepStrictEqual(s.template, { repo: core.pins.game.repo, ref: core.pins.game.ref, commit: remote.commit });
    assert.strictEqual(s.templateType, 'blank');
    assert.strictEqual(s.render, '2d');
    assert.deepStrictEqual(s.flags, []);
    assert.deepStrictEqual(s.features, ['shop']);
    assert.ok(s.warnings.some((w) => /6000\.3\.25f1/.test(w)));
    assert.strictEqual(s.nextSteps[0], 'Open the folder in Unity Hub with editor 6000.3.25f1 (Android and iOS Build Support modules).');
    assert.strictEqual(s.nextSteps.length, 3);
    assert.ok(await fs.pathExists(path.join(projectDir, 'Assets/_Project/Features/Shop')));
    assert.ok(await fs.pathExists(path.join(projectDir, 'ProjectSettings/ProjectSettings.asset')));
    assert.match(r.content[0].text, /Generated SkyHopper/);
    const record = await fs.readJson(path.join(projectDir, '.cmpose/generation.json'));
    assert.strictEqual(record.generatorVersion, `mcp@${require('../package.json').version}`);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

test('refuses a non-empty target', async () => {
    const { client, outputDir, cleanup } = await setup();
    await fs.outputFile(path.join(outputDir, 'SkyHopper', 'x'), 'mine');
    const r = await generate(client, { outputDir });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /not empty/);
    assert.deepStrictEqual(await fs.readdir(path.join(outputDir, 'SkyHopper')), ['x']);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

test('invalid input names the field and writes nothing', async () => {
    const { client, outputDir, cleanup } = await setup();
    const r = await generate(client, { outputDir, templateType: 'showcase', features: ['shop'] });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /features/);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    await cleanup();
});

test('a relative outputDir is refused', async () => {
    const { client, close } = await connect({});
    const r = await generate(client, { outputDir: 'rel', minSdk: 26, iosVersion: 16.4 });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /outputDir must be an absolute path/);
    await close();
});

test('a template that cannot be fetched leaves nothing behind', async () => {
    const missing = path.join(os.tmpdir(), `cmpose-missing-${process.pid}-${Date.now()}`);
    const { client, outputDir, cleanup } = await setup({ remoteUrl: missing });
    const r = await generate(client, { outputDir });
    assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'SkyHopper')), false);
    await cleanup();
});

test('cleans up after a failed generation', async () => {
    // A template whose GameInstaller lost its features markers: the copy is made, then module cloning fails
    const edit = async (dir) => {
        const file = path.join(dir, 'Assets/_Project/App/Game/GameInstaller.cs');
        await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace(/^.*cmpose:features:end.*\n/m, ''));
    };
    const { client, outputDir, cleanup } = await setup({ edit });
    const r = await generate(client, { outputDir, templateType: 'blank', features: ['shop'] });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /^Generation failed: module shop: .*cmpose:features:end/);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'SkyHopper')), false);
    await cleanup();
});

test('a failure after the copy removes the working directory', async () => {
    const { client, outputDir, cleanup } = await setup();
    // Works only because runGameGenerate calls core.game.generateGame through the object property at call time
    // (not a destructured or cached reference): the replacement here is what it sees
    const original = core.game.generateGame;
    core.game.generateGame = async () => { throw new Error('boom'); };
    let r;
    try {
        r = await generate(client, { outputDir });
    } finally {
        core.game.generateGame = original;
    }
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /boom/);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'SkyHopper')), false);
    await cleanup();
});

test('a target filled while generating is not overwritten', async () => {
    const { client, outputDir, cleanup } = await setup();
    const target = path.join(outputDir, 'SkyHopper');
    // Through the object property, as above: another process claims the target while the project is generated
    const original = core.game.generateGame;
    core.game.generateGame = async (...args) => {
        const summary = await original(...args);
        await fs.outputFile(path.join(target, 'theirs.txt'), 'theirs');
        return summary;
    };
    let r;
    try {
        r = await generate(client, { outputDir });
    } finally {
        core.game.generateGame = original;
    }
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /^Generation failed: .*not empty/);
    assert.deepStrictEqual(await fs.readdir(target), ['theirs.txt']);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

const FAMILIES = ['bright', 'neon', 'pastel', 'bold', 'nature', 'clean'];
const describeGame = async (client) => (await client.callTool({ name: 'game_describe', arguments: {} })).structuredContent;

test('game_describe lists the pinned template families with their font pair ids', async () => {
    const { client, cleanup } = await setup({ themes: true });
    const facts = await describeGame(client);
    assert.strictEqual(facts.themes.default, 'clean');
    assert.deepStrictEqual(facts.themes.families.map((f) => f.id), FAMILIES);
    const neon = facts.themes.families.find((f) => f.id === 'neon');
    assert.deepStrictEqual(Object.keys(neon), ['id', 'title', 'suits', 'fontPairs']);
    assert.deepStrictEqual(neon.fontPairs, ['chakrapetch-exo2', 'outfit-exo2']);
    assert.strictEqual(facts.themes.unavailable, undefined);
    assert.deepStrictEqual(facts.contract.theme.fields, ['family', 'primary', 'accent', 'fontPair']);
    assert.strictEqual(facts.contractVersion, core.game.gameContractVersion());
    await cleanup();
});

test('game_describe of an older template without themes.json has no families', async () => {
    const { client, cleanup } = await setup();
    const facts = await describeGame(client);
    assert.deepStrictEqual(facts.themes, { default: null, families: [] });
    await cleanup();
});

test('game_describe still answers when the template cannot be fetched: no families, and why', async () => {
    const missing = path.join(os.tmpdir(), `cmpose-missing-${process.pid}-${Date.now()}`);
    const { client, cleanup } = await setup({ remoteUrl: missing });
    const r = await client.callTool({ name: 'game_describe', arguments: {} });
    assert.notStrictEqual(r.isError, true);
    assert.deepStrictEqual(r.structuredContent.themes.families, []);
    assert.match(r.structuredContent.themes.unavailable, /^Theme families unavailable: Could not download the template/);
    assert.strictEqual(r.structuredContent.engine, 'unity');
    await cleanup();
});

test('game_describe reports a broken themes.json instead of guessing families', async () => {
    const edit = (dir) => fs.outputFile(path.join(dir, '.cmpose/themes.json'), '{ not json');
    const { client, cleanup } = await setup({ edit });
    const facts = await describeGame(client);
    assert.deepStrictEqual(facts.themes.families, []);
    assert.match(facts.themes.unavailable, /themes\.json is not valid/);
    await cleanup();
});

test('game_generate offers theme with its four fields', async () => {
    const { client, close } = await connect({});
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'game_generate');
    assert.deepStrictEqual(Object.keys(tool.inputSchema.properties.theme.properties), ['family', 'primary', 'accent', 'fontPair']);
    assert.match(tool.description, /theme/);
    assert.match(tool.description, /clean/);
    await close();
});

test('game_generate applies a family and reports it in the result', async () => {
    const { client, outputDir, cleanup } = await setup({ themes: true });
    const r = await generate(client, { outputDir, theme: { family: 'neon', primary: '#e91e63' } });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.deepStrictEqual(r.structuredContent.theme, { family: 'neon', primary: '#E91E63', fontPair: 'chakrapetch-exo2' });
    assert.match(r.content[0].text, /^Theme: neon \(chakrapetch-exo2\)$/m);
    const record = await fs.readJson(path.join(outputDir, 'SkyHopper', '.cmpose/generation.json'));
    assert.deepStrictEqual(record.theme, r.structuredContent.theme);
    await cleanup();
});

test('game_generate without theme uses the template default family', async () => {
    const { client, outputDir, cleanup } = await setup({ themes: true });
    const r = await generate(client, { outputDir });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.deepStrictEqual(r.structuredContent.theme, { family: 'clean', fontPair: 'outfit-inter' });
    await cleanup();
});

test('a colour that cannot keep contrast falls back with a warning in the tool result', async () => {
    // A template whose clean family is all one grey: no shift of primary can read on it, so it falls back
    const edit = async (dir) => {
        const file = path.join(dir, '.cmpose/themes.json');
        const themes = await fs.readJson(file);
        const clean = themes.families.find((f) => f.id === 'clean');
        clean.light = Object.fromEntries(Object.keys(clean.light).map((role) => [role, '#777777']));
        await fs.writeJson(file, themes);
    };
    const { client, outputDir, cleanup } = await setup({ themes: true, edit });
    const r = await generate(client, { outputDir, templateType: 'blank', flags: [], theme: { family: 'clean', primary: '#E91E63' } });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const warning = 'theme: Primary fell back to the family default in the light palette';
    assert.ok(r.structuredContent.warnings.includes(warning), r.structuredContent.warnings.join('\n'));
    assert.match(r.content[0].text, new RegExp(`^Warning: ${warning}$`, 'm'));
    // The fallen-back colour is not reported as applied
    assert.deepStrictEqual(r.structuredContent.theme, { family: 'clean', fontPair: 'outfit-inter' });
    await cleanup();
});

test('a theme the template cannot honour is refused by field and writes nothing', async () => {
    const { client, outputDir, cleanup } = await setup({ themes: true });
    const cases = [
        [{ family: 'retro' }, /theme\.family must be one of this template's families: bright, neon, pastel, bold, nature, clean/],
        [{ family: 'neon', fontPair: 'comic-sans' }, /theme\.fontPair must be one of neon's font pairs: chakrapetch-exo2, outfit-exo2/],
        [{ family: 'neon', primary: 'red' }, /theme\.primary must look like #RRGGBB/],
        [{ family: 'neon', glow: true }, /theme has unknown fields: glow/]
    ];
    for (const [theme, expected] of cases) {
        const r = await generate(client, { outputDir, theme });
        assert.strictEqual(r.isError, true, JSON.stringify(theme));
        assert.match(r.content[0].text, expected);
        assert.ok(!r.content[0].text.includes('comic-sans') && !r.content[0].text.includes('retro'), r.content[0].text);
    }
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    await cleanup();
});

test('a theme on a template without families is refused', async () => {
    const { client, outputDir, cleanup } = await setup();
    const r = await generate(client, { outputDir, theme: { family: 'neon' } });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /this template has no theme families/);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'SkyHopper')), false);
    await cleanup();
});

test('a theme that is not an object is refused by the schema', async () => {
    const { client, outputDir, cleanup } = await setup({ themes: true });
    const r = await generate(client, { outputDir, theme: 'neon' })
        .catch((err) => ({ isError: true, content: [{ text: err.message }] }));
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /theme/);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    await cleanup();
});
