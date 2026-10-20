'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { runGenerate } = require('../src/generate');
const { makeGitTemplateRepo } = require('../../core/test/support/gitTemplateRepo');
const core = require('@cmpose/core');

const args = (outputDir, extra = {}) => ({
    projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', outputDir, ...extra
});

async function setup() {
    const remote = await makeGitTemplateRepo(core.pins.cmp.ref);
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-mcp-cache-'));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-mcp-out-'));
    const opts = { cacheDir, remoteUrl: remote.url, generatorVersion: 'mcp@test' };
    const cleanup = async () => { await remote.cleanup(); await fs.remove(cacheDir); await fs.remove(outputDir); };
    return { opts, outputDir, cleanup };
}

const leftovers = async (dir) => (await fs.readdir(dir)).filter((n) => n.startsWith('.cmpose-'));

test('generates into <outputDir>/<projectName> and reports the summary', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const progress = [];
    const r = await runGenerate(args(outputDir), { ...opts, onProgress: (m) => progress.push(m) });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const projectDir = path.join(outputDir, 'Demo');
    assert.strictEqual(r.structuredContent.projectDir, projectDir);
    assert.strictEqual(r.structuredContent.template.ref, core.pins.cmp.ref);
    assert.ok(await fs.pathExists(path.join(projectDir, 'settings.gradle.kts')));
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.ok(progress.length >= 2);
    await cleanup();
});

test('a relative outputDir is refused', async () => {
    const r = await runGenerate(args('some/dir'), {});
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /absolute/);
});

test('invalid input is refused before anything is downloaded or written', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { projectName: 'Bad Name' }), opts);
    assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(opts.cacheDir, 'templates')), false);
    await cleanup();
});

test('an existing non-empty target or a file is never overwritten; an empty directory is used', async () => {
    const { opts, outputDir, cleanup } = await setup();
    await fs.outputFile(path.join(outputDir, 'Demo', 'keep.txt'), 'mine');
    let r = await runGenerate(args(outputDir), opts);
    assert.strictEqual(r.isError, true);
    assert.strictEqual(await fs.readFile(path.join(outputDir, 'Demo', 'keep.txt'), 'utf8'), 'mine');
    await fs.remove(path.join(outputDir, 'Demo'));
    await fs.outputFile(path.join(outputDir, 'Demo'), 'a file');
    r = await runGenerate(args(outputDir), opts);
    assert.strictEqual(r.isError, true);
    await fs.remove(path.join(outputDir, 'Demo'));
    await fs.ensureDir(path.join(outputDir, 'Demo'));
    r = await runGenerate(args(outputDir), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    await cleanup();
});

test('a template download failure is reported and leaves nothing behind', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { templateRef: 'template-missing' }), opts);
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /template-missing/);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    await cleanup();
});

test('a generation failure removes its working directory', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { templateType: 'blank', featuresConfig: { purchases: true } }), opts);
    // The seed template has no monetization modules: the capability check fails
    assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'Demo')), false);
    await cleanup();
});

test('content appearing at the target during generation is never deleted', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const original = core.generateCmpProject;
    core.generateCmpProject = async (...a) => {
        const summary = await original(...a);
        await fs.outputFile(path.join(outputDir, 'Demo', 'theirs.txt'), 'other run');
        return summary;
    };
    let r;
    try {
        r = await runGenerate(args(outputDir), opts);
    } finally {
        core.generateCmpProject = original;
    }
    assert.strictEqual(r.isError, true);
    assert.strictEqual(await fs.readFile(path.join(outputDir, 'Demo', 'theirs.txt'), 'utf8'), 'other run');
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

test('removeEmptyDir removes only an empty directory and tolerates a missing one', async () => {
    const { removeEmptyDir } = require('../src/generate');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-rmdir-'));
    const full = path.join(dir, 'full');
    await fs.outputFile(path.join(full, 'keep.txt'), 'mine');
    await assert.rejects(removeEmptyDir(full));
    assert.strictEqual(await fs.readFile(path.join(full, 'keep.txt'), 'utf8'), 'mine');
    await fs.ensureDir(path.join(dir, 'empty'));
    await removeEmptyDir(path.join(dir, 'empty'));
    assert.strictEqual(await fs.pathExists(path.join(dir, 'empty')), false);
    await removeEmptyDir(path.join(dir, 'missing'));
    await fs.remove(dir);
});

test('unknown featuresConfig keys are refused by name, with the valid keys listed', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { templateType: 'blank', featuresConfig: { netwrk: true, theming: true, roomz: false } }), opts);
    assert.strictEqual(r.isError, true);
    const text = r.content[0].text;
    assert.match(text, /netwrk/);
    assert.match(text, /roomz/);
    for (const key of core.SCHEMA.featuresConfigKeys) assert.ok(text.includes(key), `valid key ${key} listed`);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(opts.cacheDir, 'templates')), false);
    await cleanup();
});

test('featuresConfig on a showcase project is reported as ignored', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { featuresConfig: { network: true } }), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const warning = r.structuredContent.warnings.find((w) => /featuresConfig/.test(w));
    assert.ok(warning, 'a featuresConfig warning');
    assert.match(warning, /showcase/);
    assert.match(r.content[0].text, /Warning: featuresConfig/);
    assert.strictEqual(r.structuredContent.featuresConfig, null);
    await cleanup();
});

