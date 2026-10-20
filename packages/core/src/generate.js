'use strict';
const fs = require('fs-extra');
const path = require('path');
const { log } = require('./log');
const { OLD_PACKAGE_NAME, OLD_PROJECT_NAME } = require('./templateIdentity');
const { readTemplateVersions, COMMIT_FILE_NAME, REF_FILE_NAME } = require('./templateVersions');
const {
    processAllFiles, movePackageStructure, updateiOSProject, updateiOSConfigFiles,
    cleanImlFiles, wireFeatureModules, processBlankApp, sortKotlinImports
} = require('./fileService');
const { applyBlankShell, cloneFeatureModules, assertTemplateCapabilities } = require('./featureModules');
const { applyCiOption } = require('./ciOption');
const { applyBackendOption } = require('./backendOption');
const { writePrivacyManifest } = require('./privacyManifest');
const { fillReadme } = require('./readmeService');
const { buildGenerationRecord, writeGenerationRecord } = require('./generationRecord');
const { verifyGeneratedProject } = require('./generationVerifier');
const { generationWarnings } = require('./warnings');
const { placeServer, SERVER_DIR } = require('./serverFromBackend');

// Turns a fresh template copy (projectDir) into the requested project, in place.
// value: validate().value. Throws when the template lacks an option or the result fails verification.
// backendTemplate ({ dir, repo, ref, commit }): a fresh backend template copy, required for blank with the backend; it
// is moved into the project as server/. serverImageCheck: the verifier's server image check (opt-in: a check, true for
// Docker, false for none; unset, CMPOSE_SERVER_IMAGE_CHECK=1 asks for Docker).
async function generateCmpProject(value, { projectDir, generatorVersion = null, backendTemplate = null, serverImageCheck } = {}) {
    const { projectName, appName, packageName, templateType, features, featuresConfig, ci, minSdk, iosVersion } = value;
    const blankConfig = templateType === 'blank' ? featuresConfig : null;
    const backendOn = templateType === 'blank' && featuresConfig.backend === true;
    // Before anything is touched: server/ comes from the backend template only
    if (backendOn && !(backendTemplate && backendTemplate.dir)) {
        throw new Error('backend: the backend template is required (backendTemplate)');
    }
    if (backendOn && (await fs.pathExists(path.join(projectDir, SERVER_DIR)))) {
        throw new Error(`backend: the CMP template already has ${SERVER_DIR}/, which comes from the backend template (use a newer templateRef)`);
    }

    // An older template without the modules an on flag needs stops here, naming what is missing
    await assertTemplateCapabilities(projectDir, templateType, featuresConfig);

    // The template's own versions (SDK levels for the log, the README's requirements table)
    const versions = await readTemplateVersions(projectDir);
    const sdk = (v) => v || 'template default';
    log.info(`📱 Android: Min ${minSdk} | Target ${sdk(versions.targetSdk)} | Compile ${sdk(versions.compileSdk)}`);

    // Which template: the cache's own markers, read before they are removed below
    const readMarker = (name) => fs.readFile(path.join(projectDir, name), 'utf8').then((v) => v.trim() || null, () => null);
    const templateRef = await readMarker(REF_FILE_NAME);
    const templateCommit = await readMarker(COMMIT_FILE_NAME);

    // The cache's own records and IDE state never reach the project, nor does the template's own
    // licence: the generated project is the user's, to license as they choose
    for (const leftover of ['.git', '.idea', 'local.properties', 'LICENSE', COMMIT_FILE_NAME, REF_FILE_NAME]) {
        await fs.remove(path.join(projectDir, leftover));
    }
    await cleanImlFiles(projectDir);
    log.info('✅ Cleanup completed');

    let sanitizedFeatures = (features || []).map((f) => f.toLowerCase().trim());
    // Showcase's home and onboarding have custom dependencies: never regenerated
    if (templateType === 'showcase') {
        sanitizedFeatures = sanitizedFeatures.filter((f) => f !== 'home' && f !== 'onboarding');
    }

    // blank's shell and every requested module come from the template, applied on the
    // template's own package before the rename below
    await applyBlankShell(projectDir, templateType, featuresConfig);
    // The backend's parts stay (markers dropped) for blank with backend on; everywhere else they go
    await applyBackendOption(projectDir, backendOn);
    await cloneFeatureModules(projectDir, sanitizedFeatures);
    log.info(`✅ Template skeleton ready (${sanitizedFeatures.length} feature modules)`);

    await processAllFiles(projectDir, OLD_PACKAGE_NAME, packageName, OLD_PROJECT_NAME, projectName, appName, { minSdk, iosVersion });
    log.info('✅ Files updated');

    await movePackageStructure(projectDir, OLD_PACKAGE_NAME, packageName);
    log.info('✅ Package structure updated');

    // Blank first (drops the default modules), then the custom feature modules
    if (templateType === 'blank') {
        await processBlankApp(projectDir, packageName, sanitizedFeatures, featuresConfig);
        log.info('✅ Processed Blank App template');
    }
    if (sanitizedFeatures.length > 0) {
        await wireFeatureModules(projectDir, packageName, sanitizedFeatures);
        log.info(`✅ Wired ${sanitizedFeatures.length} feature modules`);
    }

    // The CI workflow is opt-in; after processBlankApp, which drops its detekt step when detekt is off
    await applyCiOption(projectDir, ci);

    await updateiOSProject(projectDir, packageName, iosVersion);
    await updateiOSConfigFiles(projectDir, packageName, appName, iosVersion);
    // Store-ready: the privacy manifest declares the data the on flags collect (showcase: ads and
    // purchases on, never backend)
    await writePrivacyManifest(projectDir, templateType === 'blank'
        ? { ads: featuresConfig.ads === true, purchases: featuresConfig.purchases === true, backend: backendOn }
        : { ads: true, purchases: true, backend: false });
    log.info('✅ iOS configuration updated');

    // Package rename and module cloning moved imports out of ktlint order: re-sort them last
    await sortKotlinImports(projectDir);

    // server/ comes from the backend template, after the app's rename and import sort (which never touch it)
    const server = backendOn
        ? await placeServer(projectDir, { packageName, projectName, backendTemplate, generatorVersion })
        : null;
    const serverTemplate = server ? server.template : null;

    // After server/ is in place: the module list names it
    await fillReadme(projectDir, { versions, minSdk, iosVersion });

    // The project's trace: which template, which generator, which options; no personal data
    await writeGenerationRecord(projectDir, buildGenerationRecord({
        templateRef, templateCommit, backendRevision: generatorVersion,
        templateType, ci, minSdk, iosVersion,
        features: sanitizedFeatures,
        featuresConfig: blankConfig,
        serverTemplate
    }));

    // Last check: a broken project is never returned
    await verifyGeneratedProject(projectDir, {
        projectName, appName, packageName, templateType,
        features: sanitizedFeatures,
        featuresConfig: blankConfig
    }, { serverImageCheck });

    return {
        projectDir, templateRef, templateCommit, templateType,
        features: sanitizedFeatures,
        versions,
        serverTemplate,
        warnings: generationWarnings({ templateType, featuresConfig })
    };
}

module.exports = { generateCmpProject };
