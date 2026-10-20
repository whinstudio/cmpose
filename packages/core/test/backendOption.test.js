const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const {
    removeMarkedBlocks, applySwapMarkers, stripBackendPbxproj, stripBackendPins, applyBackendOption,
    BACKEND_PATHS, BACKEND_ONLY_IMPORTS, BACKEND_PIN_IDENTITIES
} = require('../src/backendOption');

const FIXTURES = path.join(__dirname, 'fixtures', 'backend');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
// The project before the backend: the backend's pbxproj without its additions is this file byte for byte
const PBXPROJ_WITHOUT_BACKEND = fs.readFileSync(path.join(__dirname, 'fixtures', 'monetization', 'project.with-ads.pbxproj'), 'utf8');

test('slash blocks are removed with their markers when backend is off', () => {
    const src = 'a\n    // cmpose:backend\n    b()\n    // /cmpose:backend\nc\n';
    assert.strictEqual(removeMarkedBlocks(src, 'slash', false), 'a\nc\n');
    assert.strictEqual(removeMarkedBlocks(src, 'slash', true), 'a\n    b()\nc\n');
});

test('swap marker replaces the next line at its indentation', () => {
    const src = '  // cmpose:backend-off: val s = Home\n  val s = gate() ?: return\n';
    assert.strictEqual(applySwapMarkers(src, false), '  val s = Home\n');
    assert.strictEqual(applySwapMarkers(src, true), '  val s = gate() ?: return\n');
});

test('an unclosed block throws naming the marker', () => {
    assert.throws(() => removeMarkedBlocks('// cmpose:backend\nx\n', 'slash', false), /unclosed cmpose:backend/);
});

test('a stray close marker and a nested open marker throw', () => {
    assert.throws(() => removeMarkedBlocks('x\n// /cmpose:backend\n', 'slash', false), /stray \/\/ \/cmpose:backend/);
    assert.throws(() => removeMarkedBlocks('// cmpose:backend\n// cmpose:backend\n// /cmpose:backend\n', 'slash', true), /nested/);
});

test('a swap marker on the last line throws', () => {
    assert.throws(() => applySwapMarkers('x\n// cmpose:backend-off: y', false), /last line/);
});

test('a marker sharing its line with code is not a marker', () => {
    const src = 'val a = 1 // cmpose:backend\nb\n';
    assert.strictEqual(removeMarkedBlocks(src, 'slash', false), src);
});

test('hash blocks: off drops the block, on keeps its lines', () => {
    const toml = read('libs.versions.toml');
    const off = removeMarkedBlocks(toml, 'hash', false);
    assert.ok(!off.includes('cmpose:backend'));
    for (const gone of ['androidxTestRunner', 'exposed', 'googleId', 'ktor-client-auth', 'ktor-server-core', 'googleServices']) {
        assert.ok(!off.includes(gone), `${gone} still in the catalog`);
    }
    for (const kept of ['turbine', 'revenuecat', 'ktor-client-logging', 'ktor-serialization-kotlinx-json', 'kotlin-test', 'aboutLibraries']) {
        assert.ok(off.includes(kept), `${kept} missing from the catalog`);
    }
    const on = removeMarkedBlocks(toml, 'hash', true);
    assert.ok(!on.includes('cmpose:backend'));
    assert.equal(on, toml.split('\n').filter((line) => !line.includes('cmpose:backend')).join('\n'));
});

test('ymlBackendBlockIsStrippedWhenOff', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-backend-yml-'));
    t.after(() => fs.remove(dir));
    const ci = 'jobs:\n  android:\n    runs-on: ubuntu-latest\n'
        + '  # cmpose:backend\n  server:\n    if: hashFiles(\'server/settings.gradle.kts\') != \'\'\n    runs-on: ubuntu-latest\n  # /cmpose:backend\n';
    for (const enabled of [false, true]) {
        for (const name of ['ci.yml', 'other.yaml']) await fs.outputFile(path.join(dir, '.github', 'workflows', name), ci);
        await applyBackendOption(dir, enabled);
        for (const name of ['ci.yml', 'other.yaml']) {
            const out = await fs.readFile(path.join(dir, '.github', 'workflows', name), 'utf8');
            assert.ok(!out.includes('cmpose:backend'), out);
            assert.equal(out.includes('  server:\n'), enabled, out);
            assert.ok(out.startsWith('jobs:\n  android:\n    runs-on: ubuntu-latest\n'), out);
        }
    }
});

