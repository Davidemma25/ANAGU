-- =============================================================================
-- ANAGU Land Administration & Title Verification — Consolidated Supabase Schema
-- =============================================================================
-- Run this script once in your Supabase Dashboard -> SQL Editor -> New Query.
-- Includes:
--   * PostGIS extension + spatial GIST index + geometry/GeoJSON sync trigger
--   * All 17 relational tables (including application review history)
--   * PostGIS RPC spatial functions for validation & coordinate lookup
--   * Baseline RBAC roles, 3 sample institutional records, & payment settings
--   * Row Level Security (RLS) enabled on all public tables
-- =============================================================================

-- 1. Enable PostGIS for WGS84 (SRID 4326) spatial validation & overlap detection
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. RBAC Roles
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE CHECK (
    code IN (
      'CITIZEN',
      'SURVEYOR',
      'COMMUNITY_OFFICER',
      'REGISTRAR',
      'LAND_ADMIN',
      'GOVERNOR'
    )
  ),
  name VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  national_id VARCHAR(60) NOT NULL UNIQUE,
  phone VARCHAR(40),
  wallet_address VARCHAR(42),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id);

-- 4. Land Applications
CREATE TABLE IF NOT EXISTS land_applications (
  id SERIAL PRIMARY KEY,
  reference_code VARCHAR(40) NOT NULL UNIQUE,
  applicant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parcel_name VARCHAR(140) NOT NULL,
  location_description TEXT NOT NULL,
  region VARCHAR(100) NOT NULL,
  declared_area_sqm NUMERIC(14, 2) NOT NULL CHECK (declared_area_sqm > 0),
  ownership_type VARCHAR(60) NOT NULL CHECK (
    ownership_type IN ('FREEHOLD', 'CUSTOMARY', 'LEASEHOLD', 'FAMILY_TRUST')
  ),
  claimant_name VARCHAR(120) NOT NULL,
  claimant_national_id VARCHAR(60) NOT NULL,
  coordinates_geojson JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED' CHECK (
    status IN (
      'SUBMITTED',
      'SURVEYOR_REVIEW',
      'AWAITING_GIS_REVIEW',
      'CORRECTION_REQUIRED',
      'GIS_REJECTED',
      'GIS_VALIDATED',
      'VERIFICATION_REJECTED',
      'VERIFIED',
      'AWAITING_LEGAL_REVIEW',
      'APPROVED',
      'REJECTED',
      'TITLE_ISSUED',
      'REVOKED'
    )
  ),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_land_applications_applicant_id ON land_applications (applicant_id);
CREATE INDEX IF NOT EXISTS idx_land_applications_status ON land_applications (status);

