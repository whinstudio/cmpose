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
    assert.match(w[0], /adb reverse tcp:18001 tcp:18001/);
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

test('networkBaseUrl without network warns', () => {
    const message = 'featuresConfig.networkBaseUrl was not used: it applies only with featuresConfig.network on.';
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { network: false, networkBaseUrl: 'https://api.example.com' } }), [message]);
    // Used, empty or blank: nothing was dropped
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { network: true, networkBaseUrl: 'https://api.example.com' } }), []);
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { network: false, networkBaseUrl: '  ' } }), []);
    // Showcase ignores featuresConfig as a whole (the MCP says so once)
    assert.ok(!generationWarnings({ templateType: 'showcase', featuresConfig: { networkBaseUrl: 'https://api.example.com' } }).includes(message));
});

test('detektYamlContent without detekt warns', () => {
    const message = 'featuresConfig.detektYamlContent was not used: it applies only with featuresConfig.detekt on.';
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { detekt: false, detektYamlContent: 'build:\n  maxIssues: 0\n' } }), [message]);
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { detekt: true, detektYamlContent: 'build:\n  maxIssues: 0\n' } }), []);
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { detekt: false, detektYamlContent: '' } }), []);
});

test('showcase features naming a template module warn', () => {
    const own = (features) => generationWarnings({ templateType: 'showcase', featuresConfig: null, features })
        .filter((w) => /^features /.test(w));
    assert.deepStrictEqual(own(['home']),
        ["features home were not generated: they are the template's own modules (already in the project)."]);
    // profile is a custom module and is generated: only home is named
    assert.deepStrictEqual(own(['home', 'profile']),
        ["features home were not generated: they are the template's own modules (already in the project)."]);
    assert.deepStrictEqual(own(['onboarding', 'home']),
        ["features onboarding, home were not generated: they are the template's own modules (already in the project)."]);
    // Not asked for, or only custom modules: no warning
    assert.deepStrictEqual(own(undefined), []);
    assert.deepStrictEqual(own([]), []);
    assert.deepStrictEqual(own(['profile']), []);
    // Blank clones home and onboarding like any custom module
    assert.ok(!generationWarnings({ templateType: 'blank', featuresConfig: {}, features: ['home'] }).some((w) => /^features /.test(w)));
});
