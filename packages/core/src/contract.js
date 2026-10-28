'use strict';
const crypto = require('crypto');
const PV = require('./ProjectValidator');
const LIMITS = require('./limits');
const { OLD_PACKAGE_NAME } = require('./templateIdentity');

// The one place the skill's contract comes from. Schema values moved here from the skill's
// sync-contract.sh; featuresConfig.js and the generator read the same objects.
const SCHEMA = {
    templateTypes: ['blank', 'showcase'],
    featuresConfigKeys: ['network', 'networkInspector', 'networkBaseUrl', 'theming', 'multiLang', 'dataStore', 'detekt', 'detektYamlContent', 'purchases', 'ads', 'room', 'backend', 'insights'],
    dependencyRules: {
        alwaysOn: ['koin', 'navigation'],
        implies: { networkInspector: ['network'], backend: ['multiLang', 'network'] },  // inspector => network; backend => multiLang + network
        auto: { dataStore: ['theming', 'multiLang'] }      // theming || multiLang => dataStore
    },
    // Top-level request options that apply to every template (featuresConfig is blank-only)
    projectOptions: {
        ci: { default: false, templates: ['blank', 'showcase'] }
    },
    // featuresConfig flag -> core modules it adds (for the anatomy preview tree).
    // `requires` = all must be true; `requiresAny` = at least one true.
    anatomy: {
        always: ['androidApp', 'iosApp', 'shared', 'core/about', 'core/domain', 'core/image', 'core/logging', 'core/presentation', 'core/navigation', 'core/review', 'core/update', 'build-logic'],
        alwaysNote: 'shared wires Koin (DI) + Navigation, which are always included; core/logging sets up Kermit logging, core/review asks for in-app reviews and core/about shows the version, legal links and licences in every project, core/update checks for app updates, core/image loads images with Coil.',
        coreModules: {
            'core/network': { requires: ['network'], note: 'Ktor HTTP client; Coil network images' },
            'core/designsystem': { requiresAny: ['theming', 'multiLang'], note: 'theme (palette + KtTheme) and/or LocalStringResources' },
            'core/multilang': { requires: ['multiLang'], note: 'i18n / localization' },
            'core/database': { requires: ['dataStore'], note: 'DataStore persistence; with theming also the saved Light/Dark/System choice (DarkModeManager)' },
            'core/purchases': { requires: ['purchases'], note: 'offer / purchase / restore API, RevenueCat KMP (Test Store key: replace before you ship)' },
            'core/ads': { requires: ['ads'], note: 'AdMob banner/interstitial/rewarded + UMP/ATT consent (test IDs)' },
            'core/room': { requires: ['room'], note: 'Room KMP database (bundled SQLite): AppDatabase, DAOs, schemas/' },
            'core/api': { requires: ['backend'], note: "the app's client models and routes for the backend API, checked by ApiContractTest" },
            'core/auth': { requires: ['backend'], note: 'Firebase sign-in (email, Google, Apple); the server client\'s token' },
            'core/insights': { requires: ['insights'], note: 'Firebase Crashlytics + Analytics; a no-op until the Firebase config files are added' }
        },
        // featuresConfig flag -> feature modules kept in a blank project (same requires/requiresAny rules).
        featureModules: {
            'feature/monetization': { requiresAny: ['purchases', 'ads'], note: 'custom paywall (Compose) and/or ads demo' },
            'feature/notes': { requires: ['room'], note: 'Notes demo screen on Room (blank only; showcase uses Room for favorites)' },
            'feature/account': { requires: ['backend'], note: 'sign-in screens and the account (blank only)' },
            'feature/sharing': { requires: ['backend'], note: 'shared spaces and invites (blank only)' }
        },
        detektDir: { requires: ['detekt'], path: 'detekt/' },
        // Ktor server (blank only): `./gradlew :server:runLocal` runs it locally
        serverDir: { path: 'server/', requires: ['backend'] },
        showcaseFeatures: ['feature/home', 'feature/monetization', 'feature/onboarding'],
        customFeaturePath: 'feature/<name>',
        customFeatureLayers: ['contract', 'data', 'domain', 'presentation']
    },
    // Deep links (<scheme>://<path>): the generator writes the scheme; '' opens the start screen and
    // '<module>' each generated feature module; backend adds the sharing invite (blank only)
    deepLinks: {
        scheme: 'projectName, lower case',
        showcase: ['user/{username}', 'settings'],
        blank: ['', '<module>'],
        backend: { links: ['invite/<token>'], requires: ['backend'] }
    }
};

function configureValidator(limits = LIMITS) {
    // The template's own package (and below) cannot be generated: the rename would hit itself
    PV.configure({
        minSdkMin: limits.minSdkMin, minSdkMax: limits.minSdkMax,
        iosVersionMin: limits.iosVersionMin, iosVersionMax: limits.iosVersionMax,
        maxModules: limits.maxModules,
        reservedPackagePrefix: OLD_PACKAGE_NAME
    });
}

configureValidator();

// serverLimits: the hosted generator's own facts (rate limit, body size); local generation has none
function contractFacts({ limits = LIMITS, serverLimits = null } = {}) {
    configureValidator(limits);
    return {
        limits: {
            minSdkMin: limits.minSdkMin,
            minSdkMax: limits.minSdkMax,
            iosVersionMin: limits.iosVersionMin,
            iosVersionMax: limits.iosVersionMax,
            maxModules: limits.maxModules,
            ...(serverLimits || {})
        },
        maxLengths: {
            projectName: PV.MAX_LENGTH_PROJECT_NAME,
            appName: PV.MAX_LENGTH_APP_NAME,
            packageName: PV.MAX_LENGTH_PACKAGE_NAME,
            moduleName: PV.MAX_LENGTH_MODULE_NAME,
            minSdk: PV.MAX_LENGTH_MIN_SDK,
            iosVersion: PV.MAX_LENGTH_IOS_VERSION,
            networkBaseUrl: PV.MAX_LENGTH_BASE_URL
        },
        regex: Object.fromEntries(Object.entries(PV.patterns).map(([k, re]) => [k, re.source])),
        kotlinHardKeywords: [...PV.KOTLIN_HARD_KEYWORDS],
        reservedModuleNames: [...PV.RESERVED_MODULE_NAMES],
        reservedPackagePrefix: OLD_PACKAGE_NAME,
        messages: { ...PV.messages },
        ...SCHEMA
    };
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
    }
    return value;
}

// Any product's contract: sha256 of the key-sorted JSON, first 12 hex characters
function hashContract(facts) {
    return crypto.createHash('sha256').update(JSON.stringify(stable(facts))).digest('hex').slice(0, 12);
}

module.exports = { SCHEMA, contractFacts, hashContract, configureValidator };
