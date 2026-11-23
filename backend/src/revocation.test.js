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
import { resetBlockchainContextForTests } from './services/blockchainService.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
  submitApplicationReviewAction,
} from './testHelpers/applicationReviews.js';

import './testEnv.js';
import { getAdminEmail } from './config/env.js';

test('Phase 9 Sole Admin Statutory Revocation preserves history and blocks reuse/transfer (Scenario 4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-revoke-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevReqPay = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  process.env.REQUIRE_PAYMENT_BEFORE_GIS = 'false';
  delete process.env.ADMIN_PASSWORD;
  resetBlockchainContextForTests();

  await ensureSeedUsers();
  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const registerCitizen = async (fullName, email, nationalId, walletAddress) => {
      const r = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password: 'Password123!',
          nationalId,
          walletAddress,
        }),
      });
      return r.json();
    };

    const { token: citizenToken } = await registerCitizen(
      'Amara Okafor',
      'rev-seller@example.com',
      'NID-REV-001',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    );
    const { token: buyerToken, user: buyerUser } = await registerCitizen(
      'Tunde Adeyemi',
      'rev-buyer@example.com',
      'NID-REV-002',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
    );

    const adminRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const { token: adminToken } = await adminRes.json();

    // Pipeline up to active minted NFT title + active marketplace listing
    const appRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Plot A Revocation Target',
        locationDescription: 'Zone 1 Corridor',
        region: 'Zone 1',
        declaredAreaSqm: 27700,
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
    const { application } = await appRes.json();

    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'revocation');
    await completeSurveyorHandoff({
      baseUrl,
      applicationId: application.id,
      token: surveyorToken,
    });
    await fetch(`${baseUrl}/api/admin/gis/validate/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await fetch(`${baseUrl}/api/admin/verification/decide/${application.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: 'APPROVED', remarks: 'Verified against INST-2024-001.' }),
    });
    const registrarToken = await createReviewStaffToken('REGISTRAR', 'revocation');
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: application.id,
      token: registrarToken,
      action: 'START_LEGAL_REVIEW',
      reason: 'Ownership verification completed; legal review started.',
    });
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: application.id,
      token: registrarToken,
      action: 'APPROVE_APPLICATION',
      reason: 'Legal documents reviewed and approval recorded.',
    });
    const mintRes = await fetch(`${baseUrl}/api/admin/titles/mint/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { title } = await mintRes.json();

    // Citizen lists active title on Polygon marketplace
    const listRes = await fetch(`${baseUrl}/api/marketplace/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({ titleId: title.id, pricePol: 3.0 }),
    });
    const { listing } = await listRes.json();

    // Non-Admin roles (Citizen / Buyer) cannot revoke (403)
    for (const nonAdminToken of [citizenToken, buyerToken]) {
      const denied = await fetch(`${baseUrl}/api/admin/revocations/${title.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nonAdminToken}` },
        body: JSON.stringify({
          ground: 'OverridingPublicInterest',
          reason: 'Unauthorized non-admin revocation attempt.',
        }),
      });
      assert.equal(denied.status, 403);
    }

    // Invalid ground or short reason rejected (400)
    const badGround = await fetch(`${baseUrl}/api/admin/revocations/${title.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        ground: 'ArbitraryGround',
        reason: 'Valid length reason string.',
      }),
    });
    assert.equal(badGround.status, 400);

    // Sole Administrator revokes under OverridingPublicInterest -> 201
    const revokeRes = await fetch(`${baseUrl}/api/admin/revocations/${title.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        ground: 'OverridingPublicInterest',
        reason: 'Compulsory public acquisition for municipal flood drainage corridor.',
      }),
    });
    assert.equal(revokeRes.status, 201);
    const revokeBody = await revokeRes.json();
    assert.equal(revokeBody.title.title_status, 'REVOKED');
    assert.equal(revokeBody.blockedListingCount, 1);
    assert.equal(revokeBody.transaction.tx_type, 'REVOKE_TITLE');

    // Original title record is preserved with revocation history attached
    const revListRes = await fetch(`${baseUrl}/api/admin/revocations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const revList = await revListRes.json();
    assert.equal(revList.revocations.length, 1);
    assert.equal(revList.revocations[0].title_number, title.title_number);
    assert.equal(revList.revocations[0].ground, 'OverridingPublicInterest');

    // Fraud Scenario 4: attempting to re-list, buy existing listing, or transfer revoked NFT fails
    const relistRes = await fetch(`${baseUrl}/api/marketplace/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({ titleId: title.id, pricePol: 1.5 }),
    });
    assert.equal(relistRes.status, 409);

    const buyBlocked = await fetch(`${baseUrl}/api/marketplace/listings/${listing.id}/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(buyBlocked.status, 409);

    const transferTest = await fetch(`${baseUrl}/api/titles/${title.id}/test-transfer-block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ toWallet: buyerUser.walletAddress }),
    });
    assert.equal(transferTest.status, 200);
    const transferBody = await transferTest.json();
    assert.equal(transferBody.blocked, true);
    assert.match(transferBody.reason, /TitleIsRevoked/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetBlockchainContextForTests();
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevReqPay === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
