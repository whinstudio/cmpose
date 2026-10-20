const fs = require('fs-extra');
const path = require('path');
const { listTextFiles } = require('./projectFiles');
const { removeSwiftPackage } = require('./xcodePackages');
const { stripPins } = require('./backendOption');
const { capitalize, TEST_SOURCE_SET_REGEX, BLANK_KEPT_TEST_DIRS } = require('./featureModules');
const { removeMarkedBlock } = require('./readmeService');
const { log } = require('./log');

// --- Escaping per target --------------------------------------------------------
// User values written with .replace() ALWAYS use a function replacement
// (`.replace(re, () => value)`): a string replacement expands `$&`, `$1`.

// XML text node (Android strings.xml): & < > " as XML entities; ' as \' for Android
function escapeXmlText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, "\\'");
}

// Contents of a Kotlin "..." string literal: \ " $
function escapeKotlinString(s) {
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, () => '\\$');
}

// ApiConfig.kt holds the base URL twice (DEBUG_BASE_URL, RELEASE_BASE_URL); the wizard's one
// field fills both, the developer changes the release one later.
function setApiBaseUrls(content, url) {
    return content.replace(
        /const val (DEBUG|RELEASE)_BASE_URL = "(?:[^"\\]|\\.)*"/g,
        (match, kind) => `const val ${kind}_BASE_URL = "${escapeKotlinString(url)}"`
    );
}

// The template's CI runs detekt as its own step; a project without detekt has no such task
function removeCiDetektStep(content) {
    return content.replace(/^ *- name: detekt\r?\n *run: \.\/gradlew detekt\r?\n/m, '');
}

// An xcconfig value is a single line: line breaks become spaces
function sanitizeXcconfigValue(s) {
    return String(s).replace(/\r\n|\r|\n/g, ' ');
}

// The xcconfig bundle id line is written in one pass (idempotent). It is the bare package: TEAM_ID only picks the
// signing team, and a template's older $(TEAM_ID) suffix goes with the rest of the line
function replaceXcconfigBundleId(content, newPackage) {
    return content.replace(
        /^PRODUCT_BUNDLE_IDENTIFIER\s*=.*$/gm,
        () => 'PRODUCT_BUNDLE_IDENTIFIER=' + newPackage
    );
}

// Escapes regex special characters so a string can be embedded literally in a RegExp
// (for user- or template-provided values such as key names or package names).
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The theme lives in these modules' `theme` package; Theming off removes it
const THEME_MODULES = ['designsystem', 'database'];
// The palette fields KtTheme (core/designsystem/.../theme/KtTheme.kt) maps to Material roles
const KT_THEME_PALETTE_FIELDS = ['backgroundColor', 'textBlack', 'textGray', 'tintBlack', 'textFieldUnFocusedBorder'];
// `val name: Color = ...` in the palette class, or `name = Color...` in a palette value
const PALETTE_FIELD_LINE = /^\s*(?:val\s+)?(\w+)(?::\s*Color)?\s*=\s*Color\b/;
// The network lines FeatureDataConventionPlugin.kt carries (the Ktor engines live in core/network)
const FEATURE_DATA_NETWORK_LINES = ['implementation(project(":core:network"))', 'implementation(libs.ktor.client.core.get())'];
// The template's monetization feature (purchases/ads): blank keeps it when either flag is on
const MONETIZATION_MODULE = 'monetization';
// The template's own feature modules blank keeps when their flag is on (feature/sample's clones are the user's)
const NOTES_MODULE = 'notes';
const NOTES_LAYERS = ['contract', 'presentation'];
const TEMPLATE_FEATURE_MODULES = {
    [MONETIZATION_MODULE]: (cfg) => cfg.purchases === true || cfg.ads === true,
    [NOTES_MODULE]: (cfg) => cfg.room === true,
    // The backend's sign-in gate (feature/account) and shared spaces (feature/sharing)
    account: (cfg) => cfg.backend === true,
    sharing: (cfg) => cfg.backend === true
};

// Deletes every test source set (src/*Test) of a Gradle module but those in BLANK_KEPT_TEST_DIRS; a missing src/ is fine
async function removeTestSourceSets(projectPath, moduleDir) {
    const srcDir = path.join(moduleDir, 'src');
    if (!(await fs.pathExists(srcDir))) return;
    for (const sourceSet of await fs.readdir(srcDir)) {
        const rel = `${path.relative(projectPath, srcDir).split(path.sep).join('/')}/${sourceSet}/`;
        if (TEST_SOURCE_SET_REGEX.test(rel) && !BLANK_KEPT_TEST_DIRS.includes(rel)) await fs.remove(path.join(srcDir, sourceSet));
    }
}

// Rewrites a file through transform when it exists; an unchanged file is not written
async function rewriteIfExists(file, transform) {
    if (!(await fs.pathExists(file))) return;
    const content = await fs.readFile(file, 'utf8');
    const updated = transform(content);
    if (updated !== content) await fs.writeFile(file, updated);
}

// Drops the lines of a file that match predicate; a missing file is fine
async function dropLines(file, predicate) {
    if (!(await fs.pathExists(file))) return;
    const content = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, content.split('\n').filter((line) => !predicate(line)).join('\n'));
}

// Ads off: the AdMob keys the template adds to iosApp/iosApp/Info.plist
function stripAdsInfoPlist(content) {
    return content
        .replace(/\n[ \t]*<key>GADApplicationIdentifier<\/key>\s*<string>[^<]*<\/string>/, '')
        .replace(/\n[ \t]*<key>NSUserTrackingUsageDescription<\/key>\s*<string>[^<]*<\/string>/, '')
        .replace(/\n[ \t]*<key>SKAdNetworkItems<\/key>\s*<array>[\s\S]*?\n[ \t]*<\/array>/, '');
}

// Ads off: the AdMob app ID meta-data (and its comment) in androidApp's AndroidManifest.xml
function stripAdsManifest(content) {
    return content
        .replace(/\n[ \t]*<!-- AdMob app ID:[^\n]*-->/, '')
        .replace(/\n[ \t]*<meta-data\s+android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[\s\S]*?\/>/, '');
}

// Ads off: the AdsBridge registration (comment + call) in iosApp/iosApp/iOSApp.swift
function stripAdsBridgeRegistration(content) {
    return content
        .replace(/\n[ \t]*\/\/ Google Mobile Ads lives in Swift[^\n]*/, '')
        .replace(/\n[ \t]*AdsBridgeRegistrationKt\.registerAdsBridge\([^\n]*/, '');
}

// Keeps the palette fields KtTheme uses, line by line, so no blank line or trailing comma is left
function simplifyPalette(content) {
    return content
        .split('\n')
        .filter((line) => {
            const match = line.match(PALETTE_FIELD_LINE);
            return !match || KT_THEME_PALETTE_FIELDS.includes(match[1]);
        })
        .join('\n')
        .replace(/,(\s*\))/g, '$1');
}

// Removes, from TOML content such as gradle/libs.versions.toml, ONLY the lines inside the given
// [section] whose key matches EXACTLY (^\s*<key>\s*=).
// There is NO substring matching, so convention-plugin alias lines derived from the user's
// package, such as `id = "<userPackage>.kmp.library"`, are never removed by mistake - even when
// the package name happens to contain "ktor"/"detekt"/...
// Pure function: reading and writing the file is the caller's job.
function removeTomlEntries(content, entries = {}) {
    const sectionKeys = {
        versions: entries.versions || [],
        libraries: entries.libraries || [],
        plugins: entries.plugins || [],
        bundles: entries.bundles || []
    };

    // Map: so headers such as `[constructor]`/`[__proto__]` do not resolve to Object.prototype
    const sectionRegexes = new Map();
    for (const sectionName of Object.keys(sectionKeys)) {
        sectionRegexes.set(sectionName, sectionKeys[sectionName].map(
            key => new RegExp('^\\s*' + escapeRegExp(key) + '\\s*=')
        ));
    }

    // Every [header] switches the section (`[ plugins ]`, `[plugins] # note` included); an unknown
    // section (`[metadata]`) does not inherit the previous section's keys, and none of its lines go.
    const sectionHeaderRegex = /^\s*\[\s*([^\]\s]+)\s*\]\s*(#.*)?$/;
    let currentSection = null;

    const newLines = content.split('\n').filter(line => {
        const headerMatch = line.match(sectionHeaderRegex);
        if (headerMatch) {
            currentSection = headerMatch[1];
            return true;
        }

        const regexes = sectionRegexes.get(currentSection);
        if (!regexes) return true;

        return !regexes.some(re => re.test(line));
    });

    return newLines.join('\n');
}

// Update a file's content
function replaceInContent(content, oldPackage, newPackage, oldProject, newProject, appName, sdkVersions) {
    let updated = content;

    if (oldPackage && newPackage) {
        updated = updated.replace(
            new RegExp(`package ${oldPackage.replace(/\./g, '\\.')}`, 'g'),
            () => `package ${newPackage}`
        );

        updated = updated.replace(
            new RegExp(`import ${oldPackage.replace(/\./g, '\\.')}`, 'g'),
            () => `import ${newPackage}`
        );

        updated = updated.replace(
            new RegExp(`"${oldPackage.replace(/\./g, '\\.')}"`, 'g'),
            () => `"${newPackage}"`
        );
        updated = updated.replace(
            new RegExp(`'${oldPackage.replace(/\./g, '\\.')}'`, 'g'),
            () => `'${newPackage}'`
        );

        const oldPackageEscaped = oldPackage.replace(/\./g, '\\.');
        updated = updated.replace(
            new RegExp(`(id = |apply\\()"${oldPackageEscaped}\\.`, 'g'),
            (match, prefix) => `${prefix}"${newPackage}.`
        );

        updated = updated.replace(
            new RegExp(`@ComponentScan\\("${oldPackageEscaped}([^"]*)"\\)`, 'g'),
            (match, rest) => `@ComponentScan("${newPackage}${rest}")`
        );
        updated = updated.replace(
            new RegExp(`@EntityScan\\("${oldPackageEscaped}([^"]*)"\\)`, 'g'),
            (match, rest) => `@EntityScan("${newPackage}${rest}")`
        );
        updated = updated.replace(
            new RegExp(`@EnableJpaRepositories\\("${oldPackageEscaped}([^"]*)"\\)`, 'g'),
            (match, rest) => `@EnableJpaRepositories("${newPackage}${rest}")`
        );

        updated = updated.replace(
            new RegExp(`"${oldPackageEscaped}\\.(\\$\\{moduleName\\}|\\$moduleName)"`, 'g'),
            (match, moduleRef) => `"${newPackage}.${moduleRef}"`
        );

        updated = updated.replace(
            new RegExp(`applicationId\\s*=\\s*"${oldPackageEscaped}"`, 'g'),
            () => `applicationId = "${newPackage}"`
        );

        // Any other mention of the package as a whole name (the server's main class and logger names, a
        // plugin id applied with id("..."), a KDoc link), bounded like the verifier's stale identifier rule
        updated = updated.replace(
            new RegExp(`(?<![A-Za-z0-9_.])${oldPackageEscaped}(?![A-Za-z0-9_])`, 'g'),
            () => newPackage
        );
    }

    if (oldProject && newProject) {
        updated = updated.replace(
            new RegExp(`rootProject\\.name\\s*=\\s*"${oldProject}"`, 'g'),
            () => `rootProject.name = "${newProject}"`
        );
        // core/logging: every log tag starts with the project's name (letters only, so no escaping)
        updated = updated.replace(
            new RegExp(`(\\bconst\\s+val\\s+LOG_TAG_PREFIX\\s*=\\s*)"${oldProject}"`, 'g'),
            (match, head) => `${head}"${newProject}"`
        );
        // Deep links: the app's scheme is the project's name in lower case (letters only, a valid scheme)
        const oldScheme = escapeRegExp(oldProject.toLowerCase());
        const newScheme = newProject.toLowerCase();
        updated = updated
            .replace(new RegExp(`(\\bconst\\s+val\\s+DEEP_LINK_SCHEME\\s*=\\s*)"${oldScheme}"`, 'g'), (m, head) => `${head}"${newScheme}"`)
            .replace(new RegExp(`(android:scheme=")${oldScheme}(")`, 'g'), (m, a, b) => `${a}${newScheme}${b}`)
            .replace(new RegExp(`(<key>CFBundleURLSchemes</key>\\s*<array>\\s*<string>)${oldScheme}(</string>)`, 'g'), (m, a, b) => `${a}${newScheme}${b}`)
            .replace(new RegExp(`(?<![A-Za-z0-9+.-])${oldScheme}://`, 'g'), () => `${newScheme}://`);
    }

    if (appName) {
        // Android strings.xml
        updated = updated.replace(
            /<string name="app_name">[^<]*<\/string>/g,
            () => `<string name="app_name">${escapeXmlText(appName)}</string>`
        );

        updated = updated.replace(
            /<key>CFBundleName<\/key>[\s\n]*<string>[^<]*<\/string>/g,
            () => `<key>CFBundleName</key>\n    <string>${appName}</string>`
        );

        updated = updated.replace(
            /<key>CFBundleDisplayName<\/key>[\s\n]*<string>[^<]*<\/string>/g,
            () => `<key>CFBundleDisplayName</key>\n    <string>${appName}</string>`
        );
    }

    if (newPackage) {
        updated = updated.replace(
            /<key>CFBundleIdentifier<\/key>[\s\n]*<string>[^<]*<\/string>/g,
            () => `<key>CFBundleIdentifier</key>\n    <string>${newPackage}</string>`
        );
    }

    // compileSdk/targetSdk stay as the template has them (AppConfig.kt is their only source)
    if (sdkVersions) {
        updated = updated.replace(
            /android-minSdk\s*=\s*"[0-9]+"/g,
            () => `android-minSdk = "${sdkVersions.minSdk}"`
        );
        updated = updated.replace(/minSdk\s*=\s*\d+/g, () => `minSdk = ${sdkVersions.minSdk}`);
    }

    if (sdkVersions && sdkVersions.iosVersion) {
        updated = updated.replace(
            /<key>MinimumOSVersion<\/key>[\s\n]*<string>[\d.]+<\/string>/g,
            () => `<key>MinimumOSVersion</key>\n    <string>${sdkVersions.iosVersion}</string>`
        );
    }

    if (newPackage) {
        updated = replaceXcconfigBundleId(updated, newPackage);
    }

    if (appName) {
        updated = updated.replace(
            /PRODUCT_NAME\s*=\s*[^\n]+/g,
            () => `PRODUCT_NAME=${sanitizeXcconfigValue(appName)}`
        );

        updated = updated.replace(
            /APP_NAME\s*=\s*[^\n]+/g,
            () => `APP_NAME = ${sanitizeXcconfigValue(appName)}`
        );
    }

    if (sdkVersions && sdkVersions.iosVersion) {
        updated = updated.replace(
            /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*[\d.]+/g,
            () => `IPHONEOS_DEPLOYMENT_TARGET = ${sdkVersions.iosVersion}`
        );
        updated = updated.replace(
            /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*[\d.]+;/g,
            () => `IPHONEOS_DEPLOYMENT_TARGET = ${sdkVersions.iosVersion};`
        );
    }

    return updated;
}

