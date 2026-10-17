'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const core = require('@cmpose/core');
const { createServer } = require('../src/server');
const { runBackendGenerate } = require('../src/backendGenerate');
const { fixtureCopy, read, exists } = require('../../core/test/backend-helpers');

const REF = 'backend-template-test';
const COMMIT = 'a'.repeat(40);
const BASE = { projectName: 'NotesBackend', appName: 'notes-api', packageName: 'com.acme.notes' };
const leftovers = async (dir) => (await fs.readdir(dir)).filter((n) => n.startsWith('.cmpose-'));
const textOf = (r) => r.content?.[0]?.text || '';

// The fixture template served by a stubbed cache; calls records each ensure() request
async function setup(t) {
    const template = await fixtureCopy(t);
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-out-'));
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-cache-'));
    t.after(async () => { await fs.remove(outputDir); await fs.remove(cacheDir); });
    const calls = [];
    const cacheEnsure = async (req) => { calls.push(req); return { dir: template, ref: req.ref, commit: COMMIT }; };
    const run = (args, opts = {}) => runBackendGenerate({ ...BASE, outputDir, templateRef: REF, ...args }, { cacheDir, cacheEnsure, ...opts });
    return { template, outputDir, calls, run };
}

async function connect(options) {
    const server = createServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
    return { client, close: () => client.close() };
}

test('backend_generate writes the project from the pinned repo at the given ref', async (t) => {
    const { outputDir, calls, run } = await setup(t);
    const r = await run({ sharing: true }, { generatorVersion: 'mcp@test' });
    assert.notStrictEqual(r.isError, true, textOf(r));
    const dir = path.join(outputDir, 'NotesBackend');
    assert.strictEqual(r.structuredContent.projectDir, dir);
    assert.deepStrictEqual(calls.map((c) => [c.repo, c.ref]), [[core.pins.backend.repo, REF]]);
    assert.ok(await exists(dir, 'src/main/kotlin/com/acme/notes/Main.kt'));
    assert.ok(await exists(dir, 'src/main/kotlin/com/acme/notes/sharing/Spaces.kt'));
    assert.ok(await exists(dir, 'deploy/docker-compose.notes-api.yml'));
    assert.ok(await exists(dir, 'tools/deploy-lint.sh'));
    assert.strictEqual(await exists(dir, 'tools/gate.sh'), false);
    assert.strictEqual(await exists(dir, 'tools/TEMPLATE.md'), false);
    const record = JSON.parse(await read(dir, '.cmpose/generation.json'));
    assert.deepStrictEqual(record.template, { repo: core.pins.backend.repo, ref: REF, commit: COMMIT });
    assert.strictEqual(record.sharing, true);
    assert.strictEqual(record.generatorVersion, 'mcp@test');
    assert.deepStrictEqual(r.structuredContent.record, record);
    assert.deepStrictEqual(r.structuredContent.warnings, []);
    assert.deepStrictEqual(await leftovers(outputDir), []);
});

test('backend_generate without sharing drops the sharing part', async (t) => {
    const { outputDir, run } = await setup(t);
    const r = await run({});
    assert.notStrictEqual(r.isError, true, textOf(r));
    const dir = path.join(outputDir, 'NotesBackend');
    assert.strictEqual(await exists(dir, 'src/main/kotlin/com/acme/notes/sharing'), false);
    assert.strictEqual(r.structuredContent.sharing, false);
});

test('backend_generate refuses a non-empty target and changes nothing', async (t) => {
    const { outputDir, calls, run } = await setup(t);
    const target = path.join(outputDir, 'NotesBackend');
    await fs.outputFile(path.join(target, 'keep.txt'), 'mine');
    const r = await run({});
    assert.strictEqual(r.isError, true);
    assert.match(textOf(r), /already exists and is not empty/);
    assert.deepStrictEqual(await fs.readdir(target), ['keep.txt']);
    assert.strictEqual(await read(target, 'keep.txt'), 'mine');
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(await leftovers(outputDir), []);
});

