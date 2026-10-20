'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { hashContract } = require('../src/contract');
const { BACKEND_SCHEMA, backendContractVersion } = require('../src/backend/contract');

test('backendContractVersion is 12 hex chars and stable', () => {
    assert.match(backendContractVersion(), /^[0-9a-f]{12}$/);
    assert.strictEqual(backendContractVersion(), backendContractVersion());
    assert.strictEqual(backendContractVersion(), hashContract(BACKEND_SCHEMA));
});

test('backendContractVersion is the published value (the sample option changed it)', () => {
    assert.strictEqual(backendContractVersion(), 'c27b8f701820');
});

test('backendContractVersion changes with the schema', () => {
    const changed = { ...BACKEND_SCHEMA, anatomy: { ...BACKEND_SCHEMA.anatomy, localPort: BACKEND_SCHEMA.anatomy.localPort + 1 } };
    assert.notStrictEqual(hashContract(changed), backendContractVersion());
});

test('BACKEND_SCHEMA names the template identity and is frozen', () => {
    const { sqlKeywords, ...appName } = BACKEND_SCHEMA.appName;
    assert.deepStrictEqual(appName, {
        pattern: '^[a-z][a-z0-9-]{1,30}$',
        reserved: ['api', 'health', 'admin', 'static'],
        infrastructure: ['postgres', 'nginx', 'proxy', 'db', 'redis'],
        postgresReserved: ['public', 'template0', 'template1', 'postgres'],
        postgresPrefix: 'pg_'
    });
    assert.deepStrictEqual({ ...BACKEND_SCHEMA, appName: undefined }, {
        appName: undefined,
        options: { sharing: { type: 'boolean', default: false }, sample: { type: 'boolean', default: true } },
        identity: { package: 'io.cmpose.backendtemplate', appName: 'cmpose-app', projectName: 'Cmpose Backend' },
        anatomy: { localTask: 'runLocal', localPort: 18001, deployDir: 'deploy' }
    });
    assert.ok(Object.isFrozen(BACKEND_SCHEMA));
    for (const list of ['reserved', 'infrastructure', 'postgresReserved', 'sqlKeywords']) assert.ok(Object.isFrozen(BACKEND_SCHEMA.appName[list]), list);
    // the key word list: lower case, unique, and every reserved key word a database name could spell
    assert.strictEqual(new Set(sqlKeywords).size, sqlKeywords.length);
    for (const word of sqlKeywords) assert.match(word, /^[a-z_]+$/);
    for (const word of ['user', 'order', 'select', 'table', 'group', 'all', 'default', 'grant', 'check', 'current_user', 'join', 'system_user']) {
        assert.ok(sqlKeywords.includes(word), word);
    }
});
