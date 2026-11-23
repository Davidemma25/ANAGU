# ANAGU
## Product Requirements Document (PRD)
**Version:** 1.0  
**Project:** ANAGU — Nationwide Digital Land Administration, GIS & Marketplace Platform  
**Target Country:** Nigeria  
**Document Purpose:** Product specification and implementation guide for VS Code / Kiro AI  
**Status:** Development specification

## Current Implementation Direction

The current public product uses one basic account type and one personal dashboard. Governor,
surveyor, registrar, and administrator roles and their staff-facing review workflows are not
available in the public application. Applications are submitted records that users can track;
submission must not be presented as legal approval, verified ownership, or an issued title.
Title issuance and other privileged actions remain unavailable to ordinary accounts.

---

# 1. Product Overview

## 1.1 Product Description

ANAGU is a nationwide digital land administration, Geographic Information System (GIS), land registration and land marketplace platform designed for Nigeria.

The platform will provide a digital environment where citizens can submit land applications, define parcel boundaries, upload survey documents, track application progress, and access verified land records.

Authorized surveyors, GIS officers, registrars and administrators will review submitted information and manage the land approval process.

Once a land application has passed the required GIS and legal approval processes, an eligible digital land title can be represented on the Polygon blockchain using an ERC-721 NFT.

ANAGU will also provide a land marketplace where approved landowners can list eligible properties for sale. Buyers can purchase listed properties using the ANAGU ERC-20 token through a smart-contract escrow mechanism.

The platform will use MQTT for real-time notifications and dashboard updates while PostgreSQL/PostGIS remains the authoritative database for land records and geographic information.

## 1.2 Product Vision

To build a secure, transparent, accessible and scalable digital land administration ecosystem that improves how land information is submitted, verified, managed and exchanged across Nigeria.

## 1.3 Primary Objectives

1. Digitize land application and registration processes.
2. Support land parcel boundary creation using maps and GPS coordinates.
3. Provide nationwide GIS coverage across all 36 Nigerian states and the FCT.
4. Allow users to submit and track land applications.
5. Provide tools for GIS officers and registrars to review applications.
6. Maintain secure digital land records.
7. Represent approved digital land titles using blockchain technology.
8. Create a marketplace for legally approved land.
9. Enable ANAGU token payments for marketplace transactions.
10. Integrate MetaMask and Trust Wallet.
11. Provide real-time application, GIS and marketplace notifications.
12. Maintain audit trails for important administrative activities.

---

# 2. Scope of the Product

## 2.1 Main Modules

ANAGU must contain the following modules:

- User authentication and account management.
- User profile management.
- Land application and registration.
- Nationwide GIS and mapping.
- Parcel boundary management.
- Survey document management.
- GIS validation and review.
- Registrar and legal approval workflow.
- Digital land title management.
- Blockchain integration.
- ANAGU ERC-20 token.
- ERC-721 digital land title NFTs.
- Land marketplace.
- Smart-contract escrow.
- MetaMask and Trust Wallet integration.
- MQTT real-time messaging.
- Notifications.
- Administrative dashboard.
- Audit logs and reporting.
- Security and access control.

## 2.2 Geographic Coverage

ANAGU must support:

- All 36 states of Nigeria.
- Federal Capital Territory (FCT).
- Local Government Areas (LGAs).
- Communities and settlements.
- Individual land parcels.

Geographic information must be managed through the database rather than hardcoded into frontend components.

---

# 3. User Types and Permissions

ANAGU should provide one consistent registration experience.

Users should not need to register through completely separate registration pages for different account types.

Administrative roles should be assigned through a secure administrative process.

## 3.1 Citizen / General User

A registered user should be able to:

- Create an account.
- Log in and log out.
- Update their profile.
- Submit land applications.
- Enter land location information.
- Draw parcel boundaries.
- Enter GPS coordinates manually.
- Upload survey plans and supporting documents.
- View application status.
- View GIS validation results.
- Receive notifications.
- View approved land records.
- Connect a blockchain wallet.
- Browse eligible marketplace properties.
- Purchase eligible properties using ANAGU tokens.
- View transaction history.

## 3.2 Surveyor

Authorized surveyors should be able to:

- View assigned applications.
- Inspect submitted parcel boundaries.
- Review survey documents.
- Verify submitted coordinates.
- Submit corrections or recommendations.
- Provide survey-related comments.
- Submit their review for the next approval stage.

## 3.3 GIS Officer

GIS officers should be able to:

- View pending GIS applications.
- Inspect parcels on the map.
- View parcel coordinates.
- View calculated area and perimeter.
- Detect possible parcel overlaps.
- Compare nearby parcel boundaries.
- Review geographic validation results.
- Request boundary corrections.
- Approve GIS validation.
- Reject invalid submissions with reasons.
- Flag suspicious or conflicting records.

## 3.4 Registrar / Legal Officer

Authorized registrars should be able to:

- View applications that have passed the required GIS review.
- Inspect supporting documentation.
- Review ownership and legal verification records.
- Approve or reject applications.
- Request additional documentation.
- Authorize eligible title issuance.
- Review title history and administrative records.

Blockchain issuance must never replace the legal approval process.

## 3.5 Administrator

Administrators should be able to:

- Manage users and permissions.
- Assign administrative roles.
- Manage states, LGAs and communities.
- View all land applications.
- Monitor GIS activities.
- Manage surveyor and registrar assignments.
- Monitor marketplace listings.
- Monitor transactions and escrow status.
- View blockchain transaction records.
- View system audit logs.
- Manage platform settings.
- Suspend or restrict accounts when authorized.

