import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEmptyStore,
  loadLocalStore,
  nextSequence,
  ROLES_SEED,
  SAMPLE_OWNERSHIP_RECORDS,
} from './db.js';
import { createUser, findUserByAuthId } from '../models/userModel.js';

const EXPECTED_TABLES = [
  'roles',
  'users',
  'land_applications',
  'land_parcels',
  'ownership_records',
  'verification_records',
  'supporting_documents',
  'land_titles',
  'blockchain_transactions',
  'revocation_records',
  'notifications',
  'audit_logs',
];

test('SQL migrations define PostGIS extension, GIST index, and all 12 core tables', () => {
  const m1 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/001_enable_postgis_and_roles.sql'),
    'utf8'
  );
  const m2 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/002_core_tables.sql'),
    'utf8'
  );
  const m3 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/003_postgis_spatial_functions.sql'),
    'utf8'
  );
  const m10 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/010_seed_staff_roles.sql'),
    'utf8'
  );
  const m11 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/011_supabase_auth_profiles.sql'),
    'utf8'
  );
  const m12 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/012_nigeria_geographic_reference.sql'),
    'utf8'
  );
  const m13 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/013_gis_measurements_and_boundary_history.sql'),
    'utf8'
  );
  const m14 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/014_land_application_review_workflow.sql'),
    'utf8'
  );
  const m15 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/015_status_transition_error_code.sql'),
    'utf8'
  );
  const m16 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/016_private_supporting_document_storage.sql'),
    'utf8'
  );
  const supabaseSchema = fs.readFileSync(
    path.resolve(process.cwd(), 'database/supabase_schema.sql'),
    'utf8'
  );

  const combined = `${m1}\n${m2}\n${m3}`;

  assert.match(combined, /CREATE EXTENSION IF NOT EXISTS postgis;/i);
  for (const tableName of EXPECTED_TABLES) {
    assert.match(
      combined,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i'),
      `Missing table definition: ${tableName}`
    );
  }

  assert.match(combined, /GEOMETRY\(Polygon,\s*4326\)/i);
  assert.match(combined, /USING GIST \(boundary\)/i);
  assert.match(combined, /ST_IsValid\(/i);
  assert.match(combined, /ST_Intersects\(/i);
  assert.match(combined, /OverridingPublicInterest/);
  assert.match(combined, /BreachOfStatutoryCondition/);

  const m4 = fs.readFileSync(
    path.resolve(process.cwd(), 'database/migrations/004_polygon_marketplace.sql'),
    'utf8'
  );
  assert.match(m4, /CREATE TABLE IF NOT EXISTS land_listings\b/i);
  assert.match(m10, /ON CONFLICT \(code\) DO UPDATE/i);
  assert.match(m11, /auth_user_id UUID REFERENCES auth\.users\(id\)/i);
  assert.match(m11, /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id/i);
  assert.match(m12, /exactly 774 LGAs/i);
  assert.match(m12, /exactly 714 partial-coverage wards/i);
  assert.match(m13, /ALTER COLUMN parcel_id DROP NOT NULL/i);
  assert.match(m13, /CREATE TRIGGER trg_anagu_record_application_boundary_version/i);
  assert.match(m13, /anagu_validate_parcel_polygon_phase4/i);
  assert.match(m13, /computed_perimeter_m DOUBLE PRECISION/i);
  assert.match(m13, /CREATE TRIGGER trg_anagu_record_parcel_boundary_version/i);
  assert.match(m14, /CREATE TABLE IF NOT EXISTS application_status_history/i);
  assert.match(m14, /CREATE TRIGGER trg_anagu_application_status_history/i);
  assert.match(m14, /anagu_transition_land_application_status/i);
  assert.match(m14, /'AWAITING_LEGAL_REVIEW'/i);
  assert.match(m14, /ERRCODE = 'P2001'/i);
  assert.match(m15, /CREATE OR REPLACE FUNCTION anagu_transition_land_application_status/i);
  assert.match(m15, /ERRCODE = 'P2001'/i);
  assert.match(m16, /ADD COLUMN IF NOT EXISTS storage_bucket TEXT/i);
  assert.match(m16, /'land-application-documents'[\s\S]*FALSE/i);
  assert.match(m16, /AS RESTRICTIVE[\s\S]*TO anon, authenticated/i);
  assert.match(supabaseSchema, /auth_user_id UUID UNIQUE REFERENCES auth\.users\(id\)/i);

  for (const roleCode of ['SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'GOVERNOR']) {
    assert.match(m10, new RegExp(`'${roleCode}'`));
    assert.match(supabaseSchema, new RegExp(`'${roleCode}'`));
  }
});

test('Local store initializes 18 tables, including application and boundary history with the six PRD RBAC roles', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-db-test-'));
  const storePath = path.join(tmpDir, 'store.json');

  const store = loadLocalStore(storePath);
  assert.equal(Object.keys(store.tables).length, 18);
  assert.deepEqual(store.tables.parcel_boundary_versions, []);
  assert.deepEqual(store.tables.application_status_history, []);
  assert.equal(store.tables.roles.length, ROLES_SEED.length);
  assert.equal(ROLES_SEED.length, 6);
  assert.equal(store.tables.ownership_records.length, SAMPLE_OWNERSHIP_RECORDS.length);
  assert.ok(store.tables.ownership_records.every((r) => r.is_sample_record === true));

  const nextId = nextSequence(store, 'users');
  assert.equal(nextId, 1);

  const fresh = createEmptyStore();
  assert.deepEqual(
    fresh.tables.roles.map((r) => r.code),
    ['CITIZEN', 'LAND_ADMIN', 'SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'GOVERNOR']
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Supabase Auth subjects resolve only to their linked local profile', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-auth-profile-test-'));
  const previousStorePath = process.env.ANAGU_STORE_PATH;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');

  try {
    const authUserId = 'c0a80101-0000-4000-8000-000000000001';
    const created = await createUser({
      fullName: 'Linked Citizen',
      email: 'linked-citizen@example.com',
      password: 'LocalTestPassword123!',
      nationalId: 'NID-LINKED-001',
      authUserId,
    });
    const linked = await findUserByAuthId(authUserId);
    assert.equal(linked.id, created.id);
    assert.equal(linked.role_code, 'CITIZEN');
    assert.equal(await findUserByAuthId('c0a80101-0000-4000-8000-000000000002'), null);
  } finally {
    if (previousStorePath === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = previousStorePath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