test('backend_generate returns every validation error and touches nothing', async (t) => {
    const { outputDir, calls, run } = await setup(t);
    const r = await run({ projectName: 'Notes 1', appName: 'api', packageName: 'io.cmpose.backendtemplate', sharing: 'yes' });
    assert.strictEqual(r.isError, true);
    for (const field of ['projectName', 'appName', 'packageName', 'sharing']) assert.match(textOf(r), new RegExp(`- ${field}: `));
    assert.match(textOf(r), /reserved/);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
});

test('backend_generate refuses a relative outputDir and a path-like templateRef', async (t) => {
    const { run } = await setup(t);
    assert.match(textOf(await run({ outputDir: 'relative/dir' })), /- outputDir: /);
    assert.match(textOf(await run({ templateRef: '../x' })), /- templateRef: /);
});

test('backend_generate on the PENDING pin explains how to proceed instead of downloading', async (t) => {
    const { outputDir, calls, run } = await setup(t);
    assert.match(core.pins.backend.ref, /-PENDING$/);
    const r = await run({ templateRef: undefined });
    assert.strictEqual(r.isError, true);
    assert.match(textOf(r), /not released yet; pass templateRef or set CMPOSE_BACKEND_TEMPLATE_DIR/);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
});

test('backend_generate uses a local template checkout without its working files', async (t) => {
    const { template, outputDir, calls, run } = await setup(t);
    await fs.outputFile(path.join(template, '.local-server', 'config.properties'), 'firebaseProjectId=x\n');
    await fs.outputFile(path.join(template, 'build', 'junk.txt'), 'junk');
    const r = await run({ templateRef: undefined }, { templateDir: template });
    assert.notStrictEqual(r.isError, true, textOf(r));
    const dir = path.join(outputDir, 'NotesBackend');
    assert.strictEqual(await exists(dir, '.local-server'), false);
    assert.strictEqual(await exists(dir, 'build'), false);
    assert.ok(await exists(dir, 'src/main/kotlin/com/acme/notes/Main.kt'));
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(r.structuredContent.record.template.ref, 'local');
    assert.match(r.structuredContent.warnings[0], /local template/);
});

// Secret files a checkout may hold, at the top and deeper
const SECRETS = ['.env', 'deploy/.env', 'deploy/prod.env', 'deploy/.env.local', 'AuthKey.p8', 'src/main/resources/tls.pem',
    'deploy/server.key', 'service-account-prod.json', 'deploy/service-account.json', 'google-services.json', 'GoogleService-Info.plist'];

test('backend_generate skips the secret files of a local checkout outside git', async (t) => {
    const { template, outputDir, run } = await setup(t);
    await fs.outputFile(path.join(template, 'deploy', '.env.example'), 'DB_PASSWORD=\n');
    for (const rel of SECRETS) await fs.outputFile(path.join(template, rel), 'secret\n');
    const r = await run({ templateRef: undefined }, { templateDir: template });
    assert.notStrictEqual(r.isError, true, textOf(r));
    const dir = path.join(outputDir, 'NotesBackend');
    for (const rel of SECRETS) assert.strictEqual(await exists(dir, rel), false, rel);
    assert.ok(await exists(dir, 'deploy/.env.example'));
    assert.deepStrictEqual(r.structuredContent.warnings.length, 1);
});

// The fixture as a git checkout with every file committed
function gitCheckout(dir) {
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'template');
}

test('backend_generate copies only the tracked files of a local git checkout', async (t) => {
    const { template, outputDir, run } = await setup(t);
    gitCheckout(template);
    for (const rel of [...SECRETS, 'notes.txt', 'deploy/scratch.yml']) await fs.outputFile(path.join(template, rel), 'untracked\n');
    const r = await run({ templateRef: undefined }, { templateDir: template });
    assert.notStrictEqual(r.isError, true, textOf(r));
    const dir = path.join(outputDir, 'NotesBackend');
    for (const rel of [...SECRETS, 'notes.txt', 'deploy/scratch.yml', '.git']) assert.strictEqual(await exists(dir, rel), false, rel);
    assert.ok(await exists(dir, 'src/main/kotlin/com/acme/notes/Main.kt'));
    for (const rel of ['gradlew', 'tools/deploy-lint.sh']) assert.ok(((await fs.stat(path.join(dir, rel))).mode & 0o111) !== 0, rel);
    // untracked files leave the checkout clean
    assert.strictEqual(r.structuredContent.warnings.length, 1);
    assert.match(r.structuredContent.warnings[0], /local template/);
});

