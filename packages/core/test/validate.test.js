'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate, minSdkAboveTarget } = require('../src/validate');
const PV = require('../src/ProjectValidator');

const base = { projectName: 'MyApp', appName: 'My App', packageName: 'com.example.myapp', minSdk: '24', iosVersion: '15.0' };

test('valid input comes back trimmed with defaults', () => {
    const r = validate({ ...base, projectName: ' MyApp ', appName: ' My App ' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.projectName, 'MyApp');
    assert.strictEqual(r.value.appName, 'My App');
    assert.strictEqual(r.value.templateType, 'showcase');
    assert.deepStrictEqual(r.value.features, []);
});

test('body shape errors come from the request parser', () => {
    assert.strictEqual(validate(null).ok, false);
    assert.strictEqual(validate({ ...base, projectName: 5 }).ok, false);
});

test('rule errors carry the validator messages', () => {
    assert.deepStrictEqual(validate({ ...base, projectName: 'My App' }), { ok: false, error: PV.messages.projectNameSpaces });
    assert.deepStrictEqual(validate({ ...base, packageName: 'com.kturker.multiplatform.x' }).ok, false);
    assert.deepStrictEqual(validate({ ...base, minSdk: '10' }), { ok: false, error: PV.messages.minSdkInvalid });
    assert.deepStrictEqual(validate({ ...base, iosVersion: '9.0' }), { ok: false, error: PV.messages.iosVersionInvalid });
    assert.deepStrictEqual(validate({ ...base, features: ['a', 'b', 'c', 'd'] }), { ok: false, error: PV.messages.maxModulesReached });
    assert.deepStrictEqual(validate({ ...base, features: ['a', 'a'] }), { ok: false, error: PV.messages.moduleNameDuplicate });
});

test('showcase locked modules are not counted', () => {
    assert.strictEqual(validate({ ...base, features: ['home', 'onboarding', 'a', 'b', 'c'] }).ok, true);
});

test('blank normalizes featuresConfig and checks the base URL', () => {
    const r = validate({ ...base, templateType: 'blank', featuresConfig: { networkInspector: true, theming: true } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.featuresConfig.network, true);
    assert.strictEqual(r.value.featuresConfig.dataStore, true);
    const bad = validate({ ...base, templateType: 'blank', featuresConfig: { network: true, networkBaseUrl: 'not a url' } });
    assert.deepStrictEqual(bad, { ok: false, error: PV.messages.urlInvalid });
});

test('longPackageWithBackendIsRefused', () => {
    // 45 characters: fine for the app, 52 with .server
    const packageName = `com.example.${'a'.repeat(33)}`;
    assert.strictEqual(packageName.length, 45);
    assert.strictEqual(validate({ ...base, packageName, templateType: 'blank', featuresConfig: { backend: false } }).ok, true);
    assert.strictEqual(validate({ ...base, packageName, templateType: 'showcase' }).ok, true);
    assert.deepStrictEqual(validate({ ...base, packageName, templateType: 'blank', featuresConfig: { backend: true } }),
        { ok: false, error: `packageName is too long for the server package (${packageName}.server)` });
    // 43 + .server = 50: the limit itself is allowed
    const atLimit = `com.example.${'a'.repeat(31)}`;
    assert.strictEqual(validate({ ...base, packageName: atLimit, templateType: 'blank', featuresConfig: { backend: true } }).ok, true);
});

test('minSdk above the template target is rejected', () => {
    assert.match(validate({ ...base, minSdk: '36' }, { templateTargetSdk: '35' }).error, /target SDK \(35\)/);
    assert.strictEqual(minSdkAboveTarget('24', null), null);
    assert.strictEqual(minSdkAboveTarget('24', '36'), null);
});
