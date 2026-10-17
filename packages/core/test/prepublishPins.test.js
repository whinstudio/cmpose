'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { pendingPins } = require('../scripts/check-pins');

test('a PENDING pin is reported, real tags pass', () => {
    assert.deepStrictEqual(pendingPins({ cmp: { ref: 'template-2026.10.14' }, game: { ref: 'game-template-2026.10.13.2' } }), []);
    assert.deepStrictEqual(pendingPins({ cmp: { ref: 'template-2026.10.14' }, game: { ref: 'game-template-PENDING' } }),
        ['game: game-template-PENDING']);
    assert.deepStrictEqual(pendingPins({ cmp: { ref: 'template-2026.10.14' }, backend: { ref: 'backend-template-PENDING' } }),
        ['backend: backend-template-PENDING']);
});

test('the backend pin names the backend template repo', () => {
    const pins = require('../src/pins');
    assert.strictEqual(pins.backend.repo, 'whinstudio/cmpose-backend-template');
    assert.match(pins.backend.ref, /^backend-template-/);
    assert.ok(Object.isFrozen(pins.backend));
});

test('prepublishOnly runs the pin check', () => {
    const pkg = require('../package.json');
    assert.strictEqual(pkg.scripts.prepublishOnly, 'node scripts/check-pins.js');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-pins.js')], { encoding: 'utf8' });
    const pending = pendingPins(require('../src/pins')).length > 0;
    assert.strictEqual(r.status, pending ? 1 : 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    if (pending) assert.match(r.stderr, /PENDING/);
});
