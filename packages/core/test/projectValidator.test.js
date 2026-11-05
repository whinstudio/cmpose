const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectValidator = require('../src/ProjectValidator');

const RESERVED = 'com.kturker.multiplatform';

// --- Package name -----------------------------------------------------------

test('validatePackageName accepts a plain reverse-domain package', () => {
    assert.equal(ProjectValidator.validatePackageName('dev.cmpose.app'), true);
    assert.equal(ProjectValidator.validatePackageName('com.example.myapp2'), true);
});

test('validatePackageName rejects underscores (they break the iOS bundle id)', () => {
    assert.equal(ProjectValidator.validatePackageName('com.my_company.app'), false);
    assert.equal(ProjectValidator.validatePackageName('com.example.my_app'), false);
});

test('validatePackageName rejects Kotlin hard keywords as segments', () => {
    for (const pkg of ['in.company.app', 'com.object.app', 'com.example.fun', 'com.example.typealias']) {
        assert.equal(ProjectValidator.validatePackageName(pkg), false, pkg);
    }
});

test('a Java keyword package segment is refused', () => {
    for (const pkg of ['com.acme.new', 'com.acme.int', 'com.native.app', 'com.acme.null']) {
        assert.equal(ProjectValidator.validatePackageName(pkg), false, pkg);
    }
    assert.match(ProjectValidator.messages.packageNameInvalid, /Java or Kotlin keyword/);
    // Words that only start with a Java keyword stay allowed
    assert.equal(ProjectValidator.validatePackageName('com.acme.news'), true);
    assert.equal(ProjectValidator.validatePackageName('com.acme.integer'), true);
});

test('validatePackageName keeps words that are not hard keywords (soft keywords, keyword prefixes)', () => {
    for (const pkg of ['com.example.data', 'dev.value.open', 'com.inner.app', 'com.example.objects']) {
        assert.equal(ProjectValidator.validatePackageName(pkg), true, pkg);
    }
});

test('validatePackageName has no reserved package unless configured', () => {
    assert.equal(ProjectValidator.validatePackageName(RESERVED), true);
    assert.equal(ProjectValidator.validatePackageName(RESERVED + '.x'), true);
});

test('validatePackageName rejects the configured reserved package and packages under it', () => {
    ProjectValidator.configure({ reservedPackagePrefix: RESERVED });
    try {
        assert.equal(ProjectValidator.validatePackageName('com.kturker.multiplatform'), false);
        assert.equal(ProjectValidator.validatePackageName('com.kturker.multiplatform.x'), false);
        // Only segment-boundary matches are reserved
        assert.equal(ProjectValidator.validatePackageName('com.kturker.multiplatformx'), true);
        assert.equal(ProjectValidator.validatePackageName('com.kturker.other'), true);
        assert.equal(ProjectValidator.validatePackageName('dev.cmpose.app'), true);
    } finally {
        ProjectValidator.configure({ reservedPackagePrefix: null });
    }
    assert.equal(ProjectValidator.validatePackageName(RESERVED), true);
});

test('sanitizePackageName drops underscores so keystrokes cannot produce a package the server rejects', () => {
    assert.equal(ProjectValidator.sanitizePackageName('com.my_company.app'), 'com.mycompany.app');
    assert.equal(ProjectValidator.sanitizePackageName('Com.Example..My_App!'), 'com.example.myapp');
    assert.equal(ProjectValidator.sanitizePackageName('dev.cmpose.app2'), 'dev.cmpose.app2');
    // Every character the sanitizer lets through is one validatePackageName can accept
    const typed = ProjectValidator.sanitizePackageName('dev_.cm-pose.a p_p');
    assert.match(typed, /^[a-z0-9.]*$/);
    assert.equal(ProjectValidator.validatePackageName(typed), true, typed);
});

test('packageNameInvalid message drops underscores and mentions keywords and the reserved package', () => {
    const msg = ProjectValidator.messages.packageNameInvalid;
    assert.doesNotMatch(msg, /underscore/i);
    assert.match(msg, /keyword/i);
    assert.match(msg, /reserved/i);
});

