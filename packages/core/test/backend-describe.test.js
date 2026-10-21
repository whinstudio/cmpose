'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeBackend } = require('../src/backend/describe');

const SHARING_QUOTAS = ['MAX_SPACES_PER_USER', 'MAX_MEMBERS_PER_SPACE', 'MAX_PENDING_INVITES_PER_SPACE'];

test('conventions.quotas names every quota and the refusal (the MCP description)', () => {
    const { quotas } = describeBackend().conventions;
    assert.equal(quotas, 'MAX_STORAGE_BYTES_PER_USER (default 100 MB), and with sharing MAX_SPACES_PER_USER (20), ' +
        'MAX_MEMBERS_PER_SPACE (50) and MAX_PENDING_INVITES_PER_SPACE (20) cap new writes; 0 turns one off. ' +
        'A refused write answers 409 QUOTA_EXCEEDED with quota = storage | spaces | members | invites.');
    assert.equal(describeBackend({ sharing: true }).conventions.quotas, quotas);
});

test('conventions.quotas without sharing names only the storage quota', () => {
    const { quotas } = describeBackend({ sharing: false }).conventions;
    assert.match(quotas, /MAX_STORAGE_BYTES_PER_USER \(default 100 MB\)/);
    assert.match(quotas, /409 QUOTA_EXCEEDED with quota = storage\./);
    for (const name of SHARING_QUOTAS) assert.ok(!quotas.includes(name), name);
    assert.doesNotMatch(quotas, /space|member|invite/i);
});

test('the sharing option mentions invitations and their revocation', () => {
    const { description } = describeBackend().options.sharing;
    assert.match(description, /invitations \(an owner lists and revokes pending ones\)/);
});

test('conventions keep the 404 rule (never 403)', () => {
    for (const sharing of [undefined, false, true]) {
        assert.match(describeBackend({ sharing }).conventions.notFoundRule, /404 NOT_FOUND exactly like a missing row: never 403/);
    }
});
