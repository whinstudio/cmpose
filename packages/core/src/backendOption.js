'use strict';
const fs = require('fs-extra');
const path = require('path');
const { removeSwiftPackage, removeSwiftPackageProduct, removeRunScriptPhase } = require('./xcodePackages');
const { PRIVACY_MANIFEST } = require('./privacyManifest');
const { removeMarkedBlocks, applySwapMarkers } = require('./markerBlocks');

// featuresConfig.backend: the template marks everything the backend adds (MAINTAINING.md → Backend markers).
// Off strips it, on keeps it and drops only the markers. Runs on the template package, before the rename.
// The Firebase setup the backend shares with insights (cmpose:firebase blocks, the firebase-ios-sdk package,
// its pins and the GoogleService-Info copy phase) stays while either is on.

const KIND_BY_EXTENSION = {
    '.kt': 'slash', '.kts': 'slash', '.swift': 'slash', '.xcconfig': 'slash',
    '.toml': 'hash', '.gitignore': 'hash', '.properties': 'hash', '.yml': 'hash', '.yaml': 'hash',
    '.md': 'html', '.xml': 'html', '.plist': 'html', '.xcprivacy': 'html'
};
const SKIP_DIRS = new Set(['.git', '.gradle', 'build', 'node_modules']);

// Template-relative paths the backend adds outside the files it marks; deleted when backend is off
const TEMPLATE_PACKAGE_PATH = 'com/kturker/multiplatform';
const BACKEND_PATHS = [
    // The template has no server/ of its own (it comes from the backend template); kept so a stale fetched copy goes too
    'server',
    'core/api',
    'core/auth',
    'feature/account',
    'feature/sharing',
    'androidApp/src/debug',
    'iosApp/iosApp/SignInBridge.swift',
    'iosApp/iosApp/iosApp.entitlements',
    `shared/src/iosMain/kotlin/${TEMPLATE_PACKAGE_PATH}/SignInRegistration.kt`,
    `shared/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/SessionGate.kt`,
    `shared/src/androidHostTest/kotlin/${TEMPLATE_PACKAGE_PATH}/MainScreenGateTest.kt`,
    `shared/src/androidHostTest/kotlin/${TEMPLATE_PACKAGE_PATH}/di/BackendBindingsTest.kt`,
    ...['BackendClient', 'BackendConfig', 'EmulatorDetection', 'LocalHost', 'TokenSource']
        .map((name) => `core/network/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/${name}.kt`),
    `core/network/src/androidMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/LocalHost.android.kt`,
    `core/network/src/iosMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/LocalHost.ios.kt`,
    ...['AuthenticatedClientTest', 'BackendConfigTest', 'EmulatorDetectionTest']
        .map((name) => `core/network/src/commonTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/${name}.kt`),
    `core/image/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalization.kt`,
    `core/image/src/androidMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalization.android.kt`,
    `core/image/src/iosMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalization.ios.kt`,
    `core/image/src/commonTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalizationTest.kt`,
    `core/image/src/androidDeviceTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalizationDeviceTest.kt`,
    ...['core/multilang', 'blank/layers/multilang/core/multilang'].flatMap((module) => ['AccountStrings', 'SharingStrings']
        .map((name) => `${module}/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/multilang/resource/${name}.kt`)),
    ...['SharedSpacesWarningTest', 'SharingStringsTest']
        .map((name) => `core/multilang/src/commonTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/multilang/resource/${name}.kt`)
];

// Imports the template leaves outside the markers (import ordering) that only marked code uses
const BACKEND_ONLY_IMPORTS = [
    /^import [\w.]+\.core\.auth\./,
    /^import [\w.]+\.feature\.account\./,
    /^import [\w.]+\.feature\.sharing\./
];
const IMPORT_FILE_KINDS = new Set(['.kt', '.kts', '.swift']);

