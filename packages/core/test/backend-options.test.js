'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs-extra');
const { execFileSync } = require('child_process');
const { applySharingOption, applySampleOption, applyMarkerOption, removeResolverTools, resolveContent } = require('../src/backend/options');
const { fixtureCopy, read, exists, isExecutable, TEMPLATE_PKG_DIR } = require('./backend-helpers');

const MAIN = `src/main/kotlin/${TEMPLATE_PKG_DIR}/Main.kt`;
const SHARING_PATHS = [`src/main/kotlin/${TEMPLATE_PKG_DIR}/sharing`, 'src/main/resources/db/migration/V2__sharing.sql',
    'src/main/resources/db/migration/V5__invite_revoke.sql', `src/test/kotlin/${TEMPLATE_PKG_DIR}/SpaceRoutesTest.kt`];
const SAMPLE_PATHS = [`src/main/kotlin/${TEMPLATE_PKG_DIR}/feature/sample`, 'src/main/resources/db/migration/V3__sample.sql',
    `src/test/kotlin/${TEMPLATE_PKG_DIR}/ItemRoutesTest.kt`];
const ROUTING = `src/main/kotlin/${TEMPLATE_PKG_DIR}/Routing.kt`;
const RESOLVER_TOOLS = ['tools/sharing-paths.txt', 'tools/sample-paths.txt', 'tools/resolve-markers.sh', 'tools/resolve-markers.test.sh'];

test('off drops the sharing paths, blocks and unused imports and applies the swaps; the tools stay', async (t) => {
    const dir = await fixtureCopy(t);
    const result = await applySharingOption(dir, false);
    assert.deepEqual(result.removedPaths, SHARING_PATHS);
    for (const rel of SHARING_PATHS) assert.equal(await exists(dir, rel), false, rel);
    for (const rel of [...RESOLVER_TOOLS, ...SAMPLE_PATHS]) assert.ok(await exists(dir, rel), rel);
    assert.ok(await exists(dir, 'tools/deploy-lint.sh'));
    assert.ok(await isExecutable(dir, 'tools/deploy-lint.sh'));

    const main = await read(dir, MAIN);
    assert.equal(main, [
        'package io.cmpose.backendtemplate',
        '',
        'import io.cmpose.backendtemplate.config.AppConfig',
        'import java.util.UUID as Uid',
        'import kotlinx.coroutines.*',
        '',
        'fun main() {',
        '    val config = AppConfig.load()',
        '',
        '    start(config, Uid.randomUUID())',
        '}',
        ''
    ].join('\n'));
    const sql = await read(dir, 'src/main/resources/db/migration/V1__core.sql');
    assert.match(sql, /^ {4}owner_id UUID NOT NULL REFERENCES users \(id\)$/m);
    assert.doesNotMatch(sql, /space_id|placeholder|cmpose:/);
    assert.ok(sql.includes('PRIMARY KEY);\n\nCREATE TABLE items'), 'one blank line where the block was');
    const readme = await read(dir, 'README.md');
    assert.doesNotMatch(readme, /sharing|invitations/);
    // the sample markers are another option's: plain text for this run
    assert.match(readme, /<!-- cmpose:sample -->/);
    assert.equal(await read(dir, '.gitignore'), '.gradle/\nbuild/\n.local-server/\n');
    assert.doesNotMatch(await read(dir, 'deploy/docker-compose.cmpose-app.yml'), /INVITE|cmpose:/);
});

test('on keeps the sharing parts and drops only the marker lines', async (t) => {
    const dir = await fixtureCopy(t);
    await applySharingOption(dir, true);
    for (const rel of SHARING_PATHS) assert.ok(await exists(dir, rel), rel);
    for (const rel of RESOLVER_TOOLS) assert.ok(await exists(dir, rel), rel);
    const main = await read(dir, MAIN);
    assert.doesNotMatch(main, /cmpose:/);
    assert.match(main, /import io\.cmpose\.backendtemplate\.sharing\.Role/);
    assert.match(main, /^ {4}val spaces = SpaceRepository\(\)$/m);
    assert.match(main, /^ {4}start\(config, Uid\.randomUUID\(\), spaces\)$/m);
    const sql = await read(dir, 'src/main/resources/db/migration/V1__core.sql');
    assert.match(sql, /space_id UUID NOT NULL/);
    assert.doesNotMatch(sql, /owner_id|cmpose:/);
    assert.match(await read(dir, 'README.md'), /spaces, roles and invitations/);
});