-- Phase 5 application workflow status history
CREATE TABLE IF NOT EXISTS application_status_history (
  id BIGSERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_status_history_app_created
  ON application_status_history(application_id, created_at, id);

INSERT INTO application_status_history (
  application_id, from_status, to_status, changed_by, actor_role, reason, created_at
)
SELECT
  application.id,
  NULL,
  application.status,
  NULL,
  'SYSTEM',
  'Existing application status preserved when Phase 5 history was enabled',
  COALESCE(application.submitted_at, NOW())
FROM land_applications application
WHERE NOT EXISTS (
  SELECT 1
  FROM application_status_history history
  WHERE history.application_id = application.id
);

CREATE OR REPLACE FUNCTION anagu_record_application_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id INTEGER;
  v_actor_role TEXT;
  v_reason TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_actor_id := NULLIF(current_setting('anagu.actor_id', TRUE), '')::INTEGER;
  v_actor_role := NULLIF(current_setting('anagu.actor_role', TRUE), '');
  v_reason := NULLIF(current_setting('anagu.status_reason', TRUE), '');

  INSERT INTO application_status_history (
    application_id, from_status, to_status, changed_by, actor_role, reason
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    COALESCE(v_actor_id, CASE WHEN TG_OP = 'INSERT' THEN NEW.applicant_id END),
    COALESCE(v_actor_role, CASE WHEN TG_OP = 'INSERT' THEN 'CITIZEN' ELSE 'SYSTEM' END),
    COALESCE(
      v_reason,
      NULLIF(NEW.rejection_reason, ''),
      CASE
        WHEN TG_OP = 'INSERT' THEN 'Application submitted'
        ELSE 'Application status updated'
      END
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anagu_application_status_history ON land_applications;
CREATE TRIGGER trg_anagu_application_status_history
  AFTER INSERT OR UPDATE OF status ON land_applications
  FOR EACH ROW
  EXECUTE FUNCTION anagu_record_application_status_history();

CREATE OR REPLACE FUNCTION anagu_transition_land_application_status(
  p_application_id INTEGER,
  p_expected_status TEXT,
  p_next_status TEXT,
  p_actor_id INTEGER,
  p_actor_role TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_application land_applications%ROWTYPE;
BEGIN
  PERFORM set_config('anagu.actor_id', p_actor_id::TEXT, TRUE);
  PERFORM set_config('anagu.actor_role', p_actor_role, TRUE);
  PERFORM set_config('anagu.status_reason', p_reason, TRUE);

  UPDATE land_applications
  SET status = p_next_status,
      rejection_reason = CASE
        WHEN p_next_status IN (
          'CORRECTION_REQUIRED', 'GIS_REJECTED', 'VERIFICATION_REJECTED', 'REJECTED'
        ) THEN p_reason
        ELSE NULL
      END,
      updated_at = NOW()
  WHERE id = p_application_id
    AND status = p_expected_status
  RETURNING * INTO v_application;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application status changed before review could be saved.'
      USING ERRCODE = 'P2001';
  END IF;

  RETURN TO_JSONB(v_application);
END;
$$;

REVOKE ALL ON FUNCTION anagu_transition_land_application_status(
  INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION anagu_transition_land_application_status(
  INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT
) TO service_role;

-- 5. Land Parcels (PostGIS Geometry + GeoJSON Sync + Spatial Index)
CREATE TABLE IF NOT EXISTS land_parcels (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL UNIQUE REFERENCES land_applications(id) ON DELETE CASCADE,
  parcel_code VARCHAR(40) NOT NULL UNIQUE,
  boundary GEOMETRY(Polygon, 4326),
  boundary_geojson JSONB,
  area_sqm NUMERIC(14, 2) NOT NULL CHECK (area_sqm > 0),
  centroid_lat DOUBLE PRECISION NOT NULL,
  centroid_lng DOUBLE PRECISION NOT NULL,
  is_geometry_valid BOOLEAN NOT NULL DEFAULT FALSE,
  overlap_checked BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'VALIDATED', 'ACTIVE', 'REVOKED')
  ),
  validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_land_parcels_boundary_gist
  ON land_parcels USING GIST (boundary);

CREATE OR REPLACE FUNCTION anagu_sync_land_parcel_geometry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.boundary_geojson IS NOT NULL AND (
    NEW.boundary IS NULL OR TG_OP = 'INSERT' OR NEW.boundary_geojson IS DISTINCT FROM OLD.boundary_geojson
  ) THEN
    NEW.boundary := ST_SetSRID(ST_GeomFromGeoJSON(NEW.boundary_geojson::text), 4326);
  ELSIF NEW.boundary IS NOT NULL AND NEW.boundary_geojson IS NULL THEN
    NEW.boundary_geojson := ST_AsGeoJSON(NEW.boundary)::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_land_parcel_geometry ON land_parcels;
CREATE TRIGGER trg_sync_land_parcel_geometry
  BEFORE INSERT OR UPDATE ON land_parcels
  FOR EACH ROW
  EXECUTE FUNCTION anagu_sync_land_parcel_geometry();

-- 6. Sample Institutional & Community Ownership Records (Oracle Reference Data)
CREATE TABLE IF NOT EXISTS ownership_records (
  id SERIAL PRIMARY KEY,
  record_source VARCHAR(80) NOT NULL,
  source_reference VARCHAR(60) NOT NULL UNIQUE,
  parcel_code VARCHAR(40),
  registered_owner_name VARCHAR(120) NOT NULL,
  owner_national_id VARCHAR(60) NOT NULL,
  boundary_geojson JSONB,
  claim_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE_RECORD' CHECK (
    claim_status IN ('ACTIVE_RECORD', 'DISPUTED', 'HISTORICAL')
  ),
  notes TEXT,
  is_sample_record BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Community Verification Decisions
CREATE TABLE IF NOT EXISTS verification_records (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
  officer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  matched_record_id INTEGER REFERENCES ownership_records(id) ON DELETE SET NULL,
  oracle_match_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  conflict_detected BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_details JSONB,
  decision VARCHAR(30) NOT NULL CHECK (
    decision IN ('APPROVED', 'REJECTED', 'FLAGGED_CONFLICT')
  ),
  remarks TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_records_app_id ON verification_records (application_id);

-- 8. Supporting Documents (SHA-256 Tamper Detection)
CREATE TABLE IF NOT EXISTS supporting_documents (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_type VARCHAR(60) NOT NULL CHECK (
    document_type IN ('DEED_OF_CONVEYANCE', 'SURVEY_PLAN', 'COMMUNITY_LETTER', 'TAX_RECEIPT', 'ID_DOCUMENT')
  ),
  file_name VARCHAR(200) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  sha256_hash CHAR(64) NOT NULL,
  storage_path TEXT NOT NULL,
  storage_bucket TEXT,
  is_tampered_flag BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supporting_documents_app_id ON supporting_documents (application_id);

-- 9. Digital Land Titles (Preserved Permanently Even After Statutory Revocation)
CREATE TABLE IF NOT EXISTS land_titles (
  id SERIAL PRIMARY KEY,
  title_number VARCHAR(50) NOT NULL UNIQUE,
  application_id INTEGER NOT NULL UNIQUE REFERENCES land_applications(id) ON DELETE RESTRICT,
  parcel_id INTEGER NOT NULL UNIQUE REFERENCES land_parcels(id) ON DELETE RESTRICT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_id VARCHAR(78) NOT NULL UNIQUE,
  contract_address VARCHAR(42) NOT NULL,
  metadata_uri TEXT NOT NULL,
  title_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (
    title_status IN ('ACTIVE', 'REVOKED')
  ),
  issued_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_land_titles_owner_id ON land_titles (owner_id);

-- 10. Blockchain Transaction Ledger
CREATE TABLE IF NOT EXISTS blockchain_transactions (
  id SERIAL PRIMARY KEY,
  title_id INTEGER REFERENCES land_titles(id) ON DELETE SET NULL,
  application_id INTEGER REFERENCES land_applications(id) ON DELETE SET NULL,
  tx_type VARCHAR(30) NOT NULL CHECK (
    tx_type IN (
      'MINT_TITLE',
      'REVOKE_TITLE',
      'TRANSFER_BLOCKED',
      'LIST_PARCEL',
      'BUY_ESCROW',
      'SETTLE_SALE',
      'CANCEL_LISTING',
      'WITHDRAW_ESCROW'
    )
  ),
  tx_hash VARCHAR(66) NOT NULL UNIQUE,
  block_number INTEGER,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42),
  gas_used VARCHAR(40),
  latency_ms INTEGER,
  status VARCHAR(20) NOT NULL CHECK (
    status IN ('CONFIRMED', 'REVERTED', 'FAILED')
  ),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Statutory Revocation Records
CREATE TABLE IF NOT EXISTS revocation_records (
  id SERIAL PRIMARY KEY,
  title_id INTEGER NOT NULL UNIQUE REFERENCES land_titles(id) ON DELETE RESTRICT,
  governor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ground VARCHAR(40) NOT NULL CHECK (
    ground IN ('OverridingPublicInterest', 'BreachOfStatutoryCondition')
  ),
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) >= 10),
  tx_hash VARCHAR(66) NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Regulated Polygon Land Marketplace Listings
CREATE TABLE IF NOT EXISTS land_listings (
  id SERIAL PRIMARY KEY,
  title_id INTEGER REFERENCES land_titles(id) ON DELETE RESTRICT,
  application_id INTEGER REFERENCES land_applications(id) ON DELETE RESTRICT,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_wallet VARCHAR(42) NOT NULL,
  buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  buyer_wallet VARCHAR(42),
  price_wei VARCHAR(78) NOT NULL,
  price_pol NUMERIC(18, 6) NOT NULL CHECK (price_pol > 0),
  price_usd NUMERIC(18, 2),
  headline VARCHAR(160),
  description TEXT,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'VERIFIED',
  listing_status VARCHAR(24) NOT NULL DEFAULT 'LISTED' CHECK (
    listing_status IN ('LISTED', 'ESCROW_FUNDED', 'COMPLETED', 'CANCELLED', 'BLOCKED_REVOKED')
  ),
  escrow_tx_hash VARCHAR(66),
  settlement_tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_land_listings_status ON land_listings (listing_status);
CREATE INDEX IF NOT EXISTS idx_land_listings_app_id ON land_listings (application_id);

-- 13. Ethereum Sepolia Registration Fee Payments
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES land_applications(id) ON DELETE RESTRICT,
  registration_reference VARCHAR(40) NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_address VARCHAR(42),
  transaction_hash VARCHAR(66) UNIQUE,
  network VARCHAR(40) NOT NULL DEFAULT 'sepolia',
  chain_id INTEGER NOT NULL DEFAULT 11155111,
  amount_eth NUMERIC(24, 18) NOT NULL CHECK (amount_eth > 0),
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei > 0),
  amount_ngn NUMERIC(14, 2) NOT NULL CHECK (amount_ngn > 0),
  exchange_rate NUMERIC(18, 4) NOT NULL CHECK (exchange_rate > 0),
  rate_source VARCHAR(80) NOT NULL DEFAULT 'CONFIGURABLE_TEST_RATE',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
    payment_status IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED')
  ),
  contract_address VARCHAR(42) NOT NULL,
  quote_id VARCHAR(66),
  quote_signature TEXT,
  quote_expires_at TIMESTAMPTZ,
  block_number INTEGER,
  confirmations INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_registration_id ON payments (registration_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_reg_reference ON payments (registration_reference);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_paid_registration
  ON payments (registration_id)
  WHERE payment_status = 'PAID';

-- 14. Idempotent Payment Event Logs
CREATE TABLE IF NOT EXISTS payment_event_logs (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  registration_reference VARCHAR(40) NOT NULL,
  payer_address VARCHAR(42) NOT NULL,
  amount_wei NUMERIC(78, 0) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, log_index)
);

-- 15. Admin Payment Fee Settings
CREATE TABLE IF NOT EXISTS payment_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  test_fee_ngn NUMERIC(14, 2) NOT NULL DEFAULT 1000,
  eth_ngn_exchange_rate NUMERIC(18, 4) NOT NULL DEFAULT 2500000,
  rate_source VARCHAR(80) NOT NULL DEFAULT 'CONFIGURABLE_TEST_RATE',
  quote_ttl_seconds INTEGER NOT NULL DEFAULT 900,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. MQTT & In-App Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_role VARCHAR(40),
  topic VARCHAR(120) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  payload JSONB NOT NULL,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED' CHECK (
    delivery_status IN ('PUBLISHED', 'QUEUED', 'FAILED', 'ACKNOWLEDGED')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);

-- 17. Immutable Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(40),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(60) NOT NULL,
  details JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

-- =============================================================================
-- PostGIS Spatial Validation & Coordinate Lookup RPC Functions
-- =============================================================================

CREATE OR REPLACE FUNCTION anagu_validate_parcel_polygon(
  p_geojson_text TEXT,
  p_exclude_application_id INTEGER DEFAULT NULL,
  p_overlap_tolerance_sqm DOUBLE PRECISION DEFAULT 1.0
)
RETURNS TABLE (
  is_valid BOOLEAN,
  validity_reason TEXT,
  has_overlap BOOLEAN,
  overlapping_parcel_codes TEXT[],
  computed_area_sqm DOUBLE PRECISION,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_geom GEOMETRY(Polygon, 4326);
  v_valid BOOLEAN;
  v_reason TEXT;
  v_overlaps TEXT[];
BEGIN
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geojson_text), 4326);
  v_valid := ST_IsValid(v_geom);
  v_reason := CASE WHEN v_valid THEN 'Valid Geometry' ELSE ST_IsValidReason(v_geom) END;

  IF NOT v_valid THEN
    RETURN QUERY SELECT
      FALSE,
      v_reason,
      FALSE,
      ARRAY[]::TEXT[],
      0.0::DOUBLE PRECISION,
      0.0::DOUBLE PRECISION,
      0.0::DOUBLE PRECISION;
    RETURN;
  END IF;

  SELECT COALESCE(ARRAY_AGG(lp.parcel_code), ARRAY[]::TEXT[])
  INTO v_overlaps
  FROM land_parcels lp
  WHERE lp.status IN ('VALIDATED', 'ACTIVE')
    AND (p_exclude_application_id IS NULL OR lp.application_id <> p_exclude_application_id)
    AND lp.boundary IS NOT NULL
    AND ST_Intersects(lp.boundary, v_geom)
    AND ST_Area(ST_Intersection(lp.boundary::geography, v_geom::geography)) > p_overlap_tolerance_sqm;

  RETURN QUERY SELECT
    TRUE,
    v_reason,
    COALESCE(ARRAY_LENGTH(v_overlaps, 1), 0) > 0,
    v_overlaps,
    ST_Area(v_geom::geography),
    ST_Y(ST_Centroid(v_geom)),
    ST_X(ST_Centroid(v_geom));
END;
$$;

CREATE OR REPLACE FUNCTION anagu_find_parcel_at_coordinates(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS TABLE (
  matched BOOLEAN,
  match_type TEXT,
  parcel_code TEXT,
  reference_code TEXT,
  parcel_name TEXT,
  status TEXT,
  area_sqm DOUBLE PRECISION,
  region TEXT,
  application_id INTEGER,
  source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pt GEOMETRY(Point, 4326);
BEGIN
  v_pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  RETURN QUERY
  SELECT
    TRUE,
    'REGISTERED_PARCEL'::TEXT,
    lp.parcel_code::TEXT,
    la.reference_code::TEXT,
    la.parcel_name::TEXT,
    lp.status::TEXT,
    lp.area_sqm::DOUBLE PRECISION,
    la.region::TEXT,
    lp.application_id,
    'REGISTERED_PARCEL'::TEXT
  FROM land_parcels lp
  JOIN land_applications la ON la.id = lp.application_id
  WHERE COALESCE(
    lp.boundary,
    CASE WHEN lp.boundary_geojson IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON(lp.boundary_geojson::text), 4326) END
  ) IS NOT NULL
    AND ST_Covers(
      COALESCE(
        lp.boundary,
        ST_SetSRID(ST_GeomFromGeoJSON(lp.boundary_geojson::text), 4326)
      ),
      v_pt
    )
  ORDER BY CASE lp.status WHEN 'ACTIVE' THEN 0 WHEN 'VALIDATED' THEN 1 ELSE 2 END, lp.id DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    TRUE,
    'PENDING_APPLICATION'::TEXT,
    NULL::TEXT,
    la.reference_code::TEXT,
    la.parcel_name::TEXT,
    la.status::TEXT,
    la.declared_area_sqm::DOUBLE PRECISION,
    la.region::TEXT,
    la.id,
    'PENDING_APPLICATION'::TEXT
  FROM land_applications la
  WHERE la.status IN ('SUBMITTED', 'GIS_REJECTED')
    AND ST_Covers(
      ST_SetSRID(ST_GeomFromGeoJSON(la.coordinates_geojson::text), 4326),
      v_pt
    )
  ORDER BY la.submitted_at DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    TRUE,
    'INSTITUTIONAL_RECORD'::TEXT,
    orr.parcel_code::TEXT,
    orr.source_reference::TEXT,
    COALESCE(orr.notes, orr.source_reference)::TEXT,
    orr.claim_status::TEXT,
    ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(orr.boundary_geojson::text), 4326)::geography)::DOUBLE PRECISION,
    NULL::TEXT,
    NULL::INTEGER,
    orr.record_source::TEXT
  FROM ownership_records orr
  WHERE orr.boundary_geojson IS NOT NULL
    AND ST_Covers(
      ST_SetSRID(ST_GeomFromGeoJSON(orr.boundary_geojson::text), 4326),
      v_pt
    )
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT
    FALSE,
    'UNCLAIMED'::TEXT,
    NULL::TEXT,
    NULL::TEXT,
    NULL::TEXT,
    'UNCLAIMED'::TEXT,
    NULL::DOUBLE PRECISION,
    NULL::TEXT,
    NULL::INTEGER,
    NULL::TEXT;
END;
$$;

-- =============================================================================
-- Baseline Seed Data (RBAC Roles, Sample Ownership Records, Payment Settings)
-- =============================================================================

INSERT INTO roles (code, name, description)
VALUES
  (
    'CITIZEN',
    'Citizen / Landowner',
    'Submits land registration applications, coordinates, and supporting documents, verifies listings, and buys or sells verified land.'
  ),
  (
    'LAND_ADMIN',
    'Administrator',
    'Single designated administrator authorized to validate GIS boundaries, verify claims, issue and revoke titles, manage user access, and configure platform settings.'
  ),
  (
    'SURVEYOR',
    'Surveyor',
    'Reviews survey documents and assigned parcel boundaries.'
  ),
  (
    'COMMUNITY_OFFICER',
    'Community Verification Officer',
    'Verifies ownership claims against institutional and community records.'
  ),
  (
    'REGISTRAR',
    'Registrar',
    'Completes legal review and authorizes eligible title issuance.'
  ),
  (
    'GOVERNOR',
    'Governor',
    'Executes legally authorized statutory title revocation.'
  )
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO ownership_records (
  record_source,
  source_reference,
  parcel_code,
  registered_owner_name,
  owner_national_id,
  boundary_geojson,
  claim_status,
  notes,
  is_sample_record
)
VALUES
  (
    'SAMPLE_MUNICIPAL_ARCHIVE',
    'INST-2024-001',
    'ANG-PARCEL-1001',
    'Amara Okafor',
    'NID-1001-AMA',
    '{"type":"Polygon","coordinates":[[[3.3750,6.5200],[3.3765,6.5200],[3.3765,6.5215],[3.3750,6.5215],[3.3750,6.5200]]]}'::jsonb,
    'ACTIVE_RECORD',
    'Sample baseline record matching Plot A in Zone 1.',
    TRUE
  ),
  (
    'SAMPLE_COMMUNITY_ELDERS_COUNCIL',
    'COMM-2024-002',
    'ANG-PARCEL-1002',
    'Chidi Nwosu',
    'NID-1002-CHI',
    '{"type":"Polygon","coordinates":[[[3.3780,6.5200],[3.3795,6.5200],[3.3795,6.5215],[3.3780,6.5215],[3.3780,6.5200]]]}'::jsonb,
    'ACTIVE_RECORD',
    'Sample community customary allocation verified by council minutes.',
    TRUE
  ),
  (
    'SAMPLE_CUSTOMARY_LEDGER',
    'INST-2024-003',
    'ANG-PARCEL-1003',
    'Fatima Bello',
    'NID-1003-FAT',
    '{"type":"Polygon","coordinates":[[[3.3810,6.5220],[3.3825,6.5220],[3.3825,6.5235],[3.3810,6.5235],[3.3810,6.5220]]]}'::jsonb,
    'DISPUTED',
    'Sample disputed parcel flagged for overlapping customary inheritance claim.',
    TRUE
  )
ON CONFLICT (source_reference) DO NOTHING;

INSERT INTO payment_settings (
  id,
  test_fee_ngn,
  eth_ngn_exchange_rate,
  rate_source,
  quote_ttl_seconds
)
VALUES (
  1,
  1000.00,
  2500000.0000,
  'CONFIGURABLE_TEST_RATE',
  900
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Row Level Security (RLS)
-- Backend Express routes use SUPABASE_SECRET_KEY (service role), which bypasses RLS.
-- Enabling RLS blocks unauthenticated direct client-side table mutations.
-- =============================================================================

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE land_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE land_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE supporting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE land_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE revocation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE land_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'land-application-documents',
  'land-application-documents',
  FALSE,
  5242880,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/json']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS anagu_private_documents_restrict_access ON storage.objects;
CREATE POLICY anagu_private_documents_restrict_access
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'land-application-documents')
  WITH CHECK (bucket_id <> 'land-application-documents');

REVOKE ALL ON application_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON application_status_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE application_status_history_id_seq TO service_role;