Sensitive administrative actions must require appropriate permissions and must be logged.

---

# 4. Authentication and User Management

## 4.1 Requirements

The system must provide:

- User registration.
- Login.
- Logout.
- Secure password hashing or managed authentication.
- Password reset.
- Email verification where configured.
- Session management.
- Role-based access control.
- Protected frontend routes.
- Protected backend endpoints.

## 4.2 Registration

All ordinary users should use one registration flow.

The system should collect the required account information, validate it and create a user profile.

Administrative permissions must not be granted simply because a user selects an account type during registration.

## 4.3 Security

- Never store plaintext passwords.
- Validate all input on the backend.
- Protect sensitive endpoints.
- Apply rate limiting to authentication endpoints.
- Use secure token and session handling.
- Keep service-role credentials on the backend only.

---

# 5. Nationwide GIS System

## 5.1 GIS Objective

The GIS module is one of the core components of ANAGU.

It must allow users to identify land locations, define parcel boundaries, calculate land measurements and submit geographic information for validation.

The GIS system must support nationwide Nigerian coverage.

## 5.2 Technology

Recommended technologies:

- Leaflet.
- React Leaflet.
- Leaflet Draw.
- OpenStreetMap.
- Turf.js for optional frontend preview calculations.
- PostgreSQL.
- PostGIS.
- GeoJSON.
- Node.js GIS services.

The backend must perform authoritative geographic validation.

## 5.3 Map Integration

Integrate OpenStreetMap as the map background.

The map should support:

- Zooming.
- Panning.
- Location search.
- Current-location assistance when permission is granted.
- Parcel boundary drawing.
- Boundary editing before submission.
- Parcel selection.
- Nearby parcel display.
- Geographic location selection.

Production deployment must comply with the tile provider's usage policy. Do not assume the public OpenStreetMap tile service provides unlimited production capacity.

## 5.4 Boundary Input Methods

ANAGU must support BOTH boundary input methods.

### Method A: Map Drawing

Users should be able to:

1. Open the map.
2. Search for their land location.
3. Zoom to the parcel.
4. Draw a polygon around the land.
5. Edit the polygon.
6. Save the boundary.
7. View the calculated area and perimeter.
8. Submit the boundary for validation.

### Method B: Manual GPS Coordinates

Users should be able to:

1. Select manual coordinate entry.
2. Enter latitude and longitude values.
3. Add multiple boundary points.
4. Arrange the points in the correct boundary order.
5. Preview the polygon on the map.
6. Edit incorrect coordinates.
7. Save the boundary.
8. Submit it for validation.

GeoJSON coordinates must use this order:

`[longitude, latitude]`

Do not reverse the coordinate order.

## 5.5 Geographic Measurements

The system must calculate:

- Land area.
- Land perimeter.
- Polygon validity.
- Boundary coordinates.
- Geographic location.

Area should be displayed in suitable units, including:

- Square metres.
- Hectares.
- Acres.

Measurements must be calculated using appropriate geospatial methods.

Do not calculate accurate nationwide land area using simple planar measurements directly on latitude and longitude coordinates.

Use PostGIS geography calculations or an appropriate projected coordinate reference system for the location.

## 5.6 Geographic Database Structure

Use or extend the existing database structures rather than creating duplicate parcel systems.

Recommended geographic hierarchy:

- countries
- states
- local_government_areas
- communities
- land_parcels

Nigeria should be represented as the national country record.

Populate the database with the 36 states and FCT, and the relevant LGAs and communities using maintained geographic reference data.

## 5.7 Parcel Data

Each parcel should support:

- Unique parcel ID.
- Owner/user reference.
- State ID.
- LGA ID.
- Community ID.
- GeoJSON boundary.
- PostGIS geometry.
- Area.
- Perimeter.
- Boundary source.
- Survey reference.
- Boundary version.
- Verification status.
- Approval status.
- Creation date.
- Last update date.

Recommended additional fields:

- geometry_hash
- boundary_version
- boundary_source
- surveyor_reference
- perimeter_m

Use spatial indexes such as GiST for geographic queries.

## 5.8 GIS Validation

The backend must validate submitted parcel boundaries.

Validation should include:

1. Geometry format validation.
2. Polygon closure.
3. Minimum required boundary points.
4. Invalid geometry detection.
5. Self-intersection detection.
6. Geographic coverage validation.
7. State/LGA consistency checks.
8. Area calculation.
9. Perimeter calculation.
10. Duplicate geometry detection.
11. Possible parcel overlap detection.
12. Nearby parcel comparison.

The system must distinguish actual overlapping areas from parcels that merely share a boundary.

A GIS overlap warning must not automatically be treated as proof of land ownership fraud.

## 5.9 Boundary Versioning

Every submitted boundary should have a version history.

If a user or authorized officer changes an existing boundary:

- Preserve the previous geometry.
- Create a new boundary version.
- Record who made the change.
- Record the reason.
- Record the date.
- Require the appropriate review again.

Never silently overwrite previously approved parcel geometry.

## 5.10 GIS Review Dashboard

The GIS officer dashboard should display:

- Pending GIS applications.
- Parcel map.
- Parcel coordinates.
- Area and perimeter.
- Nearby registered parcels.
- Possible overlap warnings.
- Survey documents.
- Validation results.
- Boundary history.
- Applicant information.
- Review status.

Available review decisions:

- Validated.
- Needs correction.
- Rejected.
- Flagged for investigation.

Every decision should have an explanation and audit record.

