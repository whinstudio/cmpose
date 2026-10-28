/**
 * `featuresConfig` normalization (for `templateType: 'blank'` only).
 * Pure function: no HTTP or file system, does not mutate its input.
 *
 * The web wizard applied the dependency rules (networkInspector ⇒ network,
 * backend ⇒ multiLang + network, theming || multiLang ⇒ dataStore) only on the client; this function applies
 * the same rules here too (as auto-true, never as an error) and fills missing
 * keys with safe defaults, so `fileService.js` always gets a complete,
 * consistent object.
 */

const { SCHEMA } = require('./contract');

const DEFAULTS = Object.freeze({
    network: false,
    networkInspector: false,
    theming: false,
    multiLang: false,
    dataStore: false,
    detekt: false,
    purchases: false,
    ads: false,
    room: false,
    backend: false,
    insights: false
});

// Boolean flags = the contract's featuresConfig keys that have a default (networkBaseUrl and
// detektYamlContent are strings)
const BOOLEAN_KEYS = SCHEMA.featuresConfigKeys.filter((k) => DEFAULTS[k] !== undefined);

/**
 * @param {*} cfg - featuresConfig (a plain object or undefined; requestParser guarantees this)
 * @returns {{ ok: true, value: Object } | { ok: false, error: string }}
 */
function normalizeFeaturesConfig(cfg) {
    const input = cfg === undefined ? {} : cfg;
    const value = { ...DEFAULTS };

    for (const key of BOOLEAN_KEYS) {
        if (input[key] !== undefined) {
            if (typeof input[key] !== 'boolean') {
                return { ok: false, error: `featuresConfig.${key} must be a boolean` };
            }
            value[key] = input[key];
        }
    }

    if (input.networkBaseUrl !== undefined && input.networkBaseUrl !== null) {
        if (typeof input.networkBaseUrl !== 'string') {
            return { ok: false, error: 'featuresConfig.networkBaseUrl must be a string' };
        }
        value.networkBaseUrl = input.networkBaseUrl;
    }

    if (input.detektYamlContent !== undefined && input.detektYamlContent !== null) {
        if (typeof input.detektYamlContent !== 'string') {
            return { ok: false, error: 'featuresConfig.detektYamlContent must be a string' };
        }
        value.detektYamlContent = input.detektYamlContent;
    }

    // Dependency rules: always auto-true, never an error.
    for (const [flag, required] of Object.entries(SCHEMA.dependencyRules.implies)) {
        if (value[flag] === true) required.forEach((r) => { value[r] = true; });
    }
    for (const [flag, triggers] of Object.entries(SCHEMA.dependencyRules.auto)) {
        if (triggers.some((t) => value[t] === true)) value[flag] = true;
    }

    return { ok: true, value };
}

module.exports = { normalizeFeaturesConfig, BOOLEAN_KEYS, DEFAULTS };