// --- Module name ------------------------------------------------------------

test('validateModuleName rejects Kotlin hard keywords', () => {
    assert.equal(ProjectValidator.validateModuleName('object'), false);
    assert.equal(ProjectValidator.validateModuleName('in'), false);
    assert.equal(ProjectValidator.validateModuleName('package'), false);
    assert.equal(ProjectValidator.validateModuleName('profile'), true);
    assert.equal(ProjectValidator.validateModuleName('objects'), true);
});

test('a Java keyword module name is refused', () => {
    for (const name of ['switch', 'native', 'new', 'int', 'static']) {
        assert.equal(ProjectValidator.validateModuleName(name), false, name);
    }
    assert.match(ProjectValidator.messages.moduleNameInvalid, /Java or Kotlin keyword/);
    assert.equal(ProjectValidator.validateModuleName('switches'), true);
    assert.equal(ProjectValidator.validateModuleName('news'), true);
});

test('validateModuleName rejects the reserved name monetization', () => {
    assert.equal(ProjectValidator.validateModuleName('monetization'), false);
    assert.ok(ProjectValidator.RESERVED_MODULE_NAMES.includes('monetization'));
    assert.equal(ProjectValidator.validateModuleName('monetize'), true);
});

test('validateModuleName rejects the reserved name notes', () => {
    assert.equal(ProjectValidator.validateModuleName('notes'), false);
    assert.ok(ProjectValidator.RESERVED_MODULE_NAMES.includes('notes'));
    assert.match(ProjectValidator.messages.moduleNameInvalid, /build, monetization, notes/);
    assert.equal(ProjectValidator.validateModuleName('notebook'), true);
});

test('validateModuleName rejects the backend feature names account and sharing', () => {
    for (const name of ['account', 'sharing']) {
        assert.equal(ProjectValidator.validateModuleName(name), false, name);
        assert.ok(ProjectValidator.RESERVED_MODULE_NAMES.includes(name), name);
    }
    assert.match(ProjectValidator.messages.moduleNameInvalid, /reserved names \(build, monetization, notes, account, sharing\)/);
    assert.equal(ProjectValidator.validateModuleName('accounts'), true);
    assert.equal(ProjectValidator.validateModuleName('share'), true);
});

test('moduleNameInvalid message mentions keywords', () => {
    assert.match(ProjectValidator.messages.moduleNameInvalid, /keyword/i);
});

test('moduleNameInvalid message lists every reserved module name', () => {
    assert.match(ProjectValidator.messages.moduleNameInvalid, /reserved names/);
    for (const name of ProjectValidator.RESERVED_MODULE_NAMES) {
        assert.match(ProjectValidator.messages.moduleNameInvalid, new RegExp('\\b' + name + '\\b'), name);
    }
});

// --- App name ---------------------------------------------------------------

test('validateAppName accepts letters (any script), digits, spaces and . _ \' -', () => {
    const ok = [
        'My App', 'Tom\'s App', 'Çay Saati', 'App 2.0', 'my-app_x', 'x', 'x'.repeat(30),
        'हिंदी',            // Devanagari: vowel signs are combining marks (\p{M})
        'น้ำ',              // Thai: tone mark / vowel are combining marks
        'C\u0327ay Saati'  // NFD Latin: C + COMBINING CEDILLA
    ];
    for (const name of ok) {
        assert.equal(ProjectValidator.validateAppName(name), true, name);
    }
});

test('validateAppName rejects characters unsafe for strings.xml / xcconfig / Kotlin', () => {
    const bad = ['R&D', 'My <App>', 'A"B', 'A$B', 'A\\B', 'Line\nBreak', '@home', '?attr', 'A/B'];
    for (const name of bad) {
        assert.equal(ProjectValidator.validateAppName(name), false, JSON.stringify(name));
    }
});

test('validateAppName rejects empty, untrimmed and over-long values', () => {
    assert.equal(ProjectValidator.validateAppName(''), false);
    assert.equal(ProjectValidator.validateAppName(' My App'), false);
    assert.equal(ProjectValidator.validateAppName('My App '), false);
    assert.equal(ProjectValidator.validateAppName('x'.repeat(ProjectValidator.MAX_LENGTH_APP_NAME + 1)), false);
});

