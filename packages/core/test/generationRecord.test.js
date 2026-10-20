const test = require('node:test');
const assert = require('node:assert/strict');

const { truncateIp, sanitizeFeaturesConfig, buildGenerationRecord } = require('../src/generationRecord');

test('IPv4 keeps its /24, IPv6 its /48; anything else is left as is', () => {
    assert.equal(truncateIp('203.0.113.45'), '203.0.113.0');
    assert.equal(truncateIp('127.0.0.1'), '127.0.0.0');
    assert.equal(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::');
    assert.equal(truncateIp('2001:db8::1'), '2001:db8:0::');
    assert.equal(truncateIp('unknown'), 'unknown');
    // '::' is expanded before the /48 is taken; IPv4-mapped IPv6 is shortened as IPv4
    assert.equal(truncateIp('::ffff:203.0.113.45'), '203.0.113.0');
    assert.equal(truncateIp('2001:db8:85a3::8a2e:370:7348'), '2001:db8:85a3::');
    assert.equal(truncateIp('fe80::1'), 'fe80:0:0::');
    assert.equal(truncateIp('::1'), '0:0:0::');
    assert.equal(truncateIp(undefined), 'unknown');
});

test('featuresConfig is kept without the uploaded detekt.yml (only whether one was sent)', () => {
    assert.deepEqual(
        sanitizeFeaturesConfig({ network: true, detekt: true, detektYamlContent: 'style:\n  x: 1\n' }),
        { network: true, detekt: true, customDetektYaml: true }
    );
    assert.deepEqual(sanitizeFeaturesConfig({ network: false, detektYamlContent: null }), { network: false, customDetektYaml: false });
    assert.equal(sanitizeFeaturesConfig(undefined), null);
});

test('the generation record names the template, the backend and the options, with no personal data', () => {
    const record = buildGenerationRecord({
        templateRef: 'refs/tags/template-2026.09.29.2',
        templateCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        backendRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        templateType: 'blank',
        ci: true,
        minSdk: '24',
        iosVersion: '15.0',
        features: ['profile'],
        featuresConfig: { network: true, detektYamlContent: 'x' },
        now: new Date('2026-09-29T11:00:00.000Z')
    });
    assert.deepEqual(record, {
        generator: 'cmpose',
        generatedAt: '2026-09-29T11:00:00.000Z',
        template: { ref: 'refs/tags/template-2026.09.29.2', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        backend: { revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        serverTemplate: null,
        options: {
            templateType: 'blank',
            ci: true,
            minSdk: '24',
            iosVersion: '15.0',
            features: ['profile'],
            featuresConfig: { network: true, customDetektYaml: true }
        }
    });
});

test('the generation record names the backend template server/ came from', () => {
    const serverTemplate = { repo: 'https://example.invalid/backend.git', ref: 'backend-template-2026.10.20', commit: 'c'.repeat(40) };
    const record = buildGenerationRecord({ templateType: 'blank', minSdk: '24', iosVersion: '15.0', features: [], featuresConfig: { backend: true }, serverTemplate });
    assert.deepEqual(record.serverTemplate, serverTemplate);
});

test('ci-optin: the generation record says ci false when the option was not sent', () => {
    const record = buildGenerationRecord({ templateType: 'showcase', minSdk: '24', iosVersion: '15.0', features: [], featuresConfig: null });
    assert.equal(record.options.ci, false);
});
