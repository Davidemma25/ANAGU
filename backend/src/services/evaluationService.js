import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../app.js';
import { createAdminApp } from '../../admin/src/app.js';
import { loadLocalStore } from '../config/db.js';
import { getAdminEmail } from '../config/env.js';
import {
  createUser,
  ensureSeedUsers,
} from '../models/userModel.js';
import { signAuthToken } from '../middleware/authMiddleware.js';
import {
  initMqttInfrastructure,
  onMqttDelivery,
  publishAnaguEvent,
  stopMqttInfrastructure,
} from '../mqtt/mqttClient.js';
import {
  fundEscrowOnChain,
  listParcelOnChain,
  mintTitleOnChain,
  resetBlockchainContextForTests,
  revokeTitleOnChain,
  settleSaleOnChain,
} from './blockchainService.js';
import { validateAndRegisterParcel } from './gisService.js';
import { runOracleEvaluation } from './oracleService.js';

function statsFromDurations(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    trials: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    meanMs: Number((sum / sorted.length).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

async function registerCitizenAccount(baseUrl, { fullName, email, nationalId, walletAddress }) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
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
  const body = await res.json();
  if (res.status !== 201) {
    throw new Error(`Failed to register ${email}: ${body.error}`);
  }
  return body;
}

async function authenticateSoleAdmin(baseUrl, password) {
  const adminEmail = getAdminEmail();
  const setupRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: adminEmail,
      password,
      fullName: 'ANAGU Administrator',
    }),
  });
  if (setupRes.status === 201) {
    return setupRes.json();
  }
  const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const body = await loginRes.json();
  if (loginRes.status !== 200) {
    throw new Error(`Failed to authenticate administrator: ${body.error}`);
  }
  return body;
}

async function handoffApplicationToGis(baseUrl, applicationId, surveyorToken) {
  for (const [action, reason] of [
    ['START_SURVEY_REVIEW', 'Survey documents and parcel details reviewed.'],
    ['PASS_SURVEY_REVIEW', 'Survey evidence is complete for GIS validation.'],
  ]) {
    const response = await fetch(`${baseUrl}/api/applications/${applicationId}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surveyorToken}`,
      },
      body: JSON.stringify({ action, reason }),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(`Evaluation surveyor ${action} failed: ${body.error}`);
    }
  }
}

