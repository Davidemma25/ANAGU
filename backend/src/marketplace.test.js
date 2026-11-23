import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createApp } from './app.js';
import { createAdminApp } from '../admin/src/app.js';
import { ensureDemoMarketplaceData } from './config/db.js';
import './testEnv.js';
import { getAdminEmail } from './config/env.js';
import { ensureSeedUsers } from './models/userModel.js';
import { resetBlockchainContextForTests } from './services/blockchainService.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
  submitApplicationReviewAction,
} from './testHelpers/applicationReviews.js';
import {
  evaluateApplicationVerification,
  evaluateBuyerPurchaseVerification,
  isListingVisibleOnCheckLands,
  resolveAdminDeedApprovalOutcome,
  sanitizeListingDetails,
} from './services/marketplaceService.js';

test('evaluateApplicationVerification tracks verification gates and pre-verification posting eligibility', () => {
  const submitted = evaluateApplicationVerification({
    application: { id: 1, reference_code: 'ANG-APP-1', parcel_name: 'Plot 1', region: 'Zone 1', status: 'SUBMITTED' },
  });
  assert.equal(submitted.eligible, false);
  assert.equal(submitted.canPost, true);
  assert.equal(submitted.postingMode, 'PENDING_VERIFICATION');
  assert.equal(submitted.statusLabel, 'AWAITING_GIS');
  assert.equal(submitted.checks.gisValidated, false);
  assert.equal(submitted.checks.oracleVerified, false);
  assert.equal(submitted.checks.titleActive, false);

  const alreadyPostedPending = evaluateApplicationVerification({
    application: { id: 1, reference_code: 'ANG-APP-1', parcel_name: 'Plot 1', region: 'Zone 1', status: 'SUBMITTED' },
    activeListings: [{ id: 9, application_id: 1, title_id: null, listing_status: 'LISTED' }],
  });
  assert.equal(alreadyPostedPending.canPost, false);
  assert.equal(alreadyPostedPending.statusLabel, 'ALREADY_LISTED');

  const gisOnly = evaluateApplicationVerification({
    application: { id: 1, reference_code: 'ANG-APP-1', parcel_name: 'Plot 1', region: 'Zone 1', status: 'GIS_VALIDATED' },
    parcel: { id: 10, parcel_code: 'ANG-Z1-0010', area_sqm: 500, is_geometry_valid: true, overlap_checked: true, status: 'VALIDATED' },
  });
  assert.equal(gisOnly.eligible, false);
  assert.equal(gisOnly.canPost, true);
  assert.equal(gisOnly.statusLabel, 'AWAITING_ORACLE');
  assert.equal(gisOnly.checks.gisValidated, true);
  assert.equal(gisOnly.checks.oracleVerified, false);

  const verifiedNoTitle = evaluateApplicationVerification({
    application: { id: 1, reference_code: 'ANG-APP-1', parcel_name: 'Plot 1', region: 'Zone 1', status: 'VERIFIED' },
    parcel: { id: 10, parcel_code: 'ANG-Z1-0010', area_sqm: 500, is_geometry_valid: true, overlap_checked: true, status: 'VALIDATED' },
    verificationRecords: [{ decision: 'APPROVED', oracle_match_score: 94, verified_at: '2026-01-01T00:00:00Z' }],
  });
  assert.equal(verifiedNoTitle.eligible, false);
  assert.equal(verifiedNoTitle.canPost, true);
  assert.equal(verifiedNoTitle.statusLabel, 'AWAITING_TITLE_MINT');
  assert.equal(verifiedNoTitle.oracleScore, 94);

  const revoked = evaluateApplicationVerification({
    application: { id: 1, reference_code: 'ANG-APP-1', parcel_name: 'Plot 1', region: 'Zone 1', status: 'REVOKED' },
    parcel: { id: 10, parcel_code: 'ANG-Z1-0010', area_sqm: 500, is_geometry_valid: true, overlap_checked: true, status: 'REVOKED' },
    verificationRecords: [{ decision: 'APPROVED', oracle_match_score: 94, verified_at: '2026-01-01T00:00:00Z' }],
    title: { id: 2, title_number: 'ANG-TITLE-2026-0002', token_id: '2', title_status: 'REVOKED' },
  });
  assert.equal(revoked.eligible, false);
  assert.equal(revoked.canPost, false);
  assert.equal(revoked.postingMode, 'BLOCKED');
  assert.equal(revoked.statusLabel, 'REVOKED');
  assert.equal(revoked.checks.notRevoked, false);

  const ready = evaluateApplicationVerification({
    application: { id: 1, reference_code: 'ANG-APP-1', parcel_name: 'Plot 1', region: 'Zone 1', status: 'TITLE_ISSUED' },
    parcel: { id: 10, parcel_code: 'ANG-Z1-0010', area_sqm: 500, is_geometry_valid: true, overlap_checked: true, status: 'ACTIVE' },
    verificationRecords: [{ decision: 'APPROVED', oracle_match_score: 96, verified_at: '2026-01-01T00:00:00Z' }],
    title: { id: 2, title_number: 'ANG-TITLE-2026-0002', token_id: '2', title_status: 'ACTIVE' },
    activeListings: [],
  });
  assert.equal(ready.eligible, true);
  assert.equal(ready.canPost, true);
  assert.equal(ready.postingMode, 'VERIFIED');
  assert.equal(ready.statusLabel, 'READY_TO_LIST');
  assert.equal(ready.missingSteps.length, 0);
});

