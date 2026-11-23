-- ANAGU Phase 2 Migration 002: Core Relational & Spatial Tables (12 Tables Total)
-- Academic Prototype — PostgreSQL + PostGIS (SRID 4326 / WGS84)

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  national_id VARCHAR(60) NOT NULL UNIQUE,
  phone VARCHAR(40),
  wallet_address VARCHAR(42),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Land Applications
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
      'GIS_REJECTED',
      'GIS_VALIDATED',
      'VERIFICATION_REJECTED',
      'VERIFIED',
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

-- 4. Land Parcels (PostGIS Geometry Column + Spatial Index)
CREATE TABLE IF NOT EXISTS land_parcels (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL UNIQUE REFERENCES land_applications(id) ON DELETE CASCADE,
  parcel_code VARCHAR(40) NOT NULL UNIQUE,
  boundary GEOMETRY(Polygon, 4326) NOT NULL,
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

-- 5. Sample Institutional & Community Ownership Records (Oracle Reference Data)
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

-- 6. Community Verification Decisions
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

-- 7. Supporting Documents
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
  is_tampered_flag BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Digital Land Titles (Preserved Permanently Even After Statutory Revocation)
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

-- 9. Blockchain Transaction Ledger
CREATE TABLE IF NOT EXISTS blockchain_transactions (
  id SERIAL PRIMARY KEY,
  title_id INTEGER REFERENCES land_titles(id) ON DELETE SET NULL,
  application_id INTEGER REFERENCES land_applications(id) ON DELETE SET NULL,
  tx_type VARCHAR(30) NOT NULL CHECK (
    tx_type IN ('MINT_TITLE', 'REVOKE_TITLE', 'TRANSFER_BLOCKED')
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

-- 10. Governor Statutory Revocation Records (Appended, Never Overwriting Original Title)
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

-- 11. MQTT & In-App Notifications
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

-- 12. Immutable Audit Logs
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
