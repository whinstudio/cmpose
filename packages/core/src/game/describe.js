'use strict';
const pins = require('../pins');
const { GAME_SCHEMA, gameContractFacts, gameContractVersion } = require('./contract');

// What a planner needs to pick a family: palettes, style and font paths stay in the template
function summarizeThemes(themes) {
    const families = themes && Array.isArray(themes.families) ? themes.families : [];
    return {
        default: families.length ? themes.default : null,
        families: families.map((f) => ({ id: f.id, title: f.title, suits: f.suits, fontPairs: f.fontPairs.map((p) => p.id) }))
    };
}

/** What the Unity game generator offers: engine, pinned template, defaults, the template's theme families
 * (readThemes of the pinned template; none when not given) and the contract facts */
function describeGame({ themes = null } = {}) {
    return {
        engine: GAME_SCHEMA.engine,
        unityVersion: GAME_SCHEMA.unityVersion,
        contractVersion: gameContractVersion(),
        template: pins.game,
        defaults: {
            templateType: 'showcase',
            render: '2d',
            flags: { showcase: GAME_SCHEMA.flags.slice(), blank: [] },
            features: [],
            minSdk: GAME_SCHEMA.limits.minSdkMin,
            iosVersion: GAME_SCHEMA.limits.iosVersionMin
        },
        // Outside `contract`: the families belong to the template, contractVersion hashes the contract only
        themes: summarizeThemes(themes),
        contract: gameContractFacts()
    };
}

module.exports = { describeGame, summarizeThemes };
