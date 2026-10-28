const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { renderPrivacyManifest, writePrivacyManifest, PRIVACY_MANIFEST } = require('../src/privacyManifest');

const FIXTURES = path.join(__dirname, 'fixtures', 'privacy');
const read = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const TEMPLATE = read('PrivacyInfo.template.xcprivacy');

const CASES = [
    { name: 'none', flags: { ads: false, purchases: false } },
    { name: 'ads', flags: { ads: true } },
    { name: 'purchases', flags: { purchases: true } },
    { name: 'all', flags: { ads: true, purchases: true } }
];

const count = (text, re) => (text.match(re) || []).length;

for (const { name, flags } of CASES) {
    test(`renderPrivacyManifest matches expected-${name} byte for byte`, () => {
        assert.equal(renderPrivacyManifest(TEMPLATE, flags), read(`expected-${name}.xcprivacy`));
    });

    test(`renderPrivacyManifest leaves no cmpose: marker (${name})`, () => {
        assert.ok(!renderPrivacyManifest(TEMPLATE, flags).includes('cmpose:'));
    });

    test(`renderPrivacyManifest is idempotent on its own output (${name})`, () => {
        const once = renderPrivacyManifest(TEMPLATE, flags);
        assert.equal(renderPrivacyManifest(once, flags), once);
        // Showcase runs with both flags on: an already rendered file stays as it is
        assert.equal(renderPrivacyManifest(once, { ads: true, purchases: true }), once);
    });

    test(`renderPrivacyManifest keeps dict and array tags balanced (${name})`, () => {
        const out = renderPrivacyManifest(TEMPLATE, flags);
        assert.equal(count(out, /<dict>/g), count(out, /<\/dict>/g));
        assert.equal(count(out, /<array>/g), count(out, /<\/array>/g));
    });
}

test('renderPrivacyManifest rejects an unclosed block', () => {
    const broken = TEMPLATE.replace('        <!-- /cmpose:ads -->\n', '');
    assert.throws(() => renderPrivacyManifest(broken, { ads: true }),
        { message: 'PrivacyInfo.xcprivacy: unclosed cmpose:ads block' });
});

test('writePrivacyManifest is a no-op when the template has no manifest (older template)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-'));
    try {
        await writePrivacyManifest(dir, { ads: true, purchases: true });
        assert.deepEqual(await fs.readdir(dir), []);
    } finally {
        await fs.remove(dir);
    }
});

test('writePrivacyManifest renders the project file in place', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-'));
    try {
        const file = path.join(dir, ...PRIVACY_MANIFEST);
        await fs.outputFile(file, TEMPLATE);
        await writePrivacyManifest(dir, { ads: false, purchases: true });
        assert.equal(await fs.readFile(file, 'utf8'), read('expected-purchases.xcprivacy'));
    } finally {
        await fs.remove(dir);
    }
});

test('a cmpose:backend block stays (without markers) for backend on and goes for backend off', () => {
    const fixture = read('PrivacyInfo.backend.xcprivacy');
    const on = renderPrivacyManifest(fixture, { backend: true });
    assert.ok(on.includes('NSPrivacyCollectedDataTypeEmailAddress'), on);
    assert.ok(!on.includes('cmpose:'), on);
    const off = renderPrivacyManifest(fixture, { backend: false });
    assert.ok(!off.includes('NSPrivacyCollectedDataTypeEmailAddress'), off);
    assert.ok(!off.includes('cmpose:'), off);
    // The collected data array had only the backend block: it collapses
    assert.match(off, /<key>NSPrivacyCollectedDataTypes<\/key>\n    <array\/>/);
});

test('the template fixture renders the same with backend off (no backend block)', () => {
    assert.equal(renderPrivacyManifest(TEMPLATE, { ads: false, purchases: false, backend: false }), read('expected-none.xcprivacy'));
});

test('privacy keeps the insights block only when on', () => {
    const fixture = read('PrivacyInfo.insights.xcprivacy');
    const on = renderPrivacyManifest(fixture, { insights: true });
    for (const type of ['CrashData', 'ProductInteraction', 'DeviceID']) {
        assert.ok(on.includes(`NSPrivacyCollectedDataType${type}`), on);
    }
    assert.ok(on.includes('NSPrivacyCollectedDataTypePurposeAnalytics'), on);
    assert.ok(!on.includes('cmpose:'), on);
    // Insights never turns tracking on
    assert.match(on, /<key>NSPrivacyTracking<\/key>\n    <false\/>/);
    const off = renderPrivacyManifest(fixture, { insights: false });
    assert.ok(!off.includes('NSPrivacyCollectedDataTypeCrashData'), off);
    assert.ok(!off.includes('NSPrivacyCollectedDataTypePurposeAnalytics'), off);
    assert.ok(!off.includes('cmpose:'), off);
    assert.match(off, /<key>NSPrivacyCollectedDataTypes<\/key>\n    <array\/>/);
});
