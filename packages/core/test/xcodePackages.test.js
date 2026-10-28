const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { removeSwiftPackage, removeSwiftPackageProduct, removeRunScriptPhase } = require('../src/xcodePackages');

const FIXTURES = path.join(__dirname, 'fixtures', 'monetization');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const GMA_URL = 'https://github.com/googleads/swift-package-manager-google-mobile-ads';
const WITH_ADS = read('project.with-ads.pbxproj');
const WITHOUT_ADS = read('project.without-ads.pbxproj');

// A second package (as Xcode writes it) added to the with-ads project
const OTHER_REF = 'AAAAAAAAAAAAAAAAAAAAAAA1';
const OTHER_PRODUCT = 'AAAAAAAAAAAAAAAAAAAAAAA2';
const OTHER_BUILD_FILE = 'AAAAAAAAAAAAAAAAAAAAAAA3';
const OTHER_REF_COMMENT = '/* XCRemoteSwiftPackageReference "swift-collections" */';

function addSecondPackage(content) {
    const replaceOnce = (text, anchor, replacement) => {
        assert.equal(text.split(anchor).length, 2, `anchor not unique: ${anchor}`);
        return text.replace(anchor, replacement);
    };
    let out = content;
    out = replaceOnce(out, '/* End PBXBuildFile section */',
        `\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */ = {isa = PBXBuildFile; productRef = ${OTHER_PRODUCT} /* Collections */; };\n/* End PBXBuildFile section */`);
    out = replaceOnce(out, ' /* GoogleMobileAds in Frameworks */,\n',
        ` /* GoogleMobileAds in Frameworks */,\n\t\t\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */,\n`);
    out = replaceOnce(out, ' /* GoogleMobileAds */,\n\t\t\t);',
        ` /* GoogleMobileAds */,\n\t\t\t\t${OTHER_PRODUCT} /* Collections */,\n\t\t\t);`);
    out = replaceOnce(out, ' /* XCRemoteSwiftPackageReference "swift-package-manager-google-mobile-ads" */,\n',
        ` /* XCRemoteSwiftPackageReference "swift-package-manager-google-mobile-ads" */,\n\t\t\t\t${OTHER_REF} ${OTHER_REF_COMMENT},\n`);
    out = replaceOnce(out, '/* End XCRemoteSwiftPackageReference section */', [
        `\t\t${OTHER_REF} ${OTHER_REF_COMMENT} = {`,
        '\t\t\tisa = XCRemoteSwiftPackageReference;',
        '\t\t\trepositoryURL = "https://github.com/apple/swift-collections";',
        '\t\t\trequirement = {',
        '\t\t\t\tkind = upToNextMajorVersion;',
        '\t\t\t\tminimumVersion = 1.1.0;',
        '\t\t\t};',
        '\t\t};',
        '/* End XCRemoteSwiftPackageReference section */'
    ].join('\n'));
    out = replaceOnce(out, '/* End XCSwiftPackageProductDependency section */', [
        `\t\t${OTHER_PRODUCT} /* Collections */ = {`,
        '\t\t\tisa = XCSwiftPackageProductDependency;',
        `\t\t\tpackage = ${OTHER_REF} ${OTHER_REF_COMMENT};`,
        '\t\t\tproductName = Collections;',
        '\t\t};',
        '/* End XCSwiftPackageProductDependency section */'
    ].join('\n'));
    return out;
}

test('the fixtures differ only by the Google Mobile Ads package', () => {
    assert.notEqual(WITH_ADS, WITHOUT_ADS);
    assert.ok(WITH_ADS.includes('swift-package-manager-google-mobile-ads'));
    assert.ok(!WITHOUT_ADS.includes('swift-package-manager-google-mobile-ads'));
});

test('removeSwiftPackage turns the with-ads project into the without-ads project byte for byte', () => {
    assert.equal(removeSwiftPackage(WITH_ADS, GMA_URL), WITHOUT_ADS);
});

test('removeSwiftPackage matches the repository URL with or without .git', () => {
    assert.equal(removeSwiftPackage(WITH_ADS, `${GMA_URL}.git`), WITHOUT_ADS);
    assert.equal(removeSwiftPackage(WITH_ADS, `${GMA_URL}/`), WITHOUT_ADS);
});

test('removeSwiftPackage leaves the project unchanged when the URL is not there', () => {
    assert.equal(removeSwiftPackage(WITH_ADS, 'https://github.com/apple/swift-collections'), WITH_ADS);
    assert.equal(removeSwiftPackage(WITHOUT_ADS, GMA_URL), WITHOUT_ADS);
    // A URL that only starts like the package's is another package
    assert.equal(removeSwiftPackage(WITH_ADS, `${GMA_URL}-extra`), WITH_ADS);
});

test('removeSwiftPackage is idempotent', () => {
    const once = removeSwiftPackage(WITH_ADS, GMA_URL);
    assert.equal(removeSwiftPackage(once, GMA_URL), once);
});

