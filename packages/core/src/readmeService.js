const { log } = require('./log');
const fs = require('fs-extra');
const path = require('path');
const { INCLUDE_SERVER_BUILD, SERVER_DIR } = require('./serverFromBackend');

// The generated README's requirements table and module map. The template's README marks
// both sections (<!-- cmpose:requirements --> … <!-- /cmpose:requirements -->); a README without
// the markers (an older template) is left as it is.
const DASH = '—';

// One-line purpose of each core module the template ships; an unknown one gets no description
const CORE_DESCRIPTIONS = {
    about: 'app version, legal links and open source licences',
    database: 'DataStore preferences (saved theme and language)',
    designsystem: 'theme (palette, KtTheme) and shared UI components',
    domain: 'RestResult, DataError, BuildEnvironment and flow helpers',
    image: 'image loading (Coil 3): memory and disk cache, network images with the network module',
    logging: 'Kermit logging: every level in debug, warnings and errors in release',
    multilang: 'in-app language switching and string resources',
    navigation: 'type-safe navigation between feature modules',
    network: 'Ktor client, ApiConfig (base URLs), BaseRepository, ConnectivityMonitor',
    presentation: 'shared presentation helpers for ViewModels',
    purchases: 'RevenueCat in-app purchases (Test Store key)',
    review: 'in-app review (Play In-App Review, StoreKit) and the store page link',
    update: 'app updates: Play In-App Updates, the App Store lookup and an optional minimum version',
    ads: 'AdMob ads and consent (test IDs)',
    room: 'Room database (bundled SQLite): AppDatabase, DAOs and schemas',
    api: "the app's client models and routes for the backend API, checked by ApiContractTest",
    auth: "Firebase sign-in: email, Google, Apple; the server client's token"
};

function renderRequirements(versions, { minSdk, iosVersion }) {
    const row = (name, value) => `| ${name} | ${value || DASH} |`;
    const sdk = versions.compileSdk && versions.targetSdk ? `${versions.compileSdk} / ${versions.targetSdk}` : null;
    return [
        '| Requirement | Version |',
        '|---|---|',
        row('JDK', versions.jdk),
        row('Kotlin', versions.kotlin),
        row('Compose Multiplatform', versions.composeMultiplatform),
        row('Android Gradle Plugin', versions.agp),
        row('Gradle (wrapper)', versions.gradle),
        row('Android compileSdk / targetSdk', sdk),
        row('Android minSdk', minSdk),
        row('iOS minimum', iosVersion),
        row('Xcode', '16 or newer'),
        '',
        'iOS targets are arm64 only (`iosArm64`, `iosSimulatorArm64`): the simulator needs an Apple Silicon Mac.'
    ].join('\n');
}

// server/ is an included build (INCLUDE_SERVER_BUILD), not a module
const SERVER_LINE = '- `server/`: Ktor server from the cmpose backend template (an included build): sign-in check, spaces, sharing, files; '
    + '`./gradlew :server:runLocal`; deploying: `server/deploy/README.md`';

// serverDir: whether the project has server/ (the settings include it only when it is there)
function renderModules(settingsContent, { serverDir = false } = {}) {
    const paths = [...settingsContent.matchAll(/^\s*include\(([^)]*)\)/gm)]
        .flatMap((m) => [...m[1].matchAll(/"(:?[^"]+)"/g)].map((q) => q[1]))
        .map((p) => (p.startsWith(':') ? p : `:${p}`));
    const lines = [];
    if (paths.includes(':androidApp')) lines.push('- `:androidApp`: Android entry point (Application, Activity)');
    if (paths.includes(':shared')) {
        lines.push('- `:shared`: app shell: navigation graph, Koin start (`di/initKoin.kt`), the iOS framework');
    }
    for (const p of paths.filter((x) => /^:core:[^:]+$/.test(x)).sort()) {
        const name = p.split(':')[2];
        lines.push(CORE_DESCRIPTIONS[name] ? `- \`${p}\`: ${CORE_DESCRIPTIONS[name]}` : `- \`${p}\``);
    }
    const features = [...new Set(paths.filter((x) => x.startsWith(':feature:')).map((x) => x.split(':')[2]))].sort();
    for (const feature of features) {
        const layers = paths.filter((x) => x.startsWith(`:feature:${feature}:`)).map((x) => x.split(':')[3]).sort();
        lines.push(layers.length ? `- \`:feature:${feature}\`: ${layers.join(', ')}` : `- \`:feature:${feature}\``);
    }
    if (serverDir && INCLUDE_SERVER_BUILD.test(settingsContent)) lines.push(SERVER_LINE);
    return lines.join('\n');
}

function replaceBetweenMarkers(content, name, body) {
    const re = new RegExp(`(<!-- ${name} -->\\n)[\\s\\S]*?(\\n<!-- /${name} -->)`);
    return content.replace(re, (match, open, close) => `${open}${body}${close}`);
}

// Removes <!-- name --> … <!-- /name --> with its markers (a disabled monetization flag's README
// section), then collapses the blank lines left at that join to one (blank lines elsewhere stay);
// without the markers it is a no-op
function removeMarkedBlock(content, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(\\n*)<!-- ${escaped} -->[\\s\\S]*?<!-- /${escaped} -->(\\n*)`);
    if (!re.test(content)) return content;
    return content.replace(re, (match, before, after) => {
        const newlines = Math.max(before.length - 1, 0) + 1 + Math.max(after.length - 1, 0);
        return '\n'.repeat(Math.min(newlines, 2));
    });
}

// Returns true when the README had the markers and was rewritten
async function fillReadme(projectPath, { versions, minSdk, iosVersion }) {
    try {
        const readmePath = path.join(projectPath, 'README.md');
        if (!(await fs.pathExists(readmePath))) return false;
        const content = await fs.readFile(readmePath, 'utf8');
        if (!content.includes('<!-- cmpose:requirements -->') && !content.includes('<!-- cmpose:modules -->')) return false;
        const settings = await fs.readFile(path.join(projectPath, 'settings.gradle.kts'), 'utf8').catch(() => '');
        let updated = replaceBetweenMarkers(content, 'cmpose:requirements', renderRequirements(versions, { minSdk, iosVersion }));
        const serverDir = await fs.pathExists(path.join(projectPath, SERVER_DIR));
        updated = replaceBetweenMarkers(updated, 'cmpose:modules', renderModules(settings, { serverDir }));
        await fs.writeFile(readmePath, updated);
        return true;
    } catch (error) {
        log.warn('⚠️ README could not be filled:', error.message);
        return false;
    }
}

module.exports = { renderRequirements, renderModules, replaceBetweenMarkers, removeMarkedBlock, fillReadme };