test('sanitizeListingDetails trims text and provides clean default headline', () => {
  const defaulted = sanitizeListingDetails({
    headline: '   ',
    description: '  Corner parcel near main road.  ',
    fallbackTitle: { parcel_name: 'Yaba North Plot' },
  });
  assert.equal(defaulted.headline, 'Yaba North Plot · Verified Parcel');
  assert.equal(defaulted.description, 'Corner parcel near main road.');

  const pendingDefault = sanitizeListingDetails({
    headline: '   ',
    fallbackTitle: { parcel_name: 'Lekki Parcel' },
    isPendingVerification: true,
  });
  assert.equal(pendingDefault.headline, 'Lekki Parcel · Listed Before Verification');
});

test('evaluateBuyerPurchaseVerification checks GIS, Oracle, Statutory & On-Chain gates', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [3.385, 6.525],
        [3.3865, 6.525],
        [3.3865, 6.5265],
        [3.385, 6.5265],
        [3.385, 6.525],
      ],
    ],
  };

  const clean = evaluateBuyerPurchaseVerification({
    listing: { id: 1, listing_status: 'LISTED', price_pol: 3.5, price_wei: '3500000000000000000' },
    title: { id: 1, title_number: 'ANG-TITLE-2026-0001', token_id: '1', title_status: 'ACTIVE' },
    parcel: {
      id: 1,
      application_id: 1,
      parcel_code: 'ANG-PARCEL-0001',
      boundary_geojson: polygon,
      area_sqm: 27700,
      is_geometry_valid: true,
      overlap_checked: true,
      status: 'ACTIVE',
    },
    application: {
      id: 1,
      parcel_name: 'Plot B',
      region: 'Zone 2',
      ownership_type: 'FREEHOLD',
      claimant_name: 'Tunde Adeyemi',
      claimant_national_id: 'NID-2001-TUN',
      coordinates_geojson: polygon,
      status: 'TITLE_ISSUED',
    },
    verificationRecords: [{ decision: 'APPROVED', oracle_match_score: 90, verified_at: '2026-01-01T00:00:00Z' }],
    onChainStatus: {
      ok: true,
      isRevoked: false,
      isListed: true,
      escrowFunded: false,
      ownerMatchesSeller: true,
      priceMatches: true,
      onChainOwner: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    },
  });
  assert.equal(clean.verifiedSafeToBuy, true);
  assert.equal(clean.blockers.length, 0);

  const revoked = evaluateBuyerPurchaseVerification({
    listing: { id: 1, listing_status: 'LISTED' },
    title: { id: 1, title_number: 'ANG-TITLE-2026-0001', token_id: '1', title_status: 'REVOKED' },
    parcel: {
      id: 1,
      application_id: 1,
      parcel_code: 'ANG-PARCEL-0001',
      boundary_geojson: polygon,
      is_geometry_valid: true,
      overlap_checked: true,
      status: 'REVOKED',
    },
    application: { id: 1, coordinates_geojson: polygon, status: 'REVOKED' },
    verificationRecords: [{ decision: 'APPROVED', oracle_match_score: 90, verified_at: '2026-01-01T00:00:00Z' }],
    onChainStatus: { ok: false, isRevoked: true, isListed: false, escrowFunded: false },
  });
  assert.equal(revoked.verifiedSafeToBuy, false);
  assert.equal(revoked.checks.notRevoked, false);
  assert.equal(revoked.checks.onChainVerified, false);
});

