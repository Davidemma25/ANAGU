import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createApp } from './app.js';
import { createAdminApp } from '../admin/src/app.js';
import { SAMPLE_OWNERSHIP_RECORDS } from './config/db.js';
import { ensureSeedUsers } from './models/userModel.js';
import { evaluateOwnershipClaim } from './services/oracleService.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
  submitApplicationReviewAction,
} from './testHelpers/applicationReviews.js';

const PLOT_A = {
  type: 'Polygon',
  coordinates: [
    [
      [3.375, 6.52],
      [3.3765, 6.52],
      [3.3765, 6.5215],
      [3.375, 6.5215],
      [3.375, 6.52],
    ],
  ],
};

const PLOT_DISPUTED = {
  type: 'Polygon',
  coordinates: [
    [
      [3.381, 6.522],
      [3.3825, 6.522],
      [3.3825, 6.5235],
      [3.381, 6.5235],
      [3.381, 6.522],
    ],
  ],
};

test('Oracle cleanly matches Plot A against sample record INST-2024-001 (Amara Okafor)', () => {
  const result = evaluateOwnershipClaim({
    application: {
      id: 1,
      reference_code: 'ANG-APP-2026-0001',
      claimant_name: 'Amara Okafor',
      claimant_national_id: 'NID-1001-AMA',
      coordinates_geojson: PLOT_A,
    },
    documents: [
      {
        id: 1,
        file_name: 'deed.txt',
        document_type: 'DEED_OF_CONVEYANCE',
        sha256_hash: 'a'.repeat(64),
        is_tampered_flag: false,
      },
    ],
    ownershipRecords: SAMPLE_OWNERSHIP_RECORDS,
    verifyFilesOnDisk: false,
  });

  assert.equal(result.conflictDetected, false);
  assert.equal(result.recommendedDecision, 'APPROVED');
  assert.ok(result.oracleMatchScore >= 95);
  assert.equal(result.matchedRecord.sourceReference, 'INST-2024-001');
  assert.equal(result.matchedRecord.spatialMatch, true);
  assert.equal(result.matchedRecord.nationalIdMatch, true);
});

test('Oracle detects forged/tampered documents (Scenario 1) and disputed/conflicting ownership claims', () => {
  const tamperedResult = evaluateOwnershipClaim({
    application: {
      id: 2,
      reference_code: 'ANG-APP-2026-0002',
      claimant_name: 'Amara Okafor',
      claimant_national_id: 'NID-1001-AMA',
      coordinates_geojson: PLOT_A,
    },
    documents: [
      {
        id: 2,
        file_name: 'forged_deed.pdf',
        document_type: 'DEED_OF_CONVEYANCE',
        sha256_hash: 'b'.repeat(64),
        is_tampered_flag: true,
      },
    ],
    ownershipRecords: SAMPLE_OWNERSHIP_RECORDS,
    verifyFilesOnDisk: false,
  });

  assert.equal(tamperedResult.conflictDetected, true);
  assert.equal(tamperedResult.recommendedDecision, 'REJECTED');
  assert.ok(tamperedResult.conflicts.some((c) => c.type === 'TAMPERED_DOCUMENT'));

  const disputedResult = evaluateOwnershipClaim({
    application: {
      id: 3,
      reference_code: 'ANG-APP-2026-0003',
      claimant_name: 'Fatima Bello',
      claimant_national_id: 'NID-1003-FAT',
      coordinates_geojson: PLOT_DISPUTED,
    },
    documents: [],
    ownershipRecords: SAMPLE_OWNERSHIP_RECORDS,
    verifyFilesOnDisk: false,
  });

  assert.equal(disputedResult.conflictDetected, true);
  assert.equal(disputedResult.recommendedDecision, 'FLAGGED_CONFLICT');
  assert.ok(disputedResult.conflicts.some((c) => c.type === 'DISPUTED_ARCHIVE_RECORD'));
});

import './testEnv.js';
import { getAdminEmail } from './config/env.js';