test('blank-line collapse after a removed block leaves at most one blank line at the join', () => {
    const off = removeMarkedBlocks(read('libs.versions.toml'), 'hash', false);
    assert.ok(!off.includes('\n\n\n'));
    // The block opening with a blank line, after ktor-serialization: one blank line before kotlin-test
    assert.match(off, /ktor-serialization-kotlinx-json = [^\n]*\n\nkotlin-test/);
    // .gitignore: the block starts with a blank line and ends the file, so the file ends after *.jks
    assert.equal(removeMarkedBlocks(read('template.gitignore'), 'hash', false),
        'local.properties\n.idea\n\n# Release signing\nkeystore.properties\n*.jks\n');
    // Blank lines away from a join stay, as many as there are
    const src = 'a\n\n\nb\n\n# cmpose:backend\nx\n# /cmpose:backend\n\nc\n';
    assert.equal(removeMarkedBlocks(src, 'hash', false), 'a\n\n\nb\n\nc\n');
});

test('html blocks in Info.plist: off drops the LOCAL_SERVER block and the google-sign-in dict, keeps the app scheme', () => {
    const plist = read('Info.plist');
    const off = removeMarkedBlocks(plist, 'html', false);
    assert.ok(!off.includes('cmpose:backend'));
    assert.ok(!off.includes('#if LOCAL_SERVER'));
    assert.ok(!off.includes('#endif'));
    assert.ok(!off.includes('NSAppTransportSecurity'));
    assert.ok(!off.includes('google-sign-in'));
    assert.ok(!off.includes('GOOGLE_REVERSED_CLIENT_ID'));
    assert.match(off, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>multiplatform<\/string>\s*<\/array>\s*<\/dict>\s*<\/array>/);
    assert.ok(off.includes('GADApplicationIdentifier'));
});

test('html blocks in Info.plist: on keeps $(GOOGLE_REVERSED_CLIENT_ID) and the LOCAL_SERVER block, without markers', () => {
    const on = removeMarkedBlocks(read('Info.plist'), 'html', true);
    assert.ok(!on.includes('cmpose:backend'));
    assert.ok(on.includes('<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>'));
    assert.ok(on.includes('#if LOCAL_SERVER'));
    assert.ok(on.includes('<string>multiplatform</string>'));
});

test('the Swift swap marker: off restores the plain deep link handler, on keeps Google Sign-In first', () => {
    const swift = read('iOSApp.swift');
    const off = removeMarkedBlocks(applySwapMarkers(swift, false), 'slash', false);
    assert.ok(!off.includes('cmpose:backend'));
    assert.ok(!/Firebase|GoogleSignIn|GIDSignIn|SignInBridge/.test(off));
    assert.ok(off.includes('                .onOpenURL { url in _ = DeepLinksKt.handleDeepLink(uri: url.absoluteString) }\n'));
    assert.ok(off.startsWith('import SwiftUI\nimport Shared\n'));
    assert.ok(off.includes('AdsBridgeRegistrationKt.registerAdsBridge'));

    const on = removeMarkedBlocks(applySwapMarkers(swift, true), 'slash', true);
    assert.ok(!on.includes('cmpose:backend'));
    assert.ok(on.startsWith('import FirebaseCore\nimport GoogleSignIn\nimport SwiftUI\n'));
    assert.ok(on.includes('                .onOpenURL { url in if !GIDSignIn.sharedInstance.handle(url) {'));
    assert.ok(on.includes('FirebaseApp.configure()'));
});

