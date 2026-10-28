'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { removeMarkedBlocks, applySwapMarkers, kindOf } = require('../src/markerBlocks');

const FORMS = {
    slash: ['// cmpose:sharing', '// /cmpose:sharing'],
    dash: ['-- cmpose:sharing', '-- /cmpose:sharing'],
    hash: ['# cmpose:sharing', '# /cmpose:sharing'],
    xml: ['<!-- cmpose:sharing -->', '<!-- /cmpose:sharing -->']
};

for (const [kind, [open, close]] of Object.entries(FORMS)) {
    test(`${kind}: a sharing block goes when off, only its markers when on`, () => {
        const src = `a\n  ${open}\n  b\n  ${close}\nc\n`;
        assert.strictEqual(removeMarkedBlocks(src, kind, false, 'sharing'), 'a\nc\n');
        assert.strictEqual(removeMarkedBlocks(src, kind, true, 'sharing'), 'a\n  b\nc\n');
    });

    test(`${kind}: the tag defaults to backend, so sharing markers are not touched`, () => {
        const src = `a\n${open}\nb\n${close}\n`;
        assert.strictEqual(removeMarkedBlocks(src, kind, false), src);
        const backend = src.replace(/sharing/g, 'backend');
        assert.strictEqual(removeMarkedBlocks(backend, kind, false), 'a\n');
    });
}

for (const [kind, comment] of [['slash', '//'], ['dash', '--'], ['hash', '#']]) {
    test(`${kind}: a sharing swap takes the next line's indentation when off and goes when on`, () => {
        const src = `x\n    ${comment} cmpose:sharing-off: off()\n    on()\ny`;
        assert.strictEqual(applySwapMarkers(src, false, 'sharing', kind), 'x\n    off()\ny');
        assert.strictEqual(applySwapMarkers(src, true, 'sharing', kind), 'x\n    on()\ny');
    });
}

test('the swap tag defaults to backend and the kind to slash', () => {
    const sharing = '// cmpose:sharing-off: off()\non()';
    assert.strictEqual(applySwapMarkers(sharing, false), sharing);
    assert.strictEqual(applySwapMarkers('// cmpose:backend-off: off()\non()', false), 'off()');
    assert.strictEqual(applySwapMarkers('-- cmpose:sharing-off: off()\non()', false, 'sharing'), '-- cmpose:sharing-off: off()\non()');
});

test('errors name the tag', () => {
    assert.throws(() => removeMarkedBlocks('// cmpose:sharing\nx\n', 'slash', false, 'sharing'), /unclosed cmpose:sharing block/);
    assert.throws(() => removeMarkedBlocks('x\n-- /cmpose:sharing\n', 'dash', false, 'sharing'), /stray -- \/cmpose:sharing/);
    assert.throws(() => removeMarkedBlocks('# cmpose:sharing\n# cmpose:sharing\n# /cmpose:sharing\n', 'hash', true, 'sharing'), /nested/);
    assert.throws(() => applySwapMarkers('x\n-- cmpose:sharing-off: y', false, 'sharing', 'dash'), /cmpose:sharing-off marker on the last line/);
});

test('an unknown kind throws, and the xml form has no swap', () => {
    assert.throws(() => removeMarkedBlocks('x', 'semicolon', false), /unknown marker kind/);
    assert.throws(() => applySwapMarkers('x', false, 'sharing', 'xml'), /no swap marker/);
});

test('kindOf maps the backend template files to their marker form', () => {
    const expected = {
        'src/main/kotlin/App.kt': 'slash', 'build.gradle.kts': 'slash',
        'src/main/resources/db/migration/V1__init.sql': 'dash',
        'deploy/compose.yml': 'hash', 'deploy/x.yaml': 'hash', 'gradle/libs.versions.toml': 'hash',
        'gradle.properties': 'hash', '.gitignore': 'hash', 'deploy/.env.example': 'hash', '.dockerignore': 'hash',
        'README.md': 'xml'
    };
    for (const [file, kind] of Object.entries(expected)) assert.strictEqual(kindOf(file), kind, file);
    for (const file of ['Dockerfile', 'tools/gate.sh', 'a.swift', 'a.json', 'x.example']) assert.strictEqual(kindOf(file), undefined, file);
});

test('firebase blocks are their own tag: backend markers leave them alone', () => {
    const src = 'a\n// cmpose:firebase\nb\n// /cmpose:firebase\n// cmpose:backend\nc\n// /cmpose:backend\n';
    assert.strictEqual(removeMarkedBlocks(src, 'slash', false), 'a\n// cmpose:firebase\nb\n// /cmpose:firebase\n');
    assert.strictEqual(removeMarkedBlocks(src, 'slash', false, 'firebase'), 'a\n// cmpose:backend\nc\n// /cmpose:backend\n');
    assert.strictEqual(removeMarkedBlocks(src, 'slash', true, 'firebase'), 'a\nb\n// cmpose:backend\nc\n// /cmpose:backend\n');
});