test('cmp_describe defaults include backend off', () => {
    const { describe } = require('../src/describe');
    assert.strictEqual(describe().defaults.featuresConfig.backend, false);
});

test('backend on a showcase project is reported as ignored', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { featuresConfig: { backend: true } }), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const warning = r.structuredContent.warnings.find((w) => /featuresConfig/.test(w));
    assert.ok(warning, 'a featuresConfig warning');
    assert.match(warning, /ignored for showcase/);
    assert.ok(!r.structuredContent.warnings.some((w) => /Firebase|:server:runLocal/.test(w)));
    assert.strictEqual(r.structuredContent.featuresConfig, null);
    await cleanup();
});

test('no featuresConfig warning when showcase is generated without one', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(!r.structuredContent.warnings.some((w) => /featuresConfig/.test(w)));
    await cleanup();
});

test('minSdk and iosVersion may be numbers', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { minSdk: 26, iosVersion: 16.4 }), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(await fs.pathExists(path.join(outputDir, 'Demo', 'settings.gradle.kts')));
    await cleanup();
});

test('the download progress message is sent only while the template is not cached yet', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const first = [];
    let r = await runGenerate(args(outputDir), { ...opts, onProgress: (m) => first.push(m) });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(first.some((m) => /Downloading/.test(m)), first.join(' | '));
    const second = [];
    r = await runGenerate(args(outputDir, { projectName: 'Other' }), { ...opts, onProgress: (m) => second.push(m) });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.strictEqual(second.length, 2);
    assert.ok(!second.some((m) => /Downloading/.test(m)), second.join(' | '));
    await cleanup();
});

// --- blank with backend: server/ comes from the backend template (core places it; here the call is captured) ---

const { execFileSync } = require('child_process');
const { fixtureCopy } = require('../../core/test/backend-helpers');

const BACKEND_COMMIT = 'b'.repeat(40);
const MISSING_BACKEND_REF = 'backend-template-missing';
const BACKEND_ON = { templateType: 'blank', featuresConfig: { backend: true } };
const RAW_COPY_RE = /^\.cmpose-[0-9a-f]{12}-server$/;

// Relative paths of every file under dir
async function filesUnder(dir) {
    const entries = await fs.promises.readdir(dir, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath || e.path, e.name)).split(path.sep).join('/')).sort();
}

// Two remote repos behind one injected cacheEnsure: the CMP seed through the real cache, the backend fixture stubbed.
// core.generateCmpProject is captured when it gets a backendTemplate (the seed has no backend modules to generate).
async function backendSetup(t) {
    const base = await setup();
    t.after(base.cleanup);
    const template = await fixtureCopy(t);
    const calls = [];
    const cacheEnsure = async (req) => {
        calls.push(req);
        if (req.repo === core.pins.backend.repo) {
            if (req.ref === MISSING_BACKEND_REF) throw new core.TemplateFetchError(`template ${req.ref} not found`);
            return { dir: template, ref: req.ref, commit: BACKEND_COMMIT };
        }
        return core.templateCache.ensure(req);
    };
    const seen = [];
    const original = core.generateCmpProject;
    core.generateCmpProject = async (value, opts) => {
        if (!opts.backendTemplate) return original(value, opts);
        seen.push({ opts, files: await filesUnder(opts.backendTemplate.dir) });
        return { warnings: [], templateType: value.templateType, features: value.features };
    };
    t.after(() => { core.generateCmpProject = original; });
    const progress = [];
    const run = (extra, opts = {}) => runGenerate(args(base.outputDir, extra),
        { ...base.opts, cacheEnsure, onProgress: (m) => progress.push(m), ...opts });
    const backendCalls = () => calls.filter((c) => c.repo === core.pins.backend.repo).map((c) => c.ref);
    return { ...base, template, calls, backendCalls, seen, progress, run };
}

test('backendOnFetchesThePinnedBackendTemplate', async (t) => {
    const { outputDir, backendCalls, seen, progress, run } = await backendSetup(t);
    const r = await run(BACKEND_ON);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.deepStrictEqual(backendCalls(), [core.pins.backend.ref]);
    assert.strictEqual(seen.length, 1);
    const { backendTemplate, projectDir } = seen[0].opts;
    assert.deepStrictEqual(Object.keys(backendTemplate).sort(), ['commit', 'dir', 'ref', 'repo']);
    assert.strictEqual(path.dirname(backendTemplate.dir), outputDir);
    assert.match(path.basename(backendTemplate.dir), RAW_COPY_RE);
    assert.strictEqual(backendTemplate.dir, `${projectDir}-server`);
    assert.deepStrictEqual({ ...backendTemplate, dir: undefined },
        { dir: undefined, repo: core.pins.backend.repo, ref: core.pins.backend.ref, commit: BACKEND_COMMIT });
    assert.ok(seen[0].files.includes('src/main/kotlin/io/cmpose/backendtemplate/Main.kt'), seen[0].files.join(', '));
    assert.deepStrictEqual(r.structuredContent.backendTemplate,
        { repo: core.pins.backend.repo, ref: core.pins.backend.ref, commit: BACKEND_COMMIT });
    assert.ok(r.content[0].text.split('\n').includes(`Server template: ${core.pins.backend.repo}@${core.pins.backend.ref} (bbbbbbb)`),
        r.content[0].text);
    assert.ok(await fs.pathExists(path.join(outputDir, 'Demo')));
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(progress.length, 3, progress.join(' | '));
});