// --- Min SDK ----------------------------------------------------------------

test('validateMinSdk requires one or two digits before the range check', () => {
    assert.equal(ProjectValidator.validateMinSdk('24'), true);
    assert.equal(ProjectValidator.validateMinSdk('36'), true);
    assert.equal(ProjectValidator.validateMinSdk('24abc'), false);
    assert.equal(ProjectValidator.validateMinSdk(' 24'), false);
    assert.equal(ProjectValidator.validateMinSdk('24.5'), false);
    assert.equal(ProjectValidator.validateMinSdk('024'), false);
    assert.equal(ProjectValidator.validateMinSdk(''), false);
    assert.equal(ProjectValidator.validateMinSdk('23'), false);
    assert.equal(ProjectValidator.validateMinSdk('37'), false);
});

test('validateMinSdk still accepts a number (the web UI passes parseInt output)', () => {
    assert.equal(ProjectValidator.validateMinSdk(24), true);
    assert.equal(ProjectValidator.validateMinSdk(100), false);
});

// --- URL --------------------------------------------------------------------

test('validateUrl accepts http(s) URLs', () => {
    assert.equal(ProjectValidator.validateUrl('https://api.example.com'), true);
    assert.equal(ProjectValidator.validateUrl('http://localhost:8080/v1/'), true);
});

test('validateUrl rejects other schemes and unparsable values', () => {
    for (const url of ['ftp://x', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', '']) {
        assert.equal(ProjectValidator.validateUrl(url), false, url);
    }
});

test('validateUrl rejects characters that would break the generated Kotlin string', () => {
    for (const url of ['https://x"y', 'https://x.com/a\\b', 'https://x.com/$y', 'https://x.com/\nx', 'https://x.com/a b']) {
        assert.equal(ProjectValidator.validateUrl(url), false, JSON.stringify(url));
    }
});

test('validateUrl enforces MAX_LENGTH_BASE_URL', () => {
    const prefix = 'https://a.com/';
    const atLimit = prefix + 'a'.repeat(ProjectValidator.MAX_LENGTH_BASE_URL - prefix.length);
    assert.equal(atLimit.length, 100);
    assert.equal(ProjectValidator.validateUrl(atLimit), true);
    assert.equal(ProjectValidator.validateUrl(atLimit + 'a'), false);
});

test('validateUrl rejects non-string values', () => {
    assert.equal(ProjectValidator.validateUrl(123), false);
    assert.equal(ProjectValidator.validateUrl(['https://a.com']), false);
    assert.equal(ProjectValidator.validateUrl({ href: 'https://a.com' }), false);
});

// --- Max lengths ------------------------------------------------------------

test('MAX_LENGTH_* limits keep their values', () => {
    assert.equal(ProjectValidator.MAX_LENGTH_PROJECT_NAME, 30);
    assert.equal(ProjectValidator.MAX_LENGTH_APP_NAME, 30);
    assert.equal(ProjectValidator.MAX_LENGTH_PACKAGE_NAME, 50);
    assert.equal(ProjectValidator.MAX_LENGTH_MODULE_NAME, 20);
    assert.equal(ProjectValidator.MAX_LENGTH_BASE_URL, 100);
});

test('validateMaxLength enforces an inclusive upper bound', () => {
    assert.equal(ProjectValidator.validateMaxLength('abc', 3), true);
    assert.equal(ProjectValidator.validateMaxLength('abcd', 3), false);
    assert.equal(ProjectValidator.validateMaxLength('', 3), true);
});

test('too-long messages name their limit', () => {
    assert.match(ProjectValidator.messages.projectNameTooLong, /30/);
    assert.match(ProjectValidator.messages.packageNameTooLong, /50/);
    assert.match(ProjectValidator.messages.moduleNameTooLong, /20/);
    assert.match(ProjectValidator.messages.appNameInvalid, /30/);
});
