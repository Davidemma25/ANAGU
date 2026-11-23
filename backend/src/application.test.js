import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createApp } from './app.js';
import { createAdminApp } from '../admin/src/app.js';
import { ensureSeedUsers } from './models/userModel.js';
import { normalizeGeoJsonPolygon } from './models/applicationModel.js';

test('normalizeGeoJsonPolygon rejects unclosed or undersized rings', () => {
  assert.throws(
    () => normalizeGeoJsonPolygon([[3.37, 6.52], [3.38, 6.52], [3.37, 6.52]]),
    /at least 4 coordinate pairs/i
  );

  assert.throws(
    () => normalizeGeoJsonPolygon([[3.37, 6.52], [3.38, 6.52], [3.38, 6.53], [3.37, 6.53]]),
    /must be closed/i
  );

  const valid = normalizeGeoJsonPolygon([
    [3.375, 6.52],
    [3.3765, 6.52],
    [3.3765, 6.5215],
    [3.375, 6.5215],
    [3.375, 6.52],
  ]);
  assert.equal(valid.type, 'Polygon');
  assert.equal(valid.coordinates[0].length, 5);
});

import './testEnv.js';
import { getAdminEmail } from './config/env.js';

test('Phase 5 Land Application submission, document upload SHA-256 & RBAC isolation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-app-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  delete process.env.ADMIN_PASSWORD;

  await ensureSeedUsers();
  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Register Citizen 1
    const reg1Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Amara Okafor',
        email: 'citizen1@example.com',
        password: 'Password123!',
        nationalId: 'NID-7771-ONE',
      }),
    });
    const { token: citizenToken } = await reg1Res.json();

    // 2. Register a second Citizen to verify isolation
    const reg2Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Second Citizen',
        email: 'citizen2@example.com',
        password: 'Password123!',
        nationalId: 'NID-7777-TWO',
      }),
    });
    const { token: citizen2Token } = await reg2Res.json();

    // 3. Submit application as Citizen 1
    const submitRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`,
      },
      body: JSON.stringify({
        parcelName: 'Plot A Zone 1',
        locationDescription: 'Northern residential corridor, Zone 1',
        region: 'Zone 1 District',
        declaredAreaSqm: 2500,
        ownershipType: 'FREEHOLD',
        claimantName: 'Amara Okafor',
        claimantNationalId: 'NID-1001-AMA',
        coordinates: [
          [3.375, 6.52],
          [3.3765, 6.52],
          [3.3765, 6.5215],
          [3.375, 6.5215],
          [3.375, 6.52],
        ],
      }),
    });
    assert.equal(submitRes.status, 201);
    const { application } = await submitRes.json();
    assert.match(application.reference_code, /^ANG-APP-\d{4}-0001$/);
    assert.equal(application.status, 'SUBMITTED');

    // 4. Upload supporting document using multipart FormData
    const formData = new FormData();
    formData.append('documentType', 'DEED_OF_CONVEYANCE');
    formData.append(
      'document',
      new Blob(['Deed of Conveyance — Plot A Zone 1 — Amara Okafor'], { type: 'text/plain' }),
      'deed-plot-a.txt'
    );

    const uploadRes = await fetch(`${baseUrl}/api/applications/${application.id}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}` },
      body: formData,
    });
    assert.equal(uploadRes.status, 201);
    const uploadBody = await uploadRes.json();
    assert.equal(uploadBody.document.sha256_hash.length, 64);

    // 5. Citizen 2 cannot view Citizen 1's application (403)
    const isoRes = await fetch(`${baseUrl}/api/applications/${application.id}`, {
      headers: { Authorization: `Bearer ${citizen2Token}` },
    });
    assert.equal(isoRes.status, 403);

    // 6. Sole Administrator can view submitted applications via admin backend
    const adminSetup = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const { token: adminToken } = await adminSetup.json();

    const listRes = await fetch(`${baseUrl}/api/admin/applications`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.applications.length, 1);
    assert.equal(listBody.applications[0].document_count, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