test('isListingVisibleOnCheckLands and resolveAdminDeedApprovalOutcome enforce admin deed approval gating', () => {
  assert.equal(isListingVisibleOnCheckLands({ verification_status: 'PENDING_ADMIN_APPROVAL' }), false);
  assert.equal(isListingVisibleOnCheckLands({ verification_status: 'ADMIN_REJECTED' }), false);
  assert.equal(isListingVisibleOnCheckLands({ verification_status: 'PENDING_VERIFICATION' }), true);
  assert.equal(isListingVisibleOnCheckLands({ verification_status: 'VERIFIED' }), true);

  const publishOutcome = resolveAdminDeedApprovalOutcome({
    decision: 'APPROVED',
    hasPendingListing: true,
    oracleConflictDetected: false,
  });
  assert.equal(publishOutcome.allowed, true);
  assert.equal(publishOutcome.publishToCheckLands, true);
  assert.equal(publishOutcome.rejectPendingListing, false);

  const conflictBlocked = resolveAdminDeedApprovalOutcome({
    decision: 'APPROVED',
    hasPendingListing: true,
    oracleConflictDetected: true,
  });
  assert.equal(conflictBlocked.allowed, false);
  assert.equal(conflictBlocked.publishToCheckLands, false);

  const rejectOutcome = resolveAdminDeedApprovalOutcome({
    decision: 'REJECTED',
    hasPendingListing: true,
    oracleConflictDetected: false,
  });
  assert.equal(rejectOutcome.allowed, true);
  assert.equal(rejectOutcome.publishToCheckLands, false);
  assert.equal(rejectOutcome.rejectPendingListing, true);
});

