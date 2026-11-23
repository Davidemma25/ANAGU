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
import { isLocationReferenceSchemaMissing } from './models/locationModel.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
} from './testHelpers/applicationReviews.js';
import {
  computeGeodesicAreaSqm,
  computeGeodesicPerimeterM,
  detectPolygonOverlap,
  isPointInPolygon,
  validatePolygonGeometry,
} from './services/gisService.js';

const geographicReference = JSON.parse(
  fs.readFileSync(
    new URL('../../database/seeds/nigeria-geographic-reference.json', import.meta.url),
    'utf8'
  )
);

test('GIS Geometry Validation catches self-intersecting bowtie polygons and accepts valid plots', () => {
  const validPoly = {
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
  const validRes = validatePolygonGeometry(validPoly);
  assert.equal(validRes.isValid, true);
  assert.ok(computeGeodesicAreaSqm(validPoly.coordinates[0]) > 20000);
  assert.ok(computeGeodesicPerimeterM(validPoly.coordinates[0]) > 600);
  assert.ok(computeGeodesicPerimeterM(validPoly.coordinates[0]) < 700);

  // Self-intersecting bowtie polygon
  const bowtiePoly = {
    type: 'Polygon',
    coordinates: [
      [
        [3.375, 6.52],
        [3.3765, 6.5215],
        [3.3765, 6.52],
        [3.375, 6.5215],
        [3.375, 6.52],
      ],
    ],
  };
  const invalidRes = validatePolygonGeometry(bowtiePoly);
  assert.equal(invalidRes.isValid, false);
  assert.match(invalidRes.validityReason, /Self-intersection/i);
});

test('Nigeria GIS reference data preserves national totals and identifies incomplete ward coverage', () => {
  assert.equal(geographicReference.states.length, 37);
  assert.equal(geographicReference.lgas.length, 774);
  assert.equal(geographicReference.wards.length, 714);
  assert.match(geographicReference.metadata.note, /partial national coverage/i);
});

test('GIS location APIs identify missing reference migrations without masking other database errors', () => {
  for (const code of ['42703', '42P01', 'PGRST204', 'PGRST205']) {
    assert.equal(isLocationReferenceSchemaMissing({ code }), true);
  }
  assert.equal(isLocationReferenceSchemaMissing({ code: '08006' }), false);
  assert.equal(isLocationReferenceSchemaMissing(new Error('network unavailable')), false);
});

test('GIS Overlap Detection rejects overlapping parcels while allowing shared-edge adjacent parcels', () => {
  const existing = [
    {
      application_id: 1,
      parcel_code: 'ANG-PARCEL-0001',
      status: 'VALIDATED',
      boundary_geojson: {
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
      },
    },
  ];

  // Adjacent parcel sharing the exact east edge (x = 3.3765) -> 0 m² interior overlap
  const adjacentPoly = {
    type: 'Polygon',
    coordinates: [
      [
        [3.3765, 6.52],
        [3.378, 6.52],
        [3.378, 6.5215],
        [3.3765, 6.5215],
        [3.3765, 6.52],
      ],
    ],
  };
  const adjCheck = detectPolygonOverlap(adjacentPoly, existing);
  assert.equal(adjCheck.hasOverlap, false);

  // Overlapping parcel encroaching by ~50% into ANG-PARCEL-0001
  const encroachingPoly = {
    type: 'Polygon',
    coordinates: [
      [
        [3.3758, 6.5205],
        [3.3775, 6.5205],
        [3.3775, 6.522],
        [3.3758, 6.522],
        [3.3758, 6.5205],
      ],
    ],
  };
  const overlapCheck = detectPolygonOverlap(encroachingPoly, existing);
  assert.equal(overlapCheck.hasOverlap, true);
  assert.equal(overlapCheck.overlappingParcels[0].parcelCode, 'ANG-PARCEL-0001');
  assert.ok(overlapCheck.overlappingParcels[0].overlapAreaSqm > 1.0);
});

import './testEnv.js';
import { getAdminEmail } from './config/env.js';

test('GIS APIs validate locations, enforce RBAC, preserve boundary history, and reject overlaps', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-gis-test-'));
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
        email: 'gis-citizen@example.com',
        password: 'Password123!',
        nationalId: 'NID-GIS-001',
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
    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'gis');

    const statesRes = await fetch(`${baseUrl}/api/gis/locations/states`);
    const statesBody = await statesRes.json();
    assert.equal(statesRes.status, 200);
    assert.equal(statesBody.locations.length, 37);
    const allLgas = await Promise.all(
      statesBody.locations.map(async (state) => {
        const response = await fetch(`${baseUrl}/api/gis/locations/lgas/${state.id}`);
        assert.equal(response.status, 200);
        const body = await response.json();
        return body.locations;
      })
    );
    assert.equal(allLgas.flat().length, 774);
    const lagos = statesBody.locations.find((state) => state.name === 'Lagos');
    const abia = statesBody.locations.find((state) => state.name === 'Abia');
    const lagosLgaRes = await fetch(`${baseUrl}/api/gis/locations/lgas/${lagos.id}`);
    const lagosLgas = (await lagosLgaRes.json()).locations;
    const abiaLgaRes = await fetch(`${baseUrl}/api/gis/locations/lgas/${abia.id}`);
    const abiaLgas = (await abiaLgaRes.json()).locations;
    const wardParentLga = allLgas
      .flat()
      .find((lga) => lga.source_code === geographicReference.wards[0].lgaCode);
    assert.ok(wardParentLga);
    const wardsRes = await fetch(
      `${baseUrl}/api/gis/locations/communities/${wardParentLga.id}`
    );
    const wardsBody = await wardsRes.json();
    assert.equal(wardsRes.status, 200);
    assert.match(wardsBody.coverageNote, /partial national coverage/i);
    assert.ok(wardsBody.locations.every((ward) => ward.place_type === 'WARD'));

    const mismatchedLocationRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Invalid Location Pair',
        locationDescription: 'LGA from another state',
        region: 'Lagos',
        declaredAreaSqm: 25000,
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
        stateId: lagos.id,
        lgaId: abiaLgas[0].id,
      }),
    });
    assert.equal(mismatchedLocationRes.status, 400);

    // Submit Plot A (valid)
    const app1Res = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Plot A Baseline',
        locationDescription: 'Zone 1 North',
        region: 'Zone 1',
        declaredAreaSqm: 25000,
        ownershipType: 'FREEHOLD',
        claimantName: 'Amara Okafor',
        claimantNationalId: 'NID-1001-AMA',
        stateId: lagos.id,
        lgaId: lagosLgas[0].id,
        boundarySource: 'MANUAL_GPS',
        coordinates: [
          [3.375, 6.52],
          [3.3765, 6.52],
          [3.3765, 6.5215],
          [3.375, 6.5215],
          [3.375, 6.52],
        ],
      }),
    });
    const { application: app1 } = await app1Res.json();
    assert.equal(app1.state_id, lagos.id);
    assert.equal(app1.lga_id, lagosLgas[0].id);
    assert.equal(app1.boundary_source, 'MANUAL_GPS');
    const historyUrl = `${baseUrl}/api/gis/applications/${app1.id}/boundary-history`;
    const submittedHistoryResponse = await fetch(historyUrl, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    const submittedHistory = await submittedHistoryResponse.json();
    assert.equal(submittedHistoryResponse.status, 200);
    assert.equal(submittedHistory.versions.length, 1);
    assert.equal(submittedHistory.versions[0].parcel_id, null);

    // Citizen cannot run GIS validation (403)
    const citValidate = await fetch(`${baseUrl}/api/admin/gis/validate/${app1.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal(citValidate.status, 403);

    const prematureAdminValidate = await fetch(
      `${baseUrl}/api/admin/gis/validate/${app1.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(prematureAdminValidate.status, 409);

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: app1.id,
      token: surveyorToken,
    });
    // Administrator validates only after the Surveyor handoff.
    const adminValidate1 = await fetch(`${baseUrl}/api/admin/gis/validate/${app1.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminValidate1.status, 200);
    const valBody1 = await adminValidate1.json();
    assert.equal(valBody1.passed, true);
    assert.equal(valBody1.status, 'GIS_VALIDATED');
    assert.ok(valBody1.validation.computedPerimeterM > 450);
    assert.ok(Number(valBody1.parcel.perimeter_m) > 450);

    const historyResponse = await fetch(historyUrl, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal(historyResponse.status, 200);
    const historyBody = await historyResponse.json();
    assert.equal(historyBody.versions.length, 1);
    assert.equal(historyBody.versions[0].version_number, 1);
    assert.equal(historyBody.versions[0].parcel_id, valBody1.parcel.id);
    assert.equal(historyBody.versions[0].boundary_source, 'MANUAL_GPS');

    // Submit Overlapping Fraud Plot A-2 -> Administrator validation returns 422 GIS_REJECTED
    const app2Res = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Plot A Encroachment',
        locationDescription: 'Overlapping claim inside Plot A',
        region: 'Zone 1',
        declaredAreaSqm: 20000,
        ownershipType: 'FREEHOLD',
        claimantName: 'Amara Okafor',
        claimantNationalId: 'NID-1001-AMA',
        coordinates: [
          [3.3758, 6.5205],
          [3.3772, 6.5205],
          [3.3772, 6.522],
          [3.3758, 6.522],
          [3.3758, 6.5205],
        ],
      }),
    });
    const { application: app2 } = await app2Res.json();

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: app2.id,
      token: surveyorToken,
    });
    const adminValidate2 = await fetch(`${baseUrl}/api/admin/gis/validate/${app2.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminValidate2.status, 422);
    const valBody2 = await adminValidate2.json();
    assert.equal(valBody2.passed, false);
    assert.equal(valBody2.status, 'GIS_REJECTED');
    assert.equal(valBody2.validation.hasOverlap, true);

    // Coordinate lookup inside validated Plot A returns ANG-PARCEL-0001
    const hitRes = await fetch(`${baseUrl}/api/gis/lookup?lat=6.52075&lng=3.37575`);
    assert.equal(hitRes.status, 200);
    const hitBody = await hitRes.json();
    assert.equal(hitBody.matched, true);
    assert.equal(hitBody.matchType, 'REGISTERED_PARCEL');
    assert.equal(hitBody.parcelCode, 'ANG-PARCEL-0001');

    // Coordinate lookup inside sample Plot B (before application exists) returns ANG-PARCEL-1002 institutional record
    const instRes = await fetch(`${baseUrl}/api/gis/lookup?lat=6.52075&lng=3.37875`);
    assert.equal(instRes.status, 200);
    const instBody = await instRes.json();
    assert.equal(instBody.matched, true);
    assert.equal(instBody.matchType, 'INSTITUTIONAL_RECORD');
    assert.equal(instBody.parcelCode, 'ANG-PARCEL-1002');

    // Coordinate lookup outside all parcels returns UNCLAIMED
    const missRes = await fetch(`${baseUrl}/api/gis/lookup?lat=6.4541&lng=3.3947`);
    assert.equal(missRes.status, 200);
    const missBody = await missRes.json();
    assert.equal(missBody.matched, false);
    assert.equal(missBody.matchType, 'UNCLAIMED');
    assert.equal(missBody.parcelCode, null);

    // Invalid coordinates return 400
    const badRes = await fetch(`${baseUrl}/api/gis/lookup?lat=999&lng=3.39`);
    assert.equal(badRes.status, 400);

    assert.equal(
      isPointInPolygon(6.52075, 3.37575, {
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
      }),
      true
    );

    const changedBoundary = [
      [3.385, 6.52],
      [3.3865, 6.52],
      [3.3865, 6.5215],
      [3.385, 6.5215],
      [3.385, 6.52],
    ];

    const otherCitizenRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Another Citizen',
        email: 'gis-other-citizen@example.com',
        password: 'Password123!',
        nationalId: 'NID-GIS-OTHER',
      }),
    });
    const { token: otherCitizenToken } = await otherCitizenRes.json();
    const deniedBoundaryUpdate = await fetch(
      `${baseUrl}/api/gis/applications/${app1.id}/boundary`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherCitizenToken}`,
        },
        body: JSON.stringify({
          coordinates: changedBoundary,
          boundarySource: 'MANUAL_GPS',
          changeReason: 'Updated survey coordinates',
        }),
      }
    );
    assert.equal(deniedBoundaryUpdate.status, 403);

    const boundaryUpdate = await fetch(`${baseUrl}/api/gis/applications/${app1.id}/boundary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        coordinates: changedBoundary,
        boundarySource: 'MANUAL_GPS',
        changeReason: 'Updated survey coordinates',
      }),
    });
    assert.equal(boundaryUpdate.status, 200);
    const boundaryUpdateBody = await boundaryUpdate.json();
    assert.equal(boundaryUpdateBody.boundaryVersion.version_number, 2);

    await completeSurveyorHandoff({
      baseUrl,
      applicationId: app1.id,
      token: surveyorToken,
    });
    const revalidation = await fetch(`${baseUrl}/api/admin/gis/validate/${app1.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(revalidation.status, 200);
    const changedHistory = await fetch(historyUrl, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    const changedHistoryBody = await changedHistory.json();
    assert.equal(changedHistoryBody.versions.length, 2);
    assert.equal(changedHistoryBody.versions[1].version_number, 2);
    assert.equal(changedHistoryBody.versions[1].parcel_id, valBody1.parcel.id);
    assert.equal(changedHistoryBody.versions[1].changed_by, Number(boundaryUpdateBody.boundaryVersion.changed_by));
    assert.notEqual(
      changedHistoryBody.versions[0].geometry_hash,
      changedHistoryBody.versions[1].geometry_hash
    );

    const deniedHistory = await fetch(historyUrl, {
      headers: { Authorization: `Bearer ${otherCitizenToken}` },
    });
    assert.equal(deniedHistory.status, 403);
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