## 5.11 GIS APIs

Implement or extend the following API endpoints:

`GET /api/gis/locations/states`

`GET /api/gis/locations/lgas/:stateId`

`GET /api/gis/locations/communities/:lgaId`

`GET /api/gis/parcels`

`GET /api/gis/lookup`

`POST /api/gis/validate-boundary`

`POST /api/gis/applications/:applicationId/boundary`

`POST /api/gis/applications/:applicationId/validate`

`GET /api/gis/applications/:applicationId/result`

`GET /api/gis/reviews`

`POST /api/gis/reviews/:applicationId/decision`

These endpoints are proposed API contracts. Inspect existing routes and preserve compatible endpoints where possible.

---

# 6. Land Registration and Approval Workflow

## 6.1 Application Submission

A user should be able to:

1. Log in.
2. Start a new land application.
3. Enter land details.
4. Select state, LGA and community.
5. Define parcel boundaries using the map or GPS coordinates.
6. Upload supporting documents.
7. Review the application.
8. Submit the application.
9. Receive an application reference number.

## 6.2 Application Status

The system should support clear statuses, including:

- Draft.
- Submitted.
- Under initial review.
- Awaiting survey review.
- Under GIS review.
- Needs correction.
- Awaiting legal review.
- Approved.
- Rejected.
- Title issued.

Use a controlled backend state-transition system. Users must not be able to change approval statuses directly.

## 6.3 Approval Process

Recommended workflow:

1. User submits application.
2. Backend validates required information.
3. Application enters review queue.
4. Surveyor reviews the survey information where required.
5. GIS officer validates parcel geometry.
6. Corrections are requested if necessary.
7. Registrar performs the required legal and ownership verification.
8. Authorized registrar approves the application.
9. Eligible digital title issuance is initiated.
10. The system records the resulting blockchain transaction and title reference.

The exact legal workflow must be configurable to accommodate applicable Nigerian and state-level land administration requirements.

## 6.4 Legal and Ownership Verification

ANAGU must not claim that a map boundary or blockchain transaction independently proves legal ownership.

Ownership verification must be supported by appropriate documents, authorized review and relevant government or institutional processes.

The blockchain is a supporting record technology, not a replacement for the legal land registry.

---

# 7. Document Management and Storage

The system should support uploads such as:

- Survey plans.
- Land documents.
- Identification documents where legally required.
- Supporting application documents.
- Approval documents.

Use private Supabase Storage buckets.

Requirements:

- File type validation.
- File size restrictions.
- Secure upload handling.
- Access control.
- Authenticated downloads.
- File metadata storage.
- Document review history.

Do not expose private documents through unrestricted public URLs.

Sensitive documents and complete personal information must remain off-chain.

---

# 8. Supabase and Database Architecture

## 8.1 Database Technology

Use:

- Supabase.
- PostgreSQL.
- PostGIS.
- Supabase Authentication where compatible with the existing application.
- Supabase Storage.
- Row Level Security.

## 8.2 Fresh Supabase Project

The project will use a fresh Supabase project and a clean database setup.

Important implementation requirements:

1. Preserve the existing codebase.
2. Do not delete the existing Supabase project.
3. Keep the old project available as a fallback until the new setup is verified.
4. Review existing database migrations before applying them.
5. Avoid duplicate tables and conflicting migration numbers.
6. Enable PostGIS in the appropriate schema.
7. Configure database extensions and permissions.
8. Apply migrations in a controlled sequence.
9. Verify database connectivity.
10. Test all major features against the new database.

## 8.3 PostGIS

Enable PostGIS and verify it with:

`SELECT PostGIS_Full_Version();`

Use PostGIS for:

- Polygon storage.
- Spatial indexing.
- Area and perimeter calculations.
- Boundary validation.
- Parcel overlap checks.
- Geographic containment.
- Nearby parcel queries.

## 8.4 Recommended Database Tables

Inspect the existing schema before creating any of these.

Recommended logical tables:

**Users and access**
- profiles
- user_roles
- role_permissions

**Geographic information**
- countries
- states
- local_government_areas
- communities

**Land administration**
- land_applications
- land_parcels
- parcel_boundary_versions
- survey_documents
- gis_validation_results
- gis_reviews
- legal_reviews
- land_titles

**Marketplace**
- marketplace_listings
- marketplace_transactions
- marketplace_escrows

**Blockchain**
- blockchain_transactions
- blockchain_events
- wallet_connections
- token_transactions

**Notifications and auditing**
- notifications
- audit_logs
- outbox_events

Use proper foreign keys, indexes, timestamps, constraints and appropriate deletion rules.

## 8.5 Database Security

Enable RLS on user-accessible tables.

Examples:

- Users can access their own profile.
- Users can access their own applications.
- Users cannot approve their own applications.
- GIS officers can access authorized GIS reviews.
- Registrars can access authorized legal reviews.
- Administrators can access authorized management functions.

Never expose the Supabase service-role key to the frontend.

---

# 9. ANAGU Blockchain Architecture

## 9.1 Blockchain Network

Use Polygon.

Development network:

- Polygon Amoy Testnet.
- Chain ID: 80002.

Production network:

- Polygon PoS Mainnet.
- Chain ID: 137.

The application should support network configuration through environment variables.

## 9.2 Smart Contracts

The project should use the following contract architecture:

1. ANAGU ERC-20 token contract.
2. AnaguLandTitle ERC-721 contract.
3. Marketplace escrow contract.
4. Existing payment contract, if applicable.

Inspect existing contracts before writing replacements.

