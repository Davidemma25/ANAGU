import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from './config/supabase.js';

const EXPECTED_SUPABASE_TABLES = [
  'roles',
  'users',
  'land_applications',
  'application_status_history',
  'land_parcels',
  'ownership_records',
  'verification_records',
  'supporting_documents',
  'land_titles',
  'blockchain_transactions',
  'revocation_records',
  'land_listings',
  'payments',
  'payment_event_logs',
  'payment_settings',
  'notifications',
  'audit_logs',
];

test('Consolidated Supabase SQL schema defines all 17 tables, PostGIS RPCs, triggers, seeds, and RLS', () => {
  const schemaSql = fs.readFileSync(
    path.resolve(process.cwd(), 'database/supabase_schema.sql'),
    'utf8'
  );

  assert.match(schemaSql, /CREATE EXTENSION IF NOT EXISTS postgis;/i);
  for (const tableName of EXPECTED_SUPABASE_TABLES) {
    assert.match(
      schemaSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i'),
      `Missing Supabase table definition: ${tableName}`
    );
    assert.match(
      schemaSql,
      new RegExp(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`, 'i'),
      `Missing RLS enablement for table: ${tableName}`
    );
  }

  assert.match(schemaSql, /boundary GEOMETRY\(Polygon,\s*4326\)/i);
  assert.match(schemaSql, /boundary_geojson JSONB/i);
  assert.match(schemaSql, /USING GIST \(boundary\)/i);
  assert.match(schemaSql, /trg_sync_land_parcel_geometry/i);
  assert.match(schemaSql, /CREATE OR REPLACE FUNCTION anagu_validate_parcel_polygon/i);
  assert.match(schemaSql, /CREATE OR REPLACE FUNCTION anagu_find_parcel_at_coordinates/i);
  assert.match(schemaSql, /CREATE TRIGGER trg_anagu_application_status_history/i);
  assert.match(schemaSql, /anagu_transition_land_application_status/i);
  assert.match(schemaSql, /storage_bucket TEXT/i);
  assert.match(schemaSql, /'land-application-documents'[\s\S]*FALSE/i);
  assert.match(schemaSql, /anagu_private_documents_restrict_access[\s\S]*AS RESTRICTIVE/i);
  assert.match(schemaSql, /ERRCODE = 'P2001'/i);
  assert.match(schemaSql, /INSERT INTO roles/i);
  assert.match(schemaSql, /INSERT INTO ownership_records/i);
  assert.match(schemaSql, /INSERT INTO payment_settings/i);
});

test('isSupabaseActive isolates tests when ANAGU_STORE_PATH is set and assertNoSupabaseError maps unique violation to 409', () => {
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevForce = process.env.SUPABASE_FORCE;
  try {
    delete process.env.SUPABASE_FORCE;
    process.env.ANAGU_STORE_PATH = '/tmp/anagu-isolated-test-store.json';
    assert.equal(isSupabaseActive(), false);
  } finally {
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevForce === undefined) delete process.env.SUPABASE_FORCE;
    else process.env.SUPABASE_FORCE = prevForce;
  }

  assert.doesNotThrow(() => assertNoSupabaseError(null, 'No error'));

  assert.throws(
    () =>
      assertNoSupabaseError(
        { code: '23505', message: 'duplicate key value violates unique constraint' },
        'Duplicate test'
      ),
    (err) => err.statusCode === 409 && err.code === '23505'
  );

  // getSupabaseClient returns an initialized client when configured in .env
  const client = getSupabaseClient();
  if (client) {
    assert.equal(typeof client.from, 'function');
    assert.equal(typeof client.rpc, 'function');
  }
});
