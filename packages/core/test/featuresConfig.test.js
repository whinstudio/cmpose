const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFeaturesConfig } = require('../src/featuresConfig');

const DEFAULTS = {
    network: false,
    networkInspector: false,
    theming: false,
    multiLang: false,
    dataStore: false,
    detekt: false,
    purchases: false,
    ads: false,
    room: false,
    backend: false,
    insights: false
};

test('undefined featuresConfig normalizes to all-false defaults', () => {
    const result = normalizeFeaturesConfig(undefined);

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, DEFAULTS);
});

test('{network:true} keeps the other booleans false', () => {
    const result = normalizeFeaturesConfig({ network: true });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { ...DEFAULTS, network: true });
});

test('{multiLang:true} forces dataStore to true (dependency rule)', () => {
    const result = normalizeFeaturesConfig({ multiLang: true });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { ...DEFAULTS, multiLang: true, dataStore: true });
});

test('{theming:true} forces dataStore to true (dependency rule)', () => {
    const result = normalizeFeaturesConfig({ theming: true });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { ...DEFAULTS, theming: true, dataStore: true });
});

test('{networkInspector:true} forces network to true (dependency rule)', () => {
    const result = normalizeFeaturesConfig({ networkInspector: true });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { ...DEFAULTS, networkInspector: true, network: true });
});

test('backend is off when missing and implies multiLang, network and dataStore', () => {
    assert.strictEqual(normalizeFeaturesConfig({}).value.backend, false);
    const v = normalizeFeaturesConfig({ backend: true, multiLang: false, network: false, dataStore: false }).value;
    assert.deepStrictEqual([v.backend, v.multiLang, v.network, v.dataStore], [true, true, true, true]);
});

test('backend must be a boolean', () => {
    assert.match(normalizeFeaturesConfig({ backend: 'yes' }).error, /featuresConfig\.backend must be a boolean/);
});

test('{network:"yes"} is rejected: booleans must be actual booleans', () => {
    const result = normalizeFeaturesConfig({ network: 'yes' });

    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
});

for (const key of ['network', 'networkInspector', 'theming', 'multiLang', 'dataStore', 'detekt', 'purchases', 'ads', 'room', 'backend', 'insights']) {
    test(`non-boolean ${key} is rejected`, () => {
        for (const bad of ['true', 1, 0, null, [], {}]) {
            const result = normalizeFeaturesConfig({ [key]: bad });
            assert.equal(result.ok, false, `${key}=${JSON.stringify(bad)} should be rejected`);
            assert.equal(typeof result.error, 'string');
        }
    });
}

test('unknown keys are dropped', () => {
    const result = normalizeFeaturesConfig({ network: true, unknownThing: 'x', foo: 123 });

    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.value).sort(), Object.keys({ ...DEFAULTS, network: true }).sort());
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'unknownThing'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'foo'), false);
});

test('empty object normalizes to all-false defaults', () => {
    const result = normalizeFeaturesConfig({});

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, DEFAULTS);
});

// --- networkBaseUrl ---------------------------------------------------

test('networkBaseUrl absent is omitted from the normalized value', () => {
    const result = normalizeFeaturesConfig({ network: true });

    assert.equal(result.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'networkBaseUrl'), false);
});

test('networkBaseUrl null is omitted from the normalized value', () => {
    const result = normalizeFeaturesConfig({ network: true, networkBaseUrl: null });

    assert.equal(result.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'networkBaseUrl'), false);
});

test('networkBaseUrl string is kept as-is', () => {
    const result = normalizeFeaturesConfig({ network: true, networkBaseUrl: 'https://api.example.com' });

    assert.equal(result.ok, true);
    assert.equal(result.value.networkBaseUrl, 'https://api.example.com');
});

test('networkBaseUrl non-string is rejected', () => {
    for (const bad of [123, true, [], {}]) {
        const result = normalizeFeaturesConfig({ networkBaseUrl: bad });
        assert.equal(result.ok, false, `networkBaseUrl=${JSON.stringify(bad)} should be rejected`);
    }
});

// --- detektYamlContent --------------------------------------------------

test('detektYamlContent absent is omitted from the normalized value', () => {
    const result = normalizeFeaturesConfig({ detekt: true });

    assert.equal(result.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'detektYamlContent'), false);
});

test('detektYamlContent null is omitted (or null) in the normalized value', () => {
    const result = normalizeFeaturesConfig({ detekt: true, detektYamlContent: null });

    assert.equal(result.ok, true);
    const hasKey = Object.prototype.hasOwnProperty.call(result.value, 'detektYamlContent');
    if (hasKey) {
        assert.equal(result.value.detektYamlContent, null);
    }
});

test('detektYamlContent string is kept as-is', () => {
    const result = normalizeFeaturesConfig({ detekt: true, detektYamlContent: 'style:\n  MaxLineLength: 120' });

    assert.equal(result.ok, true);
    assert.equal(result.value.detektYamlContent, 'style:\n  MaxLineLength: 120');
});

test('detektYamlContent non-string is rejected', () => {
    for (const bad of [123, true, [], {}]) {
        const result = normalizeFeaturesConfig({ detektYamlContent: bad });
        assert.equal(result.ok, false, `detektYamlContent=${JSON.stringify(bad)} should be rejected`);
    }
});

// --- real wizard payload stays a no-op -----------------------------------

test('a fully-populated, rule-consistent payload normalizes to itself (no-op)', () => {
    const wizardPayload = {
        network: true,
        networkInspector: false,
        networkBaseUrl: '',
        theming: true,
        multiLang: false,
        dataStore: true,
        detekt: false,
        detektYamlContent: null,
        purchases: true,
        ads: true,
        room: true,
        backend: false
    };

    const result = normalizeFeaturesConfig(wizardPayload);

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
        network: true,
        networkInspector: false,
        networkBaseUrl: '',
        theming: true,
        multiLang: false,
        dataStore: true,
        detekt: false,
        purchases: true,
        ads: true,
        room: true,
        backend: false,
        insights: false
    });
});

test('room is independent: it implies no other flag and no other flag implies it', () => {
    const only = normalizeFeaturesConfig({ room: true });
    assert.equal(only.ok, true);
    assert.deepEqual(only.value, { ...DEFAULTS, room: true });
    const others = normalizeFeaturesConfig({ network: true, theming: true, purchases: true, ads: true });
    assert.equal(others.ok, true);
    assert.equal(others.value.room, false);
});

test('purchases and ads are independent: all four combinations normalize unchanged', () => {
    for (const purchases of [false, true]) {
        for (const ads of [false, true]) {
            const result = normalizeFeaturesConfig({ purchases, ads });

            assert.equal(result.ok, true);
            assert.deepEqual(result.value, { ...DEFAULTS, purchases, ads }, `purchases=${purchases}, ads=${ads}`);
        }
    }
});

test('does not mutate the input object', () => {
    const input = { network: true };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeFeaturesConfig(input);

    assert.deepEqual(input, snapshot);
});

test('insights defaults to false and is a boolean key', () => {
    const { DEFAULTS, BOOLEAN_KEYS } = require('../src/featuresConfig');
    assert.equal(DEFAULTS.insights, false);
    assert.ok(BOOLEAN_KEYS.includes('insights'));
    assert.equal(normalizeFeaturesConfig({}).value.insights, false);
    assert.deepEqual(normalizeFeaturesConfig({ insights: true }).value, { ...DEFAULTS, insights: true });
    assert.match(normalizeFeaturesConfig({ insights: 'yes' }).error, /featuresConfig\.insights must be a boolean/);
});