Preserve and extend `AnaguLandTitle.sol` where technically appropriate.

If an existing contract cannot be safely modified after deployment, prepare a new contract deployment and migration plan instead of pretending the old contract has changed.

## 9.3 ANAGU ERC-20 Token

Confirmed token decisions:

| Property | Decision |
|---|---|
| Token name | ANAGU Token |
| Symbol | ANAGU |
| Standard | ERC-20 |
| Total supply | 100,000,000 |
| Decimals | 18 |
| Pricing | Fixed ANAGU marketplace prices |
| Commission | 2% |
| Initial distribution | Treasury |
| Blockchain | Polygon |

Requirements:

- Fixed maximum supply of 100 million tokens.
- Initial supply allocated to the treasury.
- No unrestricted future minting.
- Secure administrative permissions.
- Safe token transfers.
- Proper event emission.
- Verified contract source after deployment.

The initial treasury distribution does not mean every user automatically owns tokens.

A separate token acquisition or distribution process must be designed.

The NGN value of ANAGU is not defined by its fixed marketplace token prices. Do not advertise a guaranteed naira value or stablecoin peg unless a separate mechanism is legally and technically established.

## 9.4 ERC-721 Digital Land Titles

Use the existing `AnaguLandTitle.sol` contract where appropriate.

Each eligible title should support:

- Unique token ID.
- Unique parcel reference.
- Issuing authority reference.
- Record hash.
- Issuance timestamp.
- Current token owner.
- Title status.

Do not store sensitive personal information, full survey plans or complete land geometry directly on-chain.

Only authorized backend processes should initiate title issuance after the required approval.

The application must prevent duplicate title issuance for the same eligible parcel.

The legal land registry remains authoritative.

## 9.5 Wallet Integration

Support:

- MetaMask.
- Trust Wallet.

Use Ethers.js.

Users should be able to:

1. Connect a wallet.
2. Detect the connected account.
3. Detect the selected blockchain network.
4. Request a network switch when supported.
5. View their ANAGU balance.
6. Approve token spending.
7. Sign marketplace transactions.
8. View transaction status.
9. View transaction history.

Never request or store a user's wallet seed phrase or private key.

## 9.6 Gas Fees

Users need the network's native gas token, POL, for Polygon transactions.

ANAGU token payments do not remove the requirement for network gas.

Display clear messages when users are connected to the wrong network or do not have sufficient gas.

---

# 10. Marketplace

## 10.1 Marketplace Objective

Provide a platform where eligible landowners can list approved properties and buyers can purchase them using ANAGU tokens.

## 10.2 Listing Requirements

A land listing should contain:

- Listing ID.
- Parcel ID.
- Title reference.
- Land location.
- Land area.
- Parcel map.
- Description.
- Supporting information.
- Seller reference.
- Fixed ANAGU price.
- Listing status.
- Date created.

Only eligible legally approved parcels should be listed.

## 10.3 Marketplace Features

Buyers should be able to:

- Browse available land.
- Search by state and LGA.
- Filter by price.
- View parcel maps.
- View land details.
- Connect a wallet.
- View the price in ANAGU.
- Purchase an eligible listing.
- Track transaction progress.
- View purchase history.

Sellers should be able to:

- Create a listing for eligible land.
- Set a fixed ANAGU price.
- View listing status.
- View offers or transaction activity where supported.
- Monitor completed and pending transactions.

## 10.4 Marketplace Commission

Confirmed commission: 2%.

Use basis points:

`200 / 10000`

Recommended settlement model:

- Buyer funds the full agreed listing price.
- 2% is deducted from the seller's proceeds.
- 98% goes to the seller.
- 2% goes to the ANAGU treasury.

Example:

| Description | Amount |
|---|---:|
| Listing price | 5,000 ANAGU |
| Seller receives | 4,900 ANAGU |
| Treasury commission | 100 ANAGU |

The smart contract must calculate this amount using integer arithmetic.

## 10.5 Escrow

The marketplace must use smart-contract escrow.

Recommended transaction lifecycle:

`LISTED → FUNDED → SELLER_CONFIRMATION → SETTLED`

Alternative states:

- CANCELLED.
- DISPUTED.
- REFUNDED.
- EXPIRED.

Requirements:

1. Buyer selects an eligible listing.
2. Buyer approves ANAGU token spending.
3. Buyer funds the escrow contract.
4. Backend verifies the transaction and contract events.
5. The listing becomes unavailable for another purchase.
6. The listing seller confirms settlement with their wallet.
7. The contract verifies the seller and completes the transaction.
8. The title NFT is transferred where legally and technically permitted.
9. The seller receives 98%.
10. Treasury receives 2%.
11. All relevant events are recorded.

Implement:

- Reentrancy protection.
- Secure access control.
- Emergency pause.
- No self-purchase.
- No duplicate settlement.
- One active escrow per listing.
- Exact payment amount validation.
- Expiry and refund handling.
- No commission on refunded transactions.
- Protection against unauthorized cancellation.

The escrow contract must not release funds merely because the frontend claims a payment succeeded. The seller's on-chain confirmation is required; the backend verifies the settlement event before marking the listing complete.

---

# 11. Registration Fees and Payment Architecture

The registration payment system must remain separate from ANAGU marketplace payments.

Confirmed decision:

- ANAGU ERC-20 is for marketplace land purchases.
- ANAGU ERC-20 is not the default registration payment currency.

The implementation should inspect the existing `AnaguPayment.sol` contract and payment architecture.

Registration fees should use the existing approved payment flow, with any supported blockchain payment option clearly separated from marketplace escrow.