async function movePackageStructure(projectPath, oldPackage, newPackage) {
    if (!oldPackage || !newPackage || oldPackage === newPackage) return;

    const oldPath = oldPackage.replace(/\./g, '/');
    const newPath = newPackage.replace(/\./g, '/');

    log.info(`📦 Moving package structure: ${oldPath} → ${newPath}`);

    const modules = [];

    const rootItems = await fs.readdir(projectPath, { withFileTypes: true });
    for (const item of rootItems) {
        if (item.isDirectory() && !['build', 'gradle', '.gradle', '.idea', 'temp', 'uploads', 'node_modules'].includes(item.name)) {
            const buildGradle = path.join(projectPath, item.name, 'build.gradle.kts');
            if (await fs.pathExists(buildGradle)) {
                modules.push(item.name);
            }
        }
    }

    const featurePath = path.join(projectPath, 'feature');
    if (await fs.pathExists(featurePath)) {
        const featureItems = await fs.readdir(featurePath, { withFileTypes: true });
        for (const item of featureItems) {
            if (item.isDirectory() && !item.name.startsWith('.')) {
                const featureModuleSrc = path.join(featurePath, item.name, 'src');
                if (await fs.pathExists(featureModuleSrc)) {
                    modules.push(`feature/${item.name}`);
                }

                const subModulePath = path.join(featurePath, item.name);
                const subModules = await fs.readdir(subModulePath, { withFileTypes: true });
                for (const subModule of subModules) {
                    if (subModule.isDirectory() && !['build', '.gradle'].includes(subModule.name)) {
                        const subModuleSrc = path.join(subModulePath, subModule.name, 'src');
                        if (await fs.pathExists(subModuleSrc)) {
                            modules.push(`feature/${item.name}/${subModule.name}`);
                        }
                    }
                }
            }
        }
    }

    const corePath = path.join(projectPath, 'core');
    if (await fs.pathExists(corePath)) {
        const coreItems = await fs.readdir(corePath, { withFileTypes: true });
        for (const item of coreItems) {
            if (item.isDirectory() && !item.name.startsWith('.')) {
                modules.push(`core/${item.name}`);
            }
        }
    }

    for (const module of modules) {
        // Every source set (commonMain, androidHostTest, iosTest, main, ...), not a fixed list:
        // the template ships test sources too, and a source set left out keeps the
        // template package, which the generation verifier rejects.
        const srcPath = path.join(projectPath, module, 'src');
        if (!(await fs.pathExists(srcPath))) continue;

        const sourceSetDirs = await fs.readdir(srcPath, { withFileTypes: true });
        for (const sourceSetDir of sourceSetDirs) {
            if (!sourceSetDir.isDirectory()) continue;

            for (const language of ['kotlin', 'java']) {
                const fullSourcePath = path.join(srcPath, sourceSetDir.name, language);

                if (await fs.pathExists(fullSourcePath)) {
                    const oldFullPath = path.join(fullSourcePath, oldPath);

                    if (await fs.pathExists(oldFullPath)) {
                        const newFullPath = path.join(fullSourcePath, newPath);

                        await fs.ensureDir(path.dirname(newFullPath));
                        await fs.move(oldFullPath, newFullPath, { overwrite: true });
                        await cleanEmptyDirs(fullSourcePath);
                    }
                }
            }
        }
    }

    // Room writes each database's schema under <module>/schemas/<database class FQN>/ (core/room): the
    // directory name carries the package, so it moves with it
    for (const module of modules) {
        const schemasDir = path.join(projectPath, module, 'schemas');
        if (!(await fs.pathExists(schemasDir))) continue;
        for (const entry of await fs.readdir(schemasDir)) {
            if (entry.startsWith(`${oldPackage}.`)) {
                await fs.move(path.join(schemasDir, entry), path.join(schemasDir, newPackage + entry.slice(oldPackage.length)), { overwrite: true });
            }
        }
    }
}

async function cleanEmptyDirs(dir) {
    if (!await fs.pathExists(dir)) return;

    const items = await fs.readdir(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
            await cleanEmptyDirs(fullPath);
            const remaining = await fs.readdir(fullPath);
            if (remaining.length === 0) {
                await fs.rmdir(fullPath);
            }
        }
    }
}

async function cleanImlFiles(dir) {
    if (!await fs.pathExists(dir)) return;

    const items = await fs.readdir(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
            if (!['node_modules', 'uploads', 'temp'].includes(item)) {
                await cleanImlFiles(fullPath);
            }
        } else if (item.endsWith('.iml')) {
            await fs.remove(fullPath);
        }
    }
}

async function processAllFiles(dir, oldPackage, newPackage, oldProject, newProject, appName, sdkVersions, root = dir) {
    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
            if (!['build', '.gradle', 'gradle/wrapper'].includes(item.name)) {
                await processAllFiles(fullPath, oldPackage, newPackage, oldProject, newProject, appName, sdkVersions, root);
            }
        } else {
            const ext = path.extname(item.name);
            const textExtensions = [
                '.kt', '.java', '.xml', '.gradle', '.kts',
                '.properties', '.toml', '.md', '.plist', '.txt', '.swift', '.xcconfig'
            ];

            if (textExtensions.includes(ext) ||
                ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties'].includes(item.name)) {
                try {
                    const content = await fs.readFile(fullPath, 'utf8');
                    let updated = replaceInContent(
                        content,
                        oldPackage,
                        newPackage,
                        oldProject,
                        newProject,
                        appName,
                        sdkVersions
                    );

                    if (item.name === 'AppConfig.kt') {
                        updated = updateAppConfig(updated, newPackage, appName, sdkVersions);
                    }

                    if (content !== updated) {
                        await fs.writeFile(fullPath, updated, 'utf8');
                    }
                } catch (err) {
                    // EISDIR: a directory that looks like a file, skipped. Any other error fails the request
                    if (err.code !== 'EISDIR') {
                        // Path relative to the root: a project has ~20 build.gradle.kts files, the bare
                        // file name would not say which one.
                        const rel = path.relative(root, fullPath).split(path.sep).join('/');
                        throw new Error(`Could not process ${rel}: ${err.message}`);
                    }
                }
            }
        }
    }
}

function updateAppConfig(content, newPackage, appName, sdkVersions) {
    let updated = content;

    updated = updated.replace(
        /const val applicationId\s*=\s*"[^"]+"/g,
        () => `const val applicationId = "${newPackage}"`
    );

    if (appName) {
        updated = updated.replace(
            /const val appName\s*=\s*"[^"]+"/g,
            () => `const val appName = "${escapeKotlinString(appName)}"`
        );
    }

    updated = updated.replace(
        /const val minSdkVersion\s*=\s*\d+/g,
        () => `const val minSdkVersion = ${sdkVersions.minSdk}`
    );

    return updated;
}

async function updateiOSProject(projectPath, newPackage, iosVersion) {
    const iosProjectPath = path.join(projectPath, 'iosApp', 'iosApp.xcodeproj', 'project.pbxproj');

    if (await fs.pathExists(iosProjectPath)) {
        try {
            let content = await fs.readFile(iosProjectPath, 'utf8');
            let modified = false;

            if (newPackage) {
                content = content.replace(
                    /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*[^;]+;/g,
                    () => `PRODUCT_BUNDLE_IDENTIFIER = ${newPackage};`
                );
                modified = true;
            }

            if (iosVersion) {
                content = content.replace(
                    /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*[\d.]+;/g,
                    () => `IPHONEOS_DEPLOYMENT_TARGET = ${iosVersion};`
                );
                modified = true;
            }

            if (modified) {
                await fs.writeFile(iosProjectPath, content, 'utf8');
            }
        } catch (err) {
            throw new Error(`iOS Xcode project error: ${err.message}`);
        }
    }
}

// The shared scheme (xcshareddata) names the product; PRODUCT_NAME becomes the app name
function setSchemeBuildableName(content, productName) {
    const xml = String(productName).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return content.replace(/BuildableName = "[^"]*\.app"/g, () => `BuildableName = "${xml}.app"`);
}

async function updateiOSConfigFiles(projectPath, newPackage, appName, iosVersion) {
    if (appName) {
        // absent in older templates: skip silently
        const schemePath = path.join(projectPath, 'iosApp', 'iosApp.xcodeproj', 'xcshareddata', 'xcschemes', 'iosApp.xcscheme');
        if (await fs.pathExists(schemePath)) {
            const scheme = await fs.readFile(schemePath, 'utf8');
            const updatedScheme = setSchemeBuildableName(scheme, sanitizeXcconfigValue(appName));
            if (updatedScheme !== scheme) await fs.writeFile(schemePath, updatedScheme, 'utf8');
        }
    }
    const configPath = path.join(projectPath, 'iosApp', 'Configuration');

    if (await fs.pathExists(configPath)) {
        const configFiles = await fs.readdir(configPath);

        for (const file of configFiles) {
            if (file.endsWith('.xcconfig')) {
                const filePath = path.join(configPath, file);

                try {
                    let content = await fs.readFile(filePath, 'utf8');
                    let modified = false;

                    if (newPackage && content.includes('PRODUCT_BUNDLE_IDENTIFIER')) {
                        content = replaceXcconfigBundleId(content, newPackage);
                        modified = true;
                    }

                    if (appName && content.includes('PRODUCT_NAME')) {
                        content = content.replace(
                            /PRODUCT_NAME\s*=\s*[^\n]+/g,
                            () => `PRODUCT_NAME=${sanitizeXcconfigValue(appName)}`
                        );
                        modified = true;
                    }

                    if (appName && content.includes('APP_NAME')) {
                        content = content.replace(
                            /APP_NAME\s*=\s*[^\n]+/g,
                            () => `APP_NAME=${sanitizeXcconfigValue(appName)}`
                        );
                        modified = true;
                    }

                    if (iosVersion && content.includes('IPHONEOS_DEPLOYMENT_TARGET')) {
                        content = content.replace(
                            /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*[\d.]+/g,
                            () => `IPHONEOS_DEPLOYMENT_TARGET=${iosVersion}`
                        );
                        modified = true;
                    }

                    if (modified) {
                        await fs.writeFile(filePath, content, 'utf8');
                    }
                } catch (err) {
                    throw new Error(`${file}: ${err.message}`);
                }
            }
        }
    }
}

// ktlint's ImportOrdering (compass-kit's detekt, Compass's gate) with its default layout
// "*,java.**,javax.**,kotlin.**,^": lexicographic, then java, javax and kotlin, aliased imports last
const KTLINT_IMPORT_GROUPS = [/^import java\./, /^import javax\./, /^import kotlin\./];

function ktlintImportGroup(line) {
    if (/ as \S+\s*$/.test(line)) return KTLINT_IMPORT_GROUPS.length + 1;
    return KTLINT_IMPORT_GROUPS.findIndex((pattern) => pattern.test(line)) + 1;
}

function sortImportsLikeKtlint(importLines) {
    return [...importLines].sort((a, b) =>
        ktlintImportGroup(a) - ktlintImportGroup(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// Final pass: the package rename and module cloning move imports out of ktlint order, so re-sort
// every run of consecutive `import ` lines in the project's .kt files (build-logic is not scanned by
// detekt). Only import lines move; a file is rewritten only when its order changed.
// Returns the number of files rewritten.
const IMPORT_SORT_SKIP_DIRS = new Set(['build-logic', '.git', 'build', 'node_modules', '.gradle']);

async function sortKotlinImports(projectPath) {
    let changed = 0;
    const walk = async (dir) => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!IMPORT_SORT_SKIP_DIRS.has(entry.name)) await walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.kt')) {
                const content = await fs.readFile(full, 'utf8');
                const lines = content.split('\n');
                let touched = false;
                for (let i = 0; i < lines.length;) {
                    if (!lines[i].startsWith('import ')) { i++; continue; }
                    let end = i;
                    while (end < lines.length && lines[end].startsWith('import ')) end++;
                    const block = lines.slice(i, end);
                    const sorted = sortImportsLikeKtlint(block);
                    if (sorted.some((line, k) => line !== block[k])) {
                        lines.splice(i, block.length, ...sorted);
                        touched = true;
                    }
                    i = end;
                }
                if (touched) {
                    await fs.writeFile(full, lines.join('\n'));
                    changed++;
                }
            }
        }
    };
    await walk(projectPath);
    return changed;
}

const KOIN_LAYERS = ['presentation', 'data', 'domain'];
// The layers of a feature/sample clone
const MODULE_LAYERS = ['contract', 'data', 'domain', 'presentation'];

