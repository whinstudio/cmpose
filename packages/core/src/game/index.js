'use strict';
const { validateGame } = require('./validate');
const { GAME_SCHEMA, gameContractFacts, gameContractVersion } = require('./contract');
const { generateGame } = require('./generate');
const { describeGame } = require('./describe');
const { cloneModules } = require('./modules');
const { applyGameIdentity } = require('./identity');
const { writeGameIds } = require('./ids');
const { applyGameReadme } = require('./readme');
const { buildGameRecord, writeGameRecord } = require('./record');
const { verifyGameProject } = require('./verifier');
const { readThemes, validateTheme, ThemesFileError } = require('./themes');
const { applyTheme } = require('./applyTheme');
const { derivePalette } = require('./themeColors');

module.exports = {
    validateGame,
    generateGame,
    describeGame,
    GAME_SCHEMA,
    gameContractFacts,
    gameContractVersion,
    cloneModules,
    applyGameIdentity,
    writeGameIds,
    applyGameReadme,
    buildGameRecord,
    writeGameRecord,
    verifyGameProject,
    readThemes,
    ThemesFileError,
    validateTheme,
    applyTheme,
    derivePalette,
    flags: require('./flags'),
    guid: require('./guid'),
    guidIntegrity: require('./guidIntegrity'),
    unityYaml: require('./unityYaml'),
    projectSettings: require('./projectSettings'),
    buildScenes: require('./buildScenes'),
    packages: require('./packages'),
    markers: require('./markers'),
    residue: require('./residue')
};
