-- ANAGU Migration 006: Support Pre-Verification Marketplace Listings
ALTER TABLE land_listings
  ALTER COLUMN title_id DROP NOT NULL;

ALTER TABLE land_listings
  ADD COLUMN IF NOT EXISTS application_id INTEGER REFERENCES land_applications(id) ON DELETE RESTRICT;

ALTER TABLE land_listings
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) NOT NULL DEFAULT 'VERIFIED';
