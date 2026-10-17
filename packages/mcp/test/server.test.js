'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const core = require('@cmpose/core');
const { createServer } = require('../src/server');
const { makeGitTemplateRepo } = require('../../core/test/support/gitTemplateRepo');

async function connect(options) {
    const server = createServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
    return { client, close: () => client.close() };
}

test('lists the six tools and describes the contract', async () => {
    const { client, close } = await connect({});
    const { tools } = await client.listTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['backend_describe', 'backend_generate', 'cmp_describe', 'cmp_generate', 'game_describe', 'game_generate']);
    const r = await client.callTool({ name: 'cmp_describe', arguments: {} });
    assert.strictEqual(r.structuredContent.template.ref, core.pins.cmp.ref);
    assert.strictEqual(r.structuredContent.contract.limits.rateLimitMax, undefined);
    await close();
});

test('cmp_generate writes a project and nothing reaches stdout', async () => {
    const remote = await makeGitTemplateRepo(core.pins.cmp.ref);
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-srv-cache-'));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-srv-out-'));
    core.setLogger({ info: (...a) => console.error(...a), warn: (...a) => console.error(...a), error: (...a) => console.error(...a) });
    const writes = [];
    const original = process.stdout.write.bind(process.stdout);
    const { client, close } = await connect({ cacheDir, remoteUrl: remote.url });
    process.stdout.write = (chunk, ...rest) => { writes.push(String(chunk)); return true; };
    let r;
    try {
        r = await client.callTool({
            name: 'cmp_generate',
            arguments: { projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', outputDir }
        });
    } finally {
        process.stdout.write = original;
    }
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(await fs.pathExists(path.join(outputDir, 'Demo', 'settings.gradle.kts')));
    assert.deepStrictEqual(writes.filter((w) => !w.startsWith('#') && !w.startsWith('TAP')), []);
    await close();
    core.setLogger(null);
    await remote.cleanup(); await fs.remove(cacheDir); await fs.remove(outputDir);
});

test('cmp_generate accepts minSdk and iosVersion as numbers', async () => {
    const { client, close } = await connect({});
    // A relative outputDir stops runGenerate before any download: reaching that check means the
    // tool's input schema took the numbers
    const r = await client.callTool({
        name: 'cmp_generate',
        arguments: { projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', outputDir: 'rel', minSdk: 26, iosVersion: 16.4 }
    });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /outputDir must be an absolute path/);
    await close();
});
