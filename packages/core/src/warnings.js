'use strict';
const { SHOWCASE_FEATURES } = require('./showcaseModules');
// What the user must replace before release (showcase has both on). insights: whether the project keeps
// core/insights (showcase: when its template has it); by default blank's flag. features: the requested modules
function generationWarnings({ templateType, featuresConfig, insights, features = [] }) {
    const on = (key) => templateType === 'showcase' || (featuresConfig != null && featuresConfig[key] === true);
    const warnings = [];
    if (on('ads')) warnings.push('Ads use AdMob test IDs: replace them with your own before release.');
    if (on('purchases')) warnings.push('Purchases use the RevenueCat Test Store key: replace it before release.');
    // Backend is blank only: showcase never has it
    if (templateType === 'blank' && featuresConfig != null && featuresConfig.backend === true) {
        warnings.push('Sign-in needs your Firebase config files (google-services.json, GoogleService-Info.plist) and the server: run ./gradlew :server:runLocal; see the README (Android: adb reverse tcp:18001 tcp:18001).');
    }
    const insightsOn = insights === undefined
        ? templateType === 'blank' && featuresConfig != null && featuresConfig.insights === true
        : insights === true;
    if (insightsOn) warnings.push('Crashlytics and Analytics stay off until you add the Firebase config files (README, Insights).');
    // Blank settings whose flag is off are never written (fileService); say so instead of dropping them silently
    if (templateType === 'blank' && featuresConfig != null) {
        const given = (v) => typeof v === 'string' && v.trim().length > 0;
        if (given(featuresConfig.networkBaseUrl) && featuresConfig.network !== true) {
            warnings.push('featuresConfig.networkBaseUrl was not used: it applies only with featuresConfig.network on.');
        }
        if (given(featuresConfig.detektYamlContent) && featuresConfig.detekt !== true) {
            warnings.push('featuresConfig.detektYamlContent was not used: it applies only with featuresConfig.detekt on.');
        }
    }
    // Showcase keeps its own home and onboarding: a request for them is dropped, never regenerated (blank clones them)
    if (templateType === 'showcase') {
        const own = [...new Set((features || []).map((f) => f.toLowerCase().trim()))].filter((f) => SHOWCASE_FEATURES.includes(f));
        if (own.length > 0) {
            warnings.push(`features ${own.join(', ')} were not generated: they are the template's own modules (already in the project).`);
        }
    }
    return warnings;
}

module.exports = { generationWarnings };
