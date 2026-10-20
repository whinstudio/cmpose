'use strict';
const path = require('path');
const PV = require('../ProjectValidator');
const { BACKEND_SCHEMA: S } = require('./contract');

const APP_NAME_RE = new RegExp(S.appName.pattern);
// templateCache's ref rule: a tag or branch name, never a path
const REF_RE = /^[A-Za-z0-9_.-]+$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTemplatePackage = (v) => v === S.identity.package || v.startsWith(S.identity.package + '.');

// Why an appName cannot name a server service, a database and its user (null = it can)
function databaseNameProblem(appName) {
    const dbName = appName.replace(/-/g, '_');
    if (S.appName.infrastructure.includes(appName)) {
        return `appName "${appName}" is a server service name (${S.appName.infrastructure.join(', ')})`;
    }
    if (S.appName.postgresReserved.includes(dbName)) return `appName "${appName}" is a PostgreSQL reserved name (${S.appName.postgresReserved.join(', ')})`;
    if (dbName.startsWith(S.appName.postgresPrefix)) return `appName "${appName}" starts with pg-: PostgreSQL reserves ${S.appName.postgresPrefix} for its own roles`;
    if (S.appName.sqlKeywords.includes(dbName)) return `appName "${appName}" gives the database name ${dbName}, a PostgreSQL reserved key word`;
    return null;
}

// Why ref cannot name a backend template tag (null = it can); field names the input in the message
function templateRefProblem(ref, field = 'templateRef') {
    if (typeof ref !== 'string' || !REF_RE.test(ref) || ref.startsWith('.')) {
        return `${field} must be a tag or branch name (letters, digits, ., _ or -, not starting with .)`;
    }
    return null;
}

// Every problem as { field, message }; the value holds only the known fields (sharing defaults to false, sample to true)
function validateBackend(input) {
    if (!isObject(input)) return { ok: false, errors: [{ field: 'input', message: 'input must be an object' }] };
    const { projectName, appName, packageName, outputDir, sharing, sample, templateRef } = input;
    const errors = [];
    const fail = (field, message) => errors.push({ field, message });

    if (typeof projectName !== 'string' || !PV.validateProjectName(projectName)) fail('projectName', PV.messages.projectNameInvalid);
    else if (projectName.length > PV.MAX_LENGTH_PROJECT_NAME) fail('projectName', PV.messages.projectNameTooLong);

    if (typeof appName !== 'string' || !APP_NAME_RE.test(appName)) {
        fail('appName', 'appName must be 2-31 lowercase letters, digits or -, starting with a letter');
    } else if (S.appName.reserved.includes(appName)) {
        fail('appName', `appName "${appName}" is reserved (${S.appName.reserved.join(', ')})`);
    } else {
        const problem = databaseNameProblem(appName);
        if (problem) fail('appName', problem);
    }

    if (typeof packageName !== 'string' || !PV.validatePackageName(packageName) || isTemplatePackage(packageName)) {
        fail('packageName', PV.messages.packageNameInvalid);
    } else if (packageName.length > PV.MAX_LENGTH_PACKAGE_NAME) {
        fail('packageName', PV.messages.packageNameTooLong);
    }

    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) fail('outputDir', 'outputDir must be an absolute path');

    if (sharing !== undefined && typeof sharing !== 'boolean') fail('sharing', 'sharing must be true or false');
    if (sample !== undefined && typeof sample !== 'boolean') fail('sample', 'sample must be true or false');

    if (templateRef !== undefined) {
        const problem = templateRefProblem(templateRef);
        if (problem) fail('templateRef', problem);
    }

    if (errors.length) return { ok: false, errors };
    const value = {
        projectName, appName, packageName, outputDir,
        sharing: sharing === undefined ? S.options.sharing.default : sharing,
        sample: sample === undefined ? S.options.sample.default : sample
    };
    if (templateRef !== undefined) value.templateRef = templateRef;
    return { ok: true, value };
}

module.exports = { validateBackend, templateRefProblem };