test('backend_generate warns about a dirty local git checkout and copies its working files', async (t) => {
    const { template, outputDir, run } = await setup(t);
    gitCheckout(template);
    await fs.appendFile(path.join(template, 'README.md'), '\nA local edit.\n');
    const r = await run({ templateRef: undefined }, { templateDir: template });
    assert.notStrictEqual(r.isError, true, textOf(r));
    assert.match(r.structuredContent.warnings[1], /uncommitted changes/);
    assert.match(textOf(r), /Warning: The local template checkout has uncommitted changes/);
    assert.match(await read(path.join(outputDir, 'NotesBackend'), 'README.md'), /A local edit\./);
});

test('backend_generate refuses a local git checkout without tracked files', async (t) => {
    const { template, outputDir, run } = await setup(t);
    execFileSync('git', ['-C', template, 'init', '-q'], { stdio: 'pipe' });
    const r = await run({ templateRef: undefined }, { templateDir: template });
    assert.strictEqual(r.isError, true);
    assert.match(textOf(r), /no tracked files/);
    assert.deepStrictEqual(await leftovers(outputDir), []);
});

test('backend_generate refuses a local template path that is not a directory', async (t) => {
    const { run } = await setup(t);
    const r = await run({}, { templateDir: 'relative/template' });
    assert.strictEqual(r.isError, true);
    assert.match(textOf(r), /CMPOSE_BACKEND_TEMPLATE_DIR must be the absolute path/);
});

test('backend_generate removes the hidden copy when generation fails', async (t) => {
    const { outputDir, run } = await setup(t);
    const original = core.backend.generateBackend;
    core.backend.generateBackend = async () => { throw new Error('boom'); };
    t.after(() => { core.backend.generateBackend = original; });
    const r = await run({});
    assert.strictEqual(r.isError, true);
    assert.match(textOf(r), /Generation failed: boom/);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
});

test('backend_describe returns the contract version, the pin and the conventions', async () => {
    const { client, close } = await connect({});
    const r = await client.callTool({ name: 'backend_describe', arguments: {} });
    const facts = r.structuredContent;
    assert.strictEqual(facts.contractVersion, core.backend.backendContractVersion());
    assert.strictEqual(facts.templateRef, core.pins.backend.ref);
    assert.strictEqual(facts.options.sharing.default, false);
    assert.deepStrictEqual(facts.appNameRules.reserved, ['api', 'health', 'admin', 'static']);
    const conventions = JSON.stringify(facts.conventions);
    for (const rule of ['requireUser()', 'requireRole(', '404', 'feature/<name>/', 'feature/sample', 'ON DELETE CASCADE',
        'SECURITY-CHECKLIST.md', './gradlew runLocal', '18001', '.local-server/config.properties', 'firebaseProjectId', 'deploy/']) {
        assert.ok(conventions.includes(rule), `conventions miss ${rule}`);
    }
    await close();
});

test('backend_generate offers exactly the contract fields', async () => {
    const { client, close } = await connect({});
    const { tools } = await client.listTools();
    const tool = tools.find((x) => x.name === 'backend_generate');
    assert.deepStrictEqual(Object.keys(tool.inputSchema.properties).sort(),
        ['appName', 'outputDir', 'packageName', 'projectName', 'sharing', 'templateRef']);
    assert.deepStrictEqual(tool.inputSchema.required.sort(), ['appName', 'outputDir', 'packageName', 'projectName']);
    assert.match(tool.description, /^Generate a standalone Kotlin\/Ktor backend \(Docker-ready\) on this machine\. Call backend_describe first\./);
    await close();
});
