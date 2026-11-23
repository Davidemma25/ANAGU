# ANAGU Ethereum Sepolia Registration Payment — Deployment & Operations Guide

## 1. Scope & Architecture Boundaries

- **Purpose**: Collects **land registration fees only** in native **ETH** on **Ethereum Sepolia Testnet** (`chainId: 11155111`).
- **Non-Bypassable Governance Guarantee**:
  - Payment **never** grants land ownership, approves a land application, or mints an ERC-721 NFT title.
  - Required pipeline sequence:
    `Land Application -> Registration Fee Calculation -> MetaMask Payment -> Backend Verification -> PAID -> GIS Validation -> Community Oracle Verification -> Government Approval -> NFT Title Issuance`
- **No ERC-20 / USDC**: `AnaguPayment.sol` accepts only native ETH via `payable` functions (`payWithQuote` and `payRegistrationFee`). Direct plain ETH transfers (`receive` / `fallback`) are rejected.

---

## 2. Environment Variables (`.env`)

Never commit `.env` or expose private keys to Vite (`VITE_*`) frontend code.

| Variable | Description |
|---|---|
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC endpoint (Alchemy, Infura, or PublicNode) |
| `SEPOLIA_CHAIN_ID` | `11155111` |
| `SEPOLIA_DEPLOYER_PRIVATE_KEY` | Funded Sepolia deployer wallet key (CLI deployment only) |
| `ETHERSCAN_API_KEY` | Etherscan API key for automated contract source verification |
| `ANAGU_PAYMENT_CONTRACT_ADDRESS` | Deployed `AnaguPayment.sol` contract address on Sepolia |
| `PAYMENT_QUOTE_SIGNER_PRIVATE_KEY` | Dedicated off-chain key used by backend to sign NGN→ETH expiring quotes |
| `REGISTRATION_FEE_TEST_NGN` | Configurable test registration fee in Nigerian Naira (default `15000`, labeled as test payment) |
| `ETH_NGN_EXCHANGE_RATE` | Configurable NGN per 1 ETH rate used for quote calculation |
| `ETH_NGN_RATE_SOURCE` | Rate source identifier (e.g. `CONFIGURABLE_TEST_RATE` or production feed name) |
| `PAYMENT_QUOTE_TTL_SECONDS` | Quote validity window in seconds (default `900`) |
| `PAYMENT_REQUIRED_CONFIRMATIONS` | Block confirmations required before marking `PAID` (default `1` on Sepolia; recommend `3–6` on Mainnet) |

---

## 3. PostgreSQL Migration Setup

Run migrations (`001` through `007_ethereum_payments.sql`) against PostgreSQL + PostGIS:

```bash
PG_ENABLED=true node database/migrate.js
```

Migration `007_ethereum_payments.sql` creates:
- `payments` (foreign-keyed to `land_applications(id)` and `users(id)`, `UNIQUE` constraint on `transaction_hash`, partial unique index preventing duplicate `PAID` rows per `registration_id`).
- `payment_event_logs` (`UNIQUE (tx_hash, log_index)` for idempotent event processing).

---

## 4. Deploy & Verify `AnaguPayment.sol` on Ethereum Sepolia

1. Compile and run contract security tests:
   ```bash
   npx hardhat compile --config contracts/hardhat.config.cjs
   npx hardhat test --config contracts/hardhat.config.cjs
   ```
2. Deploy to Sepolia (requires funded Sepolia ETH in `SEPOLIA_DEPLOYER_PRIVATE_KEY`):
   ```bash
   npx hardhat run contracts/scripts/deployPayment.cjs --network sepolia --config contracts/hardhat.config.cjs
   ```
3. Copy the output contract address into `ANAGU_PAYMENT_CONTRACT_ADDRESS` in `.env`.
4. If `ETHERSCAN_API_KEY` is set, the deploy script automatically verifies the contract on `sepolia.etherscan.io`.

---

## 5. Security & Production Transition Checklist

- **Exchange Rate Feed**: Replace static `ETH_NGN_EXCHANGE_RATE` with a live, signed/reduntant FX + Chainlink ETH/USD + NGN feed in `paymentService.ts`, keeping quote expiry short (5–15 minutes) and integer wei round-up rules enabled.
- **Role Separation**: Grant `FEE_ADMIN_ROLE`, `TREASURY_ROLE`, and `PAUSER_ROLE` to a hardware multi-sig (e.g., Safe) rather than a hot EOA on Mainnet.
- **Treasury Withdrawals**: Only `TREASURY_ROLE` can invoke `AnaguPayment.withdraw(recipient, amountWei)`, protected by `ReentrancyGuard`.
- **Emergency Pause**: `PAUSER_ROLE` can call `pause()` / `unpause()` to halt fee collection immediately if an anomaly is detected.
- **Independent Verification**: Never mark a payment `PAID` from client payloads; always verify chain ID, target contract address, `receipt.status === 1`, decoded `PaymentReceived` event log, amount, payer, and confirmations via server-side Ethereum RPC.