Do not combine registration fees and marketplace escrow into one unstructured payment process.

For all payments:

- Verify blockchain receipts on the backend.
- Confirm contract address.
- Confirm network and chain ID.
- Confirm token and amount.
- Prevent replay and duplicate processing.
- Store transaction hashes.
- Maintain transaction status history.

---

# 12. MQTT Real-Time Messaging

## 12.1 Purpose

MQTT will provide real-time communication between the ANAGU backend and connected frontend dashboards.

The initial implementation should focus on dashboard and application notifications.

Physical IoT devices such as GPS trackers, survey equipment or sensors are outside the initial required scope unless separately approved.

## 12.2 Architecture

Recommended architecture:

React frontend → MQTT over secure WebSockets → MQTT Broker → Node.js backend → Supabase PostgreSQL/PostGIS.

The backend should publish events after important database changes.

PostgreSQL remains the authoritative source of truth.

MQTT messages are notifications, not the permanent record of an approval or transaction.

## 12.3 MQTT Technology

Development:

- Mosquitto.

Production:

- EMQX or an appropriately managed MQTT broker.

Node.js:

- MQTT.js.

## 12.4 MQTT Features

Use MQTT for:

- Application status updates.
- GIS validation progress.
- GIS review decisions.
- Surveyor assignments.
- Registrar pending-review notifications.
- Marketplace listing updates.
- Escrow status notifications.
- Verified blockchain transaction updates.
- User notifications.
- Administrative activity notifications.

## 12.5 Topic Structure

Recommended topics:

`anagu/users/{userId}/notifications`

`anagu/applications/{applicationId}/status`

`anagu/gis/{applicationId}/validation`

`anagu/gis/officers/assignments`

`anagu/registrar/pending`

`anagu/marketplace/listings`

`anagu/marketplace/transactions/{transactionId}`

`anagu/blockchain/transactions/{transactionHash}`

`anagu/admin/activity`

## 12.6 MQTT Security

Implement:

- TLS or secure WebSockets in production.
- Broker authentication.
- Topic-level authorization.
- User-specific subscriptions.
- Payload validation.
- Reconnection handling.
- Duplicate message protection.
- Event IDs.
- Appropriate QoS.
- Retained messages only when justified.

Ordinary users must not be able to publish administrative approval events or arbitrary payment-success messages.

## 12.7 Transactional Outbox

Use a transactional outbox design.

When an important database transaction occurs:

1. Save the business record.
2. Save an outbox event in the same database transaction.
3. A backend publisher reads pending outbox events.
4. The publisher sends them to MQTT.
5. The event is marked as published.
6. Failed publications are retried safely.

This helps prevent important notifications from being lost during broker outages.

Clients must be able to recover missed updates through authenticated REST API requests.

## 12.8 MQTT Fallback

If MQTT is unavailable:

- The application must remain usable.
- Important information must still be stored in Supabase.
- Frontend dashboards should recover information through REST APIs.
- Supabase Realtime or polling can serve as an alternative where appropriate.

Do not make MQTT a single point of failure for the land registration or payment system.

---

# 13. Notifications

Provide notifications for:

- Successful registration.
- Application submission.
- Application status changes.
- Missing documents.
- Boundary correction requests.
- GIS validation completion.
- GIS approval.
- Legal review decisions.
- Title issuance.
- Marketplace listing updates.
- Wallet transaction status.
- Escrow funding.
- Escrow settlement.
- Refunds.
- Administrative assignments.

Notifications should be stored persistently in the database.

MQTT should deliver live updates, while the notification database provides history.

---

# 14. Administrative Dashboard

The administrator dashboard should provide an overview of the entire platform.

Recommended dashboard sections:

1. Overview.
2. User management.
3. Land applications.
4. GIS management.
5. Parcel management.
6. Surveyor management.
7. Registrar management.
8. Title management.
9. Marketplace management.
10. Token and blockchain monitoring.
11. Payment and escrow monitoring.
12. Notifications.
13. Audit logs.
14. System settings.

Dashboard statistics may include:

- Total registered users.
- Total applications.
- Pending applications.
- Approved applications.
- Rejected applications.
- Total registered parcels.
- Pending GIS reviews.
- Issued titles.
- Active listings.
- Completed marketplace transactions.
- Pending escrows.

Statistics must be calculated from real database records, not hardcoded demo values.

---

# 15. Security and Compliance Requirements

ANAGU must implement security at the frontend, backend, database and smart-contract levels.

## 15.1 Backend

- Authentication middleware.
- Role-based authorization.
- Input validation.
- Rate limiting.
- Secure error handling.
- Request logging.
- CORS configuration.
- Secure environment variable management.
- Protection against unauthorized access.
- Protection against common injection attacks.

## 15.2 Database

- Row Level Security.
- Appropriate database roles.
- Restricted service-role access.
- Foreign-key constraints.
- Audit records.
- Secure document access.

## 15.3 Blockchain

- Reentrancy protection.
- Access control.
- Safe ERC-20 transfers.
- Pausable emergency mechanism.
- Duplicate settlement prevention.
- Contract testing.
- Verified contract addresses.
- Multisignature governance for sensitive treasury and settlement operations where practical.

## 15.4 Legal and Regulatory Considerations

The product must not imply that blockchain ownership records independently replace Nigerian land registration or conveyancing requirements.

Before production deployment, obtain appropriate legal review for:

- Land registration procedures.
- State-level land administration.
- Digital title representation.
- Marketplace transactions.
- Escrow arrangements.
- Token issuance and distribution.
- Applicable financial and data protection obligations.