const PBXPROJ = ['iosApp', 'iosApp.xcodeproj', 'project.pbxproj'];
const PACKAGE_RESOLVED = ['iosApp', 'iosApp.xcodeproj', 'project.xcworkspace', 'xcshareddata', 'swiftpm', 'Package.resolved'];
const FIREBASE_PACKAGE_URL = 'https://github.com/firebase/firebase-ios-sdk';
const GOOGLE_SIGN_IN_PACKAGE_URL = 'https://github.com/google/GoogleSignIn-iOS';
// The backend's product of the shared Firebase package
const BACKEND_FIREBASE_PRODUCT = 'FirebaseAuth';
const COPY_GOOGLE_SERVICE_PHASE = 'Copy GoogleService-Info if present';
const BACKEND_MEMBERSHIP_EXCEPTION = /^\t+iosApp\.entitlements,$/;
const FIREBASE_MEMBERSHIP_EXCEPTION = /^\t+"GoogleService-Info\.plist",$/;
const BACKEND_BUILD_SETTING = /^\t+(?:CODE_SIGN_ENTITLEMENTS|INFOPLIST_PREPROCESS|INFOPLIST_PREPROCESSOR_DEFINITIONS) = [^\n]*;$/;

// Firebase, GoogleSignIn and what they pull in; the template's other pins (GMA, UMP) stay
const BACKEND_PIN_IDENTITIES = new Set([
    'abseil-cpp-binary', 'app-check', 'appauth-ios', 'firebase-ios-sdk', 'google-ads-on-device-conversion-ios-sdk',
    'googleappmeasurement', 'googledatatransport', 'googlesignin-ios', 'googleutilities', 'grpc-binary',
    'gtm-session-fetcher', 'gtmappauth', 'interop-ios-for-google-sdks', 'leveldb', 'nanopb', 'promises', 'swift-protobuf'
]);
// What only GoogleSignIn pulls in: with the Firebase setup kept, only these go
const GOOGLE_SIGN_IN_PIN_IDENTITIES = new Set(['appauth-ios', 'googlesignin-ios', 'gtmappauth']);

// Off: the GoogleSignIn package, the membership exception of the entitlements, and the entitlements and
// Info.plist preprocessing (LOCAL_SERVER) build settings. Without `firebase` also the Firebase package, the
// build phase copying GoogleService-Info.plist and its membership exception; with it only FirebaseAuth of the
// Firebase package. Text edits only.
function stripBackendPbxproj(content, { firebase = false } = {}) {
    const crlf = content.includes('\r\n');
    let result = crlf ? content.replace(/\r\n/g, '\n') : content;
    result = removeSwiftPackage(result, GOOGLE_SIGN_IN_PACKAGE_URL);
    if (firebase) {
        result = removeSwiftPackageProduct(result, FIREBASE_PACKAGE_URL, BACKEND_FIREBASE_PRODUCT);
    } else {
        result = removeSwiftPackage(result, FIREBASE_PACKAGE_URL);
        result = removeCopyGoogleServicePhase(result);
    }
    result = result.split('\n')
        .filter((line) => !BACKEND_MEMBERSHIP_EXCEPTION.test(line) && !BACKEND_BUILD_SETTING.test(line)
            && (firebase || !FIREBASE_MEMBERSHIP_EXCEPTION.test(line)))
        .join('\n');
    if (!firebase && result.includes(COPY_GOOGLE_SERVICE_PHASE)) {
        throw new Error(`stripBackendPbxproj: "${COPY_GOOGLE_SERVICE_PHASE}" is in project.pbxproj but could not be removed (unexpected formatting)`);
    }
    return crlf ? result.replace(/\n/g, '\r\n') : result;
}

function removeCopyGoogleServicePhase(content) {
    return removeRunScriptPhase(content, COPY_GOOGLE_SERVICE_PHASE);
}

// Package.resolved without the pins whose identity is in `identities`, in Xcode's layout ("key" : value).
// originHash goes (Xcode recomputes it); null when no pin is left, so the caller deletes the file.
function stripPins(json, identities) {
    const resolved = JSON.parse(json);
    const pins = (resolved.pins || []).filter((pin) => !identities.has(pin.identity));
    if (pins.length === 0) return null;
    // Nothing to drop: the file stays as Xcode wrote it (originHash included)
    if (pins.length === (resolved.pins || []).length) return json;
    const { originHash, ...rest } = resolved;
    const text = JSON.stringify({ ...rest, pins }, null, 2).replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, '$1 : ');
    return `${text}\n`;
}

