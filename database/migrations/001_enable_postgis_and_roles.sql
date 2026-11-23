-- ANAGU Phase 2 Migration 001: Enable PostGIS and Seed RBAC Roles
-- Academic Prototype — Not a legally authorised government land registry.

CREATE EXTENSION IF NOT EXISTS postgis;

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

INSERT INTO roles (code, name, description)
VALUES
  ('CITIZEN', 'Citizen / Landowner', 'Submits land registration applications, coordinates, and supporting documents, and tracks application and title status.'),
  ('SURVEYOR', 'Surveyor', 'Validates parcel boundary geometry using PostGIS ST_IsValid() and ST_Intersects() overlap detection.'),
  ('COMMUNITY_OFFICER', 'Community Verification Officer', 'Runs Community Ownership Verification Oracle checks against sample institutional and community records.'),
  ('REGISTRAR', 'Registrar', 'Reviews validated and verified land applications and authorises ERC-721 NFT land title issuance.'),
  ('LAND_ADMIN', 'Land Administrator', 'Manages user accounts, sample institutional reference records, system analytics, and audit logs.'),
  ('GOVERNOR', 'Governor', 'Executes statutory revocation of land titles on OverridingPublicInterest or BreachOfStatutoryCondition grounds.')
ON CONFLICT (code) DO NOTHING;