---

# 16. Technical Architecture

## 16.1 Recommended Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React |
| Frontend language | JavaScript |
| Mapping | Leaflet / React Leaflet |
| Map data | OpenStreetMap |
| GIS preview | Turf.js |
| Backend | Node.js |
| API | Express.js |
| Database | Supabase PostgreSQL |
| Spatial database | PostGIS |
| Authentication | Supabase Auth or existing compatible authentication |
| File storage | Supabase Storage |
| Blockchain | Polygon |
| Token standard | ERC-20 |
| Title standard | ERC-721 |
| Smart contracts | Solidity |
| Blockchain library | Ethers.js |
| Wallets | MetaMask and Trust Wallet |
| Real-time messaging | MQTT |
| MQTT client | MQTT.js |
| MQTT broker | Mosquitto for development; EMQX or managed broker for production |
| Frontend deployment | Vercel or compatible hosting |
| Backend deployment | Secure Node.js hosting |
| Version control | Git and GitHub |

## 16.2 Suggested Backend Structure

Extend the existing structure rather than replacing it.

Recommended logical service organization:

`backend/src/services/`

- authService.js
- userService.js
- gisService.js
- locationService.js
- boundaryService.js
- measurementService.js
- validationService.js
- overlapService.js
- surveyService.js
- workflowService.js
- titleService.js
- marketplaceService.js
- escrowService.js
- blockchainService.js
- tokenService.js
- walletService.js
- mqttService.js
- notificationService.js
- auditService.js

Recommended event modules:

`backend/src/events/`

- applicationEvents.js
- gisEvents.js
- marketplaceEvents.js
- blockchainEvents.js

Recommended configuration:

`backend/src/config/`

- database.js
- blockchain.js
- mqtt.js
- storage.js

These are organizational recommendations. Reuse existing service files and naming conventions when they already provide the required functionality.

---

# 17. API Requirements

The backend should expose authenticated APIs for:

## Authentication

- Registration.
- Login.
- Logout.
- Password reset.
- Profile retrieval.
- Profile update.

## Applications

- Create application.
- Update draft.
- Submit application.
- Retrieve application.
- List user's applications.
- Retrieve application status.

## GIS

- Retrieve states.
- Retrieve LGAs.
- Retrieve communities.
- Search geographic locations.
- Submit boundary.
- Validate boundary.
- Retrieve parcel.
- Retrieve validation result.
- Submit GIS review.
- Retrieve boundary history.

## Documents

- Upload document.
- Retrieve document metadata.
- Download authorized document.
- Delete or replace eligible documents.

## Titles

- Retrieve approved titles.
- Retrieve title history.
- Retrieve title verification information.
- Initiate authorized issuance.

## Marketplace

- Browse listings.
- Search listings.
- Retrieve listing details.
- Create listing.
- Update eligible listing.
- Cancel eligible listing.
- Initiate purchase.
- Retrieve transaction.
- Retrieve purchase history.

## Blockchain

- Retrieve supported network information.
- Retrieve contract configuration.
- Verify transaction.
- Retrieve token balance.
- Retrieve title token information.
- Retrieve marketplace escrow status.

## Notifications

- Retrieve notifications.
- Mark notification as read.
- Retrieve notification history.

All API endpoints must enforce server-side permissions.

---

# 18. Environment Configuration

Use environment variables.

Example backend configuration:

`SUPABASE_URL=`

`SUPABASE_ANON_KEY=`

`SUPABASE_SERVICE_ROLE_KEY=`

`DATABASE_URL=`

`JWT_SECRET=`

`POLYGON_RPC_URL=`

`POLYGON_CHAIN_ID=80002`

`ANAGU_TOKEN_ADDRESS=`

`ANAGU_LAND_TITLE_ADDRESS=`

`ANAGU_MARKETPLACE_ADDRESS=`

`ANAGU_PAYMENT_ADDRESS=`

`TREASURY_WALLET_ADDRESS=`

`MQTT_BROKER_URL=`

`MQTT_USERNAME=`

`MQTT_PASSWORD=`

`MQTT_CLIENT_ID=`

`FRONTEND_URL=`

`NODE_ENV=development`

Example frontend configuration:

`VITE_API_URL=`

`VITE_POLYGON_CHAIN_ID=80002`

`VITE_ANAGU_TOKEN_ADDRESS=`

`VITE_ANAGU_LAND_TITLE_ADDRESS=`

`VITE_ANAGU_MARKETPLACE_ADDRESS=`

Only public configuration should be exposed through frontend environment variables.

Never place private keys, database passwords, service-role keys or privileged broker credentials in frontend code.

Do not invent or hardcode contract addresses.

---

# 19. Testing Requirements

## 19.1 Authentication Testing

- Register a user.
- Log in.
- Log out.
- Reset password.
- Verify permissions.
- Attempt unauthorized access.

## 19.2 GIS Testing

- Draw a valid polygon.
- Enter GPS coordinates manually.
- Preview a polygon.
- Calculate area.
- Calculate perimeter.
- Submit invalid coordinates.
- Test self-intersecting polygons.
- Test duplicate boundaries.
- Test overlapping parcels.
- Test shared parcel boundaries.
- Test boundary version history.
- Test geographic location hierarchy.

## 19.3 Registration Testing

- Submit an application.
- Upload documents.
- Assign reviewers.
- Request corrections.
- Complete GIS review.
- Complete legal review.
- Test rejection.
- Test approval.
- Test title issuance eligibility.

