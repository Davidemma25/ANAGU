# ANAGU Deployment Checklist

## 1. Environment Variables (set on hosting platform, NOT in code)

### Required — app will not work without these
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_ENABLED=true
SUPABASE_FORCE=true
SUPABASE_AUTH_REDIRECT_URL=https://yourdomain.com/auth/callback

JWT_SECRET=<64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
JWT_EXPIRES_IN=8h

ADMIN_EMAIL=your-real-email@domain.com
ADMIN_PASSWORD=<strong password>
ADMIN_FULL_NAME=ANAGU Administrator
ADMIN_PORT=3001
```

### Required — blockchain
```
ANAGU_CONTRACT_ADDRESS=0x5c0ff939dbfc9074ae315d7f168b2c5b45234ca6
ANAGU_TITLE_CONTRACT_ADDRESS=0x5c0ff939dbfc9074ae315d7f168b2c5b45234ca6
ANAGU_TOKEN_ADDRESS=0x9C150d3B9D4796297fC9acA53A33D1d115f9ddb4
ANAGU_TREASURY_ADDRESS=0x5C0Ff939DbFC9074AE315d7f168b2c5B45234Ca6
POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_CHAIN_ID=80002
ONCHAIN_STRICT_MODE=true
```

### Required after deploying AnaguEscrow
```
ANAGU_ESCROW_ADDRESS=0x<deployed-escrow-address>
```

### Optional but recommended
```
REGISTRAR_PRIVATE_KEY=0x<64 hex chars>  # needed to mint titles on-chain
GOVERNOR_PRIVATE_KEY=0x<64 hex chars>   # needed to revoke titles on-chain
USD_PER_ANAGU=1
USD_PER_POL=1000
POLYGON_AMOY_EXPLORER_URL=https://amoy.polygonscan.com
SEED_DEMO_DATA=false
REQUIRE_PAYMENT_BEFORE_GIS=false
```

---

## 2. Smart Contract Deployments (do in this order)

### Step 1 — Deploy AnaguEscrow to Polygon Amoy
```bash
npm run deploy:amoy:escrow
# Save the output address → ANAGU_ESCROW_ADDRESS
```

### Step 2 — Grant ESCROW_ROLE on AnaguLandTitle
Using the deployer wallet via Remix or a Hardhat script:
```solidity
AnaguLandTitle(titleAddress).grantRole(
  keccak256("ESCROW_ROLE"),
  escrowAddress
);
```

### Step 3 — Verify contracts on Polygonscan (optional but good practice)
```bash
npm run deploy:amoy:token   # if token not yet verified
npm run deploy:amoy:title   # if title not yet verified
```

---

## 3. Database

### Run migration 017 (adds price_anagu column)
```bash
node database/migrate.js
```
Or paste `database/migrations/017_listing_price_anagu.sql` into the Supabase SQL editor.

---

## 4. Supabase Auth Configuration

In Supabase Dashboard → Authentication:
- **Email provider**: enabled
- **Site URL**: `https://yourdomain.com`
- **Redirect URLs**: add `https://yourdomain.com/auth/callback`
- **SMTP**: configure a real SMTP sender for password reset emails

---

## 5. Build & Deploy

```bash
# Install dependencies
npm install --omit=dev

# Build frontend
npm run build
# → outputs to dist/

# Start public site
npm start
# → http://0.0.0.0:3000 (or $PORT)

# Start admin portal (separate process / separate port)
npm run start:admin
# → http://0.0.0.0:3001 (or $ADMIN_PORT)
```

---

## 6. Post-deployment checks

- [ ] `GET /api/health` returns `{"status":"ok","database":{"connected":true,"schemaReady":true}}`
- [ ] `GET /api/admin/auth/status` returns `{"adminConfigured":false}` (first time) or `{"adminConfigured":true}`
- [ ] Admin first-time setup: visit `https://youradmindomain.com` → fill setup form
- [ ] Public signup + login works
- [ ] Marketplace listings load
- [ ] Connect MetaMask on Polygon Amoy → ANAGU balance shows
- [ ] Submit a land registration with a deed document → appears in admin verification queue
- [ ] Admin approves deed → listing appears on Check Lands marketplace

---

## 7. Vercel deployment (alternative to self-hosted)

The `api/index.ts` file is the Vercel serverless entry point.
`vercel.json` routes `/api/*` to it and all other paths to `index.html`.

**Vercel env vars to set** (same list as Section 1 above, minus `ADMIN_PORT`).

Note: The admin portal cannot run as a Vercel serverless function alongside the public site because it needs a persistent process for MQTT. Host it separately (Railway, Render, Fly.io, VPS).

---

## 8. Known gaps (not blocking launch)

| Gap | Impact | Workaround |
|---|---|---|
| `START_SURVEY_REVIEW` route missing | Surveyor review step returns 404 in integration tests | Admin can bypass via "Quick Publish" in verification queue |
| ANAGU balance only shown after wallet connect | First-time users see 0 | Expected — requires wallet connection |
| Community coverage partial (714 of ~9000 LGA wards) | Location selector incomplete for some areas | Users can type free-text region name |
| MQTT in production needs external broker | Embedded Aedes broker doesn't survive restarts | Set `MQTT_BROKER_URL` to EMQX Cloud or similar |
