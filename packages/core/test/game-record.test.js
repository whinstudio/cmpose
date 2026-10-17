const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { buildGameRecord, writeGameRecord } = require('../src/game/record');
const { GAME_SCHEMA } = require('../src/game/contract');
const { tmpDir } = require('./support/gameFixtures');

const ADMOB_APP = 'ca-app-pub-1234567890123456~1234567890';
const VALUE = {
    projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper', companyName: 'Acme',
    templateType: 'blank', render: '2d', flags: ['network', 'purchases', 'ads'], features: ['shop'],
    minSdk: 26, iosVersion: '16.0',
    ids: { admob: { androidAppId: ADMOB_APP, iosAppId: ADMOB_APP } }
};
const TEMPLATE = { repo: 'https://example.com/unity-template.git', ref: 'game-2026.10.14', commit: 'abc123' };
const NOW = new Date('2026-10-14T08:30:00.000Z');

test('buildGameRecord records the options and id statuses, never the id values', () => {
    const record = buildGameRecord({ template: TEMPLATE, coreVersion: '0.2.0', value: VALUE, now: NOW });
    assert.deepEqual(record, {
        generator: '@cmpose/core',
        coreVersion: '0.2.0',
        generatorVersion: null,
        engine: 'unity',
        unityVersion: GAME_SCHEMA.unityVersion,
        templateType: 'blank',
        render: '2d',
        flags: ['network', 'purchases', 'ads'],
        features: ['shop'],
        minSdk: 26,
        iosVersion: '16.0',
        ids: { admob: 'custom', revenueCat: 'test', gameServices: 'off' },
        theme: null,
        template: TEMPLATE,
        generatedAt: '2026-10-14T08:30:00.000Z'
    });
    assert.ok(!JSON.stringify(record).includes(ADMOB_APP));
    assert.ok(!JSON.stringify(record).includes('Acme'));
});

test('buildGameRecord records the theme as applied', () => {
    const theme = { family: 'neon', primary: '#E91E63', fontPair: 'outfit-exo2' };
    const record = buildGameRecord({ template: TEMPLATE, coreVersion: '0.2.0', value: VALUE, theme, now: NOW });
    assert.deepEqual(record.theme, theme);
    assert.notEqual(record.theme, theme);
});

test('buildGameRecord records who ran the core (e.g. mcp@0.2.0)', () => {
    assert.equal(buildGameRecord({ template: TEMPLATE, coreVersion: '0.2.0', generatorVersion: 'mcp@0.2.0', value: VALUE, now: NOW }).generatorVersion, 'mcp@0.2.0');
});

test('writeGameRecord writes .cmpose/generation.json as 2-space JSON with a trailing newline', async (t) => {
    const dir = await tmpDir(t);
    const record = buildGameRecord({ template: TEMPLATE, coreVersion: '0.2.0', value: VALUE, now: NOW });
    await writeGameRecord(dir, record);
    const text = await fs.readFile(path.join(dir, '.cmpose', 'generation.json'), 'utf8');
    assert.equal(text, `${JSON.stringify(record, null, 2)}\n`);
});

test('buildGameRecord does not assume a validated value', () => {
    for (const odd of [{}, { flags: 'ads', features: null }, { flags: ['ads', 5], features: [null, 'shop'] }]) {
        const record = buildGameRecord({ template: TEMPLATE, coreVersion: '0.2.0', value: { ...VALUE, ...odd, flags: odd.flags, features: odd.features }, now: NOW });
        assert.ok(Array.isArray(record.flags) && record.flags.every((f) => typeof f === 'string'));
        assert.ok(Array.isArray(record.features) && record.features.every((f) => typeof f === 'string'));
        assert.equal(record.ids.admob, record.flags.includes('ads') ? 'custom' : 'off');
    }
    assert.deepEqual(buildGameRecord({ template: TEMPLATE, coreVersion: '0.2.0', value: { ...VALUE, flags: ['ads', 5], features: [null, 'shop'] }, now: NOW }).features, ['shop']);
});
