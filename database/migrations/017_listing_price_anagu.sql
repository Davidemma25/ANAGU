-- Migration 017: Add price_anagu column to land_listings
-- price_anagu stores the listing price denominated in ANAGU tokens (18-decimal ERC-20)
-- It is derived from price_usd using the USD_PER_ANAGU exchange rate configured at listing time.
-- When ANAGU_ESCROW_ADDRESS is set, fundEscrow() on AnaguEscrow.sol requires this exact amount.

ALTER TABLE land_listings
  ADD COLUMN IF NOT EXISTS price_anagu NUMERIC(28, 8);

-- Back-fill existing rows: use the same 1 ANAGU = $1 default rate if no rate was stored
-- (matches the DEFAULT_USD_PER_ANAGU = 1 default in marketplaceService.js)
UPDATE land_listings
SET price_anagu = price_usd
WHERE price_anagu IS NULL AND price_usd IS NOT NULL;

UPDATE land_listings
SET price_anagu = price_pol * 1000
WHERE price_anagu IS NULL AND price_pol IS NOT NULL;

COMMENT ON COLUMN land_listings.price_anagu IS
  'Listing price in ANAGU tokens (ERC-20, 18 decimals). Computed from price_usd / usdPerAnagu at listing time.';