// Off: Package.resolved without the backend's pins (GoogleSignIn's only, with `firebase`)
function stripBackendPins(json, { firebase = false } = {}) {
    return stripPins(json, firebase ? GOOGLE_SIGN_IN_PIN_IDENTITIES : BACKEND_PIN_IDENTITIES);
}

function kindOf(file) {
    const name = path.basename(file);
    return KIND_BY_EXTENSION[name === '.gitignore' ? name : path.extname(name)];
}

async function listMarkableFiles(dir) {
    const files = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) files.push(...await listMarkableFiles(full));
        } else if (kindOf(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

// Removes a path, then the directories it leaves empty (never projectDir itself)
async function removeAndPrune(projectDir, target) {
    await fs.remove(target);
    let dir = path.dirname(target);
    while (dir.startsWith(projectDir + path.sep) && (await fs.pathExists(dir)) && (await fs.readdir(dir)).length === 0) {
        await fs.remove(dir);
        dir = path.dirname(dir);
    }
}

function renderFile(content, file, enabled, firebase) {
    const kind = kindOf(file);
    let out = content;
    if (kind === 'slash') out = applySwapMarkers(out, enabled);
    out = removeMarkedBlocks(out, kind, enabled);
    out = removeMarkedBlocks(out, kind, firebase, 'firebase');
    if (!enabled && IMPORT_FILE_KINDS.has(path.extname(file))) {
        out = out.split('\n').filter((line) => !BACKEND_ONLY_IMPORTS.some((re) => re.test(line))).join('\n');
    }
    return out;
}

// `option`: { enabled, firebase } (firebase = backend || insights; backend on implies it), or a boolean for
// both. The privacy manifest's cmpose:backend block belongs to writePrivacyManifest, so it is left alone here.
async function applyBackendOption(projectDir, option) {
    const enabled = typeof option === 'boolean' ? option : option.enabled === true;
    const firebase = enabled || (typeof option === 'object' && option.firebase === true);
    const root = path.resolve(projectDir);
    if (!enabled) {
        for (const relative of BACKEND_PATHS) {
            const target = path.join(root, ...relative.split('/'));
            if (await fs.pathExists(target)) await removeAndPrune(root, target);
        }
    }

    const privacyManifest = path.join(root, ...PRIVACY_MANIFEST);
    for (const file of await listMarkableFiles(root)) {
        if (file === privacyManifest) continue;
        const content = await fs.readFile(file, 'utf8');
        const marked = content.includes('cmpose:backend') || content.includes('cmpose:firebase');
        if (!marked && (enabled || !IMPORT_FILE_KINDS.has(path.extname(file)))) continue;
        let updated;
        try {
            updated = renderFile(content, file, enabled, firebase);
        } catch (error) {
            throw new Error(`${path.relative(root, file)}: ${error.message}`);
        }
        if (updated !== content) await fs.writeFile(file, updated);
    }

    if (enabled) return;

    const pbxproj = path.join(root, ...PBXPROJ);
    if (await fs.pathExists(pbxproj)) {
        const content = await fs.readFile(pbxproj, 'utf8');
        const updated = stripBackendPbxproj(content, { firebase });
        if (updated !== content) await fs.writeFile(pbxproj, updated);
    }

    const resolved = path.join(root, ...PACKAGE_RESOLVED);
    if (await fs.pathExists(resolved)) {
        const content = await fs.readFile(resolved, 'utf8');
        const updated = stripBackendPins(content, { firebase });
        if (updated === null) await removeAndPrune(root, resolved);
        else if (updated !== content) await fs.writeFile(resolved, updated);
    }
}

module.exports = {
    removeMarkedBlocks,
    applySwapMarkers,
    stripBackendPbxproj,
    stripBackendPins,
    stripPins,
    applyBackendOption,
    BACKEND_PATHS,
    BACKEND_ONLY_IMPORTS,
    BACKEND_PIN_IDENTITIES
};