// Adds `import <pkg>.feature.<m>.<layer>.di.<Cap><Layer>Module` (sorted with the other imports)
// and `add(<Cap><Layer>Module().module)` after the last add( line, at its indentation, for each of
// koinLayers (default: all three).
async function registerKoinModules(initKoinPath, packageName, features, koinLayers = KOIN_LAYERS) {
    if (!(await fs.pathExists(initKoinPath))) return;
    let content = await fs.readFile(initKoinPath, 'utf8');

    const entries = [];
    for (const moduleName of features) {
        const className = capitalize(moduleName);
        for (const layer of koinLayers) {
            const koinModule = `${className}${capitalize(layer)}Module`;
            entries.push({
                importLine: `import ${packageName}.feature.${moduleName}.${layer}.di.${koinModule}`,
                statement: `add(${koinModule}().module)`
            });
        }
    }

    const lines = content.split('\n');
    const importLines = lines.filter((line) => line.startsWith('import '));
    for (const { importLine } of entries) {
        if (!importLines.includes(importLine)) importLines.push(importLine);
    }
    const otherLines = lines.filter((line) => !line.startsWith('import '));
    const packageIndex = otherLines.findIndex((line) => line.startsWith('package '));
    content = [
        ...otherLines.slice(0, packageIndex + 1),
        '',
        ...sortImportsLikeKtlint(importLines),
        ...otherLines.slice(packageIndex + 1)
    ].join('\n').replace(/\n{3,}/g, '\n\n');

    for (const { statement } of entries) {
        if (content.includes(statement)) continue;
        const lastAddIndex = content.lastIndexOf('add(');
        if (lastAddIndex === -1) throw new Error(`${path.basename(initKoinPath)}: no add(...) line to append Koin modules to`);
        const lineStart = content.lastIndexOf('\n', lastAddIndex) + 1;
        const lastAddIndent = content.slice(lineStart, lastAddIndex);
        const indent = /^[ \t]*$/.test(lastAddIndent) ? lastAddIndent : '    ';
        let endOfLastAdd = content.indexOf('\n', lastAddIndex);
        if (endOfLastAdd === -1) {
            content += '\n';
            endOfLastAdd = content.length - 1;
        }
        content = content.slice(0, endOfLastAdd + 1) + indent + statement + '\n' + content.slice(endOfLastAdd + 1);
    }

    await fs.writeFile(initKoinPath, content);
}

// Wires feature modules into shared, settings and initKoin, with the given layers (default: the
// four layers of a feature/sample clone; the Notes demo has two)
async function wireFeatureModules(projectPath, packageName, features, { layers = MODULE_LAYERS } = {}) {
    if (!features || features.length === 0) return;

    // Update shared/build.gradle.kts
    const sharedBuildGradle = path.join(projectPath, 'shared', 'build.gradle.kts');
    if (await fs.pathExists(sharedBuildGradle)) {
        let content = await fs.readFile(sharedBuildGradle, 'utf8');

        // Find commonMain.dependencies block
        const dependencyBlockRegex = /(commonMain\.dependencies\s*\{)([\s\S]*?)(\n\s{8}\})/;
        const match = content.match(dependencyBlockRegex);

        if (match) {
            const start = match[1];
            const body = match[2];
            const end = match[3];

            let dependencies = body.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            // Add new dependencies
            for (const moduleName of features) {
                for (const layer of layers) dependencies.push(`implementation(projects.feature.${moduleName}.${layer})`);
            }

            // Sort dependencies
            dependencies.sort();

            // Reconstruct block with correct indentation
            const newBody = dependencies.map(dep => `            ${dep}`).join('\n');

            content = content.replace(dependencyBlockRegex, () => `${start}\n${newBody}${end}`);
            await fs.writeFile(sharedBuildGradle, content);
        }
    }

    // Update settings.gradle.kts
    const settingsGradle = path.join(projectPath, 'settings.gradle.kts');
    if (await fs.pathExists(settingsGradle)) {
        let content = await fs.readFile(settingsGradle, 'utf8');

        const includes = [];
        const includeBuilds = [];

        // Regex to match include and includeBuild lines
        // Captures: 1=type (include/includeBuild), 2=content inside parens
        const lineRegex = /^\s*(include|includeBuild)\s*\((.*?)\).*$/gm;

        let match;
        while ((match = lineRegex.exec(content)) !== null) {
            const type = match[1];
            const lineContent = match[0].trim();

            if (type === 'include') {
                // Extract path and normalize
                const args = match[2].trim();
                // Remove quotes
                let pathStr = args.replace(/["']/g, '');
                if (!pathStr.startsWith(':')) {
                    pathStr = ':' + pathStr;
                }
                includes.push(`include("${pathStr}")`);
            } else if (type === 'includeBuild') {
                includeBuilds.push(lineContent);
            }
        }

        // Add new feature modules
        for (const moduleName of features) {
            includes.push(`include(":feature:${moduleName}")`);
            for (const layer of layers) includes.push(`include(":feature:${moduleName}:${layer}")`);
        }

        // Unique and Sort
        const uniqueIncludes = [...new Set(includes)].sort();
        const uniqueIncludeBuilds = [...new Set(includeBuilds)].sort();

        // Remove all existing include/includeBuild lines from content
        content = content.replace(lineRegex, '');

        // Clean up multiple empty lines
        content = content.replace(/\n\s*\n/g, '\n\n').trim();

        // Append sorted includes and includeBuilds
        // User requested includeBuilds at the bottom
        if (uniqueIncludes.length > 0) {
            content += '\n\n' + uniqueIncludes.join('\n');
        }

        if (uniqueIncludeBuilds.length > 0) {
            content += '\n\n' + uniqueIncludeBuilds.join('\n');
        }

        await fs.writeFile(settingsGradle, content);
    }

    // initKoin.kt: every module's presentation, data and domain Koin modules, those of its layers
    const packagePath = packageName.replace(/\./g, '/');
    await registerKoinModules(
        path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt'),
        packageName,
        features,
        KOIN_LAYERS.filter((layer) => layers.includes(layer))
    );
}

async function processBlankApp(projectPath, packageName, features, featuresConfig) {
    const packagePath = packageName.replace(/\./g, '/');
    const commonMainPath = path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath);

    // 0. Process Core Features (Network, etc.)
    if (featuresConfig) {
        await processCoreFeatures(projectPath, featuresConfig, packageName);
    }

    // 1. Cleanup Default Modules (Home & Onboarding)
    // ALWAYS drop the showcase's home/onboarding lines below. applyBlankShell already deleted their
    // directories, and the custom modules (cloned from feature/sample, even one named home) are wired
    // afterwards by wireFeatureModules

    // initKoin.kt
    const initKoinPath = path.join(commonMainPath, 'di', 'initKoin.kt');
    if (await fs.pathExists(initKoinPath)) {
        let content = await fs.readFile(initKoinPath, 'utf8');
        const modulesToRemove = [
            'OnboardingPresentationModule', 'OnboardingDataModule', 'OnboardingDomainModule',
            'HomeDataModule', 'HomeDomainModule', 'HomePresentationModule'
        ];

        const lines = content.split('\n');
        const newLines = lines.filter(line => !modulesToRemove.some(module => line.includes(module)));
        await fs.writeFile(initKoinPath, newLines.join('\n'));
    }

    // shared/build.gradle.kts
    const sharedBuildGradle = path.join(projectPath, 'shared', 'build.gradle.kts');
    if (await fs.pathExists(sharedBuildGradle)) {
        let content = await fs.readFile(sharedBuildGradle, 'utf8');
        const lines = content.split('\n');
        const newLines = lines.filter(line =>
            !line.includes('projects.feature.home') &&
            !line.includes('projects.feature.onboarding')
        );
        await fs.writeFile(sharedBuildGradle, newLines.join('\n'));
    }

    // settings.gradle.kts
    const settingsGradle = path.join(projectPath, 'settings.gradle.kts');
    if (await fs.pathExists(settingsGradle)) {
        let content = await fs.readFile(settingsGradle, 'utf8');
        const lines = content.split('\n');
        const newLines = lines.filter(line =>
            !line.includes('feature:home') &&
            !line.includes('feature:onboarding')
        );
        await fs.writeFile(settingsGradle, newLines.join('\n'));
    }

    // Cleanup Core DesignSystem (component and icon packages)
    const designSystemPath = path.join(projectPath, 'core', 'designsystem', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'designsystem');
    await fs.remove(path.join(designSystemPath, 'component'));
    await fs.remove(path.join(designSystemPath, 'icon'));
    log.info('✅ Cleaned up core/designsystem (component & icon)');

    // The template's own core tests (ThemeModeTest, ColorSchemeForTest, ...) stay in the showcase.
    // Compass counts every iOS test of a project as the agent's, so a blank app starts with none
    // (clones carry none either, see featureModules.js). The Android-host checks of BLANK_KEPT_TEST_DIRS stay:
    // shared's Koin graph check and, with the backend, core/api's contract test against server/.
    // The same goes for the layers of the template's own feature modules (monetization, notes, account, sharing).
    const testParents = [
        path.join(projectPath, 'core'),
        ...Object.keys(TEMPLATE_FEATURE_MODULES).map((module) => path.join(projectPath, 'feature', module))
    ];
    for (const parentDir of testParents) {
        if (!(await fs.pathExists(parentDir))) continue;
        for (const moduleName of await fs.readdir(parentDir)) {
            await removeTestSourceSets(projectPath, path.join(parentDir, moduleName));
        }
    }

    // Remove DesignSystem module entirely if neither theming nor multilanguage is selected
    if (featuresConfig && featuresConfig.theming !== true && featuresConfig.multiLang !== true) {
        log.info('🧹 Removing DesignSystem module (not needed without Theming/MultiLanguage)...');

        // NOTE: The template's shared/build.gradle.kts depends on :core:designsystem with
        // implementation(projects.core.designsystem) (no iOS export since B); step 3 below strips it.

        // 1. Remove from FeaturePresentationConventionPlugin.kt
        const featurePluginPath = path.join(projectPath, 'build-logic', 'src', 'main', 'kotlin', 'convention', 'FeaturePresentationConventionPlugin.kt');
        if (await fs.pathExists(featurePluginPath)) {
            let content = await fs.readFile(featurePluginPath, 'utf8');
            content = content.replace(/^\s*implementation\(project\(":core:designsystem"\)\)\s*$/gm, '');
            content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
            await fs.writeFile(featurePluginPath, content);
            log.info('✅ Cleaned FeaturePresentationConventionPlugin.kt');
        }

        // 3. Remove from shared/build.gradle.kts
        const sharedBuildGradle = path.join(projectPath, 'shared', 'build.gradle.kts');
        if (await fs.pathExists(sharedBuildGradle)) {
            let content = await fs.readFile(sharedBuildGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('projects.core.designsystem'));
            await fs.writeFile(sharedBuildGradle, newLines.join('\n'));
            log.info('✅ Cleaned shared/build.gradle.kts');
        }

        // 4. Remove from initKoin.kt
        const initKoinPath = path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt');
        if (await fs.pathExists(initKoinPath)) {
            let content = await fs.readFile(initKoinPath, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('DesignSystemModule'));
            await fs.writeFile(initKoinPath, newLines.join('\n'));
            log.info('✅ Cleaned initKoin.kt (removed DesignSystemModule)');
        }

        // 5. Remove from settings.gradle.kts
        const settingsGradle = path.join(projectPath, 'settings.gradle.kts');
        if (await fs.pathExists(settingsGradle)) {
            let content = await fs.readFile(settingsGradle, 'utf8');
            content = content.replace(/include\(":core:designsystem"\)\s*/g, '');
            await fs.writeFile(settingsGradle, content);
            log.info('✅ Cleaned settings.gradle.kts');
        }

        // 6. Delete core/designsystem folder
        const designSystemDir = path.join(projectPath, 'core', 'designsystem');
        await fs.remove(designSystemDir);
        log.info('✅ Deleted core/designsystem folder');
    }

    // Blank + Theming: the palette keeps the colours KtTheme maps to Material roles (B)
    if (featuresConfig && featuresConfig.theming === true) {
        const customColorsPalettePath = path.join(designSystemPath, 'theme', 'CustomColorsPalette.kt');
        if (await fs.pathExists(customColorsPalettePath)) {
            const content = await fs.readFile(customColorsPalettePath, 'utf8');
            await fs.writeFile(customColorsPalettePath, simplifyPalette(content));
            log.info('✅ Simplified CustomColorsPalette.kt for Blank App');
        }
    }

    // 2. No custom modules: feature/ keeps only the template's own modules whose flag is on
    // (monetization, notes), otherwise there is no feature/ directory at all (the shell's
    // MainScreen and every module come from the template - see featureModules.js)
    if (!features || features.length === 0) {
        const keep = Object.keys(TEMPLATE_FEATURE_MODULES)
            .filter((module) => featuresConfig && TEMPLATE_FEATURE_MODULES[module](featuresConfig));
        const featureDir = path.join(projectPath, 'feature');
        if (keep.length === 0) {
            await fs.remove(featureDir);
        } else if (await fs.pathExists(featureDir)) {
            for (const entry of await fs.readdir(featureDir)) {
                if (!keep.includes(entry)) await fs.remove(path.join(featureDir, entry));
            }
        }
    }

    // 3. Room on: the Notes demo is wired like a custom module, with its two layers (the template's
    // shared module does not depend on it: its database has no NoteDao, see blank/layers/room)
    if (featuresConfig && featuresConfig.room === true) {
        await wireFeatureModules(projectPath, packageName, [NOTES_MODULE], { layers: NOTES_LAYERS });
    }
}


// In the current template the monitor lives in these three files of core/network (source set → file)
const MONITOR_HELPER_FILES = [
    ['commonMain', 'NetworkMonitor.kt'],
    ['androidMain', 'NetworkMonitor.android.kt'],
    ['iosMain', 'NetworkMonitor.ios.kt']
];

// Once the monitor is removed no residue may remain; if an anchor is missed, the request fails
// instead of returning a project that does not compile. Because user input (package/project/app
// name) can contain the tokens (e.g. package com.kturker.networkmonitor.app, project name
// MonitorLogging; appName - ProjectValidator.js: /^[\p{L}\p{M}\p{N} ._'-]+$/u, ≤30 characters
// - allows dots/hyphens/underscores/mixed case, e.g. "libs.networkMonitor" or
// "Tools -lsqlite3" is a valid appName), broad tokens are searched only in the files the block
// edits; across the whole project only tokens input cannot produce are searched - each must carry
// a character an appName cannot contain (':' '(' '{') or be longer than 30 characters. The file list
// comes from listTextFiles in projectFiles.js (Node 16-compatible; no recursive readdir).
const MONITOR_TREE_STRING_TOKENS = ['com.kturker:networkmonitor', 'com.kturker.networkmonitor.MonitorLogging'];
// Catches the `implementation(libs.networkMonitor.debug)` and `${libs.versions.networkMonitor.get()}`
// forms. An appName cannot produce it: a '(' or '{' must come right before it, and an appName cannot
// contain those characters (only letters/digits/space/. _ ' -).
const MONITOR_TREE_GRADLE_REF = /[({]libs\.(?:versions\.)?networkMonitor\b/;

function monitorResidueRules(packagePath) {
    const gradleTokens = ['libs.networkMonitor', 'libs.versions.networkMonitor', 'networkmonitor-noop'];
    return [
        { file: ['androidApp', 'src', 'main', 'kotlin', packagePath, 'MainActivity.kt'], tokens: ['requestNotificationPermission', 'POST_NOTIFICATIONS', 'NOTIFICATION_PERMISSION_REQUEST_CODE'] },
        { file: ['androidApp', 'src', 'main', 'AndroidManifest.xml'], tokens: ['POST_NOTIFICATIONS'] },
        { file: ['core', 'network', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'network', 'di', 'NetworkModule.kt'], tokens: ['MonitorLogging', 'installNetworkMonitor'] },
        { file: ['iosApp', 'iosApp', 'ContentView.swift'], tokens: ['requestNotificationPermission', 'import UserNotifications'] },
        { file: ['iosApp', 'iosApp', 'Info.plist'], tokens: ['NSUserNotificationUsageDescription'] },
        // Config.xcconfig carries user input (PRODUCT_NAME/APP_NAME <- appName): a bare '-lsqlite3'
        // substring would be a false positive for a valid appName such as "Tools -lsqlite3" (see
        // above). Only an OTHER_LDFLAGS line that still links sqlite is residue.
        { file: ['iosApp', 'Configuration', 'Config.xcconfig'], tokens: [], patterns: [{ regex: /^\s*OTHER_LDFLAGS\s*=.*-lsqlite3/m, label: '-lsqlite3' }] },
        { file: ['core', 'network', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'network', 'BackendClient.kt'], tokens: ['installNetworkMonitor'] },
        { file: ['core', 'network', 'build.gradle.kts'], tokens: [...gradleTokens, '-lsqlite3'] },
        { file: ['androidApp', 'build.gradle.kts'], tokens: gradleTokens }
    ];
}

async function assertNoNetworkMonitorResidue(projectPath, packageName) {
    const packagePath = packageName.replace(/\./g, '/');
    const problems = new Set();

    for (const rule of monitorResidueRules(packagePath)) {
        const file = path.join(projectPath, ...rule.file);
        if (!(await fs.pathExists(file))) continue;
        const content = await fs.readFile(file, 'utf8');
        for (const token of rule.tokens) {
            if (content.includes(token)) problems.add(`${path.relative(projectPath, file)}: ${token}`);
        }
        for (const pattern of rule.patterns || []) {
            if (pattern.regex.test(content)) problems.add(`${path.relative(projectPath, file)}: ${pattern.label}`);
        }
    }

    const tomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
    if (await fs.pathExists(tomlPath) && /^\s*networkMonitor(?:-debug|-release)?\s*=/m.test(await fs.readFile(tomlPath, 'utf8'))) {
        problems.add('gradle/libs.versions.toml: networkMonitor key');
    }

    for (const [sourceSet, fileName] of MONITOR_HELPER_FILES) {
        const file = path.join(projectPath, 'core', 'network', 'src', sourceSet, 'kotlin', packagePath, 'core', 'network', fileName);
        if (await fs.pathExists(file)) problems.add(`${path.relative(projectPath, file)}: file still present`);
    }

    for (const file of await listTextFiles(projectPath)) {
        const content = await fs.readFile(file, 'utf8');
        for (const token of MONITOR_TREE_STRING_TOKENS) {
            if (content.includes(token)) problems.add(`${path.relative(projectPath, file)}: ${token}`);
        }
        if (MONITOR_TREE_GRADLE_REF.test(content)) {
            problems.add(`${path.relative(projectPath, file)}: libs.networkMonitor reference`);
        }
    }

    if (problems.size > 0) {
        throw new Error(`Network monitor residue after removal:\n  ${[...problems].join('\n  ')}`);
    }
}

// Network off: no Ktor or core:network reference may stay in a build script or the catalog. Only .kts
// and .toml are scanned: user input (appName, which may contain dots) lands in .kt/.xml/.plist files,
// never in these (rootProject.name is letters only).
const NETWORK_RESIDUE_KTS = [
    { regex: /\blibs\.ktor\./, label: 'libs.ktor.' },
    { regex: /\bprojects\.core\.network(?![A-Za-z0-9])/, label: 'projects.core.network' },
    { regex: /"(?::)?core:network(?=[:"])/, label: '":core:network"' },
    { regex: /\blibs\.coil\.network\b/, label: 'libs.coil.network' }
];
const NETWORK_RESIDUE_TOML = /^\s*(?:ktorClientCore|ktor-[A-Za-z0-9-]+|coil-network-[A-Za-z0-9-]+)\s*=/m;

async function assertNoNetworkResidue(projectPath) {
    const tomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
    const problems = [];
    for (const file of await listTextFiles(projectPath)) {
        if (file.endsWith('.kts')) {
            const content = await fs.readFile(file, 'utf8');
            for (const { regex, label } of NETWORK_RESIDUE_KTS) {
                if (regex.test(content)) problems.push(`${path.relative(projectPath, file)}: ${label}`);
            }
        } else if (file === tomlPath && NETWORK_RESIDUE_TOML.test(await fs.readFile(file, 'utf8'))) {
            problems.push(`${path.relative(projectPath, file)}: ktor key`);
        }
    }

    if (problems.length > 0) {
        throw new Error(`Network residue after removal:\n  ${problems.join('\n  ')}`);
    }
}

// Monetization: the tokens a disabled flag must leave nowhere in the project. By default a token is
// looked for in code files only (.kt/.kts/.toml/.swift): user input that could spell a token (appName
// in strings.xml, Info.plist, Config.xcconfig; the base URL; detekt.yml) never lands there. Three more
// inputs do and are taken out before the check: the project name (rootProject.name, core/logging's
// LOG_TAG_PREFIX and the deep link scheme (the project name in lower case): DEEP_LINK_SCHEME and the
// manifest's android:scheme), the app name (the AppConfig.appName line; e.g. PaywallDestination) and the package
// (see maskOwnPackage).
// A token with `extensions` is looked for in those files instead (the ads keys in Info.plist,
// AndroidManifest.xml and project.pbxproj): such a token is markup user input cannot spell there
// (the app name is XML-escaped, a bundle id has no quotes or spaces).
const MONETIZATION_RESIDUE_EXTENSIONS = new Set(['.kt', '.kts', '.toml', '.swift']);
const USER_INPUT_LINES = [
    /^\s*rootProject\.name\s*=/,
    /^\s*(?:const\s+)?val\s+appName\s*=/,
    /^\s*(?:internal\s+)?const\s+val\s+LOG_TAG_PREFIX\s*=/,
    /^\s*(?:internal\s+)?const\s+val\s+DEEP_LINK_SCHEME\s*=/,
    /android:scheme="/
];

// Module references bounded on the right, so a custom module such as monetizationx or monetization2
// (valid names: only monetization itself is reserved) never matches; settings includes with or
// without the leading colon (both spellings are in the template)
const CORE_PURCHASES_INCLUDE = /"(?::)?core:purchases(?=[:"])/;
const CORE_PURCHASES_ACCESSOR = /\bprojects\.core\.purchases(?![A-Za-z0-9])/;
const CORE_ADS_INCLUDE = /"(?::)?core:ads(?=[:"])/;
const CORE_ADS_ACCESSOR = /\bprojects\.core\.ads(?![A-Za-z0-9])/;
const FEATURE_MONETIZATION_INCLUDE = /"(?::)?feature:monetization(?=[:"])/;
const FEATURE_MONETIZATION_ACCESSOR = /\bprojects\.feature\.monetization(?![A-Za-z0-9])/;
// Room (core/room) and its Notes demo (feature/notes), bounded the same way (notes is reserved, room is not)
const CORE_ROOM_INCLUDE = /"(?::)?core:room(?=[:"])/;
const CORE_ROOM_ACCESSOR = /\bprojects\.core\.room(?![A-Za-z0-9])/;
const FEATURE_NOTES_INCLUDE = /"(?::)?feature:notes(?=[:"])/;
const FEATURE_NOTES_ACCESSOR = /\bprojects\.feature\.notes(?![A-Za-z0-9])/;
const ROOM_PLUGIN_ALIAS = /\balias\(libs\.plugins\.room\)/;

