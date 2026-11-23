# ANAGU Database Design (PostgreSQL + PostGIS)

> Legacy role and workflow tables remain for historical records. The current public runtime does not expose staff permissions, application reviews, GIS validation decisions, or revocation actions; public accounts use one basic account experience.

## 1. Core Tables and Workflow History

1. **`roles`** — Legacy role catalog retained for existing records; it does not define public account access.
2. **`users`** — ANAGU profiles linked via `role_id` to `roles` and, in Supabase mode, `auth_user_id` to `auth.users`; Supabase Auth owns passwords, while the local prototype adapter retains bcrypt hashes. Optional blockchain `wallet_address` is stored here.
3. **`land_applications`** — User registration submissions (`reference_code`, parcel metadata, `coordinates_geojson`, recorded `status`).
4. **`land_parcels`** — Validated spatial parcels storing `boundary GEOMETRY(Polygon, 4326)` with a **GIST spatial index**.
5. **`ownership_records`** — Clearly marked **sample** institutional & community archive records used by the Community Verification Oracle.
6. **`verification_records`** — Community Verification Officer decisions, match scores, and conflicting-claim flags.
7. **`supporting_documents`** — Uploaded deed/survey/ID metadata, SHA-256 hashes, and an optional private Supabase Storage bucket name. Migration `016_private_supporting_document_storage.sql` provisions the private bucket and blocks direct `anon`/`authenticated` access to its objects.
8. **`land_titles`** — Issued ERC-721 digital land titles (`title_number`, `token_id`, `contract_address`, `title_status`).
9. **`blockchain_transactions`** — Ledger of `MINT_TITLE`, `REVOKE_TITLE`, and `TRANSFER_BLOCKED` transactions with latency metrics.
10. **`revocation_records`** — Governor statutory revocations (`OverridingPublicInterest` or `BreachOfStatutoryCondition`) with mandatory reason and transaction hash. Original `land_titles` rows are **never deleted**.
11. **`notifications`** — Persisted MQTT notification events, delivery status (`PUBLISHED`, `QUEUED`, `FAILED`, `ACKNOWLEDGED`), and retry counts.
12. **`audit_logs`** — Append-only chronological trail of all sensitive user and system actions.
13. **`application_status_history`** — Append-only status transitions with actor, role, reason, and timestamp; migration `014_land_application_review_workflow.sql` backfills the current status for existing applications.

The stored status values and migration history describe a legacy review workflow. Those staff transitions are not available in the public runtime. Existing history is retained; new submissions must not be presented as approved or title-eligible. Local-store mode records the history; PostgreSQL/Supabase requires migration 014 for the legacy history schema.

## 2. PostGIS Spatial Operations

- **Coordinate Reference System:** `SRID 4326` (WGS84 latitude/longitude), matching Leaflet GeoJSON coordinates `[lng, lat]`.
- **`ST_IsValid(geom)`:** Rejects malformed, unclosed, or self-intersecting ("bowtie") polygons before storage.
- **`ST_Intersects(a.boundary, b.boundary)`:** Uses the GIST spatial index to detect parcels that touch or overlap existing `VALIDATED` or `ACTIVE` parcels.
- **Documented Tolerance (`1.0 m²`):** `ST_Area(ST_Intersection(a.boundary::geography, b.boundary::geography)) > 1.0` allows adjacent parcels to share a common boundary edge without false positives while rejecting genuine spatial encroachments.
- **Measurements:** The Phase 4 validation function calculates authoritative area and perimeter with PostGIS `geography`; `land_parcels.perimeter_m` stores the perimeter in meters.

## 3. Geographic Reference and Boundary History

- Migrations `012_nigeria_geographic_reference.sql` and `013_gis_measurements_and_boundary_history.sql` extend the state/LGA/community hierarchy with source attribution, coordinates, and `place_type`.
- OCHA/HDX Nigeria COD-AB v01 contributes 37 state/FCT and 774 LGA records. Its 714 admin-level-3 records are wards with partial national coverage, not a complete community dataset. Source and license details are retained in `geographic_reference_sources` and the seed JSON.
- `parcel_boundary_versions` stores submitted geometry snapshots, source, SHA-256 geometry hash, change reason, actor, and timestamp. A submitted boundary can initially have a null `parcel_id`; GIS validation links the saved version to the created parcel.
- Apply migrations `012`–`016` after `001`–`011` before using the location hierarchy, boundary editing, PostGIS Phase 4 RPC, boundary history, review history, or private document storage on PostgreSQL/Supabase.
