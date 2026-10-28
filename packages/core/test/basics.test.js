'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src');

test('core exposes its version, template identity, limits and pins', () => {
    assert.strictEqual(core.version, require('../package.json').version);
    assert.strictEqual(core.templateIdentity.OLD_PACKAGE_NAME, 'com.kturker.multiplatform');
    assert.strictEqual(core.templateIdentity.OLD_PROJECT_NAME, 'Multiplatform');
    assert.deepStrictEqual(core.limits, { minSdkMin: 24, minSdkMax: 36, iosVersionMin: '15.0', iosVersionMax: '26.2', maxModules: 3 });
    assert.deepStrictEqual(core.pins.cmp, { repo: 'whinstudio/cmpose-template', ref: 'template-2026.10.28' });
    assert.deepStrictEqual(core.pins.backend, { repo: 'whinstudio/cmpose-backend-template', ref: 'backend-template-2026.10.26' });
});

test('core exposes the request parser, the template types and the validator file for consumers', () => {
    const fs = require('fs');
    const path = require('path');
    assert.strictEqual(typeof core.requestParser.parseGenerateBody, 'function');
    assert.deepStrictEqual(core.TEMPLATE_TYPES, ['showcase', 'blank']);
    assert.strictEqual(core.TEMPLATE_TYPES, core.requestParser.TEMPLATE_TYPES);
    assert.ok(path.isAbsolute(core.validatorPath));
    assert.strictEqual(path.basename(core.validatorPath), 'ProjectValidator.js');
    assert.ok(fs.readFileSync(core.validatorPath, 'utf8').includes('ProjectValidator'));
});

test('core exposes the featuresConfig defaults (frozen)', () => {
    const { DEFAULTS, BOOLEAN_KEYS } = core.featuresConfig;
    assert.deepStrictEqual(Object.keys(DEFAULTS).sort(), [...BOOLEAN_KEYS].sort());
    assert.ok(BOOLEAN_KEYS.includes('insights'));
    assert.ok(Object.values(DEFAULTS).every((v) => v === false));
    assert.ok(Object.isFrozen(DEFAULTS));
});
