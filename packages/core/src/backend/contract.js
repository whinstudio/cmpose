'use strict';
const { hashContract } = require('../contract');

// The Ktor backend generator's contract: what the backend_* tools accept. Published facts feed contractVersion.
const BACKEND_SCHEMA = Object.freeze({
    appName: Object.freeze({
        pattern: '^[a-z][a-z0-9-]{1,30}$',
        // the server's own route prefixes
        reserved: Object.freeze(['api', 'health', 'admin', 'static']),
        // the shared server's own services, which an app's compose service and nginx location must not shadow
        infrastructure: Object.freeze(['postgres', 'nginx', 'proxy', 'db', 'redis']),
        // PostgreSQL's own databases and schema, and its pg_ prefix for roles (matched on the database name)
        postgresReserved: Object.freeze(['public', 'template0', 'template1', 'postgres']),
        postgresPrefix: 'pg_',
        // PostgreSQL's reserved key words (both reserved columns of the key word appendix): the database name never is one
        sqlKeywords: Object.freeze([
            'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric', 'authorization', 'binary', 'both',
            'case', 'cast', 'check', 'collate', 'collation', 'column', 'concurrently', 'constraint', 'create', 'cross',
            'current_catalog', 'current_date', 'current_role', 'current_schema', 'current_time', 'current_timestamp',
            'current_user', 'default', 'deferrable', 'desc', 'distinct', 'do', 'else', 'end', 'except', 'false', 'fetch',
            'for', 'foreign', 'freeze', 'from', 'full', 'grant', 'group', 'having', 'ilike', 'in', 'initially', 'inner',
            'intersect', 'into', 'is', 'isnull', 'join', 'lateral', 'leading', 'left', 'like', 'limit', 'localtime',
            'localtimestamp', 'natural', 'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order', 'outer',
            'overlaps', 'placing', 'primary', 'references', 'returning', 'right', 'select', 'session_user', 'similar',
            'some', 'symmetric', 'system_user', 'table', 'tablesample', 'then', 'to', 'trailing', 'true', 'union', 'unique',
            'user', 'using', 'variadic', 'verbose', 'when', 'where', 'window', 'with'
        ])
    }),
    options: Object.freeze({
        sharing: Object.freeze({ type: 'boolean', default: false }),
        sample: Object.freeze({ type: 'boolean', default: true })
    }),
    // The template's own names, which the generator renames
    identity: Object.freeze({ package: 'io.cmpose.backendtemplate', appName: 'cmpose-app', projectName: 'Cmpose Backend' }),
    anatomy: Object.freeze({ localTask: 'runLocal', localPort: 18001, deployDir: 'deploy' })
});

function backendContractVersion() {
    return hashContract(BACKEND_SCHEMA);
}

module.exports = { BACKEND_SCHEMA, backendContractVersion };
