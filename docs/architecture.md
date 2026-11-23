# ANAGU System Architecture

## 1. Public Application

- **Single account experience:** The public React + Vite application has one registration and login flow and one personal dashboard. Legacy role values are normalized to the basic account experience at the API boundary.
- **Personal data scope:** Application and dashboard queries use the authenticated user's ID. Public account holders cannot access staff-only actions.
- **Application tracking:** Users can submit parcel information, save boundaries, upload supporting documents, and view recorded status history. Submission does not itself approve a claim or issue a land title.
- **GIS and maps:** Leaflet supports parcel boundary entry and map exploration; the backend and PostGIS remain authoritative for stored spatial data.
- **Titles and marketplace:** Existing eligible titles and listings can be viewed through public account routes. Wallet-based transactions retain their on-chain checks.
- **Notifications:** Authenticated users can view and update their own notification records; MQTT is a delivery mechanism, not the permanent record.

## 2. Retired Public Staff Workflows

The public runtime does not mount the Admin Console API, application review actions, GIS validation actions, verification, title issuance, statutory revocation, or evaluation routes. The corresponding legacy source and role records remain dormant for existing data and are not exposed through the public server or Vercel API handler.

Application status history and existing role data are retained rather than destructively migrated. No ordinary account can turn a submission into an approved claim or mint/revoke a title through the public API.

## 3. Server and Data Boundaries

- Express verifies Supabase Auth or local prototype tokens and resolves the ANAGU profile before applying the basic public-account view.
- The database remains authoritative for users, applications, boundaries, titles, listings, payments, and notifications.
- Private credentials and privileged blockchain keys remain backend-only.
- Smart contracts continue to enforce registry authorization and escrow invariants independently of the public interface.

## 4. MQTT Topics

- `anagu/applications/submitted`
- `anagu/gis/validated`
- `anagu/verification/completed`
- `anagu/applications/decided`
- `anagu/titles/issued`
- `anagu/titles/revoked`
- `anagu/marketplace/updated`