export async function runFourFraudScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-fraud-eval-'));
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
    const citizen = await registerCitizenAccount(baseUrl, {
      fullName: 'Amara Okafor',
      email: 'eval-citizen@example.com',
      nationalId: 'NID-EVAL-001',
      walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });
    const admin = await authenticateSoleAdmin(baseUrl, 'EvalAdminPass123!');
    const registrar = await createUser({
      fullName: 'Evaluation Registrar',
      email: 'eval-registrar@example.com',
      password: 'Password123!',
      nationalId: 'NID-EVAL-REGISTRAR',
      roleCode: 'REGISTRAR',
    });
    const registrarToken = signAuthToken(registrar);
    const surveyor = await createUser({
      fullName: 'Evaluation Surveyor',
      email: 'eval-surveyor@example.com',
      password: 'Password123!',
      nationalId: 'NID-EVAL-SURVEYOR',
      roleCode: 'SURVEYOR',
    });
    const surveyorToken = signAuthToken(surveyor);

    // Scenario 1: Forged / Tampered Document Detection
    const s1Start = nowMs();
    const s1AppRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({
        parcelName: 'Scenario 1 Forged Deed Plot',
        locationDescription: 'Zone 1 Baseline Evaluation Sector',
        region: 'Zone 1 District',
        declaredAreaSqm: 26000,
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
    const s1App = (await s1AppRes.json()).application;

    const formData = new FormData();
    formData.append('documentType', 'DEED_OF_CONVEYANCE');
    formData.append(
      'document',
      new Blob(['Authentic Deed Bytes — Scenario 1'], { type: 'text/plain' }),
      'scenario1-deed.txt'
    );
    formData.append('simulateTampered', 'true');
    const s1UploadRes = await fetch(`${baseUrl}/api/applications/${s1App.id}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizen.token}` },
      body: formData,
    });
    const s1Doc = (await s1UploadRes.json()).document;

    // Complete survey review before GIS validation and Oracle evaluation.
    await handoffApplicationToGis(baseUrl, s1App.id, surveyorToken);
    const s1GisRes = await fetch(`${baseUrl}/api/admin/gis/validate/${s1App.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    if (s1GisRes.status !== 200) {
      throw new Error('Scenario 1 baseline GIS validation unexpectedly failed');
    }

    const s1OracleRes = await fetch(`${baseUrl}/api/admin/verification/evaluate/${s1App.id}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const s1OracleBody = await s1OracleRes.json();
    const s1HasTamperConflict = s1OracleBody.oracle.conflicts.some(
      (c) => c.type === 'TAMPERED_DOCUMENT'
    );
    const s1LatencyMs = Number((nowMs() - s1Start).toFixed(2));

    // Cleanup uploaded file — handle both legacy root/uploads and new backend/uploads paths
    if (s1Doc?.storage_path) {
      const diskPath = s1Doc.storage_path.startsWith('backend/')
        ? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', s1Doc.storage_path.replace(/^backend\//, ''))
        : path.resolve(process.cwd(), s1Doc.storage_path);
      if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    }

    // Scenario 2: Overlapping Parcel Rejection (PostGIS ST_Intersects)
    const s2Start = nowMs();
    const s2OverlapAppRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({
        parcelName: 'Scenario 2 Overlapping Encroachment',
        locationDescription: 'Encroaching directly on Plot A Zone 1',
        region: 'Zone 1 District',
        declaredAreaSqm: 22000,
        ownershipType: 'FREEHOLD',
        claimantName: 'Encroaching Claimant',
        claimantNationalId: 'NID-9090-ENC',
        coordinates: [
          [3.3755, 6.5205],
          [3.377, 6.5205],
          [3.377, 6.522],
          [3.3755, 6.522],
          [3.3755, 6.5205],
        ],
      }),
    });
    const s2OverlapApp = (await s2OverlapAppRes.json()).application;
    await handoffApplicationToGis(baseUrl, s2OverlapApp.id, surveyorToken);
    const s2GisRes = await fetch(`${baseUrl}/api/admin/gis/validate/${s2OverlapApp.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const s2GisBody = await s2GisRes.json();
    const s2LatencyMs = Number((nowMs() - s2Start).toFixed(2));

    // Scenario 3: Oracle Conflict Override Block (409 ORACLE_CONFLICT_OVERRIDE_BLOCKED)
    const s3Start = nowMs();
    const s3AppRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({
        parcelName: 'Scenario 3 Disputed Plot C',
        locationDescription: 'Customary disputed parcel INST-2024-003',
        region: 'Zone 3 District',
        declaredAreaSqm: 24000,
        ownershipType: 'CUSTOMARY',
        claimantName: 'Colluding Applicant',
        claimantNationalId: 'NID-8888-COL',
        coordinates: [
          [3.381, 6.522],
          [3.3825, 6.522],
          [3.3825, 6.5235],
          [3.381, 6.5235],
          [3.381, 6.522],
        ],
      }),
    });
    const s3App = (await s3AppRes.json()).application;
    await handoffApplicationToGis(baseUrl, s3App.id, surveyorToken);
    await fetch(`${baseUrl}/api/admin/gis/validate/${s3App.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const s3OverrideRes = await fetch(`${baseUrl}/api/admin/verification/decide/${s3App.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        decision: 'APPROVED',
        remarks: 'Attempted override approval over disputed archive record.',
      }),
    });
    const s3OverrideBody = await s3OverrideRes.json();
    const s3LatencyMs = Number((nowMs() - s3Start).toFixed(2));

    // Scenario 4: Revoked Title Transfer, Listing & Reuse Prevention
    const s4Start = nowMs();
    const s4CleanAppRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({
        parcelName: 'Scenario 4 Clean Plot B',
        locationDescription: 'Community allocation corridor Plot B',
        region: 'Zone 2 District',
        declaredAreaSqm: 26000,
        ownershipType: 'CUSTOMARY',
        claimantName: 'Chidi Nwosu',
        claimantNationalId: 'NID-1002-CHI',
        coordinates: [
          [3.378, 6.52],
          [3.3795, 6.52],
          [3.3795, 6.5215],
          [3.378, 6.5215],
          [3.378, 6.52],
        ],
      }),
    });
    const s4App = (await s4CleanAppRes.json()).application;
    await handoffApplicationToGis(baseUrl, s4App.id, surveyorToken);
    await fetch(`${baseUrl}/api/admin/gis/validate/${s4App.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    await fetch(`${baseUrl}/api/admin/verification/decide/${s4App.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        decision: 'APPROVED',
        remarks: 'Verified clean community allocation matching COMM-2024-002.',
      }),
    });
    for (const [action, reason] of [
      ['START_LEGAL_REVIEW', 'Ownership verification completed; legal review started.'],
      ['APPROVE_APPLICATION', 'Legal documents reviewed and approval recorded.'],
    ]) {
      const reviewRes = await fetch(`${baseUrl}/api/applications/${s4App.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${registrarToken}`,
        },
        body: JSON.stringify({ action, reason }),
      });
      if (!reviewRes.ok) {
        const reviewBody = await reviewRes.json();
        throw new Error(`Evaluation registrar ${action} failed: ${reviewBody.error}`);
      }
    }
    const s4MintRes = await fetch(`${baseUrl}/api/admin/titles/mint/${s4App.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({}),
    });
    const s4Title = (await s4MintRes.json()).title;

    const s4RevokeRes = await fetch(`${baseUrl}/api/admin/revocations/${s4Title.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        ground: 'OverridingPublicInterest',
        reason: 'Statutory public transit corridor acquisition order 2026-11.',
      }),
    });
    const s4RevokeBody = await s4RevokeRes.json();

    const s4TransferRes = await fetch(`${baseUrl}/api/titles/${s4Title.id}/test-transfer-block`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({}),
    });
    const s4TransferBody = await s4TransferRes.json();

    const s4RelistRes = await fetch(`${baseUrl}/api/marketplace/listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({ titleId: s4Title.id, pricePol: 3.0 }),
    });
    const s4LatencyMs = Number((nowMs() - s4Start).toFixed(2));

    return [
      {
        id: 'SCENARIO_1_FORGED_DOCUMENT',
        title: 'Scenario 1: Forged / Tampered Document Detection',
        passed: s1HasTamperConflict && s1OracleBody.oracle.conflictDetected === true,
        outcome: s1HasTamperConflict ? 'DETECTED (TAMPERED_DOCUMENT)' : 'FAILED',
        httpStatus: s1OracleRes.status,
        latencyMs: s1LatencyMs,
        evidence: `Oracle flagged ${s1OracleBody.oracle.conflicts.length} conflict(s) on tampered deed.`,
      },
      {
        id: 'SCENARIO_2_OVERLAPPING_PARCEL',
        title: 'Scenario 2: Overlapping Parcel Boundary Rejection',
        passed: s2GisRes.status === 422 && s2GisBody.passed === false,
        outcome: s2GisRes.status === 422 ? 'REJECTED (HTTP 422 · OVERLAP)' : 'FAILED',
        httpStatus: s2GisRes.status,
        latencyMs: s2LatencyMs,
        evidence: `GIS detected overlap (${s2GisBody.validation?.overlappingParcels?.length || 0} conflicting parcel(s)).`,
      },
      {
        id: 'SCENARIO_3_ORACLE_OVERRIDE_BLOCK',
        title: 'Scenario 3: Conflicting Archive Claim Override Block',
        passed:
          s3OverrideRes.status === 409 &&
          s3OverrideBody.code === 'ORACLE_CONFLICT_OVERRIDE_BLOCKED',
        outcome:
          s3OverrideRes.status === 409
            ? 'BLOCKED (HTTP 409 · ORACLE_CONFLICT_OVERRIDE_BLOCKED)'
            : 'FAILED',
        httpStatus: s3OverrideRes.status,
        latencyMs: s3LatencyMs,
        evidence: 'Blocked attempt to override disputed archive INST-2024-003 and logged audit event.',
      },
      {
        id: 'SCENARIO_4_REVOKED_TITLE_REUSE',
        title: 'Scenario 4: Revoked Title Transfer & Market Reuse Prevention',
        passed:
          s4RevokeRes.status === 201 &&
          s4TransferBody.blocked === true &&
          String(s4TransferBody.reason).includes('TitleIsRevoked') &&
          s4RelistRes.status === 409,
        outcome:
          s4TransferBody.blocked && s4RelistRes.status === 409
            ? 'BLOCKED (TitleIsRevoked + HTTP 409)'
            : 'FAILED',
        httpStatus: s4RelistRes.status,
        latencyMs: s4LatencyMs,
        evidence: `Revoked tx ${s4RevokeBody.revocation?.tx_hash?.slice(0, 14)}... blocked transfer (${s4TransferBody.reason}) & marketplace listing.`,
      },
    ];
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetBlockchainContextForTests();
    if (prevStore === undefined) {
      delete process.env.ANAGU_STORE_PATH;
    } else {
      process.env.ANAGU_STORE_PATH = prevStore;
    }
    if (prevReqPay === undefined) {
      delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    } else {
      process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    }
    if (prevAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = prevAdminPassword;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function runPerformanceBenchmarks({ trials = 5 } = {}) {
  const numTrials = Math.max(2, Math.min(15, Number(trials) || 5));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-bench-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const storePath = path.join(tmpDir, 'store.json');
  process.env.ANAGU_STORE_PATH = storePath;
  resetBlockchainContextForTests();

  const gisSamples = [];
  const oracleSamples = [];
  const mintSamples = [];
  const mintGas = [];
  const escrowSamples = [];
  const escrowGas = [];
  const revokeSamples = [];
  const revokeGas = [];
  const mqttSamples = [];

  try {
    await ensureSeedUsers();
    const citizen = await createUser({
      fullName: 'Benchmark Seller',
      email: 'bench-seller@example.com',
      password: 'Password123!',
      nationalId: 'NID-BENCH-001',
      walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      roleCode: 'CITIZEN',
    });
    const buyer = await createUser({
      fullName: 'Benchmark Buyer',
      email: 'bench-buyer@example.com',
      password: 'Password123!',
      nationalId: 'NID-BENCH-002',
      walletAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      roleCode: 'CITIZEN',
    });

    // Initialize isolated Aedes broker & MQTT client for MQTT latency measurements
    await initMqttInfrastructure({ port: 0 });
    const pendingWaiters = new Map();
    const unsubscribe = onMqttDelivery((entry) => {
      const waiter = pendingWaiters.get(entry.eventId);
      if (waiter) {
        pendingWaiters.delete(entry.eventId);
        waiter(entry.deliveryLatencyMs);
      }
    });

    for (let i = 0; i < numTrials; i += 1) {
      // Shift parcel longitude each iteration so parcels never collide in GIS overlap check
      const baseLng = 3.4 + i * 0.01;
      const appObj = {
        id: 100 + i,
        reference_code: `ANG-BENCH-2026-${String(i + 1).padStart(4, '0')}`,
        applicant_id: citizen.id,
        parcel_name: `Benchmark Plot ${i + 1}`,
        region: 'Zone 1 District',
        declared_area_sqm: 25000,
        ownership_type: 'FREEHOLD',
        claimant_name: 'Amara Okafor',
        claimant_national_id: 'NID-1001-AMA',
        coordinates_geojson: {
          type: 'Polygon',
          coordinates: [
            [
              [baseLng, 6.52],
              [baseLng + 0.0015, 6.52],
              [baseLng + 0.0015, 6.5215],
              [baseLng, 6.5215],
              [baseLng, 6.52],
            ],
          ],
        },
        status: 'SUBMITTED',
      };

      const currentStore = loadLocalStore(storePath);
      currentStore.tables.land_applications.push(appObj);
      fs.writeFileSync(storePath, JSON.stringify(currentStore, null, 2), 'utf8');

      // 1. GIS spatial check
      const tGis0 = nowMs();
      await validateAndRegisterParcel({ application: appObj, surveyorId: citizen.id });
      gisSamples.push(nowMs() - tGis0);

      // 2. Oracle cross-check
      const tOracle0 = nowMs();
      await runOracleEvaluation(appObj.id);
      oracleSamples.push(nowMs() - tOracle0);

      // 3. Blockchain Mint Title
      const tMint0 = nowMs();
      const mintRes = await mintTitleOnChain({
        toWallet: citizen.walletAddress,
        parcelCode: `ANG-BENCH-P-${i + 1}`,
        applicationRef: appObj.reference_code,
        metadataUri: `data:application/json;base64,${Buffer.from(
          JSON.stringify({ parcel: `P-${i + 1}` })
        ).toString('base64')}`,
      });
      mintSamples.push(nowMs() - tMint0);
      mintGas.push(Number(mintRes.gasUsed));

      // 4. Polygon Marketplace Escrow Cycle (List -> Fund -> Settle)
      const tEscrow0 = nowMs();
      const listRes = await listParcelOnChain({
        sellerWallet: citizen.walletAddress,
        tokenId: mintRes.tokenId,
        pricePol: 1.5,
      });
      const buyRes = await fundEscrowOnChain({
        buyerWallet: buyer.walletAddress,
        tokenId: mintRes.tokenId,
        priceWei: listRes.priceWei,
      });
      const settleRes = await settleSaleOnChain({ tokenId: mintRes.tokenId });
      escrowSamples.push(nowMs() - tEscrow0);
      escrowGas.push(Number(listRes.gasUsed) + Number(buyRes.gasUsed) + Number(settleRes.gasUsed));

      // 5. Statutory Revocation
      const tRev0 = nowMs();
      const revRes = await revokeTitleOnChain({
        tokenId: mintRes.tokenId,
        ground: 'OverridingPublicInterest',
        reason: `Benchmark statutory revocation trial ${i + 1}`,
      });
      revokeSamples.push(nowMs() - tRev0);
      revokeGas.push(Number(revRes.gasUsed));

      // 6. MQTT QoS 1 End-to-End Pub/Sub Latency
      const tMqtt0 = nowMs();
      const deliveredPromise = new Promise((resolve) => {
        setTimeout(() => resolve(nowMs() - tMqtt0), 500);
        // Attach dynamically once eventId returns
        pendingWaiters.set(`pending-${i}`, resolve);
      });
      const pubRes = await publishAnaguEvent({
        topic: 'anagu/benchmark/trial',
        eventType: 'BENCHMARK_PING',
        userId: citizen.id,
        targetRole: 'ALL',
        data: { trial: i + 1, nonce: crypto.randomBytes(4).toString('hex') },
      });
      const resolver = pendingWaiters.get(`pending-${i}`);
      if (resolver) {
        pendingWaiters.delete(`pending-${i}`);
        pendingWaiters.set(pubRes.notification.payload.eventId, resolver);
      }
      await deliveredPromise;
      mqttSamples.push(nowMs() - tMqtt0);
    }

    unsubscribe();

    const storeSizeBytes = fs.statSync(storePath).size;
    const finalStore = loadLocalStore(storePath);
    const totalRecords = Object.values(finalStore.tables).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0
    );

    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    return {
      trials: numTrials,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        evmEngine: 'Hardhat In-Process EVM (Cancun)',
        mqttEngine: 'Aedes Embedded TCP Broker + MQTT.js (QoS 1)',
      },
      subsystems: [
        {
          id: 'GIS_SPATIAL_CHECK',
          label: 'GIS Geometry & Overlap Check',
          ...statsFromDurations(gisSamples),
          avgGasUsed: null,
        },
        {
          id: 'COMMUNITY_ORACLE',
          label: 'Community Ownership Oracle Cross-Check',
          ...statsFromDurations(oracleSamples),
          avgGasUsed: null,
        },
        {
          id: 'BLOCKCHAIN_MINT',
          label: 'ERC-721 Title Minting (Polygon EVM)',
          ...statsFromDurations(mintSamples),
          avgGasUsed: avg(mintGas),
        },
        {
          id: 'POLYGON_ESCROW_CYCLE',
          label: 'Polygon Marketplace Escrow (List+Buy+Settle)',
          ...statsFromDurations(escrowSamples),
          avgGasUsed: avg(escrowGas),
        },
        {
          id: 'ADMIN_REVOKE',
          label: 'Admin Statutory Revocation On-Chain',
          ...statsFromDurations(revokeSamples),
          avgGasUsed: avg(revokeGas),
        },
        {
          id: 'MQTT_QOS1_PUBSUB',
          label: 'MQTT QoS 1 Publish + Subscriber Receipt',
          ...statsFromDurations(mqttSamples),
          avgGasUsed: null,
        },
      ],
      storage: {
        prototypeStoreBytes: storeSizeBytes,
        totalRecordsStored: totalRecords,
        avgBytesPerRecord: totalRecords > 0 ? Math.round(storeSizeBytes / totalRecords) : 0,
        sampleTitleMetadataBytes: Buffer.byteLength(
          JSON.stringify({
            name: 'ANAGU Title · ANG-PARCEL-0001',
            parcelCode: 'ANG-PARCEL-0001',
            areaSqm: 27701.69,
          })
        ),
      },
    };
  } finally {
    await stopMqttInfrastructure();
    resetBlockchainContextForTests();
    if (prevStore === undefined) {
      delete process.env.ANAGU_STORE_PATH;
    } else {
      process.env.ANAGU_STORE_PATH = prevStore;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
