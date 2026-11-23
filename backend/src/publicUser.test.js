import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePublicUser } from './models/userModel.js';

test('legacy staff accounts are presented as basic public accounts', () => {
  const user = sanitizePublicUser({
    id: 7,
    role_id: 3,
    role_code: 'LAND_ADMIN',
    role_name: 'Administrator',
    full_name: 'Existing Account',
    email: 'account@example.test',
    national_id: 'TEST-1234',
    is_active: true,
  });

  assert.equal(user.roleCode, 'CITIZEN');
  assert.equal(user.roleName, 'Account holder');
  assert.equal(user.email, 'account@example.test');
});

test('already sanitized users are normalized without losing account data', () => {
  const user = sanitizePublicUser({
    id: 8,
    roleCode: 'SURVEYOR',
    roleName: 'Surveyor',
    fullName: 'Legacy User',
    email: 'legacy@example.test',
  });

  assert.equal(user.roleCode, 'CITIZEN');
  assert.equal(user.fullName, 'Legacy User');
});