test('Marketplace API supports posting land before verification, live buyer verification, blocking conflicts, and verified escrow purchase', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-market-test-'));
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  const prevPaymentGate = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
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
      'mkt-seller@example.com',
      'NID-MKT-001',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    );
    const { token: buyerToken } = await registerCitizen(
      'Tunde Adeyemi',
      'mkt-buyer@example.com',
      'NID-MKT-002',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
    );
    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'marketplace');
    const registrarToken = await createReviewStaffToken('REGISTRAR', 'marketplace');
    const adminSetupRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'TestAdminPassword123!',
      }),
    });
    const adminAuthBody = await adminSetupRes.json();
    let adminToken = adminAuthBody.token;
    if (!adminToken) {
      const adminLoginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: getAdminEmail(), password: 'TestAdminPassword123!' }),
      });
      adminToken = (await adminLoginRes.json()).token;
    }
    assert.ok(adminToken);

    // 1. Citizen registers a clean land parcel (SUBMITTED — not verified yet)
    const appRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Prime Corner Plot 7',
        locationDescription: 'Zone 1 Block C',
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
    assert.equal(appRes.status, 201);
    const { application } = await appRes.json();

    // Eligibility shows parcel is postable immediately before verification
    const eligBeforeRes = await fetch(`${baseUrl}/api/marketplace/eligibility`, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal(eligBeforeRes.status, 200);
    const eligBefore = await eligBeforeRes.json();
    assert.equal(eligBefore.postableParcels.length, 1);
    assert.equal(eligBefore.postableParcels[0].postingMode, 'PENDING_VERIFICATION');

    // 2. Citizen posts the parcel BEFORE verification completes -> 201 Created (PENDING_VERIFICATION)
    const preVerPost = await fetch(`${baseUrl}/api/marketplace/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        applicationId: application.id,
        pricePol: 4.5,
        headline: 'Prime Corner Plot 7 · Direct Access',
        description: 'Posted before formal verification so buyers can inspect and verify.',
      }),
    });
    assert.equal(preVerPost.status, 201);
    const preVerBody = await preVerPost.json();
    assert.equal(preVerBody.listing.verification_status, 'PENDING_VERIFICATION');
    assert.equal(preVerBody.listing.title_id, null);
    assert.equal(preVerBody.listing.reference_code, application.reference_code);

    // Public visitors can immediately see it in GET /api/marketplace/listings
    const publicListingsRes = await fetch(`${baseUrl}/api/marketplace/listings`);
    assert.equal(publicListingsRes.status, 200);
    const publicListingsBody = await publicListingsRes.json();
    assert.ok(publicListingsBody.listings.some((l) => l.id === preVerBody.listing.id));

    // Buyer attempts to buy BEFORE running verification -> 409 Conflict
    const unverifiedBuy = await fetch(
      `${baseUrl}/api/marketplace/listings/${preVerBody.listing.id}/buy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({ requireVerificationConfirmation: true }),
      }
    );
    assert.equal(unverifiedBuy.status, 409);
    const unverifiedBuyBody = await unverifiedBuy.json();
    assert.equal(unverifiedBuyBody.verificationRequired, true);

    const prematureVerification = await fetch(
      `${baseUrl}/api/marketplace/listings/${preVerBody.listing.id}/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(prematureVerification.status, 200);
    const prematureVerificationBody = await prematureVerification.json();
    assert.equal(prematureVerificationBody.verificationReport.verifiedSafeToBuy, false);
    assert.equal(prematureVerificationBody.listing.title_id, null);
    const unchangedApplication = await fetch(`${baseUrl}/api/applications/${application.id}`, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal((await unchangedApplication.json()).application.status, 'SUBMITTED');

    await submitApplicationReviewAction({
      baseUrl,
      applicationId: application.id,
      token: surveyorToken,
      action: 'START_SURVEY_REVIEW',
      reason: 'Survey documents and parcel details reviewed.',
    });
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: application.id,
      token: surveyorToken,
      action: 'PASS_SURVEY_REVIEW',
      reason: 'Survey evidence is complete for GIS validation.',
    });
    const gisReview = await fetch(`${baseUrl}/api/gis/applications/${application.id}/validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${surveyorToken}` },
    });
    assert.equal(gisReview.status, 200);

    const ownershipReview = await fetch(
      `${baseUrl}/api/admin/verification/decide/${application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          decision: 'APPROVED',
          remarks: 'Verified against the ownership record.',
        }),
      }
    );
    assert.equal(ownershipReview.status, 201);
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

    // 3. Buyer confirms the approved workflow and the title is issued before purchase
    const verifyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${preVerBody.listing.id}/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.verificationReport.verifiedSafeToBuy, true);
    assert.equal(verifyBody.verificationReport.checks.gisClean, true);
    assert.equal(verifyBody.verificationReport.checks.oracleClean, true);
    assert.equal(verifyBody.verificationReport.checks.notRevoked, true);
    assert.equal(verifyBody.verificationReport.checks.onChainVerified, true);
    assert.equal(verifyBody.listing.verification_status, 'VERIFIED');
    assert.ok(verifyBody.listing.title_id);
    assert.ok(verifyBody.listing.token_id);

    // 4. Buyer completes escrow purchase with verificationCode -> 200 OK
    const verifiedBuy = await fetch(
      `${baseUrl}/api/marketplace/listings/${preVerBody.listing.id}/buy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({
          requireVerificationConfirmation: true,
          verificationCode: verifyBody.verificationReport.verificationCode,
        }),
      }
    );
    assert.equal(verifiedBuy.status, 200);
    const verifiedBuyBody = await verifiedBuy.json();
    assert.equal(verifiedBuyBody.listing.listing_status, 'ESCROW_FUNDED');

    // 5. A parcel without an ownership decision remains blocked from purchase.
    const badAppRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Unverified Ownership Plot',
        locationDescription: 'Zone 2 Unverified Claim',
        region: 'Zone 2',
        declaredAreaSqm: 27700,
        ownershipType: 'CUSTOMARY',
        claimantName: 'Fatima Bello',
        claimantNationalId: 'NID-1003-FAT',
        coordinates: [
          [3.381, 6.522],
          [3.3825, 6.522],
          [3.3825, 6.5235],
          [3.381, 6.5235],
          [3.381, 6.522],
        ],
      }),
    });
    assert.equal(badAppRes.status, 201);
    const { application: badApp } = await badAppRes.json();
    await completeSurveyorHandoff({
      baseUrl,
      applicationId: badApp.id,
      token: surveyorToken,
    });
    const badGis = await fetch(`${baseUrl}/api/gis/applications/${badApp.id}/validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${surveyorToken}` },
    });
    assert.equal(badGis.status, 200);

    const badPostRes = await fetch(`${baseUrl}/api/marketplace/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        applicationId: badApp.id,
        pricePol: 2.0,
        headline: 'Disputed Plot Listing',
      }),
    });
    assert.equal(badPostRes.status, 201);
    const badPostBody = await badPostRes.json();

    const badVerifyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${badPostBody.listing.id}/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(badVerifyRes.status, 200);
    const badVerifyBody = await badVerifyRes.json();
    assert.equal(badVerifyBody.verificationReport.verifiedSafeToBuy, false);
    assert.equal(badVerifyBody.verificationReport.checks.gisClean, true);
    assert.equal(badVerifyBody.verificationReport.checks.oracleClean, false);
    assert.ok(badVerifyBody.verificationReport.blockers.length >= 1);
    assert.equal(badVerifyBody.listing.title_id, null);

    // Purchase remains blocked even without confirmation flag
    const blockedBuyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${badPostBody.listing.id}/buy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(blockedBuyRes.status, 409);

    // Public visitor registers land directly — held as PENDING_ADMIN_APPROVAL until Admin verifies the deed
    const publicRegRes = await fetch(`${baseUrl}/api/marketplace/register-land`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcelName: 'Public Direct Checklands Plot',
        locationDescription: 'Zone 4 Direct Roadway',
        region: 'Zone 4',
        declaredAreaSqm: 950,
        ownershipType: 'FREEHOLD',
        claimantName: 'Adaeze Nwankwo',
        claimantNationalId: 'NID-2026-888',
        pricePol: 3.75,
        headline: 'Direct Public Plot',
        coordinates: [
          [3.395, 6.535],
          [3.3965, 6.535],
          [3.3965, 6.5365],
          [3.395, 6.5365],
          [3.395, 6.535],
        ],
      }),
    });
    assert.equal(publicRegRes.status, 201);
    const publicRegBody = await publicRegRes.json();
    assert.equal(publicRegBody.application.parcel_name, 'Public Direct Checklands Plot');
    assert.equal(publicRegBody.listing.listing_status, 'LISTED');
    assert.equal(publicRegBody.listing.verification_status, 'PENDING_ADMIN_APPROVAL');
    assert.equal(publicRegBody.verificationReport, null);

    // Must NOT appear on Check Lands yet
    const checkLandsRes = await fetch(`${baseUrl}/api/marketplace/listings`);
    assert.equal(checkLandsRes.status, 200);
    const checkLandsBody = await checkLandsRes.json();
    assert.equal(
      checkLandsBody.listings.some((l) => l.id === publicRegBody.listing.id),
      false
    );

    // Rejects missing price on /register-land
    const missingPriceRes = await fetch(`${baseUrl}/api/marketplace/register-land`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcelName: 'No Price Plot',
        locationDescription: 'Zone 4 Missing Price',
        region: 'Zone 4',
        declaredAreaSqm: 900,
        ownershipType: 'FREEHOLD',
        claimantName: 'Adaeze Nwankwo',
        claimantNationalId: 'NID-2026-888',
        pricePol: '',
        coordinates: [
          [3.401, 6.541],
          [3.402, 6.541],
          [3.402, 6.542],
          [3.401, 6.542],
          [3.401, 6.541],
        ],
      }),
    });
    assert.equal(missingPriceRes.status, 400);

    // Multipart upload with custom USD price + land deed is held for Admin deed verification before Check Lands
    const deedText = 'Deed of Conveyance for Zone 5 Survey Beacon 12';
    const deedForm = new FormData();
    deedForm.append('parcelName', 'Verified Deed Direct Plot');
    deedForm.append('locationDescription', 'Zone 5 Survey Beacon 12');
    deedForm.append('region', 'Zone 5');
    deedForm.append('declaredAreaSqm', '2750');
    deedForm.append('ownershipType', 'FREEHOLD');
    deedForm.append('claimantName', 'Emeka Okafor');
    deedForm.append('claimantNationalId', 'NID-2026-999');
    deedForm.append('priceUsd', '4250');
    deedForm.append('documentType', 'DEED_OF_CONVEYANCE');
    deedForm.append(
      'coordinates',
      JSON.stringify([
        [3.405, 6.545],
        [3.4065, 6.545],
        [3.4065, 6.5465],
        [3.405, 6.5465],
        [3.405, 6.545],
      ])
    );
    deedForm.append(
      'document',
      new Blob([deedText], { type: 'text/plain' }),
      'zone5-deed.txt'
    );

    const deedRegRes = await fetch(`${baseUrl}/api/marketplace/register-land`, {
      method: 'POST',
      body: deedForm,
    });
    assert.equal(deedRegRes.status, 201);
    const deedRegBody = await deedRegRes.json();
    assert.ok(deedRegBody.document?.sha256_hash);
    assert.equal(deedRegBody.document.document_type, 'DEED_OF_CONVEYANCE');
    assert.equal(Number(deedRegBody.listing.price_usd), 4250);
    assert.equal(Number(deedRegBody.listing.price_pol), 4.25);
    assert.equal(deedRegBody.listing.verification_status, 'PENDING_ADMIN_APPROVAL');
    assert.equal(deedRegBody.verificationReport, null);
    assert.ok(typeof deedRegBody.paymentToken === 'string' && deedRegBody.paymentToken.length > 20);

    // Public registrant can immediately inspect fee payment overview & generate a Sepolia quote using paymentToken
    const payOverviewRes = await fetch(
      `${baseUrl}/api/payments/applications/${deedRegBody.application.id}`,
      { headers: { Authorization: `Bearer ${deedRegBody.paymentToken}` } }
    );
    assert.equal(payOverviewRes.status, 200);
    const payQuoteRes = await fetch(`${baseUrl}/api/payments/quotes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deedRegBody.paymentToken}`,
      },
      body: JSON.stringify({
        applicationId: deedRegBody.application.id,
        walletAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      }),
    });
    assert.equal(payQuoteRes.status, 201);
    const payQuoteBody = await payQuoteRes.json();
    assert.ok(payQuoteBody.payment?.quote_id);

    // Still hidden from Check Lands and blocked from direct buyer verify/buy before Admin verification
    const hiddenRes = await fetch(`${baseUrl}/api/marketplace/listings`);
    const hiddenBody = await hiddenRes.json();
    assert.equal(
      hiddenBody.listings.some((l) => l.id === deedRegBody.listing.id),
      false
    );

    const lockedVerifyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${deedRegBody.listing.id}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(lockedVerifyRes.status, 409);

    const lockedBuyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${deedRegBody.listing.id}/buy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
        }),
      }
    );
    assert.equal(lockedBuyRes.status, 409);

    // Sole Admin inspects the verification queue and deed after the workflow review.

    const queueRes = await fetch(`${baseUrl}/api/admin/verification/queue`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(queueRes.status, 200);
    const queueBody = await queueRes.json();
    const queueItem = queueBody.queue.find((q) => q.id === deedRegBody.application.id);
    assert.ok(queueItem);
    assert.equal(queueItem.pending_listing?.verification_status, 'PENDING_ADMIN_APPROVAL');

    // Admin downloads & inspects uploaded deed file
    const docDownloadRes = await fetch(
      `${baseUrl}/api/admin/verification/documents/${deedRegBody.document.id}/download`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(docDownloadRes.status, 200);
    const downloadedDeedText = await docDownloadRes.text();
    assert.equal(downloadedDeedText, deedText);

    const evalRes = await fetch(
      `${baseUrl}/api/admin/verification/evaluate/${deedRegBody.application.id}`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(evalRes.status, 200);
    const evalBody = await evalRes.json();
    assert.equal(evalBody.documents.length, 1);
    assert.equal(evalBody.pendingListing?.id, deedRegBody.listing.id);

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: deedRegBody.application.id,
      token: surveyorToken,
    });
    const deedGis = await fetch(
      `${baseUrl}/api/gis/applications/${deedRegBody.application.id}/validate`,
      { method: 'POST', headers: { Authorization: `Bearer ${surveyorToken}` } }
    );
    assert.equal(deedGis.status, 200);

    // Admin completes ownership verification; registrar review and title issuance follow separately.
    const decideRes = await fetch(
      `${baseUrl}/api/admin/verification/decide/${deedRegBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          decision: 'APPROVED',
          remarks: 'Deed of conveyance inspected and approved for Check Lands.',
        }),
      }
    );
    assert.equal(decideRes.status, 201);
    const decideBody = await decideRes.json();
    assert.equal(decideBody.application.status, 'VERIFIED');
    assert.equal(decideBody.publishedListing?.verification_status, 'PENDING_ADMIN_APPROVAL');
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: deedRegBody.application.id,
      token: registrarToken,
      action: 'START_LEGAL_REVIEW',
      reason: 'Ownership verification completed; legal review started.',
    });
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: deedRegBody.application.id,
      token: registrarToken,
      action: 'APPROVE_APPLICATION',
      reason: 'Legal documents reviewed and approval recorded.',
    });
    const deedMint = await fetch(
      `${baseUrl}/api/admin/titles/mint/${deedRegBody.application.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(deedMint.status, 201);
    const publishApprovedDeed = await fetch(
      `${baseUrl}/api/admin/verification/publish-checklands/${deedRegBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      }
    );
    assert.equal(publishApprovedDeed.status, 200);
    const publishedDeedBody = await publishApprovedDeed.json();
    assert.equal(publishedDeedBody.publishedListing?.verification_status, 'VERIFIED');
    assert.equal(publishedDeedBody.publishedListing?.listing_status, 'LISTED');

    // Now Verified Deed Direct Plot appears on Check Lands!
    const updatedCheckLandsRes = await fetch(`${baseUrl}/api/marketplace/listings`);
    const updatedCheckLandsBody = await updatedCheckLandsRes.json();
    assert.ok(
      updatedCheckLandsBody.listings.some(
        (l) =>
          l.id === deedRegBody.listing.id &&
          l.verification_status === 'VERIFIED' &&
          Number(l.price_usd) === 4250 &&
          Number(l.price_pol) === 4.25
      )
    );

    // Buyer verifies the newly published Check Lands listing to obtain a live verificationCode
    const liveVerifyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${deedRegBody.listing.id}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(liveVerifyRes.status, 200);
    const liveVerifyBody = await liveVerifyRes.json();
    assert.equal(
      liveVerifyBody.verificationReport?.verifiedSafeToBuy,
      true,
      JSON.stringify(liveVerifyBody.verificationReport)
    );
    assert.equal(liveVerifyBody.verificationReport?.details?.documentsCount, 1);

    // Public buyer without JWT cannot pay without a connected wallet -> 401
    const noWalletBuy = await fetch(
      `${baseUrl}/api/marketplace/listings/${deedRegBody.listing.id}/buy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requireVerificationConfirmation: true,
          verificationCode: liveVerifyBody.verificationReport.verificationCode,
        }),
      }
    );
    assert.equal(noWalletBuy.status, 401);

    // Public buyer connects wallet (e.g. MetaMask Hardhat Account #4) and pays directly without email sign-in -> 200 OK
    const walletBuyRes = await fetch(
      `${baseUrl}/api/marketplace/listings/${deedRegBody.listing.id}/buy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
          requireVerificationConfirmation: true,
          verificationCode: liveVerifyBody.verificationReport.verificationCode,
        }),
      }
    );
    assert.equal(walletBuyRes.status, 200);
    const walletBuyBody = await walletBuyRes.json();
    assert.equal(walletBuyBody.listing.listing_status, 'ESCROW_FUNDED');
    assert.equal(
      walletBuyBody.listing.buyer_wallet.toLowerCase(),
      '0x90f79bf6eb2c4f870365e785982e1f101e93b906'
    );
    assert.match(walletBuyBody.message, /\$4,250/);

    // GIS must precede the Admin rejection decision, which keeps the listing hidden.
    await completeSurveyorHandoff({
      baseUrl,
      applicationId: publicRegBody.application.id,
      token: surveyorToken,
    });
    const publicGis = await fetch(
      `${baseUrl}/api/gis/applications/${publicRegBody.application.id}/validate`,
      { method: 'POST', headers: { Authorization: `Bearer ${surveyorToken}` } }
    );
    assert.equal(publicGis.status, 200);
    const rejectPublicRes = await fetch(
      `${baseUrl}/api/admin/verification/decide/${publicRegBody.application.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          decision: 'REJECTED',
          remarks: 'Submitted without supporting land deed.',
        }),
      }
    );
    assert.equal(rejectPublicRes.status, 201);
    const afterRejectList = await (await fetch(`${baseUrl}/api/marketplace/listings`)).json();
    assert.equal(
      afterRejectList.listings.some((l) => l.id === publicRegBody.listing.id),
      false
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetBlockchainContextForTests();
    delete process.env.ANAGU_STORE_PATH;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    if (prevPaymentGate === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevPaymentGate;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureDemoMarketplaceData seeds 4 idempotent USD demo land sales with verified, pending, and disputed flows', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-demo-seed-'));
  const storePath = path.join(tmpDir, 'store.json');
  process.env.ANAGU_STORE_PATH = storePath;
  resetBlockchainContextForTests();

  await ensureSeedUsers();
  const firstSeed = ensureDemoMarketplaceData(storePath);
  assert.equal(firstSeed.seeded, true);
  assert.equal(firstSeed.count, 4);

  const secondSeed = ensureDemoMarketplaceData(storePath);
  assert.equal(secondSeed.seeded, false);
  assert.equal(secondSeed.existingCount, 4);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/marketplace/listings`);
    assert.equal(res.status, 200);
    const { listings } = await res.json();
    assert.equal(listings.length, 4);

    const byName = new Map(listings.map((l) => [l.parcel_name, l]));
    assert.equal(byName.get('Yaba Commercial Plot A')?.price_usd, 4500);
    assert.equal(byName.get('Yaba Commercial Plot A')?.verification_status, 'VERIFIED');
    assert.equal(byName.get('Akoka Residential Plot B')?.price_usd, 6800);
    assert.equal(byName.get('Akoka Residential Plot B')?.verification_status, 'VERIFIED');
    assert.equal(byName.get('Victoria Waterfront Lot C')?.price_usd, 12500);
    assert.equal(
      byName.get('Victoria Waterfront Lot C')?.verification_status,
      'PENDING_VERIFICATION'
    );
    assert.equal(byName.get('Lekki Disputed Parcel D')?.price_usd, 3200);
    assert.equal(
      byName.get('Lekki Disputed Parcel D')?.verification_status,
      'PENDING_VERIFICATION'
    );

    // 1. Pre-verified demo parcel passes all 4 verification gates for wallet payment
    const yabaVerify = await fetch(
      `${baseUrl}/api/marketplace/listings/${byName.get('Yaba Commercial Plot A').id}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(yabaVerify.status, 200);
    const yabaReport = (await yabaVerify.json()).verificationReport;
    assert.equal(yabaReport.verifiedSafeToBuy, true);
    assert.equal(yabaReport.checks.gisClean, true);
    assert.equal(yabaReport.checks.oracleClean, true);
    assert.equal(yabaReport.checks.notRevoked, true);
    assert.equal(yabaReport.checks.onChainVerified, true);

    // 2. Disputed demo parcel is blocked by Oracle conflict check
    const lekkiVerify = await fetch(
      `${baseUrl}/api/marketplace/listings/${byName.get('Lekki Disputed Parcel D').id}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(lekkiVerify.status, 200);
    const lekkiReport = (await lekkiVerify.json()).verificationReport;
    assert.equal(lekkiReport.verifiedSafeToBuy, false);
    assert.equal(lekkiReport.checks.oracleClean, false);
    assert.ok(lekkiReport.blockers.length >= 1);

    // 3. Pending waterfront demo parcel verifies cleanly on demand and unlocks wallet escrow
    const vicVerify = await fetch(
      `${baseUrl}/api/marketplace/listings/${byName.get('Victoria Waterfront Lot C').id}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(vicVerify.status, 200);
    const vicBody = await vicVerify.json();
    assert.equal(vicBody.verificationReport.verifiedSafeToBuy, false);
    assert.equal(vicBody.verificationReport.checks.onChainVerified, false);
    assert.equal(vicBody.listing.title_id, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetBlockchainContextForTests();
    delete process.env.ANAGU_STORE_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

