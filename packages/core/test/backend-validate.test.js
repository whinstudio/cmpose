'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { validateBackend } = require('../src/backend/validate');

const OUT = path.resolve('/', 'tmp', 'out');
const valid = (over = {}) => ({ projectName: 'Notes', appName: 'notes-app', packageName: 'com.example.notes', outputDir: OUT, ...over });
const fieldsOf = (r) => r.errors.map((e) => e.field);

test('a valid input passes with sharing off by default', () => {
    const r = validateBackend(valid());
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.value, { projectName: 'Notes', appName: 'notes-app', packageName: 'com.example.notes', outputDir: OUT, sharing: false });
});

test('sharing and templateRef pass through when valid', () => {
    const r = validateBackend(valid({ sharing: true, templateRef: 'backend-template-2026.10.17' }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.sharing, true);
    assert.strictEqual(r.value.templateRef, 'backend-template-2026.10.17');
});

test('a reserved appName is rejected', () => {
    for (const appName of ['api', 'health', 'admin', 'static']) {
        const r = validateBackend(valid({ appName }));
        assert.strictEqual(r.ok, false);
        assert.deepStrictEqual(fieldsOf(r), ['appName']);
        assert.match(r.errors[0].message, /reserved/);
    }
});

test('an appName that names a server service is rejected', () => {
    for (const appName of ['postgres', 'nginx', 'proxy', 'db', 'redis']) {
        const r = validateBackend(valid({ appName }));
        assert.deepStrictEqual(fieldsOf(r), ['appName'], appName);
        assert.match(r.errors[0].message, /server service name/);
    }
});

test('an appName PostgreSQL reserves is rejected', () => {
    for (const appName of ['public', 'template0', 'template1']) {
        const r = validateBackend(valid({ appName }));
        assert.deepStrictEqual(fieldsOf(r), ['appName'], appName);
        assert.match(r.errors[0].message, /PostgreSQL reserved name/);
    }
    for (const appName of ['pg-notes', 'pg-x']) {
        const r = validateBackend(valid({ appName }));
        assert.deepStrictEqual(fieldsOf(r), ['appName'], appName);
        assert.match(r.errors[0].message, /starts with pg-/);
    }
});

test('an appName whose database name is a PostgreSQL reserved key word is rejected', () => {
    for (const appName of ['user', 'order', 'select', 'table', 'group', 'all', 'default', 'grant', 'check', 'current-user', 'session-user']) {
        const r = validateBackend(valid({ appName }));
        assert.deepStrictEqual(fieldsOf(r), ['appName'], appName);
        assert.match(r.errors[0].message, new RegExp(`database name ${appName.replace(/-/g, '_')}, a PostgreSQL reserved key word`));
    }
});

test('names near the forbidden ones pass', () => {
    for (const appName of ['users', 'my-db', 'orders', 'postgres-notes', 'pgnotes', 'nginx-app', 'public-notes', 'user-app', 'current']) {
        const r = validateBackend(valid({ appName }));
        assert.strictEqual(r.ok, true, `${appName}: ${JSON.stringify(r.errors)}`);
    }
});

test('appName follows the pattern', () => {
    for (const appName of ['My-App', 'a', '1app', 'app_name', 'app name', 'a'.repeat(32), 42, undefined]) {
        const r = validateBackend(valid({ appName }));
        assert.strictEqual(r.ok, false, String(appName));
        assert.deepStrictEqual(fieldsOf(r), ['appName']);
    }
    assert.strictEqual(validateBackend(valid({ appName: 'a'.repeat(31) })).ok, true);
    assert.strictEqual(validateBackend(valid({ appName: 'ab' })).ok, true);
});

test('a relative or missing outputDir is rejected', () => {
    for (const outputDir of ['out', './out', '', undefined, 7]) {
        const r = validateBackend(valid({ outputDir }));
        assert.strictEqual(r.ok, false, String(outputDir));
        assert.deepStrictEqual(fieldsOf(r), ['outputDir']);
    }
});

test('sharing must be a boolean', () => {
    for (const sharing of ['yes', 'true', 1, null]) {
        const r = validateBackend(valid({ sharing }));
        assert.strictEqual(r.ok, false, String(sharing));
        assert.deepStrictEqual(fieldsOf(r), ['sharing']);
    }
});

test('packageName follows the CMP rule', () => {
    for (const packageName of ['com.example', 'Com.example.app', 'com.in.app', 'com.kturker.multiplatform', `com.example.${'a'.repeat(50)}`, 3]) {
        const r = validateBackend(valid({ packageName }));
        assert.strictEqual(r.ok, false, String(packageName));
        assert.deepStrictEqual(fieldsOf(r), ['packageName']);
    }
});

test('the template package is reserved', () => {
    for (const packageName of ['io.cmpose.backendtemplate', 'io.cmpose.backendtemplate.x']) {
        assert.deepStrictEqual(fieldsOf(validateBackend(valid({ packageName }))), ['packageName']);
    }
});

test('projectName follows the CMP rule', () => {
    for (const projectName of ['', 'My Notes', 'Notes1', 'a'.repeat(31), null]) {
        const r = validateBackend(valid({ projectName }));
        assert.strictEqual(r.ok, false, String(projectName));
        assert.deepStrictEqual(fieldsOf(r), ['projectName']);
    }
});

test('a bad templateRef is rejected', () => {
    for (const templateRef of ['../x', '.hidden', 'a b', '', 5]) {
        const r = validateBackend(valid({ templateRef }));
        assert.strictEqual(r.ok, false, String(templateRef));
        assert.deepStrictEqual(fieldsOf(r), ['templateRef']);
    }
});

test('every problem is reported, and a non-object input is one error', () => {
    const r = validateBackend({ projectName: 'Notes', appName: 'api', packageName: 'x', outputDir: 'rel', sharing: 'yes', templateRef: '../x' });
    assert.deepStrictEqual(fieldsOf(r).sort(), ['appName', 'outputDir', 'packageName', 'sharing', 'templateRef']);
    for (const input of [null, 'x', []]) {
        const bad = validateBackend(input);
        assert.strictEqual(bad.ok, false);
        assert.strictEqual(bad.errors.length, 1);
    }
});

test('only the known fields reach the value', () => {
    const r = validateBackend(valid({ admin: true, __proto__: { polluted: true } }));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(Object.keys(r.value).sort(), ['appName', 'outputDir', 'packageName', 'projectName', 'sharing']);
});