test('stripBackendPbxproj removes Firebase, GoogleSignIn, the copy phase, the exceptions and the settings, and keeps GMA', () => {
    const out = stripBackendPbxproj(read('project.pbxproj'));
    for (const gone of ['firebase-ios-sdk', 'FirebaseAuth', 'GoogleSignIn', 'Copy GoogleService-Info', 'GoogleService-Info.plist',
        'iosApp.entitlements', 'CODE_SIGN_ENTITLEMENTS', 'INFOPLIST_PREPROCESS', 'LOCAL_SERVER']) {
        assert.ok(!out.includes(gone), `${gone} still in project.pbxproj`);
    }
    assert.ok(out.includes('swift-package-manager-google-mobile-ads'));
    assert.ok(out.includes('/* GoogleMobileAds in Frameworks */'));
    assert.ok(out.includes('/* Compile Kotlin Framework */ = {'));
    assert.ok(out.includes('\t\t\t\tInfo.plist,\n'));
    // Exactly the project as it was before the backend
    assert.equal(out, PBXPROJ_WITHOUT_BACKEND);
});

test('stripBackendPbxproj keeps CRLF line endings and is a no-op on a project without the backend', () => {
    const crlf = read('project.pbxproj').replace(/\n/g, '\r\n');
    assert.equal(stripBackendPbxproj(crlf), PBXPROJ_WITHOUT_BACKEND.replace(/\n/g, '\r\n'));
    assert.equal(stripBackendPbxproj(PBXPROJ_WITHOUT_BACKEND), PBXPROJ_WITHOUT_BACKEND);
});

