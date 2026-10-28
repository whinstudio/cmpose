'use strict';
// What the user must replace before release (showcase has both on). insights: whether the project keeps
// core/insights (showcase: when its template has it); by default blank's flag
function generationWarnings({ templateType, featuresConfig, insights }) {
    const on = (key) => templateType === 'showcase' || (featuresConfig != null && featuresConfig[key] === true);
    const warnings = [];
    if (on('ads')) warnings.push('Ads use AdMob test IDs: replace them with your own before release.');
    if (on('purchases')) warnings.push('Purchases use the RevenueCat Test Store key: replace it before release.');
    // Backend is blank only: showcase never has it
    if (templateType === 'blank' && featuresConfig != null && featuresConfig.backend === true) {
        warnings.push('Sign-in needs your Firebase config files (google-services.json, GoogleService-Info.plist) and the server: run ./gradlew :server:runLocal; see the README.');
    }
    const insightsOn = insights === undefined
        ? templateType === 'blank' && featuresConfig != null && featuresConfig.insights === true
        : insights === true;
    if (insightsOn) warnings.push('Crashlytics and Analytics stay off until you add the Firebase config files (README, Insights).');
    return warnings;
}

module.exports = { generationWarnings };
