-- ANAGU Migration 007: Ethereum Sepolia Registration Fee Payments
-- Covers ONLY land registration fee payments in native ETH (never auto-approves ownership or mints NFTs).

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

CREATE INDEX IF NOT EXISTS idx_payments_registration_id
  ON payments(registration_id);

CREATE INDEX IF NOT EXISTS idx_payments_user_id
  ON payments(user_id);

CREATE INDEX IF NOT EXISTS idx_payments_status
  ON payments(payment_status);

CREATE INDEX IF NOT EXISTS idx_payments_reg_reference
  ON payments(registration_reference);

-- Prevent duplicate confirmed PAID records for the same land registration application
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_paid_registration
  ON payments(registration_id)
  WHERE payment_status = 'PAID';

-- Track processed blockchain events idempotently so the same event log cannot be applied twice
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
