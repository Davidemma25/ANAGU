-- ANAGU Migration 005: Marketplace Listing Details (Headline & Description)
ALTER TABLE land_listings
  ADD COLUMN IF NOT EXISTS headline VARCHAR(160);

ALTER TABLE land_listings
  ADD COLUMN IF NOT EXISTS description TEXT;