test('a marker error leaves the directory as it was', async (t) => {
    const dir = await fixtureCopy(t);
    await fs.appendFile(path.join(dir, 'README.md'), '<!-- cmpose:sharing -->\nunclosed\n');
    const before = await read(dir, MAIN);
    await assert.rejects(applySharingOption(dir, false), /README\.md:\d+: unclosed cmpose:sharing block/);
    assert.equal(await read(dir, MAIN), before);
    for (const rel of [...SHARING_PATHS, ...RESOLVER_TOOLS]) assert.ok(await exists(dir, rel), rel);
});

test('an unsafe sharing path is refused', async (t) => {
    for (const bad of ['/etc', '../outside', 'src/./x', 'src/../../x']) {
        const dir = await fixtureCopy(t);
        await fs.writeFile(path.join(dir, 'tools', 'sharing-paths.txt'), `${bad}\n`);
        await assert.rejects(applySharingOption(dir, false), /must be a relative path inside the project/, bad);
    }
});

test('without tools/<option>-paths.txt either mode fails before any file changes', async (t) => {
    for (const [option, apply] of [['sharing', applySharingOption], ['sample', applySampleOption]]) {
        for (const enabled of [true, false]) {
            const dir = await fixtureCopy(t);
            await fs.remove(path.join(dir, 'tools', `${option}-paths.txt`));
            const before = await read(dir, ROUTING);
            await assert.rejects(apply(dir, enabled), new RegExp(`tools/${option}-paths\\.txt is missing`), `${option} ${enabled}`);
            assert.equal(await read(dir, ROUTING), before);
        }
    }
    const dir = await fixtureCopy(t);
    await assert.rejects(applyMarkerOption(dir, 'foo', false), /tools\/foo-paths\.txt is missing/);
});

test('an option name other than lowercase letters is refused', async (t) => {
    const dir = await fixtureCopy(t);
    for (const bad of ['Sharing', 'sha-ring', '', '../sharing']) {
        await assert.rejects(applyMarkerOption(dir, bad, false), /option/, bad);
    }
});

test('sampleOffRemovesSampleBlocksAndPaths', async (t) => {
    const dir = await fixtureCopy(t);
    const result = await applySampleOption(dir, false);
    assert.deepEqual(result.removedPaths, SAMPLE_PATHS);
    for (const rel of SAMPLE_PATHS) assert.equal(await exists(dir, rel), false, rel);
    for (const rel of [...SHARING_PATHS, ...RESOLVER_TOOLS]) assert.ok(await exists(dir, rel), rel);
    assert.equal(await read(dir, ROUTING), [
        'package io.cmpose.backendtemplate',
        '',
        // the pruned imports leave their blank lines, as the script does
        '',
        'fun routing() {',
        '    health()',
        '',
        '    println("no features yet")',
        '}',
        ''
    ].join('\n'));
    const readme = await read(dir, 'README.md');
    assert.doesNotMatch(readme, /feature\/sample|cmpose:sample/);
    assert.match(readme, /<!-- cmpose:sharing -->/);
    // a file with only sharing markers is not touched by the sample run
    assert.match(await read(dir, MAIN), /cmpose:sharing/);
});

test('sample on keeps the sample parts and drops only its marker lines', async (t) => {
    const dir = await fixtureCopy(t);
    await applySampleOption(dir, true);
    for (const rel of SAMPLE_PATHS) assert.ok(await exists(dir, rel), rel);
    const routing = await read(dir, ROUTING);
    assert.doesNotMatch(routing, /cmpose:sample/);
    assert.match(routing, /^ {4}\/\/ cmpose:sharing-off: itemRoutes\(items\)$/m);
    assert.match(routing, /^ {4}println\("features"\)$/m);
});