test('stripBackendPbxproj fails closed when the copy phase is there but cannot be parsed', () => {
    // The phase's object loses its closing line: it is no longer a parseable object
    const broken = read('project.pbxproj').replace(
        /(name = "Copy GoogleService-Info if present";[\s\S]*?fi\\n";\n)\t\t\};\n/, '$1');
    assert.notEqual(broken, read('project.pbxproj'));
    assert.throws(() => stripBackendPbxproj(broken), /Copy GoogleService-Info if present/);
});

test('stripBackendPins keeps the GMA and UMP pins, drops originHash and keeps Xcode\'s layout', () => {
    const out = stripBackendPins(read('Package.resolved'));
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.pins.map((pin) => pin.identity),
        ['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform']);
    assert.equal(parsed.version, 3);
    assert.ok(!('originHash' in parsed));
    assert.ok(out.startsWith('{\n  "pins" : [\n    {\n      "identity" : "swift-package-manager-google-mobile-ads",'));
    assert.ok(out.endsWith('\n  ],\n  "version" : 3\n}\n'));
});

test('stripBackendPins returns null for a Firebase-only file', () => {
    const resolved = JSON.parse(read('Package.resolved'));
    resolved.pins = resolved.pins.filter((pin) => ['firebase-ios-sdk', 'googlesignin-ios', 'gtm-session-fetcher'].includes(pin.identity));
    assert.equal(resolved.pins.length, 3);
    assert.equal(stripBackendPins(JSON.stringify(resolved, null, 2)), null);
});

test('stripBackendPins leaves a file without backend pins as it is (originHash kept)', () => {
    const resolved = JSON.parse(read('Package.resolved'));
    resolved.pins = resolved.pins.filter((pin) => !BACKEND_PIN_IDENTITIES.has(pin.identity));
    const json = `${JSON.stringify({ originHash: 'abc', ...resolved }, null, 2).replace(/^(\s*"[^"]*"): /gm, '$1 : ')}\n`;
    assert.equal(stripBackendPins(json), json);
});

test('BACKEND_ONLY_IMPORTS matches the backend modules\' imports only', () => {
    const matches = (line) => BACKEND_ONLY_IMPORTS.some((re) => re.test(line));
    assert.ok(matches('import com.kturker.multiplatform.core.auth.CurrentActivity'));
    assert.ok(matches('import com.kturker.multiplatform.core.auth.di.AuthModule'));
    assert.ok(matches('import dev.cmpose.app.feature.account.presentation.di.AccountModule'));
    assert.ok(matches('import com.kturker.multiplatform.feature.sharing.presentation.di.SharingModule'));
    assert.ok(!matches('import com.kturker.multiplatform.core.network.di.NetworkModule'));
    assert.ok(!matches('import com.kturker.multiplatform.feature.accounting.Ledger'));
    assert.ok(!matches('import com.kturker.multiplatform.core.authz.Policy'));
    assert.ok(!matches('    import com.kturker.multiplatform.core.auth.X'));
});

test('BACKEND_PATHS are template-relative, unique, and never a shared module root', () => {
    assert.equal(new Set(BACKEND_PATHS).size, BACKEND_PATHS.length);
    for (const p of BACKEND_PATHS) {
        assert.ok(!p.startsWith('/') && !p.includes('..') && !p.includes('\\'), p);
    }
    for (const shared of ['core/network', 'core/image', 'core/multilang', 'shared', 'androidApp', 'iosApp', 'blank']) {
        assert.ok(!BACKEND_PATHS.includes(shared), shared);
    }
    assert.ok(!BACKEND_PATHS.some((p) => p.endsWith('ImageLoaderCustomizer.kt')));
    assert.ok(!BACKEND_PATHS.includes('LICENSE'));
});

// --- applyBackendOption on a small project tree ---

const PKG = 'com/kturker/multiplatform';
const PRIVACY = 'iosApp/iosApp/PrivacyInfo.xcprivacy';
const PRIVACY_TEXT = '<dict>\n    <!-- cmpose:backend -->\n    <key>x</key>\n    <!-- /cmpose:backend -->\n</dict>\n';

async function seedProject() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-'));
    const write = (relative, content) => fs.outputFile(path.join(dir, relative), content);
    await write(`shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`, read('MainScreen.kt'));
    await write('iosApp/iosApp/iOSApp.swift', read('iOSApp.swift'));
    await write('iosApp/iosApp/Info.plist', read('Info.plist'));
    await write('iosApp/iosApp.xcodeproj/project.pbxproj', read('project.pbxproj'));
    await write('iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved', read('Package.resolved'));
    await write('gradle/libs.versions.toml', read('libs.versions.toml'));
    await write('.gitignore', read('template.gitignore'));
    await write('iosApp/Configuration/Config.xcconfig', 'TEAM_ID=\n// cmpose:backend\n\nGOOGLE_REVERSED_CLIENT_ID=\n// /cmpose:backend\n\nCURRENT_PROJECT_VERSION=1\n');
    await write('README.md', '# App\n\n<!-- cmpose:backend -->\n## Local server\n\nRun it.\n<!-- /cmpose:backend -->\n\n## Modules\n');
    await write(PRIVACY, PRIVACY_TEXT);
    // Backend-only files and directories, and neighbours that stay
    await write('server/build.gradle.kts', 'plugins {}\n');
    await write(`core/auth/src/commonMain/kotlin/${PKG}/core/auth/AuthService.kt`, 'interface AuthService\n');
    await write(`feature/account/presentation/src/commonMain/kotlin/${PKG}/A.kt`, 'class A\n');
    await write('androidApp/src/debug/AndroidManifest.xml', '<manifest/>\n');
    await write('androidApp/src/main/AndroidManifest.xml', '<manifest/>\n');
    await write('iosApp/iosApp/SignInBridge.swift', 'class SignInBridge {}\n');
    await write(`core/network/src/commonMain/kotlin/${PKG}/core/network/BackendClient.kt`, 'val c = 1\n');
    await write(`core/network/src/commonMain/kotlin/${PKG}/core/network/NetworkModule.kt`, 'class NetworkModule\n');
    await write(`core/image/src/androidDeviceTest/kotlin/${PKG}/core/image/ImageNormalizationDeviceTest.kt`, 'class T\n');
    await write(`core/image/src/commonMain/kotlin/${PKG}/core/image/ImageLoaderCustomizer.kt`, 'interface ImageLoaderCustomizer\n');
    await write(`blank/layers/multilang/core/multilang/src/commonMain/kotlin/${PKG}/core/multilang/resource/AccountStrings.kt`, 'object A\n');
    await write('build-logic/README.md', '<!-- cmpose:backend -->\nx\n<!-- /cmpose:backend -->\n');
    await write('notes.txt', '// cmpose:backend\nnot a marked file kind\n');
    return dir;
}

