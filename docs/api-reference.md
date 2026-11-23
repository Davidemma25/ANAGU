# ANAGU REST API Reference

Protected endpoints require `Authorization: Bearer <token>` from `POST /api/auth/login` or the registration flow. Supabase tokens are resolved to an ANAGU profile. Public accounts use the same basic account view, and user-owned records are scoped to that profile.

## Health and authentication

- `GET /api/health` — Service and database status.
- `POST /api/auth/register` — Create a public account.
- `POST /api/auth/login` — Sign in and return an access token and profile.
- `POST /api/auth/logout` — Sign out the current session.
- `POST /api/auth/refresh` — Refresh a Supabase session.
- `POST /api/auth/password-reset/request` — Request password recovery.
- `POST /api/auth/password-reset/confirm` — Complete password recovery.
- `GET /api/auth/roles` — Lists the single public account role.
- `GET /api/auth/me` — Get the current profile.
- `PATCH /api/auth/profile` — Update profile information.

## Dashboard and applications

- `GET /api/dashboard/summary` — Personal application, title, and marketplace summary.
- `GET /api/applications` — List the signed-in user's applications.
- `POST /api/applications` — Submit a land application.
- `GET /api/applications/:id` — Get an owned application, documents, and recorded status history.
- `POST /api/applications/:id/documents` — Upload a supporting document.

Applications can be submitted and tracked, but submission is not approval, verified ownership, or a title.

## GIS and locations

- `GET /api/gis/lookup` — Look up a parcel by coordinates.
- `GET /api/gis/parcels` — Get map parcel data for the signed-in account.
- `GET /api/gis/applications/:applicationId/boundary-history` — Get boundary history for an owned application.
- `POST /api/gis/applications/:applicationId/boundary` — Save a boundary update for an owned application.
- `GET /api/gis/locations/states` — List state/FCT records.
- `GET /api/gis/locations/lgas/:stateId` — List LGAs for a state.
- `GET /api/gis/locations/communities/:lgaId` — List available community/ward records.

## Titles and marketplace

- `GET /api/titles` — List titles available to the signed-in account.
- `GET /api/titles/contract` — Get public contract metadata.
- `POST /api/titles/:id/test-transfer-block` — Check the contract's transfer-block behavior.
- `GET /api/marketplace/listings` — Browse listings.
- `POST /api/marketplace/listings/:listingId/verify` — Check a listing before purchase.
- `POST /api/marketplace/listings/:listingId/buy` — Initiate a wallet-based purchase.
- `POST /api/marketplace/register-land` — Submit a land listing and supporting document.
- `GET /api/marketplace/eligibility` — Check the signed-in account's listing eligibility.
- `POST /api/marketplace/listings` — Create a listing.
- `POST /api/marketplace/listings/:listingId/activate` — Activate a listing on-chain.
- `POST /api/marketplace/listings/:listingId/cancel` — Cancel a listing.

## Payments and notifications

- `GET /api/payments/config` — Get public payment configuration.
- `GET /api/payments/history` — List the signed-in account's payments.
- `GET /api/payments/applications/:applicationId` — Get payment details for an owned application.
- `GET /api/payments/status/:paymentId` — Get payment status.
- `POST /api/payments/quotes` — Create a payment quote.
- `POST /api/payments/submit-tx` — Submit a transaction hash.
- `POST /api/payments/direct-checkout` — Initiate direct wallet checkout.
- `POST /api/payments/verify` — Verify a payment.
- `GET /api/notifications` — List the signed-in account's notifications.
- `GET /api/notifications/status` — Get notification broker and queue status.
- `PATCH /api/notifications/read-all` — Mark all account notifications as read.
- `PATCH /api/notifications/:id/read` — Mark one account notification as read.
- `POST /api/notifications/retry-queue` — Retry queued notification delivery.

## Not exposed in the public runtime

Admin Console APIs, staff role management, application review actions, GIS validation actions, verification decisions, title issuance, statutory revocation, and evaluation endpoints are not mounted. Requests to those retired routes return `404`. Legacy source and database role records remain dormant; they do not grant public API access.