test('removeSwiftPackage leaves another package intact', () => {
    const twoPackages = addSecondPackage(WITH_ADS);
    const result = removeSwiftPackage(twoPackages, GMA_URL);
    assert.ok(!result.includes('google-mobile-ads'), result);
    assert.ok(!result.includes('GoogleMobileAds'), result);
    assert.ok(result.includes(`\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */ = {isa = PBXBuildFile; productRef = ${OTHER_PRODUCT} /* Collections */; };`));
    assert.ok(result.includes(`\t\t\tfiles = (\n\t\t\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */,\n\t\t\t);`));
    assert.ok(result.includes(`\t\t\tpackageProductDependencies = (\n\t\t\t\t${OTHER_PRODUCT} /* Collections */,\n\t\t\t);`));
    assert.ok(result.includes(`\t\t\tpackageReferences = (\n\t\t\t\t${OTHER_REF} ${OTHER_REF_COMMENT},\n\t\t\t);`));
    assert.ok(result.includes('/* Begin XCRemoteSwiftPackageReference section */'));
    assert.ok(result.includes('repositoryURL = "https://github.com/apple/swift-collections";'));
    assert.ok(result.includes(`\t\t\tpackage = ${OTHER_REF} ${OTHER_REF_COMMENT};`));

    // Removing the second package too gives the project without any package
    assert.equal(removeSwiftPackage(result, 'https://github.com/apple/swift-collections.git'), WITHOUT_ADS);
});

// Review M3: no silently unchanged output on a pbxproj written with other line endings or indentation
test('removeSwiftPackage handles a CRLF project and keeps its line endings', () => {
    const crlf = (text) => text.replace(/\n/g, '\r\n');
    assert.equal(removeSwiftPackage(crlf(WITH_ADS), GMA_URL), crlf(WITHOUT_ADS));
    assert.equal(removeSwiftPackage(crlf(WITHOUT_ADS), GMA_URL), crlf(WITHOUT_ADS));
});

test('removeSwiftPackage throws when the package is there but its objects cannot be parsed', () => {
    const spaces = WITH_ADS.replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length));
    assert.throws(() => removeSwiftPackage(spaces, GMA_URL), /swift-package-manager-google-mobile-ads/);
    // Without the package, an unusual layout is left as it is
    const spacesWithout = WITHOUT_ADS.replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length));
    assert.equal(removeSwiftPackage(spacesWithout, GMA_URL), spacesWithout);
});

// The insights fixture is the backend's project with firebase-ios-sdk's FirebaseCrashlytics and FirebaseAnalytics
// products and the "Upload Crashlytics symbols if configured" phase added
const FIREBASE_URL = 'https://github.com/firebase/firebase-ios-sdk';
const UPLOAD_PHASE = 'Upload Crashlytics symbols if configured';
const WITH_INSIGHTS = fs.readFileSync(path.join(__dirname, 'fixtures', 'insights', 'project.pbxproj'), 'utf8');
const WITHOUT_INSIGHTS = fs.readFileSync(path.join(__dirname, 'fixtures', 'backend', 'project.pbxproj'), 'utf8');
const stripInsights = (content) => removeRunScriptPhase(
    removeSwiftPackageProduct(removeSwiftPackageProduct(content, FIREBASE_URL, 'FirebaseCrashlytics'), FIREBASE_URL, 'FirebaseAnalytics'),
    UPLOAD_PHASE
);

test('removing the insights products and phase gives the project before insights byte for byte', () => {
    assert.equal(stripInsights(WITH_INSIGHTS), WITHOUT_INSIGHTS);
    // CRLF survives, and a second pass changes nothing
    const crlf = (text) => text.replace(/\n/g, '\r\n');
    assert.equal(stripInsights(crlf(WITH_INSIGHTS)), crlf(WITHOUT_INSIGHTS));
    assert.equal(stripInsights(WITHOUT_INSIGHTS), WITHOUT_INSIGHTS);
});

test('removeSwiftPackageProduct keeps the package and its other products', () => {
    const result = removeSwiftPackageProduct(WITH_INSIGHTS, FIREBASE_URL, 'FirebaseCrashlytics');
    assert.ok(!result.includes('FirebaseCrashlytics'), result);
    for (const kept of ['productName = FirebaseAnalytics;', 'productName = FirebaseAuth;', 'repositoryURL = "https://github.com/firebase/firebase-ios-sdk";']) {
        assert.ok(result.includes(kept), kept);
    }
    // Asked of another package, the product it still links is an error, never a silently unchanged project
    assert.throws(() => removeSwiftPackageProduct(WITH_INSIGHTS, GMA_URL, 'FirebaseCrashlytics'), /FirebaseCrashlytics/);
});

test('removeRunScriptPhase removes only the named phase', () => {
    const result = removeRunScriptPhase(WITH_INSIGHTS, UPLOAD_PHASE);
    assert.ok(!result.includes(UPLOAD_PHASE), result);
    assert.ok(result.includes('name = "Copy GoogleService-Info if present";'));
    assert.ok(result.includes('name = "Compile Kotlin Framework";'));
    assert.ok(result.includes('productName = FirebaseCrashlytics;'));
    // Not there: unchanged, whatever the layout
    assert.equal(removeRunScriptPhase(WITHOUT_INSIGHTS, UPLOAD_PHASE), WITHOUT_INSIGHTS);
    const spaces = WITHOUT_INSIGHTS.replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length));
    assert.equal(removeRunScriptPhase(spaces, UPLOAD_PHASE), spaces);
});

test('removeRunScriptPhase throws when the phase is there but cannot be parsed', () => {
    const spaces = WITH_INSIGHTS.replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length));
    assert.throws(() => removeRunScriptPhase(spaces, UPLOAD_PHASE), /Upload Crashlytics symbols if configured/);
    // A phase whose closing line is missing would swallow the next object
    const unclosed = WITH_INSIGHTS.replace(/(name = "Upload Crashlytics symbols if configured";[\s\S]*?fi\\n";\n)\t\t\};\n/, '$1');
    assert.notEqual(unclosed, WITH_INSIGHTS);
    assert.throws(() => removeRunScriptPhase(unclosed, UPLOAD_PHASE), /Upload Crashlytics symbols if configured/);
});