// The Google Mobile Ads Swift package (iosApp/iosApp.xcodeproj); the template's repositoryURL ends in
// .git, removeSwiftPackage matches it either way
const GMA_PACKAGE_URL = 'https://github.com/googleads/swift-package-manager-google-mobile-ads';
const PACKAGE_RESOLVED = ['iosApp', 'iosApp.xcodeproj', 'project.xcworkspace', 'xcshareddata', 'swiftpm', 'Package.resolved'];
// The pins the GMA package brings into Package.resolved (the Google Mobile Ads SDK and UMP)
const ADS_PIN_IDENTITIES = new Set(['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform']);

const PLIST = new Set(['.plist']);
const XML = new Set(['.xml']);
const PBXPROJ = new Set(['.pbxproj']);

// The template's own monetization class names. Custom modules are clones of feature/sample whose
// classes are named after the module (paywall -> PaywallDestination in Screens.kt, PaywallEntry.kt),
// so inside feature/<custom module>/ a class token is matched with the module's own class names
// (its capitalised name followed by more of the identifier) taken out (review M3). Another module's
// monetization class (AdsDemoDestination in feature/shop) and everything else (imports, module
// references, libs) are still seen there.
const classToken = (name, regex = new RegExp(name)) => ({ regex, label: name, classToken: true });

// A Swift import of a module, attributed or kind-qualified (import class Module.Symbol)
function swiftImport(module) {
    return new RegExp(`^\\s*(?:@\\w+\\s+)*import\\s+(?:(?:struct|class|enum|protocol|typealias|func|var|let)\\s+)?${module}\\b`, 'm');
}

