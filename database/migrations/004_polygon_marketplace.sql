-- ANAGU Migration 004: Regulated Polygon Land Marketplace (Wallet-Based Buy & Sell)
-- Preserves non-bypassable registry controls:
--   * Ordinary direct ERC-721 transfers remain blocked.
--   * Active (non-revoked) titles may be listed for sale and purchased via escrow
--     on Polygon Amoy / Local Hardhat EVM with Registrar settlement verification.

ALTER TABLE blockchain_transactions
  DROP CONSTRAINT IF EXISTS blockchain_transactions_tx_type_check;

ALTER TABLE blockchain_transactions
  ADD CONSTRAINT blockchain_transactions_tx_type_check CHECK (
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
  );

CREATE TABLE IF NOT EXISTS land_listings (
  id SERIAL PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES land_titles(id) ON DELETE RESTRICT,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_wallet VARCHAR(42) NOT NULL,
  buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  buyer_wallet VARCHAR(42),
  price_wei VARCHAR(78) NOT NULL,
  price_pol NUMERIC(18, 6) NOT NULL CHECK (price_pol > 0),
  listing_status VARCHAR(24) NOT NULL DEFAULT 'LISTED' CHECK (
    listing_status IN ('LISTED', 'ESCROW_FUNDED', 'COMPLETED', 'CANCELLED', 'BLOCKED_REVOKED')
  ),
  escrow_tx_hash VARCHAR(66),
  settlement_tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