test('crossOptionNestingResolvesSharingThenSample', async (t) => {
    const nested = 'first\n// cmpose:sample\n// cmpose:sharing-off: plain()\nshared()\n// /cmpose:sample\nlast\n';
    const run = (sharing, sample) => resolveContent(resolveContent(nested, 'slash', sharing), 'slash', sample, { tag: 'sample' });
    assert.equal(run(true, false), 'first\nlast\n');
    assert.equal(run(false, true), 'first\nplain()\nlast\n');
    assert.equal(run(true, true), 'first\nshared()\nlast\n');
    assert.equal(run(false, false), 'first\nlast\n');

    // the same on the fixture: sharing off then sample on swaps the line inside the sample block
    const dir = await fixtureCopy(t);
    await applySharingOption(dir, false);
    await applySampleOption(dir, true);
    const routing = await read(dir, ROUTING);
    assert.match(routing, /^ {4}itemRoutes\(items\)$/m);
    assert.doesNotMatch(routing, /spaces|cmpose:/);
});

test('a file is picked by its own option\'s markers only (no prefix match)', async (t) => {
    const dir = await fixtureCopy(t);
    await fs.writeFile(path.join(dir, 'tools', 'sam-paths.txt'), '# none\n');
    const before = await read(dir, ROUTING);
    assert.deepEqual(await applyMarkerOption(dir, 'sam', false), { resolvedFiles: 0, removedPaths: [] });
    // Routing.kt has only cmpose:sample and cmpose:sharing markers: its imports are not pruned either
    assert.equal(await read(dir, ROUTING), before);
});

test('resolverToolsAndEveryPathsFileAreRemoved', async (t) => {
    const dir = await fixtureCopy(t);
    await fs.writeFile(path.join(dir, 'tools', 'extra-paths.txt'), 'x\n');
    await removeResolverTools(dir);
    for (const rel of [...RESOLVER_TOOLS, 'tools/extra-paths.txt']) assert.equal(await exists(dir, rel), false, rel);
    // the gate and the notes are generateBackend's leftovers; deploy-lint stays
    for (const rel of ['tools/deploy-lint.sh', 'tools/gate.sh', 'tools/TEMPLATE.md']) assert.ok(await exists(dir, rel), rel);
    assert.ok(await isExecutable(dir, 'tools/deploy-lint.sh'));
});

// The fixture's tools/resolve-markers.sh is the template's resolver: both runs, every combination, byte for byte
async function tree(dir, rel = '', out = {}) {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await tree(dir, r, out);
        else out[r] = await fs.readFile(path.join(dir, r), 'latin1');
    }
    return out;
}

for (const sharing of ['on', 'off']) {
    for (const sample of ['on', 'off']) {
        test(`sharing ${sharing}, sample ${sample}: the same bytes as the fixture's resolve-markers.sh`, async (t) => {
            const ours = await fixtureCopy(t);
            const reference = await fixtureCopy(t);
            await applySharingOption(ours, sharing === 'on');
            await applySampleOption(ours, sample === 'on');
            const script = path.join(reference, 'tools', 'resolve-markers.sh');
            execFileSync('bash', [script, reference, 'sharing', sharing], { stdio: 'pipe' });
            execFileSync('bash', [script, reference, 'sample', sample], { stdio: 'pipe' });
            assert.deepEqual(await tree(ours), await tree(reference));
        });
    }
}