## 19.4 Blockchain Testing

- Deploy ERC-20 on Polygon Amoy.
- Verify supply.
- Verify treasury allocation.
- Test token transfers.
- Deploy or verify ERC-721 contract.
- Test title issuance.
- Test title transfer restrictions.
- Test wallet connection.
- Test wrong network handling.

## 19.5 Marketplace Testing

- Create an eligible listing.
- Reject an ineligible listing.
- Approve token allowance.
- Fund escrow.
- Verify transaction.
- Test 2% commission.
- Test seller proceeds.
- Settle a transaction.
- Test refund.
- Test expiry.
- Test duplicate settlement protection.

## 19.6 MQTT Testing

- Connect authenticated users.
- Subscribe to authorized topics.
- Publish backend-generated status updates.
- Verify user-specific notifications.
- Test unauthorized topic access.
- Test broker disconnection.
- Test reconnection.
- Test duplicate event handling.
- Test REST recovery when MQTT is unavailable.

## 19.7 End-to-End Testing

The system must support this complete workflow:

1. A user registers.
2. The user submits a land application.
3. The user defines the parcel boundary using the map or GPS coordinates.
4. The user uploads survey documents.
5. The backend validates the boundary.
6. A surveyor/GIS officer reviews the information.
7. The registrar completes the required legal review.
8. The application is approved.
9. An authorized process issues the digital title.
10. The owner creates an eligible marketplace listing.
11. A buyer connects MetaMask or Trust Wallet.
12. The buyer purchases using ANAGU tokens.
13. The smart contract holds the payment in escrow.
14. The backend verifies the transaction.
15. Authorized settlement is completed.
16. The seller receives 98%.
17. The treasury receives 2%.
18. The title token is transferred where legally and technically permitted.
19. The buyer receives a notification.
20. All records remain available in the database.

---

# 20. Deployment Requirements

## Development

- Polygon Amoy.
- Local backend.
- Fresh Supabase development project.
- Local MQTT broker.
- Test wallets.
- Test ANAGU tokens.

## Production

- Polygon PoS Mainnet.
- Production Supabase project.
- Secure backend hosting.
- Production MQTT broker.
- HTTPS.
- Secure WebSockets.
- Production wallet configuration.
- Verified smart contracts.
- Monitoring and backups.
- Production database policies.

Do not switch to production until the full critical workflow has passed testing.

---

# 21. Implementation Roadmap

Implement ANAGU in phases.

## Phase 1: Codebase Audit and Foundation

- Inspect the entire existing repository.
- Identify existing components and services.
- Review current database migrations.
- Inspect `AnaguLandTitle.sol`.
- Inspect `AnaguPayment.sol`.
- Review existing authentication.
- Review existing GIS code.
- Review existing local storage fallback.
- Identify missing features.
- Create a documented implementation plan.

Deliverable: Existing project audit and gap report.

## Phase 2: Fresh Supabase Setup

- Prepare a fresh Supabase project.
- Enable PostGIS.
- Review and organize migrations.
- Configure database schema.
- Configure authentication.
- Configure Storage.
- Configure RLS.
- Connect backend.
- Test database operations.

Deliverable: Functional database foundation.

## Phase 3: Authentication and User Management

- Implement registration.
- Implement login.
- Implement user profiles.
- Implement role management.
- Implement permissions.
- Protect API routes.

Deliverable: Functional account system.

## Phase 4: GIS and Nationwide Locations

- Integrate OpenStreetMap.
- Implement location hierarchy.
- Implement map drawing.
- Implement manual GPS coordinates.
- Implement GeoJSON handling.
- Implement area and perimeter calculations.
- Implement PostGIS validation.
- Implement parcel overlap detection.
- Implement boundary history.

Deliverable: Functional nationwide GIS module.

## Phase 5: Land Registration Workflow

- Implement application creation.
- Implement document uploads.
- Implement surveyor review.
- Implement GIS officer review.
- Implement registrar review.
- Implement status tracking.
- Implement audit history.

Deliverable: Functional land application and review workflow.

## Phase 6: Blockchain

- Review and finalize contracts.
- Implement ANAGU ERC-20.
- Integrate ERC-721 title contract.
- Deploy test contracts to Amoy.
- Integrate Ethers.js.
- Implement transaction verification.
- Integrate MetaMask and Trust Wallet.

Deliverable: Functional blockchain testnet integration.

## Phase 7: Marketplace and Escrow

- Implement eligible listings.
- Implement fixed ANAGU prices.
- Implement token allowance.
- Implement escrow funding.
- Implement transaction verification.
- Implement authorized settlement.
- Implement 2% commission.
- Implement refund and expiry handling.

Deliverable: Functional testnet marketplace.

## Phase 8: MQTT and Notifications

- Configure MQTT broker.
- Implement backend MQTT service.
- Implement secure topic authorization.
- Implement event publishing.
- Implement transactional outbox.
- Implement frontend subscriptions.
- Implement notification persistence.
- Implement fallback recovery.

Deliverable: Real-time notification system.

## Phase 9: Administrative Dashboard

- Implement user management.
- Implement application management.
- Implement GIS dashboard.
- Implement registrar dashboard.
- Implement marketplace monitoring.
- Implement blockchain monitoring.
- Implement reports and audit logs.

Deliverable: Functional administration system.

## Phase 10: Testing and Production Preparation

- Run backend tests.
- Run frontend tests.
- Run smart-contract tests.
- Run GIS tests.
- Run security tests.
- Run end-to-end tests.
- Fix critical issues.
- Prepare production deployment.
- Document operational procedures.

