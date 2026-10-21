'use strict';
const pins = require('../pins');
const { BACKEND_SCHEMA: S, backendContractVersion } = require('./contract');

// The quota convention; sharing false leaves out the space, member and invite quotas
function quotasConvention(sharing) {
    if (sharing === false) {
        return 'MAX_STORAGE_BYTES_PER_USER (default 100 MB) caps new writes; 0 turns it off. ' +
            'A refused write answers 409 QUOTA_EXCEEDED with quota = storage.';
    }
    return 'MAX_STORAGE_BYTES_PER_USER (default 100 MB), and with sharing MAX_SPACES_PER_USER (20), MAX_MEMBERS_PER_SPACE (50) ' +
        'and MAX_PENDING_INVITES_PER_SPACE (20) cap new writes; 0 turns one off. ' +
        'A refused write answers 409 QUOTA_EXCEEDED with quota = storage | spaces | members | invites.';
}

/** What the Ktor backend generator offers, plus the rules an AI client follows when it writes code in the project.
 * sharing false describes a project without sharing; left out, the conventions cover both. */
function describeBackend({ sharing } = {}) {
    const port = S.anatomy.localPort;
    return {
        contractVersion: backendContractVersion(),
        templateRef: pins.backend.ref,
        template: pins.backend,
        options: {
            sharing: {
                type: S.options.sharing.type,
                default: S.options.sharing.default,
                description: 'Spaces shared between users, with roles (viewer, editor, owner) and invitations (an owner lists and revokes pending ones). ' +
                    'Off: every row belongs to one user.'
            },
            sample: {
                type: S.options.sample.type,
                default: S.options.sample.default,
                description: 'Include the sample items feature (feature/sample) as the shape to copy'
            }
        },
        appNameRules: {
            pattern: S.appName.pattern,
            reserved: S.appName.reserved.slice(),
            infrastructure: S.appName.infrastructure.slice(),
            postgresReserved: S.appName.postgresReserved.slice(),
            postgresPrefix: 'pg-',
            sqlKeywords: S.appName.sqlKeywords.slice(),
            databaseName: 'appName with - replaced by _ (database and database user)'
        },
        anatomy: {
            stack: 'Kotlin on JVM 21, Ktor, Exposed, Flyway, PostgreSQL, HikariCP; Firebase ID tokens verified on the server',
            paths: {
                'src/main/kotlin/<package>/config': 'AppConfig: every setting, read from the environment',
                'src/main/kotlin/<package>/plugins': 'errors, security headers, CORS, body limits, rate limits, request ids, client version',
                'src/main/kotlin/<package>/auth': 'token verification and requireUser()',
                'src/main/kotlin/<package>/users': 'GET and DELETE /api/v1/me, PUT /api/v1/me/profile',
                'src/main/kotlin/<package>/files': 'uploads and downloads',
                'src/main/kotlin/<package>/feature/sample': 'the sample feature (/api/v1/items paged, /api/v1/items/recent one bounded array): the shape to copy (sample only)',
                'src/main/kotlin/<package>/sharing': 'spaces, roles and invitations (sharing only)',
                'src/main/kotlin/<package>/openapi': 'the API description, served at /api/v1/openapi.json',
                'src/main/resources/db/migration': 'Flyway migrations (V<n>__<name>.sql)',
                'src/local/kotlin': 'the local runner (embedded PostgreSQL)',
                [S.anatomy.deployDir + '/']: 'Dockerfile, compose fragment, nginx location, database script, .env.example'
            },
            routes: { api: '/api/v1', liveness: '/health', readiness: '/ready', openapi: '/api/v1/openapi.json' },
            containerPort: 8080,
            localPort: port,
            requiredEnv: ['DATABASE_URL', 'DATABASE_USER', 'DATABASE_PASSWORD', 'FIREBASE_PROJECT_ID', 'FILES_DIR']
        },
        conventions: {
            protectRoutes: 'Every route under /api/v1 calls call.requireUser() before it reads the body or looks anything up (401 without a valid token). ' +
                'With sharing, a route on a space\'s data calls call.requireRole(spaces, spaceId, Role.VIEWER) to read and Role.EDITOR to write, ' +
                'then uses the returned membership.spaceId.',
            notFoundRule: 'A row the caller may not see (another user\'s, or with sharing a space where the caller is not a member or has too low a role) ' +
                'answers 404 NOT_FOUND exactly like a missing row: never 403. Every query filters by the owner (owner_id, or space_id with sharing) in the same query.',
            newFeature: 'Put a new feature under src/main/kotlin/<package>/feature/<name>/ (table, repository, routes, DTOs) ' +
                'copying feature/sample when present, otherwise the shape of files/; ' +
                'add a new migration V<n>__<name>.sql (never edit one that has run), its tests (IDOR and validation included) and its routes in openapi/OpenApiSpec.kt. ' +
                'A list that can grow pages with limit and an opaque cursor (as GET /api/v1/items); a small list with a fixed upper bound may answer in one array ' +
                '(as GET /api/v1/items/recent); never an unbounded list.',
            newTable: 'Every new table points at its owner with REFERENCES users(id) ON DELETE CASCADE (with sharing: spaces(id) ON DELETE CASCADE), ' +
                'so account deletion removes its rows.',
            securityChecklist: 'Go through SECURITY-CHECKLIST.md for every new route or table: authorization, owner filter, validation at the boundary, ' +
                'DTOs without id/owner/role fields, no SQL string building, no personal data in logs, rate limits on sensitive routes.',
            errors: 'Fail with notFound(), badRequest(...) or an ApiException; the body is {"error":{"code","message","requestId"}} (+ fields for validation). ' +
                'A 500 carries no detail.',
            quotas: quotasConvention(sharing),
            runLocal: `./gradlew ${S.anatomy.localTask} serves on 127.0.0.1:${port} with an embedded PostgreSQL in .local-server/; ` +
                'it needs .local-server/config.properties with firebaseProjectId=<Firebase project id> (optional port=). ' +
                './gradlew resetLocal deletes .local-server/; ./gradlew build compiles, runs detekt and the tests.',
            deploy: `${S.anatomy.deployDir}/ holds the Dockerfile (container port 8080), docker-compose.<appName>.yml, nginx/<appName>.conf, ` +
                'sql/create-<appName>.sql, .env.example and README.md (first deployment, updates, rollback); secrets come only from the environment. ' +
                'bash tools/deploy-lint.sh checks them.',
            clientHeaders: 'The app sends Authorization: Bearer <Firebase ID token> and X-Client-Version; below MIN_CLIENT_VERSION the answer is 426 CLIENT_UPGRADE_REQUIRED.'
        }
    };
}

module.exports = { describeBackend };
