# ANAGU — Integrated Land Administration & Title Verification Prototype

> **Academic Prototype Disclaimer:** ANAGU is an academic software prototype built for research and educational evaluation. It is **not** a legally authorised government land registry, and all institutional/community reference records (`SAMPLE_MUNICIPAL_ARCHIVE`, `SAMPLE_COMMUNITY_ELDERS_COUNCIL`, `SAMPLE_CUSTOMARY_LEDGER`) are labeled sample datasets.

> **Current public app:** All accounts use the same basic account and personal dashboard. Staff roles and their review/admin APIs are not exposed. Applications can be submitted and tracked, but submission is not approval, verified ownership, or a land title. No account is automatically granted a title.

## System Overview

ANAGU provides a simplified public account experience in one React + Node.js + Solidity application:

1. **Accounts & dashboard:** Users register, sign in, manage a profile, and track their own land applications and account activity.
2. **Land applications & GIS:** Users submit parcel information, map boundaries, upload supporting documents, and view application status.
3. **Titles & marketplace:** Users can view eligible existing titles and listings and use the wallet-integrated marketplace. Public accounts cannot issue or revoke titles.
4. **Notifications:** Authenticated users can view their account notifications.

## Accounts & access

All users share the same public registration and login flow. Legacy role records and staff implementation files are retained for existing data, but the public app normalizes accounts to the basic user experience and does not mount staff review or Admin Console APIs. Personal dashboard and application data are scoped to the signed-in user.

## Supabase Auth email setup

1. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the backend-only `SUPABASE_SECRET_KEY`.
2. Set `SUPABASE_AUTH_REDIRECT_URL` to the app callback, such as `http://localhost:3000/auth/callback` during local development.
3. Keep email confirmation enabled under **Authentication → Sign In / Providers → Email**. Under **Authentication → URL Configuration**, set the local site URL and allow the callback URL above.
4. For an existing database, apply the required base schema and Supabase Auth profile migration. Legacy role rows are retained and are not required for choosing a public account type.
5. Test signup and password recovery through the app’s `/signup` and `/login` pages. Supabase’s built-in email service is for limited testing; configure a verified SMTP sender for dependable production delivery.

Never expose `SUPABASE_SECRET_KEY` or SMTP credentials to frontend code.

## Quick Commands

- **Install dependencies:** `npm install`
- **Start full-stack dev server (Express + Vite + Aedes MQTT + Hardhat EVM):** `npm run dev`
- **Compile & test Solidity smart contract:** `npx hardhat --config contracts/hardhat.config.cjs test`
- **Run public-account and route tests:** `npx tsx --test backend/src/auth.test.js backend/src/applicationReview.test.js backend/src/publicUser.test.js frontend/src/utils/roleRouting.test.ts`
- **Run 4 Fraud Scenarios & 5-Trial Benchmarks (writes `docs/benchmarks-and-fraud-report.md`):** `npm run evaluate`
- **Typecheck & Production Build:** `npm run lint && npm run build`

## Project Layout

- `frontend/` — public React app, static assets, Vite config, and the retained OSM prototype; old Admin Console source is dormant.
- `backend/` — Express API, server entry point, tests, and the Vercel API handler implementation; old Admin Console source is dormant.
- `api/` — thin Vercel function entry point that forwards to `backend/api/`.
- `contracts/`, `database/`, and `docs/` remain separate.

## Documentation Index

- `docs/architecture.md` — High-level architecture & subsystem boundaries
- `docs/database-schema.md` — PostgreSQL + PostGIS (SRID 4326) schema and local prototype store documentation
- `docs/api-reference.md` — Complete REST API & MQTT topic reference
- `docs/benchmarks-and-fraud-report.md` — Live measured fraud scenario and repeated-trial benchmark report

## Implementation Status (PRD Phases 1–10)

- **Phase 1:** Codebase audit and foundation *(Complete)*
- **Phase 2:** Supabase database preparation and migrations *(Core schema and migrations `001`–`013` applied; no destructive reset performed)*
- **Phase 3:** Authentication and user management *(Implemented; confirmation-email receipt still needs an inbox-level test)*
- **Phase 4:** GIS and nationwide locations *(Implemented and live-verified after migrations `012`–`013`; ward/community coverage remains partial)*
- **Phase 5:** Land applications *(Submission, document storage, and status tracking remain available; staff review routes are retired from the public runtime and submissions do not auto-approve)*
- **Phase 6:** Blockchain *(Existing ERC-721, Ethers.js, and wallet support retained; fixed-supply ANAGU ERC-20 implemented and locally tested. Amoy deployment is pending explicit approval.)*
- **Phase 7:** Marketplace and escrow *(ANAGU-token escrow contract and wallet/backend integration implemented; deployment and end-to-end testnet validation remain.)*
- **Phase 8:** MQTT and notifications *(Core broker, retry queue, and UI implemented; production outbox and recovery behavior still require verification.)*
- **Phase 9:** Public account experience *(Single account type, personal dashboard, and simplified navigation implemented; staff/Admin routes are not mounted)*
- **Phase 10:** Testing and production preparation *(In progress; live database, storage, deployment, and end-to-end checks remain.)*

**PRD Phase 4 (GIS and Nationwide Locations):** The application now includes cascading state/LGA/ward selectors, location-parent validation, map/manual boundary-source tracking, geodesic perimeter persistence, and authorized boundary-version history. Migrations `012_nigeria_geographic_reference.sql` and `013_gis_measurements_and_boundary_history.sql` have been applied and the location data and PostGIS RPC were live-verified. Ward/community coverage remains partial.

**PRD Phase 5 (Land Applications):** Users can submit applications, manage supporting documents, and track status. Staff review and GIS validation routes are not available in the public runtime. Existing workflow/status data is retained for history; submissions are not represented as legally approved or title-eligible.

**PRD Phase 6 (Blockchain):** `AnaguToken` implements the fixed 100,000,000 ANAGU supply, allocated at deployment to an explicit treasury address, with no future mint function. Its local contract tests pass. No Amoy deployment has been run.

**PRD Phase 7 (ANAGU Escrow):** `AnaguEscrow` provides ANAGU ERC-20 allowance-based funding, exact 98/2 integer commission settlement, seller-confirmed NFT transfer and settlement, pause/reentrancy controls, cancellation, Registrar refund, and expiry refund handling. The legacy native-POL settlement also requires the listing seller. The wallet and backend marketplace paths support ANAGU escrow when `ANAGU_ESCROW_ADDRESS` and `ANAGU_TOKEN_ADDRESS` are configured, while retaining native-POL fallback when escrow is absent. Seller settlement verifies the confirmed on-chain event and matches both listing wallets before updating the database. Local tests pass after validation; any contract changes require redeployment through Remix before live settlement is available.

The geographic reference data is OCHA/HDX Nigeria COD-AB v01 (CC BY-IGO 3.0; see the migration and [source dataset](https://data.humdata.org/dataset/cod-ab-nga)). It contains all 37 state/FCT and 774 LGA records, but its 714 admin-level-3 records are wards with partial national coverage—not a complete community or settlement dataset. Community/settlement coverage therefore remains incomplete and must not be presented as nationwide. The registration form no longer invents parcel geometry from a GPS point or sample polygon.
