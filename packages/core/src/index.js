'use strict';
const { log, setLogger } = require('./log');
const contract = require('./contract');
const requestParser = require('./requestParser');
const { readTemplateVersions, COMMIT_FILE_NAME, REF_FILE_NAME } = require('./templateVersions');

module.exports = {
    version: require('../package.json').version,
    log,
    setLogger,
    templateIdentity: require('./templateIdentity'),
    limits: require('./limits'),
    pins: require('./pins'),
    SCHEMA: contract.SCHEMA,
    contractFacts: contract.contractFacts,
    hashContract: contract.hashContract,
    readTemplateVersions,
    COMMIT_FILE_NAME,
    REF_FILE_NAME,
    ProjectValidator: require('./ProjectValidator'),
    // The validator is also a browser script (the hosted wizard serves this file as is)
    validatorPath: require.resolve('./ProjectValidator'),
    requestParser,
    TEMPLATE_TYPES: requestParser.TEMPLATE_TYPES,
    featuresConfig: require('./featuresConfig'),
    generationRecord: require('./generationRecord'),
    fileService: require('./fileService'),
    featureModules: require('./featureModules'),
    backendOption: require('./backendOption'),
    markerBlocks: require('./markerBlocks'),
    TemplateCapabilityError: require('./featureModules').TemplateCapabilityError,
    verifyGeneratedProject: require('./generationVerifier').verifyGeneratedProject,
    validate: require('./validate').validate,
    minSdkAboveTarget: require('./validate').minSdkAboveTarget,
    generationWarnings: require('./warnings').generationWarnings,
    generateCmpProject: require('./generate').generateCmpProject,
    templateCache: require('./templateCache'),
    game: require('./game'),
    backend: require('./backend'),
    TemplateFetchError: require('./templateCache').TemplateFetchError
};