test('Phase 7 Verification API enforces Sole Admin RBAC, blocks conflict overrides (Scenario 3), and persists history', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-oracle-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevReqPay = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  process.env.REQUIRE_PAYMENT_BEFORE_GIS = 'false';
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
    const citRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Amara Okafor',
        email: 'ver-citizen@example.com',
        password: 'Password123!',
        nationalId: 'NID-VER-001',
      }),
    });
    const { token: citizenToken } = await citRes.json();

    const adminRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const { token: adminToken } = await adminRes.json();
    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'verification');
    const registrarToken = await createReviewStaffToken('REGISTRAR', 'verification');

    // Citizen denied access to Verification Queue
    const citQueue = await fetch(`${baseUrl}/api/admin/verification/queue`, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal(citQueue.status, 403);

    // 1. Clean application matching INST-2024-001 (Amara Okafor)
    const app1Res = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Plot A Clean Verification',
        locationDescription: 'Zone 1 Block A',
        region: 'Zone 1',
        declaredAreaSqm: 27700,
        ownershipType: 'FREEHOLD',
        claimantName: 'Amara Okafor',
        claimantNationalId: 'NID-1001-AMA',
        coordinates: PLOT_A.coordinates[0],
      }),
    });
    const { application: app1 } = await app1Res.json();

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: app1.id,
      token: surveyorToken,
    });
    const val1 = await fetch(`${baseUrl}/api/admin/gis/validate/${app1.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(val1.status, 200);

    // Sole Administrator evaluates & approves clean claim
    const eval1 = await fetch(`${baseUrl}/api/admin/verification/evaluate/${app1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(eval1.status, 200);
    const evalData1 = await eval1.json();
    assert.equal(evalData1.oracle.conflictDetected, false);
    assert.equal(evalData1.oracle.matchedRecord.sourceReference, 'INST-2024-001');

    const dec1 = await fetch(`${baseUrl}/api/admin/verification/decide/${app1.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        remarks: 'Confirmed against INST-2024-001 municipal archive and elders minutes.',
      }),
    });
    assert.equal(dec1.status, 201);
    const decData1 = await dec1.json();
    assert.equal(decData1.application.status, 'VERIFIED');

    // 2. Disputed claim (Scenario 3: override attempt on a disputed parcel is blocked)
    const app2Res = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Disputed Customary Plot',
        locationDescription: 'Zone 2 Block C',
        region: 'Zone 2',
        declaredAreaSqm: 27700,
        ownershipType: 'CUSTOMARY',
        claimantName: 'Fatima Bello',
        claimantNationalId: 'NID-1003-FAT',
        coordinates: PLOT_DISPUTED.coordinates[0],
      }),
    });
    const { application: app2 } = await app2Res.json();

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: app2.id,
      token: surveyorToken,
    });
    const val2 = await fetch(`${baseUrl}/api/admin/gis/validate/${app2.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(val2.status, 200);

    // Override attempt on disputed parcel -> 409 blocked
    const overrideAttempt = await fetch(`${baseUrl}/api/admin/verification/decide/${app2.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        remarks: 'Attempting silent override of disputed record.',
      }),
    });
    assert.equal(overrideAttempt.status, 409);

    // Flag conflict properly -> 201 VERIFICATION_REJECTED
    const flagRes = await fetch(`${baseUrl}/api/admin/verification/decide/${app2.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'FLAGGED_CONFLICT',
        remarks: 'Flagged due to DISPUTED customary inheritance claim INST-2024-003.',
      }),
    });
    assert.equal(flagRes.status, 201);
    const flagData = await flagRes.json();
    assert.equal(flagData.application.status, 'VERIFICATION_REJECTED');

    // Citizen cannot add sample ownership record (403); Sole Admin can (201)
    const citAddRec = await fetch(`${baseUrl}/api/admin/verification/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        recordSource: 'SAMPLE_TEST',
        sourceReference: 'INST-2026-999',
        registeredOwnerName: 'Test Owner',
        ownerNationalId: 'NID-9999-TST',
      }),
    });
    assert.equal(citAddRec.status, 403);

    const adminAddRec = await fetch(`${baseUrl}/api/admin/verification/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        recordSource: 'SAMPLE_MUNICIPAL_ARCHIVE',
        sourceReference: 'INST-2026-004',
        parcelCode: 'ANG-PARCEL-1004',
        registeredOwnerName: 'Ngozi Eze',
        ownerNationalId: 'NID-1004-NGO',
        claimStatus: 'ACTIVE_RECORD',
        notes: 'Sample newly indexed archive deed.',
      }),
    });
    assert.equal(adminAddRec.status, 201);

    // 3. Public land registration submitted in SUBMITTED + PENDING_ADMIN_APPROVAL can be verified & approved directly
    const deedForm = new FormData();
    deedForm.append('parcelName', 'Direct Verification Queue Plot');
    deedForm.append('locationDescription', 'Zone 6 Lot 19');
    deedForm.append('region', 'Zone 6');
    deedForm.append('declaredAreaSqm', '1850');
    deedForm.append('ownershipType', 'FREEHOLD');
    deedForm.append('claimantName', 'Chukwuemeka Obi');
    deedForm.append('claimantNationalId', 'NID-2026-619');
    deedForm.append('priceUsd', '6100');
    deedForm.append('documentType', 'DEED_OF_CONVEYANCE');
    deedForm.append(
      'coordinates',
      JSON.stringify([
        [3.421, 6.561],
        [3.4225, 6.561],
        [3.4225, 6.5625],
        [3.421, 6.5625],
        [3.421, 6.561],
      ])
    );
    deedForm.append(
      'document',
      new Blob(['Certified Survey & Conveyance Deed 619'], { type: 'text/plain' }),
      'lot-619-deed.txt'
    );

    const regRes = await fetch(`${baseUrl}/api/marketplace/register-land`, {
      method: 'POST',
      body: deedForm,
    });
    assert.equal(regRes.status, 201);
    const regBody = await regRes.json();

    // Non-admin blocked from downloading deed document
    const citDownload = await fetch(
      `${baseUrl}/api/admin/verification/documents/${regBody.document.id}/download`,
      { headers: { Authorization: `Bearer ${citizenToken}` } }
    );
    assert.equal(citDownload.status, 403);

    // Admin can download deed and approve directly from SUBMITTED
    const adminDownload = await fetch(
      `${baseUrl}/api/admin/verification/documents/${regBody.document.id}/download`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(adminDownload.status, 200);
    assert.equal(await adminDownload.text(), 'Certified Survey & Conveyance Deed 619');

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: regBody.application.id,
      token: surveyorToken,
    });
    const deedGis = await fetch(
      `${baseUrl}/api/admin/gis/validate/${regBody.application.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(deedGis.status, 200);

    const directApprove = await fetch(
      `${baseUrl}/api/admin/verification/decide/${regBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          decision: 'APPROVED',
          remarks: 'Verified deed and spatial boundary directly.',
        }),
      }
    );
    assert.equal(directApprove.status, 201);
    const directApproveBody = await directApprove.json();
    assert.equal(directApproveBody.application.status, 'VERIFIED');
    assert.equal(directApproveBody.publishedListing?.verification_status, 'PENDING_ADMIN_APPROVAL');
    assert.match(directApproveBody.message, /registrar legal approval/i);
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: regBody.application.id,
      token: registrarToken,
      action: 'START_LEGAL_REVIEW',
      reason: 'Ownership verification completed; legal review started.',
    });
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: regBody.application.id,
      token: registrarToken,
      action: 'APPROVE_APPLICATION',
      reason: 'Legal documents reviewed and approval recorded.',
    });
    const directMint = await fetch(
      `${baseUrl}/api/admin/titles/mint/${regBody.application.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(directMint.status, 201);
    const directPublish = await fetch(
      `${baseUrl}/api/admin/verification/publish-checklands/${regBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(directPublish.status, 200);
    assert.equal(
      (await directPublish.json()).publishedListing?.verification_status,
      'VERIFIED'
    );

    // 4. 1-click Admin "Verify & Show on Check Lands" endpoint works without remarks and still blocks disputed claims
    const quickForm = new FormData();
    quickForm.append('parcelName', 'One Click Check Lands Plot');
    quickForm.append('locationDescription', 'Zone 8 Block D');
    quickForm.append('region', 'Zone 8');
    quickForm.append('declaredAreaSqm', '2200');
    quickForm.append('ownershipType', 'FREEHOLD');
    quickForm.append('claimantName', 'Ngozi Adichie');
    quickForm.append('claimantNationalId', 'NID-2026-888');
    quickForm.append('priceUsd', '7400');
    quickForm.append('documentType', 'DEED_OF_CONVEYANCE');
    quickForm.append(
      'coordinates',
      JSON.stringify([
        [3.431, 6.571],
        [3.4325, 6.571],
        [3.4325, 6.5725],
        [3.431, 6.5725],
        [3.431, 6.571],
      ])
    );
    quickForm.append(
      'document',
      new Blob(['Clean Conveyance Deed 888'], { type: 'text/plain' }),
      'lot-888-deed.txt'
    );

    const quickRegRes = await fetch(`${baseUrl}/api/marketplace/register-land`, {
      method: 'POST',
      body: quickForm,
    });
    assert.equal(quickRegRes.status, 201);
    const quickRegBody = await quickRegRes.json();

    const skippedWorkflow = await fetch(
      `${baseUrl}/api/admin/verification/publish-checklands/${quickRegBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(skippedWorkflow.status, 409);

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: quickRegBody.application.id,
      token: surveyorToken,
    });
    const quickGis = await fetch(
      `${baseUrl}/api/admin/gis/validate/${quickRegBody.application.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(quickGis.status, 200);

    const quickPublishRes = await fetch(
      `${baseUrl}/api/admin/verification/publish-checklands/${quickRegBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(quickPublishRes.status, 200);
    const quickPublishBody = await quickPublishRes.json();
    assert.equal(quickPublishBody.application?.status, 'VERIFIED');
    assert.equal(quickPublishBody.publishedListing?.verification_status, 'PENDING_ADMIN_APPROVAL');
    assert.match(quickPublishBody.message, /registrar legal approval/i);

    await submitApplicationReviewAction({
      baseUrl,
      applicationId: quickRegBody.application.id,
      token: registrarToken,
      action: 'START_LEGAL_REVIEW',
      reason: 'Ownership verification completed; legal review started.',
    });
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: quickRegBody.application.id,
      token: registrarToken,
      action: 'APPROVE_APPLICATION',
      reason: 'Legal documents reviewed and approval recorded.',
    });
    const quickMint = await fetch(
      `${baseUrl}/api/admin/titles/mint/${quickRegBody.application.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(quickMint.status, 201);
    const finalPublishRes = await fetch(
      `${baseUrl}/api/admin/verification/publish-checklands/${quickRegBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(finalPublishRes.status, 200);
    const finalPublishBody = await finalPublishRes.json();
    assert.equal(finalPublishBody.publishedListing?.verification_status, 'VERIFIED');
    assert.equal(finalPublishBody.publishedListing?.listing_status, 'LISTED');

    // Public Check Lands listing feed now displays the parcel as VERIFIED
    const marketRes = await fetch(`${baseUrl}/api/marketplace/listings`);
    assert.equal(marketRes.status, 200);
    const marketBody = await marketRes.json();
    const publishedItem = (marketBody.listings || []).find(
      (item) => Number(item.application_id) === Number(quickRegBody.application.id)
    );
    assert.ok(publishedItem, '1-click verified parcel should appear on public Check Lands');
    assert.equal(publishedItem.verification_status, 'VERIFIED');

    // Disputed claim cannot bypass Oracle conflict protection via 1-click button
    const blockedQuick = await fetch(
      `${baseUrl}/api/admin/verification/publish-checklands/${app2.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(blockedQuick.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevReqPay === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