const exists = (dir, relative) => fs.pathExistsSync(path.join(dir, relative));
const text = (dir, relative) => fs.readFileSync(path.join(dir, relative), 'utf8');

test('applyBackendOption(false) strips the backend from the tree', async (t) => {
    const dir = await seedProject();
    t.after(() => fs.remove(dir));
    await applyBackendOption(dir, false);

    for (const gone of ['server', 'core/auth', 'feature/account', 'androidApp/src/debug', 'iosApp/iosApp/SignInBridge.swift',
        `core/network/src/commonMain/kotlin/${PKG}/core/network/BackendClient.kt`,
        `blank/layers/multilang/core/multilang/src/commonMain/kotlin/${PKG}/core/multilang/resource/AccountStrings.kt`]) {
        assert.ok(!exists(dir, gone), `${gone} is still there`);
    }
    // Directories a deleted file leaves empty go too; feature/ keeps nothing but stays out of the way
    assert.ok(!exists(dir, 'core/image/src/androidDeviceTest'));
    assert.ok(!exists(dir, 'feature'));
    assert.ok(!exists(dir, 'blank'));
    for (const kept of ['androidApp/src/main/AndroidManifest.xml', `core/network/src/commonMain/kotlin/${PKG}/core/network/NetworkModule.kt`,
        `core/image/src/commonMain/kotlin/${PKG}/core/image/ImageLoaderCustomizer.kt`]) {
        assert.ok(exists(dir, kept), `${kept} is gone`);
    }

    const main = text(dir, `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`);
    assert.ok(!/cmpose:backend|core\.auth|feature\.account|feature\.sharing|rememberSessionStart|CurrentActivity/.test(main));
    assert.ok(main.includes('    val start: NavigationCommand.Destination = OnboardingDestination\n'));
    assert.ok(main.includes('import com.kturker.multiplatform.core.navigation.NavigationCommand\n'));
    assert.ok(main.includes('import com.kturker.multiplatform.feature.onboarding.contract.OnboardingDestination\n'));

    const swift = text(dir, 'iosApp/iosApp/iOSApp.swift');
    assert.ok(!/cmpose:backend|Firebase|GIDSignIn/.test(swift));
    assert.ok(swift.includes('.onOpenURL { url in _ = DeepLinksKt.handleDeepLink'));

    const plist = text(dir, 'iosApp/iosApp/Info.plist');
    assert.ok(!/cmpose:backend|LOCAL_SERVER|GOOGLE_REVERSED_CLIENT_ID/.test(plist));
    assert.ok(plist.includes('<string>multiplatform</string>'));

    assert.equal(text(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), PBXPROJ_WITHOUT_BACKEND);
    const pins = JSON.parse(text(dir, 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved')).pins;
    assert.deepEqual(pins.map((pin) => pin.identity),
        ['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform']);

    assert.ok(!text(dir, 'gradle/libs.versions.toml').includes('googleServices'));
    assert.equal(text(dir, '.gitignore'), 'local.properties\n.idea\n\n# Release signing\nkeystore.properties\n*.jks\n');
    assert.equal(text(dir, 'iosApp/Configuration/Config.xcconfig'), 'TEAM_ID=\n\nCURRENT_PROJECT_VERSION=1\n');
    assert.equal(text(dir, 'README.md'), '# App\n\n## Modules\n');

    // The privacy manifest's block is writePrivacyManifest's: untouched here
    assert.equal(text(dir, PRIVACY), PRIVACY_TEXT);
    // Any .md is walked, not only the root README
    assert.equal(text(dir, 'build-logic/README.md'), '');
    // Not a marked file kind
    assert.equal(text(dir, 'notes.txt'), '// cmpose:backend\nnot a marked file kind\n');
});

test('applyBackendOption(true) keeps the backend and drops only the markers', async (t) => {
    const dir = await seedProject();
    t.after(() => fs.remove(dir));
    await applyBackendOption(dir, true);

    for (const kept of ['server/build.gradle.kts', 'core/auth', 'feature/account', 'androidApp/src/debug/AndroidManifest.xml',
        'iosApp/iosApp/SignInBridge.swift', `core/network/src/commonMain/kotlin/${PKG}/core/network/BackendClient.kt`]) {
        assert.ok(exists(dir, kept), `${kept} is gone`);
    }
    const main = text(dir, `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`);
    assert.ok(!main.includes('cmpose:backend'));
    assert.ok(main.includes('import com.kturker.multiplatform.core.auth.CurrentActivity\n'));
    assert.ok(main.includes('    val start: NavigationCommand.Destination = rememberSessionStart(OnboardingDestination, navigationManager) ?: return\n'));
    assert.ok(main.includes('    CurrentActivity.touch()\n'));

    const plist = text(dir, 'iosApp/iosApp/Info.plist');
    assert.ok(!plist.includes('cmpose:backend'));
    assert.ok(plist.includes('<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>'));
    assert.ok(plist.includes('#if LOCAL_SERVER'));

    assert.equal(text(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), read('project.pbxproj'));
    assert.equal(text(dir, 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'), read('Package.resolved'));
    assert.equal(text(dir, 'iosApp/Configuration/Config.xcconfig'), 'TEAM_ID=\n\nGOOGLE_REVERSED_CLIENT_ID=\n\nCURRENT_PROJECT_VERSION=1\n');
    assert.ok(text(dir, '.gitignore').includes('androidApp/google-services.json\n'));
    assert.ok(!text(dir, '.gitignore').includes('cmpose:backend'));
    assert.equal(text(dir, PRIVACY), PRIVACY_TEXT);
});

test('applyBackendOption(false) deletes a Package.resolved left with no pin, and the directories it empties', async (t) => {
    const dir = await seedProject();
    t.after(() => fs.remove(dir));
    const resolvedPath = 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
    const resolved = JSON.parse(read('Package.resolved'));
    resolved.pins = resolved.pins.filter((pin) => pin.identity === 'firebase-ios-sdk');
    await fs.outputFile(path.join(dir, resolvedPath), JSON.stringify(resolved, null, 2));
    await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.xcworkspace/contents.xcworkspacedata'), '<Workspace/>\n');
    await applyBackendOption(dir, false);
    assert.ok(!exists(dir, resolvedPath));
    assert.ok(!exists(dir, 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata'));
    assert.ok(exists(dir, 'iosApp/iosApp.xcodeproj/project.xcworkspace/contents.xcworkspacedata'));
});

test('applyBackendOption names the file of a malformed marker', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-'));
    t.after(() => fs.remove(dir));
    await fs.outputFile(path.join(dir, 'shared/Broken.kt'), 'a\n// cmpose:backend\nb\n');
    await assert.rejects(applyBackendOption(dir, false), /shared[\\/]Broken\.kt: unclosed cmpose:backend block/);
    await assert.rejects(applyBackendOption(dir, true), /shared[\\/]Broken\.kt: unclosed cmpose:backend block/);
});

test('applyBackendOption(false) on a tree without the backend changes nothing', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-'));
    t.after(() => fs.remove(dir));
    await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), PBXPROJ_WITHOUT_BACKEND);
    await fs.outputFile(path.join(dir, 'shared/Main.kt'), 'import com.kturker.multiplatform.core.network.X\n');
    await applyBackendOption(dir, false);
    assert.equal(text(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'), PBXPROJ_WITHOUT_BACKEND);
    assert.equal(text(dir, 'shared/Main.kt'), 'import com.kturker.multiplatform.core.network.X\n');
});
