'use strict';
const { validateBackend } = require('./validate');
const { BACKEND_SCHEMA, backendContractVersion } = require('./contract');
const { applySharingOption, resolveContent } = require('./options');
const { applyBackendIdentity } = require('./identity');
const { verifyBackendProject } = require('./verifier');
const { RECORD_PATH, buildBackendRecord, writeBackendRecord } = require('./record');
const { generateBackend } = require('./generate');
const { describeBackend } = require('./describe');

module.exports = {
    validateBackend,
    BACKEND_SCHEMA,
    backendContractVersion,
    applySharingOption,
    resolveContent,
    applyBackendIdentity,
    verifyBackendProject,
    RECORD_PATH,
    buildBackendRecord,
    writeBackendRecord,
    generateBackend,
    describeBackend
};