Deliverable: Tested deployment candidate.

---

# 22. Acceptance Criteria

ANAGU should not be considered complete simply because the frontend pages look finished.

The platform must satisfy these requirements:

1. Users can register and log in.
2. User permissions are enforced by the backend.
3. Users can create land applications.
4. Users can draw parcel boundaries on the map.
5. Users can enter GPS coordinates manually.
6. Both input methods produce valid geographic data.
7. The backend performs authoritative GIS validation.
8. Area and perimeter calculations work correctly.
9. The system supports nationwide Nigerian geographic data.
10. Boundary versions are preserved.
11. Survey documents can be uploaded securely.
12. GIS officers can review applications.
13. Registrars can complete the required approval process.
14. Only eligible approved parcels can receive digital title issuance.
15. The ANAGU ERC-20 contract has a maximum supply of 100 million.
16. The initial token allocation goes to the treasury.
17. Users can connect MetaMask and Trust Wallet.
18. The marketplace supports fixed ANAGU prices.
19. Marketplace escrow works on the selected test network.
20. The 2% commission is calculated correctly.
21. The backend verifies blockchain transactions.
22. MQTT provides authorized real-time notifications.
23. Critical records remain available when MQTT is offline.
24. Administrative actions are logged.
25. Sensitive information is not exposed publicly or stored unnecessarily on-chain.
26. The complete workflow passes end-to-end testing.

---

# 23. Instructions to the VS Code / Kiro AI Developer

You are acting as the lead software architect and senior full-stack developer responsible for implementing ANAGU.

You must follow these instructions carefully.

## 23.1 Inspect Before Coding

First inspect the entire existing project.

Identify:

- Frontend architecture.
- Backend architecture.
- Existing API routes.
- Existing database schema.
- Existing migrations.
- Authentication implementation.
- GIS implementation.
- Existing PostGIS functions.
- Existing smart contracts.
- Wallet integration.
- Existing payment architecture.
- Existing local storage fallback.
- Existing admin dashboard.
- Existing deployment configuration.

Do not assume that a feature is missing until you inspect the source code.

## 23.2 Preserve Existing Work

This is an extension and completion of an existing project.

Do not:

- Delete existing working features.
- Replace the entire frontend unnecessarily.
- Create a second application.
- Create duplicate database tables.
- Create duplicate API endpoints.
- Replace working contracts without a technical reason.
- Remove existing authentication.
- Hardcode fake data to make pages look functional.
- Claim that an unimplemented feature works.

Extend existing modules wherever possible.

## 23.3 Work in Phases

Do not attempt to implement the entire system in one uncontrolled operation.

Follow the implementation roadmap.

For each phase:

1. Inspect relevant files.
2. Explain what already exists.
3. Identify what is missing.
4. Propose the necessary changes.
5. Implement the changes.
6. Run relevant tests.
7. Fix errors.
8. Document the completed work.
9. Identify remaining tasks.

## 23.4 Database Rules

- Review all migrations before running them.
- Use the fresh Supabase project.
- Preserve the old project as a fallback.
- Enable PostGIS.
- Avoid destructive SQL operations.
- Use version-controlled migrations.
- Enable RLS.
- Keep service-role keys on the backend.
- Do not invent database credentials.

## 23.5 Blockchain Rules

- Use Polygon Amoy for development.
- Use Polygon Mainnet only for production.
- Use the confirmed ANAGU token parameters.
- Use secure OpenZeppelin contract patterns.
- Test contracts before deployment.
- Never invent deployed contract addresses.
- Never store private keys in frontend code.
- Never trust frontend transaction-success claims.
- Verify receipts and events on the backend.
- Do not issue a title before the required approval.
- Keep the legal registry authoritative.

## 23.6 GIS Rules

- Support map drawing and manual GPS input.
- Use GeoJSON.
- Respect longitude/latitude coordinate order.
- Use PostGIS for authoritative validation.
- Use correct geospatial measurement methods.
- Preserve boundary history.
- Avoid treating overlap warnings as proof of fraud.
- Do not automatically approve land applications.

## 23.7 MQTT Rules

- Use MQTT for real-time notifications and updates.
- Keep PostgreSQL as the permanent source of truth.
- Protect topic access.
- Do not allow clients to publish privileged approval or payment events.
- Implement a transactional outbox.
- Implement reconnection and fallback.
- Do not make MQTT mandatory for core application functionality.

## 23.8 Final Reporting

After each implementation phase, provide:

- Files created.
- Files modified.
- Database migrations added.
- Features implemented.
- Tests performed.
- Test results.
- Environment variables required.
- Remaining problems.
- Exact next steps.

Do not mark a phase complete unless its required functionality has been implemented and tested.

---

# 24. Final Product Definition

ANAGU is intended to become a unified digital land administration ecosystem with five major foundations:

1. **Land Administration:** Registration, document submission, review, approval and title management.
2. **GIS Infrastructure:** Nationwide parcel mapping, boundary creation, spatial validation and geographic records.
3. **Blockchain Infrastructure:** ANAGU ERC-20 token, ERC-721 digital titles and verified transaction records.
4. **Land Marketplace:** Approved property listings, ANAGU payments, escrow and a 2% commission.
5. **Real-Time Infrastructure:** MQTT notifications, application updates and administrative monitoring.

The most important development principle is that every component must work together through a consistent, secure backend and database architecture.

**The objective is not to build a collection of attractive dashboards. The objective is to build a functional, secure, testable and scalable land administration platform.**