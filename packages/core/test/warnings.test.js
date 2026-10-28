'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generationWarnings } = require('../src/warnings');

test('showcase warns about ads and purchases test keys', () => {
    assert.strictEqual(generationWarnings({ templateType: 'showcase', featuresConfig: null }).length, 2);
});

test('blank warns only for the flags that are on', () => {
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { ads: false, purchases: false } }), []);
    const w = generationWarnings({ templateType: 'blank', featuresConfig: { ads: true, purchases: false } });
    assert.strictEqual(w.length, 1);
    assert.match(w[0], /AdMob/);
});

test('blank with backend warns once about the Firebase config files and the local server', () => {
    const w = generationWarnings({ templateType: 'blank', featuresConfig: { backend: true } });
    assert.strictEqual(w.length, 1);
    assert.match(w[0], /google-services\.json/);
    assert.match(w[0], /GoogleService-Info\.plist/);
    assert.match(w[0], /:server:runLocal/);
});

test('showcase never warns about the backend', () => {
    for (const featuresConfig of [null, { backend: true }]) {
        const w = generationWarnings({ templateType: 'showcase', featuresConfig });
        assert.ok(!w.some((m) => /Firebase|server/.test(m)), JSON.stringify(w));
    }
});

test('insights on warns about the config files', () => {
    const message = 'Crashlytics and Analytics stay off until you add the Firebase config files (README, Insights).';
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { insights: true } }), [message]);
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { insights: false } }), []);
    // Showcase: insights is on only when its template has core/insights (the caller says)
    assert.ok(generationWarnings({ templateType: 'showcase', featuresConfig: null, insights: true }).includes(message));
    assert.ok(!generationWarnings({ templateType: 'showcase', featuresConfig: null }).includes(message));
    // Backend and insights both on: both warnings
    assert.strictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { backend: true, insights: true } }).length, 2);
});