test('marker errors: nested, stray, unclosed, swap on the last line, swap before a marker, malformed', () => {
    const cases = [
        ['// cmpose:sharing\n// cmpose:sharing\n// /cmpose:sharing\n', /:2: nested/],
        ['a\n// /cmpose:sharing\n', /:2: block close without an open/],
        ['// cmpose:sharing\na\n', /:1: unclosed/],
        ['a\n// cmpose:sharing-off: b', /:2: cmpose:sharing-off marker on the last line/],
        ['// cmpose:sharing-off: b\n// cmpose:sharing\n// /cmpose:sharing\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:sharing-off: b\n// cmpose:other\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:sharing-off: b\n# /cmpose:sample\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:sharing-off: b\n// cmpose:sample-off: c\nd\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:sharing-off: b\n<!-- cmpose:sample -->\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:sharing_x\n', /:1: malformed cmpose marker: \/\/ cmpose:sharing_x/],
        ['//cmpose:sharing\n', /malformed/],
        ['// /cmpose:sharing x\n', /malformed/],
        ['// cmpose:sharing-off:\nx\n', /malformed/]
    ];
    for (const [content, error] of cases) {
        for (const enabled of [true, false]) assert.throws(() => resolveContent(content, 'slash', enabled), error, content);
    }
    assert.throws(() => resolveContent('<!-- cmpose:sharing-off: x -->\n', 'xml', false), /malformed/);
    assert.throws(() => resolveContent('# cmpose:sharing2\n', 'hash', true), /malformed/);
    // the sample run checks its own markers the same way
    assert.throws(() => resolveContent('// cmpose:sample-off: b\n// cmpose:sharing\nc\n// /cmpose:sharing\n', 'slash', true, { tag: 'sample' }),
        /:1: cmpose:sample-off marker before a marker/);
    assert.throws(() => resolveContent('//cmpose:sample\n', 'slash', false, { tag: 'sample' }), /malformed/);
});

test('another option\'s marker lines, or a longer tag, are plain text for a run', () => {
    const content = '// cmpose:other\n// cmpose:sample\nx\n// /cmpose:sample\n// cmpose:sharingx\n# cmpose:shared\n';
    for (const enabled of [true, false]) assert.equal(resolveContent(content, 'slash', enabled), content);
    assert.equal(resolveContent(content, 'slash', false, { tag: 'sample' }), '// cmpose:other\n// cmpose:sharingx\n# cmpose:shared\n');
});

test('off skips a swap inside a dropped block; on applies it', () => {
    const content = 'a\n// cmpose:sharing\n// cmpose:sharing-off: x\ny\n// /cmpose:sharing\nb\n';
    assert.equal(resolveContent(content, 'slash', false), 'a\nb\n');
    assert.equal(resolveContent(content, 'slash', true), 'a\ny\nb\n');
});

test('blank runs: one blank line where a block went, other runs stay; a missing final newline is added', () => {
    const content = 'a\n\n\n// cmpose:sharing\nx\n// /cmpose:sharing\n\n\nb\n\n\nc';
    assert.equal(resolveContent(content, 'slash', false), 'a\n\n\nb\n\n\nc\n');
    assert.equal(resolveContent(content, 'slash', true), 'a\n\n\nx\n\n\nb\n\n\nc\n');
    assert.equal(resolveContent('a\r\n-- cmpose:sharing\r\nx\r\n-- /cmpose:sharing\r\nb\r\n', 'dash', false), 'a\r\nb\r\n');
});

test('off drops a Kotlin import only when no other line names it', () => {
    const content = [
        'import a.b.Used', 'import a.b.Gone', 'import a.b.Thing as Alias', 'import a.b.Other as Unused', 'import a.b.*',
        'import a.b.`Ticked`', 'import a.b.UsedPrefix', '', '// cmpose:sharing', 'Gone()', 'Unused()', '// /cmpose:sharing',
        'Used(); Alias(); Ticked(); UsedPrefixx()', ''
    ].join('\n');
    assert.equal(resolveContent(content, 'slash', false, { kotlin: true }),
        'import a.b.Used\nimport a.b.Thing as Alias\nimport a.b.*\nimport a.b.`Ticked`\n\nUsed(); Alias(); Ticked(); UsedPrefixx()\n');
    // not Kotlin, or on: the imports stay
    assert.ok(resolveContent(content, 'slash', false).includes('import a.b.Gone'));
    assert.ok(resolveContent(content, 'slash', true, { kotlin: true }).includes('import a.b.Gone'));
});
