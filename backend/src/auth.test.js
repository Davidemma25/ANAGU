import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createApp } from './app.js';
import { createAdminApp } from '../admin/src/app.js';
import './testEnv.js';
import { getAdminEmail, isDesignatedAdminEmail } from './config/env.js';
import { ensureSeedUsers } from './models/userModel.js';

function createCombinedTestApp() {
  const root = express();
  root.use('/api/admin', createAdminApp());
  root.use(createApp());
  return root;
}

test('Phase 3 Authentication, JWT, Sole Designated Admin & Citizen RBAC Flow', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-auth-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  delete process.env.ADMIN_PASSWORD;

  await ensureSeedUsers();
  const app = createCombinedTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminEmail = getAdminEmail();
  if (!process.env.ADMIN_EMAIL) {
    assert.equal(adminEmail, 'test.admin@anagu.local');
    assert.equal(isDesignatedAdminEmail('test.admin@anagu.local'), true);
    assert.equal(isDesignatedAdminEmail('other.admin@anagu.local'), false);
  }

  try {
    // 0. Before activation, sole admin status reports adminConfigured: false (no email leaked)
    const statusBefore = await fetch(`${baseUrl}/api/admin/auth/status`);
    assert.equal(statusBefore.status, 200);
    const statusBeforeBody = await statusBefore.json();
    assert.equal(statusBeforeBody.adminConfigured, false);
    assert.equal('email' in statusBeforeBody, false);

    // 1. Public registration enforces CITIZEN role even if client passes LAND_ADMIN
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Efeosa Igbinovia',
        email: 'efeosa@example.com',
        password: 'StrongPassword123',
        nationalId: 'NID-9901-EFE',
        roleCode: 'SURVEYOR',
      }),
    });
    assert.equal(regRes.status, 201);
    const regBody = await regRes.json();
    assert.equal(regBody.user.roleCode, 'CITIZEN');
    assert.ok(regBody.token);
    assert.equal(regBody.user.password_hash, undefined);

    // 2. Protected route rejects missing token
    const unauthRes = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(unauthRes.status, 401);

    // 3. Citizen can fetch and update own profile
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${regBody.token}` },
    });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.user.email, 'efeosa@example.com');

    const patchRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regBody.token}`,
      },
      body: JSON.stringify({ phone: '+234-800-111-2222' }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.user.phone, '+234-800-111-2222');

    // 4. Citizen is blocked from Admin user management endpoint (403)
    const forbiddenRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${regBody.token}` },
    });
    assert.equal(forbiddenRes.status, 403);

    // 5. Non-designated email cannot activate admin portal (403)
    const badSetupRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'intruder@example.com',
        password: 'AdminPassword123!',
      }),
    });
    assert.equal(badSetupRes.status, 403);

    // 6. Sole designated administrator activates password once -> 201 LAND_ADMIN
    const setupRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: 'AdminPassword123!',
        fullName: 'Sole Platform Administrator',
      }),
    });
    assert.equal(setupRes.status, 201);
    const setupBody = await setupRes.json();
    assert.equal(setupBody.user.roleCode, 'LAND_ADMIN');
    assert.equal(setupBody.user.email, adminEmail);

    // Duplicate activation is rejected (409)
    const dupSetupRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: 'AnotherPassword123!',
      }),
    });
    assert.equal(dupSetupRes.status, 409);

    // 7. All account types can use the same public login and are presented as basic accounts.
    const publicAdminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'AdminPassword123!' }),
    });
    assert.equal(publicAdminLogin.status, 200);
    const publicAdminBody = await publicAdminLogin.json();
    assert.equal(publicAdminBody.user.roleCode, 'CITIZEN');

    const citizenLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'efeosa@example.com', password: 'StrongPassword123' }),
    });
    assert.equal(citizenLogin.status, 200);
    const citizenLoginBody = await citizenLogin.json();
    assert.equal(citizenLoginBody.user.roleCode, 'CITIZEN');

    const badAdminLogin = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'WrongPassword' }),
    });
    assert.equal(badAdminLogin.status, 401);

    const nonDesignatedLogin = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'efeosa@example.com', password: 'StrongPassword123' }),
    });
    assert.equal(nonDesignatedLogin.status, 403);

    const adminLoginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'AdminPassword123!' }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminBody = await adminLoginRes.json();
    assert.equal(adminBody.user.roleCode, 'LAND_ADMIN');

    // 8. Admin can create authorized staff accounts but cannot promote a citizen to LAND_ADMIN
    const staffCreateRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminBody.token}`,
      },
      body: JSON.stringify({
        fullName: 'Extra Staff',
        email: 'staff@example.com',
        password: 'Password123!',
        nationalId: 'NID-STAFF-1',
        roleCode: 'SURVEYOR',
      }),
    });
    assert.equal(staffCreateRes.status, 201);

    const promoteRes = await fetch(`${baseUrl}/api/admin/users/${regBody.user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminBody.token}`,
      },
      body: JSON.stringify({ roleCode: 'LAND_ADMIN' }),
    });
    assert.equal(promoteRes.status, 403);

    // 9. Admin lists users & deactivates Citizen -> Citizen token rejected (403)
    const usersRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminBody.token}` },
    });
    assert.equal(usersRes.status, 200);
    const usersBody = await usersRes.json();
    assert.equal(usersBody.users.length, 3);

    // 10. Password reset request/confirmation is available while account is active
    const resetRequest = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'efeosa@example.com' }),
    });
    assert.equal(resetRequest.status, 200);
    const resetBody = await resetRequest.json();
    assert.ok(resetBody.resetToken);

    const resetConfirm = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resetToken: resetBody.resetToken,
        password: 'ResetPassword123!',
      }),
    });
    assert.equal(resetConfirm.status, 200);

    const resetLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'efeosa@example.com', password: 'ResetPassword123!' }),
    });
    assert.equal(resetLogin.status, 200);

    const deactivateRes = await fetch(`${baseUrl}/api/admin/users/${regBody.user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminBody.token}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactivateRes.status, 200);

    const blockedRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${regBody.token}` },
    });
    assert.equal(blockedRes.status, 403);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenLoginBody.token}` },
    });
    assert.equal(logoutRes.status, 403);

    // 11. Audit logs captured sensitive actions
    const logsRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminBody.token}` },
    });
    assert.equal(logsRes.status, 200);
    const logsBody = await logsRes.json();
    const actions = logsBody.logs.map((l) => l.action);
    assert.ok(actions.includes('USER_REGISTERED'));
    assert.ok(actions.includes('ADMIN_ACCOUNT_ACTIVATED'));
    assert.ok(actions.includes('ADMIN_LOGIN'));
    assert.ok(actions.includes('ADMIN_UPDATED_USER'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureSeedUsers provisions an explicitly configured administrator for Admin Console login', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-admin-seed-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  delete process.env.ADMIN_PASSWORD;

  await ensureSeedUsers({
    defaultAdminEmail: 'test.admin@anagu.local',
    defaultAdminPassword: 'TestAdminPassword123!',
    syncDefaultPassword: true,
  });

  const app = createCombinedTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const statusRes = await fetch(`${baseUrl}/api/admin/auth/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.adminConfigured, true);

    const publicLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test.admin@anagu.local', password: 'TestAdminPassword123!' }),
    });
    assert.equal(publicLogin.status, 200);
    const publicLoginBody = await publicLogin.json();
    assert.equal(publicLoginBody.user.roleCode, 'CITIZEN');

    const adminLoginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test.admin@anagu.local', password: 'TestAdminPassword123!' }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminBody = await adminLoginRes.json();
    assert.equal(adminBody.user.email, 'test.admin@anagu.local');
    assert.equal(adminBody.user.roleCode, 'LAND_ADMIN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureSeedUsers respects custom ADMIN_EMAIL and ADMIN_PASSWORD env vars over fallback defaults', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-custom-admin-env-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevAdminEmail = process.env.ADMIN_EMAIL;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;

  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  process.env.ADMIN_EMAIL = 'custom.admin@anagu.gov';
  process.env.ADMIN_PASSWORD = 'CustomAdminPassword99!';

  await ensureSeedUsers({
    defaultAdminEmail: 'test.admin@anagu.local',
    defaultAdminPassword: 'TestAdminPassword123!',
    syncDefaultPassword: true,
  });

  const app = createCombinedTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'custom.admin@anagu.gov',
        password: 'CustomAdminPassword99!',
      }),
    });
    assert.equal(loginRes.status, 200);
    const body = await loginRes.json();
    assert.equal(body.user.email, 'custom.admin@anagu.gov');
    assert.equal(body.user.roleCode, 'LAND_ADMIN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = prevAdminEmail;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