// A token is a plain substring or { regex, label[, extensions][, classToken] } (regex without the g flag)
const MONETIZATION_RESIDUE_TOKENS = {
    purchases: [
        'com.revenuecat', 'libs.revenuecat',
        classToken('PurchasesManager'), classToken('PaywallDestination'), classToken('PurchasesKeys'),
        classToken('FirstLaunchPaywall', /\bFirstLaunchPaywall\b/), classToken('FirstPaywallStore', /\bFirstPaywallStore\b/),
        classToken('PurchasesModule', /\bPurchasesModule\b/),
        { regex: CORE_PURCHASES_INCLUDE, label: '":core:purchases"' },
        { regex: CORE_PURCHASES_ACCESSOR, label: 'projects.core.purchases' }
    ],
    ads: [
        classToken('IosAdsBridge'), classToken('AdsBridgeRegistrationKt'), classToken('registerAdsBridge'),
        classToken('AdsDemoDestination'),
        classToken('InterstitialPacer', /\bInterstitialPacer\b/),
        { regex: /com\.google\.android\.gms:play-services-ads(?![A-Za-z0-9-])/, label: 'com.google.android.gms:play-services-ads' },
        { regex: /com\.google\.android\.ump:user-messaging-platform(?![A-Za-z0-9-])/, label: 'com.google.android.ump:user-messaging-platform' },
        { regex: /com\.google\.android\.libraries\.ads\.mobile\.sdk:ads-mobile-sdk(?![A-Za-z0-9-])/, label: 'com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk' },
        { regex: /^\s*import\s+com\.google\.android\.libraries\.ads\.mobile\.sdk(?![A-Za-z0-9_])/m, label: 'import com.google.android.libraries.ads.mobile.sdk' },
        { regex: /\blibs\.adsMobileSdk(?![A-Za-z0-9])/, label: 'libs.adsMobileSdk' },
        { regex: /\blibs\.playServicesAds(?![A-Za-z0-9])/, label: 'libs.playServicesAds' },
        { regex: /\blibs\.ump(?![A-Za-z0-9])/, label: 'libs.ump' },
        // core/ads depends on a current WorkManager directly (the ads SDK's old one breaks under R8);
        // nothing else in the template uses it
        { regex: /androidx\.work:work-runtime(?![A-Za-z0-9-])/, label: 'androidx.work:work-runtime' },
        { regex: /\blibs\.androidx\.work(?![A-Za-z0-9])/, label: 'libs.androidx.work' },
        // Attributed (@preconcurrency import GoogleMobileAds) and kind-qualified imports too
        // (import struct GoogleMobileAds.BannerView)
        { regex: swiftImport('GoogleMobileAds'), label: 'import GoogleMobileAds' },
        { regex: swiftImport('UserMessagingPlatform'), label: 'import UserMessagingPlatform' },
        { regex: CORE_ADS_INCLUDE, label: '":core:ads"' },
        { regex: CORE_ADS_ACCESSOR, label: 'projects.core.ads' },
        { regex: /<key>GADApplicationIdentifier<\/key>/, label: 'GADApplicationIdentifier', extensions: PLIST },
        { regex: /<key>SKAdNetworkItems<\/key>/, label: 'SKAdNetworkItems', extensions: PLIST },
        { regex: /<key>NSUserTrackingUsageDescription<\/key>/, label: 'NSUserTrackingUsageDescription', extensions: PLIST },
        // As any attribute value, in either quotes and attribute order (not as element text: an app name);
        // XML comments are taken out before the scan, so a commented-out meta-data is not residue
        { regex: /=\s*(["'])com\.google\.android\.gms\.ads\.APPLICATION_ID\1/, label: 'com.google.android.gms.ads.APPLICATION_ID', extensions: XML },
        // Anywhere in the pbxproj: the reference, its comments or a lone repositoryURL line
        { regex: /swift-package-manager-google-mobile-ads/, label: 'swift-package-manager-google-mobile-ads', extensions: PBXPROJ },
        { regex: /\bproductName = GoogleMobileAds;/, label: 'GoogleMobileAds', extensions: PBXPROJ }
    ],
    // The feature/monetization module itself: looked for only when both flags are off
    monetization: [
        { regex: FEATURE_MONETIZATION_INCLUDE, label: '":feature:monetization"' },
        { regex: FEATURE_MONETIZATION_ACCESSOR, label: 'projects.feature.monetization' },
        classToken('MonetizationPresentationModule', /\bMonetizationPresentationModule\b/)
    ]
};

// Files a disabled flag must leave nowhere (paths relative to the project; packagePath = pkg/as/dirs)
const MONETIZATION_RESIDUE_FILES = {
    purchases: () => [],
    ads: (packagePath) => [
        path.join('shared', 'src', 'iosMain', 'kotlin', packagePath, 'AdsBridgeRegistration.kt'),
        path.join('iosApp', 'iosApp', 'AdsBridge.swift')
    ],
    monetization: () => []
};

// Room off: the tokens core/room and feature/notes must leave nowhere (code files only, as above)
const ROOM_RESIDUE_TOKENS = [
    { regex: /\bandroidx\.room(?![A-Za-z0-9_])/, label: 'androidx.room' },
    { regex: /\bandroidx\.sqlite(?![A-Za-z0-9_])/, label: 'androidx.sqlite' },
    { regex: /\blibs\.androidx\.room(?![A-Za-z0-9])/, label: 'libs.androidx.room' },
    { regex: /\blibs\.androidx\.sqlite(?![A-Za-z0-9])/, label: 'libs.androidx.sqlite' },
    { regex: /\blibs\.plugins\.room(?![A-Za-z0-9])/, label: 'libs.plugins.room' },
    { regex: CORE_ROOM_INCLUDE, label: '":core:room"' },
    { regex: CORE_ROOM_ACCESSOR, label: 'projects.core.room' },
    { regex: FEATURE_NOTES_INCLUDE, label: '":feature:notes"' },
    { regex: FEATURE_NOTES_ACCESSOR, label: 'projects.feature.notes' },
    classToken('AppDatabase'), classToken('RoomModule', /\bRoomModule\b/),
    classToken('NoteDao'), classToken('NoteEntity'), classToken('FavoriteUserDao'),
    classToken('NotesPresentationModule', /\bNotesPresentationModule\b/), classToken('NotesDestination')
];
const ROOM_RESIDUE_FILES = () => [path.join('core', 'room'), path.join('feature', 'notes')];

// Backend off (applyBackendOption): the tokens the backend's parts must leave nowhere. Bounded like the
// module references above, so a custom module (api, auth, account2, ...) never matches; the user's
// package and a custom module's own class names are masked by scanForResidue. Markup and the Xcode
// project are looked at only where user input cannot spell the token.
const BACKEND_CODE_EXTENSIONS = new Set(['.kt', '.kts', '.toml', '.swift', '.properties']);
const BACKEND_IOS_EXTENSIONS = new Set([...BACKEND_CODE_EXTENSIONS, '.pbxproj']);
const code = (regex, label, extensions = BACKEND_CODE_EXTENSIONS) => ({ regex, label, extensions });
const BACKEND_RESIDUE_TOKENS = [
    code(/\bcore\.auth(?![A-Za-z0-9_])/, 'core.auth'),
    code(/\bcore\.api(?![A-Za-z0-9_])/, 'core.api'),
    code(/\bBACKEND_CLIENT\b/, 'BACKEND_CLIENT'),
    code(/\bFirebaseAuth\b/, 'FirebaseAuth', BACKEND_IOS_EXTENSIONS),
    code(/\bFirebaseCore\b/, 'FirebaseCore', BACKEND_IOS_EXTENSIONS),
    code(/\bGoogleSignIn\b/, 'GoogleSignIn', BACKEND_IOS_EXTENSIONS),
    code(/\bgoogle-services\b/, 'google-services'),
    code(/\bgoogleServices\b/, 'googleServices'),
    code(/\bLOCAL_SERVER\b/, 'LOCAL_SERVER', BACKEND_IOS_EXTENSIONS),
    code(/^\s*#if LOCAL_SERVER\b/m, 'LOCAL_SERVER', PLIST),
    code(/com\.apple\.developer\.applesignin/, 'applesignin', new Set([...BACKEND_IOS_EXTENSIONS, '.plist'])),
    { ...classToken('rememberSessionStart', /\brememberSessionStart\b/), extensions: BACKEND_CODE_EXTENSIONS },
    { ...classToken('registerSignInBridge', /\bregisterSignInBridge\b/), extensions: BACKEND_CODE_EXTENSIONS },
    // Any marker the template left (block and swap markers); the privacy manifest's block is
    // writePrivacyManifest's, after this check
    code(/cmpose:backend/, 'cmpose:backend', new Set([...BACKEND_IOS_EXTENSIONS, '.xcconfig', '.plist', '.xml', '.md']))
];
const BACKEND_RESIDUE_FILES = () => ['server', path.join('core', 'api'), path.join('core', 'auth'),
    path.join('feature', 'account'), path.join('feature', 'sharing')];

// Whether a MONETIZATION_RESIDUE_TOKENS key is off (monetization = purchases and ads both off)
function monetizationKeyOff(config, key) {
    if (key === MONETIZATION_MODULE) return config.purchases !== true && config.ads !== true;
    return config[key] !== true;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Takes the user's package out of the places it is the user's own: package lines, quoted values
// ("pkg", "pkg.x", "pkg.${moduleName}": applicationId, namespace, plugin ids, @ComponentScan) and
// imports of the user's own code. An import under the package is the user's when what follows the
// package is a single name, starts with a segment the user's own package lines start with
// (ownSegments: core, feature, di, ...), or is generated code (Compose resources, KSP). So with the
// package com.revenuecat.purchases a leftover "import com.revenuecat.purchases.kmp.Purchases"
// (RevenueCat's SDK) is still seen.
// An import under an SDK's own package (SDK_PACKAGES) is the user's only when it is plainly the
// template's code (core, feature, di, generated) or a single name the user's package declares at its
// top level (ownNames): with the package com.revenuecat.purchases.kmp, a leftover
// "import com.revenuecat.purchases.kmp.Purchases" is still seen (review M1).
function maskOwnPackage(content, packageName, ownSegments, ownNames = new Set()) {
    const pkg = escapeRegex(packageName);
    const packageLine = new RegExp(`^(\\s*package\\s+)${pkg}(?=[.\\s;]|$)`);
    const quoted = new RegExp(`"${pkg}(?=[".$])`, 'g');
    return content.split('\n').map((line) => {
        let masked = line.replace(packageLine, '$1').replace(quoted, '"');
        const imported = masked.match(/^(\s*import\s+)([\w.]+?)(\.\*)?(?=\s|;|$)/);
        if (imported && isOwnImport(imported[2], packageName, ownSegments, ownNames)) {
            masked = imported[1] + imported[2].slice(packageName.length) + masked.slice(imported[1].length + imported[2].length);
        }
        return masked;
    }).join('\n');
}

// The SDK packages whose imports are residue tokens (com.revenuecat, the Next-Gen ads SDK import)
const SDK_PACKAGES = ['com.revenuecat.purchases.kmp', 'com.google.android.libraries.ads.mobile.sdk'];

function isOwnImport(importPath, packageName, ownSegments, ownNames) {
    if (importPath === packageName) return true;
    if (!importPath.startsWith(`${packageName}.`)) return false;
    const rest = importPath.slice(packageName.length + 1).split('.');
    if (rest.includes('generated')) return true;
    if (SDK_PACKAGES.some((sdk) => importPath.startsWith(`${sdk}.`))) {
        return rest.length === 1 ? ownNames.has(rest[0]) : TEMPLATE_PACKAGE_SEGMENTS.includes(rest[0]);
    }
    return rest.length === 1 || ownSegments.has(rest[0]);
}

// The names a Kotlin file declares at its top level, and its file facade (App.kt -> AppKt)
function topLevelNames(file, content) {
    const names = [`${path.basename(file, '.kt')}Kt`];
    // Annotations may share the line (@Composable fun App(), @OptIn(X::class) @Composable fun Root())
    const declaration = /^(?:@[\w.]+(?:\([^)\n]*\))?\s+)*(?:(?:public|internal|private|expect|actual|data|sealed|enum|annotation|value|inline|abstract|open|const|fun)\s+)*(?:class|interface|object|fun|val|var|typealias)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/gm;
    for (const match of content.matchAll(declaration)) names.push(match[1]);
    return names;
}

function residueTokenFound(content, token) {
    return typeof token === 'string' ? content.includes(token) : token.regex.test(content);
}

// The top-level packages under the template's own package (com.kturker.multiplatform.core/feature/di)
const TEMPLATE_PACKAGE_SEGMENTS = ['core', 'feature', 'di'];

// The custom module a file is in (feature/<name>/..., any module but the template's own: monetization,
// notes), else null. In blank, by the time the residue check runs, applyBlankShell has removed the
// showcase's home and onboarding, so every other feature module is a clone of feature/sample.
function customModuleOf(relPath) {
    const parts = relPath.split(path.sep);
    return parts.length > 2 && parts[0] === 'feature' && !Object.hasOwn(TEMPLATE_FEATURE_MODULES, parts[1]) ? parts[1] : null;
}

// Takes a custom module's own class names (PaywallDestination, PaywallEntry, ... for paywall) out
function maskModuleClasses(content, moduleName) {
    const own = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    return content.replace(new RegExp(`\\b${escapeRegex(own)}[A-Za-z0-9_]*`, 'g'), '');
}

const tokenExtensions = (token) => (typeof token === 'string' ? null : token.extensions) || MONETIZATION_RESIDUE_EXTENSIONS;

async function assertNoMonetizationResidue(projectPath, packageName, config) {
    const offKeys = Object.keys(MONETIZATION_RESIDUE_TOKENS).filter((key) => monetizationKeyOff(config, key));
    const tokens = offKeys.flatMap((key) => MONETIZATION_RESIDUE_TOKENS[key]);
    if (tokens.length === 0) return;
    const packagePath = packageName.replace(/\./g, '/');
    const files = offKeys.flatMap((key) => MONETIZATION_RESIDUE_FILES[key](packagePath));
    const pins = offKeys.includes('ads') ? ADS_PIN_IDENTITIES : null;
    await scanForResidue(projectPath, packageName, { tokens, files, pins, title: 'Monetization residue after removal' });
}

// Room off: nothing of core/room or feature/notes is left (see ROOM_RESIDUE_TOKENS)
async function assertNoRoomResidue(projectPath, packageName, config) {
    if (config.room === true) return;
    await scanForResidue(projectPath, packageName, {
        tokens: ROOM_RESIDUE_TOKENS,
        files: ROOM_RESIDUE_FILES(),
        title: 'Room residue after removal'
    });
}

// Backend off: nothing of the backend is left (see BACKEND_RESIDUE_TOKENS)
async function assertNoBackendResidue(projectPath, packageName, config) {
    if (config.backend === true) return;
    await scanForResidue(projectPath, packageName, {
        tokens: BACKEND_RESIDUE_TOKENS,
        files: BACKEND_RESIDUE_FILES(),
        title: 'Backend residue after removal'
    });
}

// Fails with `title` and a file: label list when a path in `files` (relative to the project) is still
// there or a token is in a file it is looked for in (user input and the user's own package masked)
async function scanForResidue(projectPath, packageName, { tokens, files, pins, title }) {
    const problems = await findResidue(projectPath, packageName, { tokens, files, pins });
    if (problems.length > 0) {
        throw new Error(`${title}:\n  ${problems.join('\n  ')}`);
    }
}

// scanForResidue's problems as a `file: label` list (the verifier collects them); `pins`: identities
// Package.resolved, if there, must no longer pin
async function findResidue(projectPath, packageName, { tokens, files: residueFiles, pins = null }) {
    const problems = [];
    for (const rel of residueFiles) {
        if (await fs.pathExists(path.join(projectPath, rel))) problems.push(`${rel}: file still present`);
    }
    const resolvedPath = path.join(projectPath, ...PACKAGE_RESOLVED);
    if (pins && (await fs.pathExists(resolvedPath))) {
        for (const pin of JSON.parse(await fs.readFile(resolvedPath, 'utf8')).pins || []) {
            if (pins.has(pin.identity)) problems.push(`${path.join(...PACKAGE_RESOLVED)}: ${pin.identity} pin`);
        }
    }

    const scanned = new Set(tokens.flatMap((token) => [...tokenExtensions(token)]));
    const files = [];
    // Seeded with the template's own top-level segments (review M4): with no custom modules, no file
    // declares a feature package by the time this runs, yet initKoin.kt still imports the showcase's
    // feature.home/feature.onboarding modules (processBlankApp drops those lines afterwards)
    const ownSegments = new Set(TEMPLATE_PACKAGE_SEGMENTS);
    const ownNames = new Set();
    const ownPackageLine = new RegExp(`^\\s*package\\s+${escapeRegex(packageName)}\\.(\\w+)`, 'm');
    const rootPackageLine = new RegExp(`^\\s*package\\s+${escapeRegex(packageName)}\\s*;?\\s*$`, 'm');
    for (const file of await listTextFiles(projectPath)) {
        if (!scanned.has(path.extname(file))) continue;
        const content = await fs.readFile(file, 'utf8');
        const declared = content.match(ownPackageLine);
        if (declared) ownSegments.add(declared[1]);
        if (file.endsWith('.kt') && rootPackageLine.test(content)) topLevelNames(file, content).forEach((name) => ownNames.add(name));
        files.push([file, content]);
    }

    for (const [file, raw] of files) {
        const extension = path.extname(file);
        const uncommented = XML.has(extension) ? raw.replace(/<!--[\s\S]*?-->/g, '') : raw;
        const withoutInput = uncommented
            .split('\n')
            .filter((line) => !USER_INPUT_LINES.some((re) => re.test(line)))
            .join('\n');
        const content = maskOwnPackage(withoutInput, packageName, ownSegments, ownNames);
        const customModule = customModuleOf(path.relative(projectPath, file));
        const classContent = customModule ? maskModuleClasses(content, customModule) : content;
        for (const token of tokens) {
            const haystack = token.classToken ? classContent : content;
            if (tokenExtensions(token).has(extension) && residueTokenFound(haystack, token)) {
                problems.push(`${path.relative(projectPath, file)}: ${typeof token === 'string' ? token : token.label}`);
            }
        }
    }
    return problems;
}

async function processCoreFeatures(projectPath, config, packageName) {
    // Handle Network Inspector Removal
    if (config.networkInspector !== true) {
        log.info('🕵️ Removing Network Inspector...');

        // 1. Remove from MainActivity.kt
        const packagePath = packageName.replace(/\./g, '/');
        const mainActivityPath = path.join(projectPath, 'androidApp', 'src', 'main', 'kotlin', packagePath, 'MainActivity.kt');
        if (await fs.pathExists(mainActivityPath)) {
            let content = await fs.readFile(mainActivityPath, 'utf8');

            // Remove the requestNotificationPermission function. The AGP 9 template uses a
            // collapsed if + a NOTIFICATION_PERMISSION_REQUEST_CODE companion constant, so we
            // anchor on that constant in the call (not the literal 1001) and its braces.
            content = content.replace(/\s*private fun requestNotificationPermission\(\)\s*\{[\s\S]*?NOTIFICATION_PERMISSION_REQUEST_CODE\s*\)\s*\}\s*\}/g, '');
            // Remove the companion object that holds the request-code constant.
            content = content.replace(/\s*private companion object\s*\{\s*const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001\s*\}/g, '');

            // Remove function call (match entire line to be safe)
            content = content.replace(/^\s*requestNotificationPermission\(\)\s*$/gm, '');

            // Remove imports
            const importsToRemove = [
                'import android.Manifest',
                'import android.content.pm.ApplicationInfo',
                'import android.content.pm.PackageManager',
                'import android.os.Build',
                'import androidx.core.app.ActivityCompat',
                'import androidx.core.content.ContextCompat'
            ];

            const lines = content.split('\n');
            const newLines = lines.filter(line => !importsToRemove.some(imp => line.trim() === imp));

            // Clean up empty lines
            content = newLines.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n');
            // The removed call leaves a blank line right before the closing brace (NoBlankLineBeforeRbrace)
            content = content.replace(/\n[ \t]*\n([ \t]*\})/g, '\n$1');

            await fs.writeFile(mainActivityPath, content);
            log.info('✅ Cleaned MainActivity.kt');
        }

        // 2. Remove from AndroidManifest.xml
        const manifestPath = path.join(projectPath, 'androidApp', 'src', 'main', 'AndroidManifest.xml');
        if (await fs.pathExists(manifestPath)) {
            let content = await fs.readFile(manifestPath, 'utf8');
            content = content.replace(/<uses-permission android:name="android.permission.POST_NOTIFICATIONS"\s*\/>/g, '');
            await fs.writeFile(manifestPath, content);
            log.info('✅ Cleaned AndroidManifest.xml');
        }

        // 3. Remove from NetworkModule.kt
        const networkModulePath = path.join(projectPath, 'core', 'network', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'network', 'di', 'NetworkModule.kt');
        if (await fs.pathExists(networkModulePath)) {
            let content = await fs.readFile(networkModulePath, 'utf8');

            // Remove install block (handle nested braces by matching specific end content)
            content = content.replace(/\s*install\(MonitorLogging\)(?:\s*\{[\s\S]*?\n\s*\})?\s*/g, '');

            // Remove import
            content = content.replace(/import com.kturker.networkmonitor.MonitorLogging/g, '');

            // Current template: the module keeps only the call + import, the monitor is in NetworkMonitor.kt
            const monitorLines = ['installNetworkMonitor()', `import ${packageName}.core.network.installNetworkMonitor`];
            content = content.split('\n').filter(line => !monitorLines.includes(line.trim())).join('\n');
            // Collapse the blank line the removed call leaves right before the closing brace
            content = content.replace(/\n[ \t]*\n([ \t]*\})/g, '\n$1');

            await fs.writeFile(networkModulePath, content);
            log.info('✅ Cleaned NetworkModule.kt');
        }

        // 3a. Backend on: the backend's client records its calls in debug builds too, and core/network's iOS
        // test executable links the system SQLite only for the monitor
        const backendClientPath = path.join(projectPath, 'core', 'network', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'network', 'BackendClient.kt');
        if (await fs.pathExists(backendClientPath)) {
            let content = await fs.readFile(backendClientPath, 'utf8');
            content = content.split('\n').filter((line) => {
                const t = line.trim();
                return t !== 'if (isDebug) installNetworkMonitor()' && !t.startsWith('// Debug builds only, like the request log: the monitor');
            }).join('\n');
            content = content.replace(/\n[ \t]*\n([ \t]*\})/g, '\n$1');
            await fs.writeFile(backendClientPath, content);
        }
        const networkGradlePath = path.join(projectPath, 'core', 'network', 'build.gradle.kts');
        if (await fs.pathExists(networkGradlePath)) {
            const content = await fs.readFile(networkGradlePath, 'utf8');
            const cleaned = content.replace(/\n*\/\/ The backend client \(BackendClient\.kt\) keeps the network monitor[^\n]*\n\/\/[^\n]*\nkotlin\.targets\.withType<[^\n]*KotlinNativeTarget>\(\)\.configureEach \{\n[^\n]*TestExecutable>\(\)\.configureEach \{\n\s*linkerOpts\("-lsqlite3"\)\n\s*\}\n\}/, '');
            if (cleaned !== content) await fs.writeFile(networkGradlePath, cleaned);
        }

        // 3b. Current template: remove the monitor helper files
        for (const [sourceSet, fileName] of MONITOR_HELPER_FILES) {
            await fs.remove(path.join(projectPath, 'core', 'network', 'src', sourceSet, 'kotlin', packagePath, 'core', 'network', fileName));
        }

        // 4. Remove from Config.xcconfig
        const xcconfigPath = path.join(projectPath, 'iosApp', 'Configuration', 'Config.xcconfig');
        if (await fs.pathExists(xcconfigPath)) {
            let content = await fs.readFile(xcconfigPath, 'utf8');
            content = content.replace(/OTHER_LDFLAGS = \$\(inherited\) -lsqlite3/g, '');
            await fs.writeFile(xcconfigPath, content);
            log.info('✅ Cleaned Config.xcconfig');
        }

        // 5. Remove from ContentView.swift
        const contentViewPath = path.join(projectPath, 'iosApp', 'iosApp', 'ContentView.swift');
        if (await fs.pathExists(contentViewPath)) {
            let content = await fs.readFile(contentViewPath, 'utf8');

            // Remove import
            content = content.replace(/import UserNotifications/g, '');

            // Remove .task block
            content = content.replace(/\.task\s*\{\s*requestNotificationPermission\(\)\s*\}/g, '');

            // Remove function definition (handle nested closure; the current template wraps the body in #if DEBUG)
            content = content.replace(/func requestNotificationPermission\(\) \{[\s\S]*?error in\s*\}\s*(?:#endif\s*)?\}/g, '');

            // Clean up empty lines
            content = content.replace(/\n\s*\n\s*\n/g, '\n\n');

            await fs.writeFile(contentViewPath, content);
            log.info('✅ Cleaned ContentView.swift');
        }

        // 6. Remove from Info.plist
        const infoPlistPath = path.join(projectPath, 'iosApp', 'iosApp', 'Info.plist');
        if (await fs.pathExists(infoPlistPath)) {
            let content = await fs.readFile(infoPlistPath, 'utf8');

            // Remove key and string
            content = content.replace(/<key>NSUserNotificationUsageDescription<\/key>\s*<string>[^<]*<\/string>/g, '');

            await fs.writeFile(infoPlistPath, content);
            log.info('✅ Cleaned Info.plist');
        }

        // 7. Remove from libs.versions.toml (by key, not by substring - see removeTomlEntries)
        const libsTomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
        if (await fs.pathExists(libsTomlPath)) {
            let content = await fs.readFile(libsTomlPath, 'utf8');
            const newContent = removeTomlEntries(content, {
                versions: ['networkMonitor'],
                libraries: ['networkMonitor-debug', 'networkMonitor-release']
            });
            await fs.writeFile(libsTomlPath, newContent);
            log.info('✅ Cleaned libs.versions.toml');
        }

        // 8. Remove from core/network/build.gradle.kts
        const networkBuildGradle = path.join(projectPath, 'core', 'network', 'build.gradle.kts');
        if (await fs.pathExists(networkBuildGradle)) {
            let content = await fs.readFile(networkBuildGradle, 'utf8');

            // Remove the specific block of comments and implementations for networkMonitor
            // We use a regex to match the lines including the comments
            const regex = /\s*\/\/ Add this only to the debug buildType\/flavor\s*implementation\(libs\.networkMonitor\.debug\)\s*\/\/ Add this to the release buildType\/flavor so the no-op implementation is used\s*\/\/implementation\(libs\.networkMonitor\.release\)/g;

            content = content.replace(regex, '');

            // Fallback cleanup for any remaining networkMonitor reference lines, just in case:
            // this is a Kotlin build script (not TOML), so we match the exact known reference
            // lines rather than a substring - a package name coincidentally containing
            // "networkmonitor" must not delete unrelated lines here either.
            const networkMonitorReferenceLines = [
                'implementation(libs.networkMonitor.debug)',
                'implementation(libs.networkMonitor.release)',
                '//implementation(libs.networkMonitor.debug)',
                '//implementation(libs.networkMonitor.release)',
                '// Network monitor: release APKs swap in networkmonitor-noop (androidApp); iOS gates it at runtime'
            ];
            const lines = content.split('\n');
            const newLines = lines.filter(line => !networkMonitorReferenceLines.includes(line.trim()));

            await fs.writeFile(networkBuildGradle, newLines.join('\n'));
            log.info('✅ Cleaned core/network/build.gradle.kts');
        }

        // 9. Remove the release no-op substitution block from androidApp/build.gradle.kts.
        // Template contract: the block starts with this comment line and ends at the next
        // closing brace in column 0.
        const appBuildGradle = path.join(projectPath, 'androidApp', 'build.gradle.kts');
        if (await fs.pathExists(appBuildGradle)) {
            const content = await fs.readFile(appBuildGradle, 'utf8');
            const cleaned = content.replace(/(?:^|\n)\/\/ Network monitor: release builds[\s\S]*?\n\}(?=\n|$)/, '');
            if (cleaned !== content) {
                await fs.writeFile(appBuildGradle, cleaned.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'));
                log.info('✅ Cleaned androidApp/build.gradle.kts');
            }
        }

        // 10. Verify no monitor residue is left (if any is, the request fails)
        // This must run in processCoreFeatures BEFORE the user's detekt.yml (step "Detekt is ENABLED")
        // and the network base URL (the config.network === true block) are written: the scan covers
        // .yml files too, so it must see only template content, not user input.
        await assertNoNetworkMonitorResidue(projectPath, packageName);
    }

    // Handle Network Removal
    if (config.network !== true) {
        log.info('🔌 Removing Network Module...');

        // 1. Remove Permission from AndroidManifest.xml. RevenueCat (and Google Mobile Ads) talk to their
        // servers without core:network: RevenueCat's configure() requires INTERNET (review M1), so the
        // permission stays while a monetization flag is on.
        const manifestPath = path.join(projectPath, 'androidApp', 'src', 'main', 'AndroidManifest.xml');
        const monetizationNeedsInternet = config.purchases === true || config.ads === true;
        // backend implies network, so this is the network block's own guard should that rule change
        if (!monetizationNeedsInternet && config.backend !== true) {
            await dropLines(manifestPath, (line) =>
                /<uses-permission android:name="android\.permission\.INTERNET"\s*\/>/.test(line));
        }
        // The connectivity banner's permission (and its comment) goes with core:network; with ads on, the
        // GMA SDK brings its own through manifest merging
        await dropLines(manifestPath, (line) =>
            /<uses-permission android:name="android\.permission\.ACCESS_NETWORK_STATE"\s*\/>/.test(line) ||
            line.trim() === '<!-- Connectivity banner and retry (core/network ConnectivityMonitor) -->');
        // The permission block between two blank lines may be gone: keep one blank line there
        await rewriteIfExists(manifestPath, (content) => content.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n'));

        // 2. Remove Ktor from libs.versions.toml (by key, not by substring). Every Ktor key
        // goes with ktorClientCore, or the catalog no longer resolves (ktor-client-logging included).
        const libsTomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
        if (await fs.pathExists(libsTomlPath)) {
            let content = await fs.readFile(libsTomlPath, 'utf8');
            const newContent = removeTomlEntries(content, {
                versions: ['ktorClientCore'],
                libraries: [
                    'ktor-client-android',
                    'ktor-client-content-negotiation',
                    'ktor-client-core',
                    'ktor-client-darwin',
                    'ktor-client-logging',
                    // core/network's test client (MockEngine)
                    'ktor-client-mock',
                    'ktor-serialization-kotlinx-json',
                    // Coil's network fetcher lives in core:network and goes with it
                    'coil-network-ktor3'
                ]
            });
            await fs.writeFile(libsTomlPath, newContent);
        }

        // 3. Remove module from settings.gradle.kts
        const settingsGradle = path.join(projectPath, 'settings.gradle.kts');
        if (await fs.pathExists(settingsGradle)) {
            let content = await fs.readFile(settingsGradle, 'utf8');
            content = content.replace(/include\(":core:network"\)/g, '');
            await fs.writeFile(settingsGradle, content);
        }

        // 4. Delete core/network directory
        const networkDir = path.join(projectPath, 'core', 'network');
        if (await fs.pathExists(networkDir)) {
            await fs.remove(networkDir);
        }

        // 5. Update FeatureDataConventionPlugin.kt
        const pluginPath = path.join(projectPath, 'build-logic', 'src', 'main', 'kotlin', 'convention', 'FeatureDataConventionPlugin.kt');
        if (await fs.pathExists(pluginPath)) {
            // Exactly the core:network and ktor-client-core lines go; any other network reference
            // left means the template changed shape -> an error, not a project that does not compile
            const content = await fs.readFile(pluginPath, 'utf8');
            const kept = content.split('\n').filter((line) => !FEATURE_DATA_NETWORK_LINES.includes(line.trim())).join('\n');
            if (/core:network|libs\.ktor\./.test(kept)) {
                throw new Error('FeatureDataConventionPlugin.kt: network references left after removing core:network (template shape changed)');
            }
            await fs.writeFile(pluginPath, kept);
            log.info('FeatureDataConventionPlugin.kt updated.');
        } else {
            log.warn(`⚠️ FeatureDataConventionPlugin.kt not found at: ${pluginPath}`);
        }

        // 6. Remove from shared/build.gradle.kts
        const sharedBuildGradle = path.join(projectPath, 'shared', 'build.gradle.kts');
        if (await fs.pathExists(sharedBuildGradle)) {
            let content = await fs.readFile(sharedBuildGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => {
                const trimmed = line.trim();
                return !trimmed.includes('projects.core.network') && !trimmed.includes('":core:network"');
            });
            await fs.writeFile(sharedBuildGradle, newLines.join('\n'));
            log.info('shared/build.gradle.kts updated.');
        }

        // 7. Remove from initKoin.kt (the core.network import goes by exact match, not by
        // substring - even with a package name such as "com.score.networks", the @ComponentScan/
        // package/other import lines are left alone)
        const packagePath = packageName.replace(/\./g, '/');
        const initKoinPath = path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt');
        if (await fs.pathExists(initKoinPath)) {
            let content = await fs.readFile(initKoinPath, 'utf8');
            const lines = content.split('\n');
            const coreNetworkImportRegex = new RegExp('^import ' + escapeRegExp(packageName) + '\\.core\\.network\\.');
            const newLines = lines.filter(line => {
                const trimmed = line.trim();
                // Filter out network module import (exact match) and injection usage
                if (coreNetworkImportRegex.test(trimmed)) return false;
                if (trimmed.includes('NetworkModule')) return false;
                return true;
            });
            await fs.writeFile(initKoinPath, newLines.join('\n'));
            log.info('initKoin.kt updated.');
        }

        // 8. Nothing of Ktor or core:network is left in a build script or the catalog
        await assertNoNetworkResidue(projectPath);
    }

    // Handle Theming Removal (B): the theme is two packages - core/designsystem/.../theme (palette,
    // KtTheme) and core/database/.../theme (the saved Light/Dark/System choice). Theming off drops
    // both, in every source set; shared/.../AppTheme.kt came from blank/layers/theming-off (a plain
    // MaterialTheme that follows the system), so nothing refers to them. No Gradle file changes.
    if (config.theming !== true) {
        log.info('🎨 Removing Theming...');
        const packagePath = packageName.replace(/\./g, '/');
        for (const moduleName of THEME_MODULES) {
            const srcDir = path.join(projectPath, 'core', moduleName, 'src');
            if (!(await fs.pathExists(srcDir))) continue;
            for (const sourceSet of await fs.readdir(srcDir)) {
                await fs.remove(path.join(srcDir, sourceSet, 'kotlin', packagePath, 'core', moduleName, 'theme'));
            }
        }
        log.info('✅ Removed the theme packages of core/designsystem and core/database');
    }

    // Handle Multi-Language Removal
    if (config.multiLang !== true) {
        log.info('🌍 Removing Multi-Language Support...');

        // 1. Remove core/multilang module
        await fs.remove(path.join(projectPath, 'core', 'multilang'));
        log.info('✅ Removed core/multilang');

        // 2. Remove from settings.gradle.kts
        const settingsGradle = path.join(projectPath, 'settings.gradle.kts');
        if (await fs.pathExists(settingsGradle)) {
            let content = await fs.readFile(settingsGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('":core:multilang"'));
            await fs.writeFile(settingsGradle, newLines.join('\n'));
            log.info('✅ Removed multilang from settings.gradle.kts');
        }

        // 3. Remove from build-logic plugins
        const buildLogicPath = path.join(projectPath, 'build-logic', 'src', 'main', 'kotlin', 'convention');

        // ComposeMultiplatformAppConventionPlugin.kt
        const appPluginPath = path.join(buildLogicPath, 'ComposeMultiplatformAppConventionPlugin.kt');
        if (await fs.pathExists(appPluginPath)) {
            let content = await fs.readFile(appPluginPath, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('project(":core:multilang")'));
            await fs.writeFile(appPluginPath, newLines.join('\n'));
            log.info('✅ Removed multilang from ComposeMultiplatformAppConventionPlugin.kt');
        }

        // FeaturePresentationConventionPlugin.kt
        const featurePluginPath = path.join(buildLogicPath, 'FeaturePresentationConventionPlugin.kt');
        if (await fs.pathExists(featurePluginPath)) {
            let content = await fs.readFile(featurePluginPath, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('project(":core:multilang")'));
            await fs.writeFile(featurePluginPath, newLines.join('\n'));
            log.info('✅ Removed multilang from FeaturePresentationConventionPlugin.kt');
        }

        // 4. Remove language folder from core/designsystem
        const packagePath = packageName.replace(/\./g, '/');
        const designSystemCommonPath = path.join(projectPath, 'core', 'designsystem', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'designsystem');
        await fs.remove(path.join(designSystemCommonPath, 'language'));
        log.info('✅ Removed language folder from designsystem');

        // 5. Remove multilang from core/designsystem/build.gradle.kts
        const designSystemBuildGradle = path.join(projectPath, 'core', 'designsystem', 'build.gradle.kts');
        if (await fs.pathExists(designSystemBuildGradle)) {
            let content = await fs.readFile(designSystemBuildGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('projects.core.multilang'));
            await fs.writeFile(designSystemBuildGradle, newLines.join('\n'));
            log.info('✅ Removed multilang from core/designsystem/build.gradle.kts');
        }

        // 5b. Remove multilang from shared/build.gradle.kts (the app aggregator).
        // In the AGP 9 template the aggregate module deps live in shared/build.gradle.kts.
        const sharedMultilangBuildGradle = path.join(projectPath, 'shared', 'build.gradle.kts');
        if (await fs.pathExists(sharedMultilangBuildGradle)) {
            let content = await fs.readFile(sharedMultilangBuildGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('projects.core.multilang'));
            await fs.writeFile(sharedMultilangBuildGradle, newLines.join('\n'));
            log.info('✅ Removed multilang from shared/build.gradle.kts');
        }

        // 6. Remove MultiLangModule from initKoin.kt
        const initKoinPath = path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt');
        if (await fs.pathExists(initKoinPath)) {
            let content = await fs.readFile(initKoinPath, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('MultiLangModule'));
            await fs.writeFile(initKoinPath, newLines.join('\n'));
            log.info('✅ Removed MultiLangModule from initKoin.kt');
        }
    }

    // Handle DataStore/Database Removal
    if (config.dataStore !== true) {
        log.info('💾 Removing DataStore/Database...');

        // 1. Remove core/database module
        await fs.remove(path.join(projectPath, 'core', 'database'));
        log.info('✅ Removed core/database');

        // 2. Remove from settings.gradle.kts
        const settingsGradle = path.join(projectPath, 'settings.gradle.kts');
        if (await fs.pathExists(settingsGradle)) {
            let content = await fs.readFile(settingsGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('":core:database"'));
            await fs.writeFile(settingsGradle, newLines.join('\n'));
            log.info('✅ Removed database from settings.gradle.kts');
        }

        // 3. Remove from shared/build.gradle.kts
        const sharedBuildGradle = path.join(projectPath, 'shared', 'build.gradle.kts');
        if (await fs.pathExists(sharedBuildGradle)) {
            let content = await fs.readFile(sharedBuildGradle, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('projects.core.database'));
            await fs.writeFile(sharedBuildGradle, newLines.join('\n'));
            log.info('✅ Removed database from shared/build.gradle.kts');
        }

        // 4. Remove DatabaseModule from initKoin.kt
        const packagePath = packageName.replace(/\./g, '/');
        const initKoinPath = path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt');
        if (await fs.pathExists(initKoinPath)) {
            let content = await fs.readFile(initKoinPath, 'utf8');
            const lines = content.split('\n');
            const newLines = lines.filter(line => !line.includes('DatabaseModule'));
            await fs.writeFile(initKoinPath, newLines.join('\n'));
            log.info('✅ Removed DatabaseModule from initKoin.kt');
        }

        // 5. Remove DataStore from libs.versions.toml (by key, not by substring)
        const libsTomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
        if (await fs.pathExists(libsTomlPath)) {
            let content = await fs.readFile(libsTomlPath, 'utf8');
            const newContent = removeTomlEntries(content, {
                versions: ['datastore'],
                libraries: ['androidx-datastore', 'androidx-datastore-preferences']
            });
            await fs.writeFile(libsTomlPath, newContent);
            log.info('✅ Removed DataStore from libs.versions.toml');
        }
    }

    // Handle Purchases (RevenueCat) Removal. The ads side stays: with ads on, the blank layer
    // ads-without-purchases has put NoPremiumAdFreeSource in place of PremiumAdFreeSource.
    if (config.purchases !== true) {
        log.info('💳 Removing Purchases (RevenueCat)...');
        const packagePath = packageName.replace(/\./g, '/');
        const monetizationPresentation = path.join(projectPath, 'feature', 'monetization', 'presentation', 'src', 'commonMain', 'kotlin', packagePath, 'feature', 'monetization', 'presentation');
        const monetizationContract = path.join(projectPath, 'feature', 'monetization', 'contract', 'src', 'commonMain', 'kotlin', packagePath, 'feature', 'monetization', 'contract');

        // 1. core/purchases and its include
        await fs.remove(path.join(projectPath, 'core', 'purchases'));
        await dropLines(path.join(projectPath, 'settings.gradle.kts'), (line) => CORE_PURCHASES_INCLUDE.test(line));

        // 2. Gradle dependencies (each one on its own line in the template)
        await dropLines(path.join(projectPath, 'shared', 'build.gradle.kts'), (line) => CORE_PURCHASES_ACCESSOR.test(line));
        await dropLines(
            path.join(projectPath, 'feature', 'monetization', 'presentation', 'build.gradle.kts'),
            (line) => CORE_PURCHASES_ACCESSOR.test(line) || line.includes('libs.revenuecat')
        );

        // 3. initKoin.kt: the PurchasesModule import and its add(...) line
        await dropLines(
            path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt'),
            (line) => /\bPurchasesModule\b/.test(line)
        );

        // 3b. MainScreen.kt: FirstLaunchPaywall's import, comment and call (the template keeps the comment and the
        // call as the screen's last lines, so nothing but them goes)
        await dropLines(
            path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'MainScreen.kt'),
            (line) => /\bFirstLaunchPaywall\b/.test(line)
        );

        // 4. The paywall (every source set: its test needs PurchasesManager too), its destination
        // and the premium-backed AdFreeSource
        const presentationSrc = path.join(projectPath, 'feature', 'monetization', 'presentation', 'src');
        if (await fs.pathExists(presentationSrc)) {
            for (const sourceSet of await fs.readdir(presentationSrc)) {
                const presentationPkg = path.join(presentationSrc, sourceSet, 'kotlin', packagePath, 'feature', 'monetization', 'presentation');
                await fs.remove(path.join(presentationPkg, 'paywall'));
                // PremiumAdFreeSource's own test (it fakes PurchasesManager)
                await fs.remove(path.join(presentationPkg, 'ads', 'PremiumAdFreeSourceTest.kt'));
            }
        }
        await fs.remove(path.join(monetizationPresentation, 'ads', 'PremiumAdFreeSource.kt'));
        await fs.remove(path.join(monetizationContract, 'PaywallDestination.kt'));

        // 5. libs.versions.toml (key based, see removeTomlEntries)
        const libsTomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
        if (await fs.pathExists(libsTomlPath)) {
            const content = await fs.readFile(libsTomlPath, 'utf8');
            await fs.writeFile(libsTomlPath, removeTomlEntries(content, {
                versions: ['revenuecat'],
                libraries: ['revenuecat-core', 'revenuecat-ui']
            }));
        }
        log.info('✅ Removed Purchases');
    }

    // Handle Ads (AdMob) Removal: core/ads, the Swift bridge and the Google Mobile Ads Swift
    // package, the platform keys and the ads demo. With purchases on, the paywall stays.
    if (config.ads !== true) {
        log.info('📺 Removing Ads (AdMob)...');
        const packagePath = packageName.replace(/\./g, '/');
        const monetizationContract = path.join(projectPath, 'feature', 'monetization', 'contract', 'src', 'commonMain', 'kotlin', packagePath, 'feature', 'monetization', 'contract');

        // 1. core/ads and its include
        await fs.remove(path.join(projectPath, 'core', 'ads'));
        await dropLines(path.join(projectPath, 'settings.gradle.kts'), (line) => CORE_ADS_INCLUDE.test(line));

        // 2. Gradle dependencies: api(...) and export(...) in shared, the presentation's implementation(...)
        await dropLines(path.join(projectPath, 'shared', 'build.gradle.kts'), (line) => CORE_ADS_ACCESSOR.test(line));
        await dropLines(
            path.join(projectPath, 'feature', 'monetization', 'presentation', 'build.gradle.kts'),
            (line) => CORE_ADS_ACCESSOR.test(line)
        );

        // 3. iOS: the Kotlin registration, the Swift bridge and its registration in iOSApp.swift
        await fs.remove(path.join(projectPath, 'shared', 'src', 'iosMain', 'kotlin', packagePath, 'AdsBridgeRegistration.kt'));
        await fs.remove(path.join(projectPath, 'iosApp', 'iosApp', 'AdsBridge.swift'));
        await rewriteIfExists(path.join(projectPath, 'iosApp', 'iosApp', 'iOSApp.swift'), stripAdsBridgeRegistration);

        // 4. Platform keys: the AdMob app IDs, ATT and SKAdNetwork
        await rewriteIfExists(path.join(projectPath, 'androidApp', 'src', 'main', 'AndroidManifest.xml'), stripAdsManifest);
        await rewriteIfExists(path.join(projectPath, 'iosApp', 'iosApp', 'Info.plist'), stripAdsInfoPlist);

        // 5. The Google Mobile Ads Swift package. Package.resolved loses the GMA and UMP pins (the
        // backend's stay); with no pin left it goes as a whole (Xcode writes a new one if the user adds a
        // package), with the swiftpm/ and xcshareddata/ directories it leaves empty.
        await rewriteIfExists(
            path.join(projectPath, 'iosApp', 'iosApp.xcodeproj', 'project.pbxproj'),
            (content) => removeSwiftPackage(content, GMA_PACKAGE_URL)
        );
        const resolvedPath = path.join(projectPath, ...PACKAGE_RESOLVED);
        if (await fs.pathExists(resolvedPath)) {
            const stripped = stripPins(await fs.readFile(resolvedPath, 'utf8'), ADS_PIN_IDENTITIES);
            if (stripped === null) await fs.remove(resolvedPath);
            else await fs.writeFile(resolvedPath, stripped);
        }
        for (const depth of [1, 2]) {
            const emptied = path.join(projectPath, ...PACKAGE_RESOLVED.slice(0, -depth));
            if ((await fs.pathExists(emptied)) && (await fs.readdir(emptied)).length === 0) await fs.remove(emptied);
        }

        // 6. The ads demo (every source set: its test needs core/ads too) and its destination. With
        // purchases off the paywall is gone already and so is the whole feature below.
        const presentationSrc = path.join(projectPath, 'feature', 'monetization', 'presentation', 'src');
        if (await fs.pathExists(presentationSrc)) {
            for (const sourceSet of await fs.readdir(presentationSrc)) {
                await fs.remove(path.join(presentationSrc, sourceSet, 'kotlin', packagePath, 'feature', 'monetization', 'presentation', 'ads'));
            }
        }
        await fs.remove(path.join(monetizationContract, 'AdsDemoDestination.kt'));

        // 7. libs.versions.toml (key based, see removeTomlEntries): adsMobileSdk is the GMA Next-Gen
        // SDK; playServicesAds is the entry of templates before it, still stripped for them;
        // androidx-work is the WorkManager core/ads pins so release (R8) builds keep its Room database
        await rewriteIfExists(path.join(projectPath, 'gradle', 'libs.versions.toml'), (content) => removeTomlEntries(content, {
            versions: ['adsMobileSdk', 'playServicesAds', 'ump', 'androidx-work'],
            libraries: ['adsMobileSdk', 'playServicesAds', 'ump', 'androidx-work-runtime']
        }));
        log.info('✅ Removed Ads');
    }

    // Both monetization flags off: the feature/monetization module goes too. processBlankApp removes
    // feature/ as a whole only without custom modules, so the module and its lines are removed here.
    if (config.purchases !== true && config.ads !== true) {
        log.info('🪙 Removing the monetization feature...');
        const packagePath = packageName.replace(/\./g, '/');
        await fs.remove(path.join(projectPath, 'feature', MONETIZATION_MODULE));
        await dropLines(path.join(projectPath, 'settings.gradle.kts'), (line) => FEATURE_MONETIZATION_INCLUDE.test(line));
        await dropLines(path.join(projectPath, 'shared', 'build.gradle.kts'), (line) => FEATURE_MONETIZATION_ACCESSOR.test(line));
        await dropLines(
            path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt'),
            (line) => /\bMonetizationPresentationModule\b/.test(line)
        );
        log.info('✅ Removed the monetization feature');
    }

    // Room on: blank's database holds the Notes demo (blank/layers/room has put its AppDatabase.kt and
    // schema in place), so the showcase's favorites entity and DAO go (every source set)
    const roomPackagePath = packageName.replace(/\./g, '/');
    if (config.room === true) {
        const roomSrc = path.join(projectPath, 'core', 'room', 'src');
        if (await fs.pathExists(roomSrc)) {
            for (const sourceSet of await fs.readdir(roomSrc)) {
                await fs.remove(path.join(roomSrc, sourceSet, 'kotlin', roomPackagePath, 'core', 'room', 'favorites'));
            }
        }
    } else {
        // Room off: core/room and the Notes demo go with every line that names them. The template
        // wires only core/room into shared (RoomModule); the NotesPresentationModule pattern is a
        // safeguard. The root alias line is not in the template either (core/room applies the plugin).
        log.info('🗄️ Removing Room...');
        await fs.remove(path.join(projectPath, 'core', 'room'));
        await fs.remove(path.join(projectPath, 'feature', NOTES_MODULE));
        await dropLines(path.join(projectPath, 'settings.gradle.kts'),
            (line) => CORE_ROOM_INCLUDE.test(line) || FEATURE_NOTES_INCLUDE.test(line));
        await dropLines(path.join(projectPath, 'shared', 'build.gradle.kts'),
            (line) => CORE_ROOM_ACCESSOR.test(line) || FEATURE_NOTES_ACCESSOR.test(line));
        await dropLines(
            path.join(projectPath, 'shared', 'src', 'commonMain', 'kotlin', roomPackagePath, 'di', 'initKoin.kt'),
            (line) => /\bRoomModule\b|\bNotesPresentationModule\b/.test(line)
        );
        await dropLines(path.join(projectPath, 'build.gradle.kts'), (line) => ROOM_PLUGIN_ALIAS.test(line));
        // libs.versions.toml (key based, see removeTomlEntries)
        await rewriteIfExists(path.join(projectPath, 'gradle', 'libs.versions.toml'), (content) => removeTomlEntries(content, {
            versions: ['room', 'sqlite'],
            libraries: ['androidx-room-runtime', 'androidx-room-compiler', 'androidx-sqlite-bundled'],
            plugins: ['room']
        }));
        log.info('✅ Removed Room');
    }

    // README: a disabled flag's marked section goes (both monetization flags off: the whole
    // monetization section; room off: the whole Room section, room on: its favorites part). fillReadme runs later
    // and rewrites only the requirements/modules sections.
    const readmePath = path.join(projectPath, 'README.md');
    if (await fs.pathExists(readmePath)) {
        const readme = await fs.readFile(readmePath, 'utf8');
        let updated = readme;
        if (config.purchases !== true && config.ads !== true) {
            updated = removeMarkedBlock(updated, 'cmpose:monetization');
        } else if (config.purchases !== true) {
            updated = removeMarkedBlock(updated, 'cmpose:purchases');
        } else if (config.ads !== true) {
            updated = removeMarkedBlock(updated, 'cmpose:ads');
        }
        updated = removeMarkedBlock(updated, config.room === true ? 'cmpose:room-favorites' : 'cmpose:room');
        if (updated !== readme) await fs.writeFile(readmePath, updated);
    }

    // Monetization residue check, once both monetization flags are handled. It runs before the
    // user's detekt.yml and network base URL are written (user input stays out of the scan).
    await assertNoMonetizationResidue(projectPath, packageName, config);
    // Room residue check, at the same point and for the same reason
    await assertNoRoomResidue(projectPath, packageName, config);
    // Backend residue check (applyBackendOption removed it on the template package), likewise
    await assertNoBackendResidue(projectPath, packageName, config);

    // --- Detekt Removal Logic ---
    if (config.detekt !== true) {
        log.info('🧹 Removing Detekt...');

        // 1. Delete 'detekt' folder at root
        const detektDir = path.join(projectPath, 'detekt');
        await fs.remove(detektDir);
        log.info('✅ Removed detekt directory');

        // 2. Remove from libs.versions.toml (by key, not by substring)
        const libsTomlPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
        if (await fs.pathExists(libsTomlPath)) {
            let content = await fs.readFile(libsTomlPath, 'utf8');
            const newContent = removeTomlEntries(content, {
                versions: ['detekt'],
                libraries: ['detekt-plugin', 'detekt-formatting'],
                plugins: ['detekt']
            });
            await fs.writeFile(libsTomlPath, newContent);
            log.info('✅ Removed Detekt from libs.versions.toml');
        }

        // 3. Remove from build-logic/build.gradle.kts
        const buildLogicGradle = path.join(projectPath, 'build-logic', 'build.gradle.kts');
        if (await fs.pathExists(buildLogicGradle)) {
            let content = await fs.readFile(buildLogicGradle, 'utf8');
            // Remove implementation(libs.detekt.plugin)
            content = content.replace(/implementation\(libs\.detekt\.plugin\)/g, '');
            // Remove register("detektConvention") block
            content = content.replace(/register\("detektConvention"\)\s*\{[\s\S]*?\}/g, '');
            await fs.writeFile(buildLogicGradle, content);
            log.info('✅ Removed Detekt from build-logic/build.gradle.kts');
        }

        // 4. Delete DetektConventionPlugin.kt
        const conventionPluginPath = path.join(projectPath, 'build-logic', 'src', 'main', 'kotlin', 'convention', 'DetektConventionPlugin.kt');
        await fs.remove(conventionPluginPath);
        log.info('✅ Removed DetektConventionPlugin.kt');

        // 5. Remove usage in other convention plugins
        const conventionDir = path.join(projectPath, 'build-logic', 'src', 'main', 'kotlin', 'convention');
        if (await fs.pathExists(conventionDir)) {
            const files = await fs.readdir(conventionDir);
            for (const file of files) {
                if (file.endsWith('.kt')) {
                    const filePath = path.join(conventionDir, file);
                    let content = await fs.readFile(filePath, 'utf8');

                    // Remove apply("packageName.detekt")
                    const detektPluginId = `${packageName}.detekt`;
                    if (content.includes(detektPluginId)) {
                        const lines = content.split('\n');
                        const newLines = lines.filter(line => !line.includes(detektPluginId));
                        await fs.writeFile(filePath, newLines.join('\n'));
                        log.info(`✅ Removed Detekt usage from ${file}`);
                    }
                }
            }
        }

        // 6. Modules outside the convention plugins that apply it by id (core/api, the backend's JVM-capable module;
        // server/ is the backend template's own build with its own detekt, placed after this step)
        const detektPluginLine = `id("${packageName}.detekt")`;
        await dropLines(path.join(projectPath, 'core', 'api', 'build.gradle.kts'), (line) => line.trim() === detektPluginLine);

        // The CI workflow's detekt step would fail without the plugin
        const ciPath = path.join(projectPath, '.github', 'workflows', 'ci.yml');
        if (await fs.pathExists(ciPath)) {
            await fs.writeFile(ciPath, removeCiDetektStep(await fs.readFile(ciPath, 'utf8')));
            log.info('✅ Removed the detekt step from .github/workflows/ci.yml');
        }
    } else {
        // Detekt is ENABLED
        const detektYamlPath = path.join(projectPath, 'detekt', 'detekt.yml');
        if (await fs.pathExists(detektYamlPath)) {
            const hasCustomYaml = typeof config.detektYamlContent === 'string' && config.detektYamlContent.trim().length > 0;
            if (hasCustomYaml) {
                // User uploaded a custom YAML
                await fs.writeFile(detektYamlPath, config.detektYamlContent);
                log.info('✅ Updated detekt.yml with custom content');
            } else {
                // User did NOT upload a file -> keep the template's detekt.yml as-is
                log.info('✅ Kept template detekt.yml (no custom file provided)');
            }
        }
    }
    // Only set/clear the base URL when the Network module is enabled. Templates from D on keep it in
    // ApiConfig.kt (both constants); older ones in NetworkModule's url("...").
    if (config.network === true) {
        const packagePath = packageName.replace(/\./g, '/');
        const networkSrc = path.join(projectPath, 'core', 'network', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'network');
        const apiConfigPath = path.join(networkSrc, 'ApiConfig.kt');
        const networkModulePath = path.join(networkSrc, 'di', 'NetworkModule.kt');
        const targetUrl = config.networkBaseUrl ? config.networkBaseUrl : "";
        const logMsg = config.networkBaseUrl ? `set to "${config.networkBaseUrl}"` : 'cleared to empty string';

        if (await fs.pathExists(apiConfigPath)) {
            await fs.writeFile(apiConfigPath, setApiBaseUrls(await fs.readFile(apiConfigPath, 'utf8'), targetUrl));
            log.info(`✅ ApiConfig.kt base URLs ${logMsg}.`);
        } else if (await fs.pathExists(networkModulePath)) {
            let content = await fs.readFile(networkModulePath, 'utf8');
            // Replace url("...") with url("targetUrl") - escaped as a Kotlin string
            content = content.replace(/url\s*\(\s*["'][^"']*["']\s*\)/g, () => `url("${escapeKotlinString(targetUrl)}")`);
            await fs.writeFile(networkModulePath, content);
            log.info(`✅ NetworkModule.kt base URL ${logMsg}.`);
        } else {
            log.info('⚠️ Neither ApiConfig.kt nor NetworkModule.kt found.');
        }
    }
}

module.exports = {
    escapeRegExp,
    escapeXmlText,
    escapeKotlinString,
    setApiBaseUrls,
    removeCiDetektStep,
    sanitizeXcconfigValue,
    setSchemeBuildableName,
    replaceInContent,
    movePackageStructure,
    cleanEmptyDirs,
    cleanImlFiles,
    processAllFiles,
    updateAppConfig,
    updateiOSProject,
    updateiOSConfigFiles,
    wireFeatureModules,
    processBlankApp,
    removeTomlEntries,
    stripAdsInfoPlist,
    stripAdsManifest,
    stripAdsBridgeRegistration,
    assertNoNetworkMonitorResidue,
    assertNoNetworkResidue,
    assertNoMonetizationResidue,
    assertNoRoomResidue,
    assertNoBackendResidue,
    findResidue,
    BACKEND_RESIDUE_TOKENS,
    processCoreFeatures,
    sortImportsLikeKtlint,
    sortKotlinImports
};
