'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { contractFacts, hashContract, SCHEMA } = require('../src/contract');
const LIMITS = require('../src/limits');

test('local contract carries product limits only', () => {
    const facts = contractFacts();
    assert.deepStrictEqual(facts.limits, { ...LIMITS });
    assert.strictEqual(facts.reservedPackagePrefix, 'com.kturker.multiplatform');
    assert.deepStrictEqual(facts.templateTypes, SCHEMA.templateTypes);
});

test('server limits join the limits and change the hash', () => {
    const local = contractFacts();
    const hosted = contractFacts({ serverLimits: { rateLimitMax: 5, rateLimitWindowMinutes: 15, maxBodyLimit: '500kb' } });
    assert.strictEqual(hosted.limits.rateLimitMax, 5);
    assert.notStrictEqual(hashContract(local), hashContract(hosted));
    assert.match(hashContract(local), /^[0-9a-f]{12}$/);
});

test('custom limits reconfigure the validator messages', () => {
    const facts = contractFacts({ limits: { ...LIMITS, maxModules: 7 } });
    assert.strictEqual(facts.limits.maxModules, 7);
    assert.match(facts.messages.maxModulesReached, /7/);
    contractFacts(); // restore defaults for other tests
});

test('backend adds its anatomy entries and the invite deep link', () => {
    const facts = contractFacts();
    assert.ok(facts.featuresConfigKeys.includes('backend'));
    assert.deepStrictEqual(facts.dependencyRules.implies.backend, ['multiLang', 'network']);
    for (const dir of ['core/api', 'core/auth']) {
        assert.deepStrictEqual(facts.anatomy.coreModules[dir].requires, ['backend'], dir);
    }
    for (const dir of ['feature/account', 'feature/sharing']) {
        assert.deepStrictEqual(facts.anatomy.featureModules[dir].requires, ['backend'], dir);
    }
    assert.deepStrictEqual(facts.anatomy.serverDir, { path: 'server/', requires: ['backend'] });
    assert.deepStrictEqual(facts.deepLinks.backend, { links: ['invite/<token>'], requires: ['backend'] });
});

test('the backend flag changes the contract hash', () => {
    const before = require('./fixtures/contract/facts-before-backend.json');
    assert.strictEqual(before.featuresConfigKeys.includes('backend'), false);
    assert.notStrictEqual(hashContract(contractFacts()), hashContract(before));
});

test('insights adds core/insights to the anatomy', () => {
    const facts = contractFacts();
    assert.ok(facts.featuresConfigKeys.includes('insights'));
    assert.deepStrictEqual(facts.anatomy.coreModules['core/insights'].requires, ['insights']);
});

test('the insights flag changes the contract hash', () => {
    const before = require('./fixtures/contract/facts-before-insights.json');
    assert.strictEqual(before.featuresConfigKeys.includes('insights'), false);
    assert.notStrictEqual(hashContract(contractFacts()), hashContract(before));
});