test('backendTemplateRefOverridesThePin', async (t) => {
    const { backendCalls, seen, run } = await backendSetup(t);
    const r = await run({ ...BACKEND_ON, backendTemplateRef: 'backend-template-2026.01.01' });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.deepStrictEqual(backendCalls(), ['backend-template-2026.01.01']);
    assert.strictEqual(seen[0].opts.backendTemplate.ref, 'backend-template-2026.01.01');
    assert.strictEqual(r.structuredContent.backendTemplate.ref, 'backend-template-2026.01.01');
    // the CMP template keeps its own pin
    assert.strictEqual(r.structuredContent.template.ref, core.pins.cmp.ref);
});

test('backendFetchFailureWritesNothing', async (t) => {
    const { outputDir, seen, run } = await backendSetup(t);
    const r = await run({ ...BACKEND_ON, backendTemplateRef: MISSING_BACKEND_REF });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, new RegExp(MISSING_BACKEND_REF));
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'Demo')), false);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    assert.deepStrictEqual(seen, []);
});

test('pendingBackendPinIsRefused', async (t) => {
    const { outputDir, calls, seen, run } = await backendSetup(t);
    const r = await run({ ...BACKEND_ON, backendTemplateRef: 'backend-template-PENDING' });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /not released yet; pass templateRef or set CMPOSE_BACKEND_TEMPLATE_DIR/);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(seen, []);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
});

test('localBackendTemplateDirIsUsedAndWarned', async (t) => {
    const { template, outputDir, backendCalls, seen, run } = await backendSetup(t);
    const git = (...a) => execFileSync('git', ['-C', template, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'template');
    await fs.appendFile(path.join(template, 'README.md'), '\nA local edit.\n');
    await fs.outputFile(path.join(template, '.env'), 'SECRET=1\n');
    const r = await run(BACKEND_ON, { backendTemplateDir: template });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.deepStrictEqual(backendCalls(), []);
    const { files } = seen[0];
    assert.ok(files.includes('README.md'));
    assert.ok(!files.includes('.env'), 'untracked secret not copied');
    assert.ok(!files.some((f) => f.startsWith('.git/')), 'no .git');
    assert.deepStrictEqual(r.structuredContent.backendTemplate, { repo: core.pins.backend.repo, ref: 'local', commit: null });
    const warnings = r.structuredContent.warnings;
    assert.ok(warnings.some((w) => /local backend template checkout \(CMPOSE_BACKEND_TEMPLATE_DIR\), not a released tag/.test(w)), warnings.join(' | '));
    assert.ok(warnings.includes('The local template checkout has uncommitted changes; the project holds them.'), warnings.join(' | '));
    assert.ok(r.content[0].text.split('\n').includes(`Server template: ${core.pins.backend.repo}@local`), r.content[0].text);
    assert.deepStrictEqual(await leftovers(outputDir), []);
});

test('backendOffDoesNotFetchTheBackendTemplate', async (t) => {
    const { calls, backendCalls, seen, progress, run } = await backendSetup(t);
    const r = await run({ templateType: 'blank', featuresConfig: { backend: false } });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.deepStrictEqual(backendCalls(), []);
    assert.deepStrictEqual(calls.map((c) => c.repo), [core.pins.cmp.repo]);
    assert.deepStrictEqual(seen, []);
    assert.strictEqual(r.structuredContent.backendTemplate, undefined);
    assert.doesNotMatch(r.content[0].text, /Server template:/);
    assert.strictEqual(progress.length, 2, progress.join(' | '));
});

test('backendTemplateRefWithBackendOffIsIgnoredWithAWarning', async (t) => {
    const { backendCalls, run } = await backendSetup(t);
    for (const [projectName, extra] of [['Blank', { templateType: 'blank' }], ['Showcase', {}]]) {
        const r = await run({ ...extra, projectName, backendTemplateRef: 'backend-template-2026.01.01' });
        assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
        assert.ok(r.structuredContent.warnings.includes('backendTemplateRef ignored: featuresConfig.backend is off'),
            r.structuredContent.warnings.join(' | '));
        assert.match(r.content[0].text, /Warning: backendTemplateRef ignored: featuresConfig\.backend is off/);
        assert.strictEqual(r.structuredContent.backendTemplate, undefined);
    }
    assert.deepStrictEqual(backendCalls(), []);
});

test('invalidBackendTemplateRefIsRefused', async (t) => {
    const { outputDir, calls, run } = await backendSetup(t);
    const r = await run({ ...BACKEND_ON, backendTemplateRef: '../x' });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /backendTemplateRef must be a tag or branch name/);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
});
