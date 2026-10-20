'use strict';
const PV = require('./ProjectValidator');
const LIMITS = require('./limits');
const { configureValidator } = require('./contract');
const { parseGenerateBody } = require('./requestParser');
const { normalizeFeaturesConfig } = require('./featuresConfig');
const { serverPackageOf } = require('./serverFromBackend');

// compile/target SDK come from the template (AppConfig.kt); a minSdk above its targetSdk cannot build
function minSdkAboveTarget(minSdk, targetSdk) {
    if (targetSdk && Number(minSdk) > Number(targetSdk)) {
        return `Min SDK cannot be higher than the template's target SDK (${targetSdk})`;
    }
    return null;
}

// The hosted generator's and the local MCP's one check: body shape first, then the rules in
// the order the wizard shows them. templateTargetSdk: skip when no template is at hand yet.
function validate(input, { limits = LIMITS, templateTargetSdk = null } = {}) {
    configureValidator(limits);
    const parsed = parseGenerateBody(input);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { features, templateType, featuresConfig, ci, minSdk, iosVersion } = parsed.value;
    const projectName = parsed.value.projectName.trim();
    const appName = parsed.value.appName.trim();
    const packageName = parsed.value.packageName.trim();
    const fail = (error) => ({ ok: false, error });

    if (!PV.validateMaxLength(projectName, PV.MAX_LENGTH_PROJECT_NAME)) return fail(PV.messages.projectNameTooLong);
    if (!PV.validateNoSpaces(projectName)) return fail(PV.messages.projectNameSpaces);
    if (!PV.validateProjectName(projectName)) return fail(PV.messages.projectNameInvalid);
    if (!PV.validateMaxLength(packageName, PV.MAX_LENGTH_PACKAGE_NAME)) return fail(PV.messages.packageNameTooLong);
    if (!PV.validateNoSpaces(packageName)) return fail(PV.messages.packageNameSpaces);
    if (!PV.validatePackageName(packageName)) return fail(PV.messages.packageNameInvalid);
    if (!PV.validateAppName(appName)) return fail(PV.messages.appNameInvalid);

    // Showcase's own modules (home, onboarding) are locked: only custom modules count
    const customFeatures = (features || []).filter((f) =>
        templateType !== 'showcase' || (f !== 'home' && f !== 'onboarding'));
    if (!PV.validateModuleCount(customFeatures.length)) return fail(PV.messages.maxModulesReached);
    if (new Set(customFeatures).size !== customFeatures.length) return fail(PV.messages.moduleNameDuplicate);
    for (const moduleName of features || []) {
        if (!PV.validateMaxLength(moduleName, PV.MAX_LENGTH_MODULE_NAME)) return fail(PV.messages.moduleNameTooLong);
        if (!PV.validateModuleName(moduleName)) return fail(PV.messages.moduleNameInvalid);
    }

    if (!PV.validateMinSdk(minSdk)) return fail(PV.messages.minSdkInvalid);
    // Right after the minSdk range check, before the iOS check (the hosted generator's order)
    const sdkError = minSdkAboveTarget(minSdk, templateTargetSdk);
    if (sdkError) return fail(sdkError);
    if (!PV.validateIosVersion(iosVersion)) return fail(PV.messages.iosVersionInvalid);

    // Blank's featuresConfig gets the defaults and the dependency rules; showcase ignores it
    let normalizedFeaturesConfig = featuresConfig;
    if (templateType === 'blank') {
        const normalized = normalizeFeaturesConfig(featuresConfig);
        if (!normalized.ok) return fail(normalized.error);
        normalizedFeaturesConfig = normalized.value;
        // The base URL is checked only where it is written (blank, network on, URL given)
        if (normalizedFeaturesConfig.network === true && normalizedFeaturesConfig.networkBaseUrl &&
            !PV.validateUrl(normalizedFeaturesConfig.networkBaseUrl)) {
            return fail(PV.messages.urlInvalid);
        }
        // The backend's server package is the app's plus .server (server/ from the backend template)
        if (normalizedFeaturesConfig.backend === true) {
            const serverPackage = serverPackageOf(packageName);
            if (!PV.validatePackageName(serverPackage) || !PV.validateMaxLength(serverPackage, PV.MAX_LENGTH_PACKAGE_NAME)) {
                return fail(`packageName is too long for the server package (${serverPackage})`);
            }
        }
    }

    return {
        ok: true,
        value: {
            projectName, appName, packageName, templateType,
            features: features || [],
            featuresConfig: normalizedFeaturesConfig,
            ci, minSdk, iosVersion
        }
    };
}

module.exports = { validate, minSdkAboveTarget };
