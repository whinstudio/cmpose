'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs-extra');
const { applySharingOption, resolveContent } = require('../src/backend/options');
const { fixtureCopy, read, exists, isExecutable, TEMPLATE_PKG_DIR } = require('./backend-helpers');

const MAIN = `src/main/kotlin/${TEMPLATE_PKG_DIR}/Main.kt`;
const SHARING_PATHS = [`src/main/kotlin/${TEMPLATE_PKG_DIR}/sharing`, 'src/main/resources/db/migration/V2__sharing.sql',
    `src/test/kotlin/${TEMPLATE_PKG_DIR}/SpaceRoutesTest.kt`];
const RESOLVER_TOOLS = ['tools/sharing-paths.txt', 'tools/resolve-markers.sh', 'tools/resolve-markers.test.sh'];

test('off drops the sharing paths, blocks and unused imports, applies the swaps and drops the resolver tools', async (t) => {
    const dir = await fixtureCopy(t);
    await applySharingOption(dir, false);
    for (const rel of SHARING_PATHS) assert.equal(await exists(dir, rel), false, rel);
    for (const rel of RESOLVER_TOOLS) assert.equal(await exists(dir, rel), false, rel);
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
    assert.doesNotMatch(await read(dir, 'README.md'), /sharing|cmpose:/);
    assert.equal(await read(dir, '.gitignore'), '.gradle/\nbuild/\n.local-server/\n');
    assert.doesNotMatch(await read(dir, 'deploy/docker-compose.cmpose-app.yml'), /INVITE|cmpose:/);
});

test('on keeps the sharing parts and drops only the marker lines', async (t) => {
    const dir = await fixtureCopy(t);
    await applySharingOption(dir, true);
    for (const rel of SHARING_PATHS) assert.ok(await exists(dir, rel), rel);
    for (const rel of RESOLVER_TOOLS) assert.equal(await exists(dir, rel), false, rel);
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

test('off without tools/sharing-paths.txt fails', async (t) => {
    const dir = await fixtureCopy(t);
    await fs.remove(path.join(dir, 'tools', 'sharing-paths.txt'));
    await assert.rejects(applySharingOption(dir, false), /sharing-paths\.txt is missing/);
});

test('marker errors: nested, stray, unclosed, swap on the last line, swap before a marker, malformed', () => {
    const cases = [
        ['// cmpose:sharing\n// cmpose:sharing\n// /cmpose:sharing\n', /:2: nested/],
        ['a\n// /cmpose:sharing\n', /:2: block close without an open/],
        ['// cmpose:sharing\na\n', /:1: unclosed/],
        ['a\n// cmpose:sharing-off: b', /:2: cmpose:sharing-off marker on the last line/],
        ['// cmpose:sharing-off: b\n// cmpose:sharing\n// /cmpose:sharing\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:sharing-off: b\n// cmpose:other\n', /:1: cmpose:sharing-off marker before a marker/],
        ['// cmpose:other\n', /:1: malformed cmpose marker: \/\/ cmpose:other/],
        ['//cmpose:sharing\n', /malformed/],
        ['// /cmpose:sharing x\n', /malformed/],
        ['// cmpose:sharing-off:\nx\n', /malformed/]
    ];
    for (const [content, error] of cases) {
        for (const enabled of [true, false]) assert.throws(() => resolveContent(content, 'slash', enabled), error, content);
    }
    assert.throws(() => resolveContent('<!-- cmpose:sharing-off: x -->\n', 'xml', false), /malformed/);
    assert.throws(() => resolveContent('# cmpose:shared\n', 'hash', true), /malformed/);
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
