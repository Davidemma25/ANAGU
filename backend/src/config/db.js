import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { env } from './env.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  getSupabaseDatabaseStatus,
  isSupabaseActive,
} from './supabase.js';

const { Pool } = pg;

export const ROLES_SEED = [
  {
    id: 1,
    code: 'CITIZEN',
    name: 'Citizen / Landowner',
    description:
      'Submits land registration applications, coordinates, and supporting documents, verifies listings, and buys or sells verified land.',
  },
  {
    id: 2,
    code: 'LAND_ADMIN',
    name: 'Administrator',
    description:
      'Single designated administrator authorized to validate GIS boundaries, verify claims, issue and revoke titles, manage user access, and configure platform settings.',
  },
  {
    id: 3,
    code: 'SURVEYOR',
    name: 'Surveyor',
    description: 'Reviews survey documents and assigned parcel boundaries.',
  },
  {
    id: 4,
    code: 'COMMUNITY_OFFICER',
    name: 'Community Verification Officer',
    description: 'Verifies ownership claims against institutional and community records.',
  },
  {
    id: 5,
    code: 'REGISTRAR',
    name: 'Registrar',
    description: 'Completes legal review and authorizes eligible title issuance.',
  },
  {
    id: 6,
    code: 'GOVERNOR',
    name: 'Governor',
    description: 'Executes legally authorized statutory title revocation.',
  },
];

export const SAMPLE_OWNERSHIP_RECORDS = [
  {
    id: 1,
    record_source: 'SAMPLE_MUNICIPAL_ARCHIVE',
    source_reference: 'INST-2024-001',
    parcel_code: 'ANG-PARCEL-1001',
    registered_owner_name: 'Amara Okafor',
    owner_national_id: 'NID-1001-AMA',
    boundary_geojson: {
      type: 'Polygon',
      coordinates: [
        [
          [3.375, 6.52],
          [3.3765, 6.52],
          [3.3765, 6.5215],
          [3.375, 6.5215],
          [3.375, 6.52],
        ],
      ],
    },
    claim_status: 'ACTIVE_RECORD',
    notes: 'Sample baseline record matching Plot A in Zone 1.',
    is_sample_record: true,
    created_at: new Date('2026-01-10T09:00:00Z').toISOString(),
  },
  {
    id: 2,
    record_source: 'SAMPLE_COMMUNITY_ELDERS_COUNCIL',
    source_reference: 'COMM-2024-002',
    parcel_code: 'ANG-PARCEL-1002',
    registered_owner_name: 'Chidi Nwosu',
    owner_national_id: 'NID-1002-CHI',
    boundary_geojson: {
      type: 'Polygon',
      coordinates: [
        [
          [3.378, 6.52],
          [3.3795, 6.52],
          [3.3795, 6.5215],
          [3.378, 6.5215],
          [3.378, 6.52],
        ],
      ],
    },
    claim_status: 'ACTIVE_RECORD',
    notes: 'Sample community customary allocation verified by council minutes.',
    is_sample_record: true,
    created_at: new Date('2026-01-12T11:30:00Z').toISOString(),
  },
  {
    id: 3,
    record_source: 'SAMPLE_CUSTOMARY_LEDGER',
    source_reference: 'INST-2024-003',
    parcel_code: 'ANG-PARCEL-1003',
    registered_owner_name: 'Fatima Bello',
    owner_national_id: 'NID-1003-FAT',
    boundary_geojson: {
      type: 'Polygon',
      coordinates: [
        [
          [3.381, 6.522],
          [3.3825, 6.522],
          [3.3825, 6.5235],
          [3.381, 6.5235],
          [3.381, 6.522],
        ],
      ],
    },
    claim_status: 'DISPUTED',
    notes: 'Sample disputed parcel flagged for overlapping customary inheritance claim.',
    is_sample_record: true,
    created_at: new Date('2026-01-15T14:15:00Z').toISOString(),
  },
];

let poolInstance = null;

/**
 * Returns a configured PostgreSQL connection pool using the Object Method
 * when PG_ENABLED=true. Returns null when running in container prototype mode.
 */
export function getPgPool() {
  if (!env.pg.enabled) {
    return null;
  }

  if (!poolInstance) {
    poolInstance = new Pool({
      host: env.pg.host,
      port: env.pg.port,
      database: env.pg.database,
      user: env.pg.user,
      password: env.pg.password,
      max: 10,
      connectionTimeoutMillis: 10000,
    });

    poolInstance.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err.message);
    });
  }

  return poolInstance;
}

function getDefaultStorePath() {
  if (process.env.ANAGU_STORE_PATH) {
    return process.env.ANAGU_STORE_PATH;
  }
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), '.local-anagu-store.json');
  }
  return path.resolve(process.cwd(), 'database', '.local-anagu-store.json');
}

export function createEmptyStore() {
  return {
    meta: {
      schemaVersion: 2,
      mode: 'container-prototype-store',
      updatedAt: new Date().toISOString(),
    },
    sequences: {
      roles: ROLES_SEED.length,
      users: 0,
      land_applications: 0,
      application_status_history: 0,
      land_parcels: 0,
      parcel_boundary_versions: 0,
      ownership_records: SAMPLE_OWNERSHIP_RECORDS.length,
      verification_records: 0,
      supporting_documents: 0,
      land_titles: 0,
      blockchain_transactions: 0,
      revocation_records: 0,
      land_listings: 0,
      payments: 0,
      payment_event_logs: 0,
      notifications: 0,
      audit_logs: 0,
    },
    tables: {
      roles: [...ROLES_SEED],
      users: [],
      land_applications: [],
      application_status_history: [],
      land_parcels: [],
      parcel_boundary_versions: [],
      ownership_records: [...SAMPLE_OWNERSHIP_RECORDS],
      verification_records: [],
      supporting_documents: [],
      land_titles: [],
      blockchain_transactions: [],
      revocation_records: [],
      land_listings: [],
      payments: [],
      payment_event_logs: [],
      payment_settings: {
        testFeeNgn: env.ethereumPayment.testFeeNgn,
        ethNgnExchangeRate: env.ethereumPayment.ethNgnExchangeRate,
        rateSource: env.ethereumPayment.rateSource,
        quoteTtlSeconds: env.ethereumPayment.quoteTtlSeconds,
        updatedAt: new Date().toISOString(),
      },
      notifications: [],
      audit_logs: [],
    },
  };
}

export function loadLocalStore(storePath = getDefaultStorePath()) {
  const template = createEmptyStore();
  if (!fs.existsSync(storePath)) {
    saveLocalStore(template, storePath);
    return template;
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);

    // Backfill any tables/sequences added in later phases/migrations
    parsed.sequences = { ...template.sequences, ...(parsed.sequences || {}) };
    parsed.tables = { ...template.tables, ...(parsed.tables || {}) };
    return parsed;
  } catch (err) {
    console.warn('Recovering from corrupted local store file:', err.message);
    saveLocalStore(template, storePath);
    return template;
  }
}

export function saveLocalStore(store, storePath = getDefaultStorePath()) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  store.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
}

export function nextSequence(store, tableName) {
  store.sequences[tableName] = (store.sequences[tableName] || 0) + 1;
  return store.sequences[tableName];
}

export async function getDatabaseStatus() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    try {
      const result = await pool.query(
        'SELECT PostGIS_Version() AS postgis_version, current_database() AS database_name;'
      );
      return {
        mode: 'postgresql-postgis',
        connected: true,
        database: result.rows[0]?.database_name,
        postgisVersion: result.rows[0]?.postgis_version,
      };
    } catch (error) {
      return {
        mode: 'postgresql-postgis',
        connected: false,
        error: error.message,
      };
    }
  }

  if (env.supabase.enabled && !process.env.ANAGU_STORE_PATH) {
    return getSupabaseDatabaseStatus();
  }

  const store = loadLocalStore();
  return {
    mode: 'container-prototype-store',
    connected: true,
    tableCount: Object.keys(store.tables).length,
    rolesCount: store.tables.roles.length,
    sampleOwnershipRecordsCount: store.tables.ownership_records.length,
  };
}

function createDemoSha256(seedText) {
  let hash = '';
  let acc = 0x811c9dc5;
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < seedText.length; i++) {
      acc ^= seedText.charCodeAt(i) + round * 31;
      acc = Math.imul(acc, 0x01000193);
    }
    hash += (acc >>> 0).toString(16).padStart(8, '0');
  }
  return hash.slice(0, 64);
}

/**
 * Seeds 4 realistic demo land sales into Check Lands when no marketplace listings exist yet
 * (2 Verified Titles ready for wallet checkout, 1 Pending Verification parcel, and 1 Disputed demo).
 */
export function ensureDemoMarketplaceData(storePath = getDefaultStorePath()) {
  if (env.pg.enabled) {
    return { seeded: false };
  }

  const store = loadLocalStore(storePath);
  if ((store.tables.land_listings || []).length > 0) {
    return { seeded: false, existingCount: store.tables.land_listings.length };
  }

  const now = new Date().toISOString();
  const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  const findOrCreateDemoSeller = ({ fullName, email, nationalId, walletAddress }) => {
    const existing = (store.tables.users || []).find(
      (u) =>
        String(u.email || '').toLowerCase() === email.toLowerCase() ||
        String(u.national_id || '').toUpperCase() === nationalId.toUpperCase()
    );
    if (existing) {
      if (!existing.wallet_address) {
        existing.wallet_address = walletAddress;
      }
      return existing;
    }
    const seller = {
      id: nextSequence(store, 'users'),
      role_id: 1,
      full_name: fullName,
      email: email.toLowerCase(),
      password_hash: '',
      national_id: nationalId.toUpperCase(),
      phone: '+234-800-000-0000',
      wallet_address: walletAddress,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    store.tables.users.push(seller);
    return seller;
  };

  const demoParcels = [
    {
      seller: {
        fullName: 'Amara Okafor',
        email: 'amara.okafor@demo.anagu.local',
        nationalId: 'NID-1001-AMA',
        walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      },
      parcelName: 'Yaba Commercial Plot A',
      headline: 'Yaba Commercial Plot A',
      description: 'Surveyed corner freehold parcel with verified municipal archive record and clean road access.',
      region: 'Zone 1',
      locationDescription: 'Plot 14 Commercial Avenue, Yaba District, Zone 1',
      ownershipType: 'FREEHOLD',
      declaredAreaSqm: 27700,
      centroidLat: 6.52075,
      centroidLng: 3.37575,
      ring: [
        [3.375, 6.52],
        [3.3765, 6.52],
        [3.3765, 6.5215],
        [3.375, 6.5215],
        [3.375, 6.52],
      ],
      priceUsd: 4500,
      pricePol: 4.5,
      priceWei: '4500000000000000000',
      verified: true,
      oracleScore: 96,
      oracleRemarks: 'Matched SAMPLE_MUNICIPAL_ARCHIVE (INST-2024-001) with intact SHA-256 conveyance deed.',
      deedFileName: 'yaba-plot-a-deed.pdf',
    },
    {
      seller: {
        fullName: 'Chidi Nwosu',
        email: 'chidi.nwosu@demo.anagu.local',
        nationalId: 'NID-1002-CHI',
        walletAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      },
      parcelName: 'Akoka Residential Plot B',
      headline: 'Akoka Residential Plot B',
      description: 'Community elders endorsed residential plot with clean GIS perimeter and active ERC-721 title.',
      region: 'Zone 1',
      locationDescription: '8 University Crescent, Akoka, Zone 1',
      ownershipType: 'CUSTOMARY',
      declaredAreaSqm: 27700,
      centroidLat: 6.52075,
      centroidLng: 3.37875,
      ring: [
        [3.378, 6.52],
        [3.3795, 6.52],
        [3.3795, 6.5215],
        [3.378, 6.5215],
        [3.378, 6.52],
      ],
      priceUsd: 6800,
      pricePol: 6.8,
      priceWei: '6800000000000000000',
      verified: true,
      oracleScore: 94,
      oracleRemarks: 'Matched SAMPLE_COMMUNITY_ELDERS_COUNCIL (COMM-2024-002) with zero boundary overlap.',
      deedFileName: 'akoka-plot-b-deed.pdf',
    },
    {
      seller: {
        fullName: 'Tunde Adeyemi',
        email: 'tunde.adeyemi@demo.anagu.local',
        nationalId: 'NID-DEMO-TUNDE',
        walletAddress: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
      },
      parcelName: 'Victoria Waterfront Lot C',
      headline: 'Victoria Waterfront Lot C',
      description: 'Waterfront lot posted prior to verification. Click Verify Land Before Buying to run live GIS, Oracle & NFT checks.',
      region: 'Zone 2',
      locationDescription: 'Waterfront Promenade Lot C, Victoria Annex, Zone 2',
      ownershipType: 'FREEHOLD',
      declaredAreaSqm: 27700,
      centroidLat: 6.52575,
      centroidLng: 3.38575,
      ring: [
        [3.385, 6.525],
        [3.3865, 6.525],
        [3.3865, 6.5265],
        [3.385, 6.5265],
        [3.385, 6.525],
      ],
      priceUsd: 12500,
      pricePol: 12.5,
      priceWei: '12500000000000000000',
      verified: false,
      deedFileName: 'victoria-waterfront-deed.pdf',
    },
    {
      seller: {
        fullName: 'Fatima Bello',
        email: 'fatima.bello@demo.anagu.local',
        nationalId: 'NID-1003-FAT',
        walletAddress: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
      },
      parcelName: 'Lekki Disputed Parcel D',
      headline: 'Lekki Disputed Parcel D',
      description: 'Demo disputed claim overlapping an active inheritance conflict record so buyers can test pre-purchase blocking.',
      region: 'Zone 3',
      locationDescription: 'Block 4 Expansion Corridor, Lekki, Zone 3',
      ownershipType: 'CUSTOMARY',
      declaredAreaSqm: 27700,
      centroidLat: 6.52275,
      centroidLng: 3.38175,
      ring: [
        [3.381, 6.522],
        [3.3825, 6.522],
        [3.3825, 6.5235],
        [3.381, 6.5235],
        [3.381, 6.522],
      ],
      priceUsd: 3200,
      pricePol: 3.2,
      priceWei: '3200000000000000000',
      verified: false,
      deedFileName: 'lekki-parcel-d-claim.pdf',
    },
  ];

  const year = new Date().getUTCFullYear();

  for (const item of demoParcels) {
    const seller = findOrCreateDemoSeller(item.seller);
    const appId = nextSequence(store, 'land_applications');
    const coordinatesGeojson = {
      type: 'Polygon',
      coordinates: [item.ring],
    };

    const application = {
      id: appId,
      reference_code: `ANG-APP-${year}-${String(appId).padStart(4, '0')}`,
      applicant_id: seller.id,
      parcel_name: item.parcelName,
      location_description: item.locationDescription,
      region: item.region,
      declared_area_sqm: item.declaredAreaSqm,
      ownership_type: item.ownershipType,
      claimant_name: item.seller.fullName,
      claimant_national_id: item.seller.nationalId,
      coordinates_geojson: coordinatesGeojson,
      status: item.verified ? 'TITLE_ISSUED' : 'SUBMITTED',
      rejection_reason: null,
      submitted_at: now,
      updated_at: now,
    };
    store.tables.land_applications.push(application);

    const docId = nextSequence(store, 'supporting_documents');
    store.tables.supporting_documents.push({
      id: docId,
      application_id: appId,
      uploaded_by: seller.id,
      document_type: 'DEED_OF_CONVEYANCE',
      file_name: item.deedFileName,
      mime_type: 'application/pdf',
      file_size_bytes: 24576,
      sha256_hash: createDemoSha256(`${item.parcelName}:${item.seller.nationalId}`),
      storage_path: `demo/${item.deedFileName}`,
      is_tampered_flag: false,
      uploaded_at: now,
    });

    let titleId = null;
    if (item.verified) {
      const parcelId = nextSequence(store, 'land_parcels');
      const zoneNum = String(item.region.match(/\d+/)?.[0] || '1');
      store.tables.land_parcels.push({
        id: parcelId,
        application_id: appId,
        parcel_code: `ANG-Z${zoneNum}-${String(parcelId).padStart(4, '0')}`,
        boundary_geojson: coordinatesGeojson,
        area_sqm: item.declaredAreaSqm,
        centroid_lat: item.centroidLat,
        centroid_lng: item.centroidLng,
        is_geometry_valid: true,
        overlap_checked: true,
        validated_by: seller.id,
        status: 'ACTIVE',
        created_at: now,
      });

      const verId = nextSequence(store, 'verification_records');
      store.tables.verification_records.push({
        id: verId,
        application_id: appId,
        verified_by: seller.id,
        oracle_match_score: item.oracleScore,
        oracle_conflict_detected: false,
        decision: 'APPROVED',
        remarks: item.oracleRemarks,
        verified_at: now,
      });

      titleId = nextSequence(store, 'land_titles');
      const tokenId = String(titleId);
      const titleNumber = `ANG-TITLE-${year}-${String(titleId).padStart(4, '0')}`;
      store.tables.land_titles.push({
        id: titleId,
        title_number: titleNumber,
        application_id: appId,
        parcel_id: parcelId,
        owner_id: seller.id,
        token_id: tokenId,
        contract_address: contractAddress,
        metadata_uri: `data:application/json;base64,${Buffer.from(
          JSON.stringify({
            name: `ANAGU Title · ${titleNumber}`,
            parcelName: item.parcelName,
            region: item.region,
          })
        ).toString('base64')}`,
        title_status: 'ACTIVE',
        issued_by: seller.id,
        issued_at: now,
      });
    }

    const listingId = nextSequence(store, 'land_listings');
    store.tables.land_listings.push({
      id: listingId,
      title_id: titleId,
      application_id: appId,
      seller_id: seller.id,
      seller_wallet: item.seller.walletAddress,
      buyer_id: null,
      buyer_wallet: null,
      price_wei: item.priceWei,
      price_pol: item.pricePol,
      price_usd: item.priceUsd,
      headline: item.headline,
      description: item.description,
      verification_status: item.verified ? 'VERIFIED' : 'PENDING_VERIFICATION',
      listing_status: 'LISTED',
      escrow_tx_hash: null,
      settlement_tx_hash: null,
      created_at: now,
      updated_at: now,
    });
  }

  saveLocalStore(store, storePath);
  return { seeded: true, count: demoParcels.length };
}

export async function ensureDemoMarketplaceDataAsync(storePath = getDefaultStorePath()) {
  if (env.pg.enabled) {
    return { seeded: false };
  }
  if (!isSupabaseActive()) {
    return ensureDemoMarketplaceData(storePath);
  }

  const supabase = getSupabaseClient();
  const { count, error: countError } = await supabase
    .from('land_listings')
    .select('id', { count: 'exact', head: true });
  assertNoSupabaseError(countError, 'Check Supabase land_listings count');
  if ((count || 0) > 0) {
    return { seeded: false, existingCount: count };
  }

  const now = new Date().toISOString();
  const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const { data: citizenRole, error: roleErr } = await supabase
    .from('roles')
    .select('id')
    .eq('code', 'CITIZEN')
    .single();
  assertNoSupabaseError(roleErr, 'Lookup CITIZEN role in Supabase');

  const findOrCreateDemoSeller = async ({ fullName, email, nationalId, walletAddress }) => {
    const cleanEmail = email.toLowerCase();
    const cleanNid = nationalId.toUpperCase();
    const { data: existingByEmail } = await supabase
      .from('users')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();
    const { data: existingByNid } = existingByEmail
      ? { data: existingByEmail }
      : await supabase.from('users').select('*').eq('national_id', cleanNid).maybeSingle();
    const existing = existingByEmail || existingByNid;
    if (existing) {
      if (!existing.wallet_address && walletAddress) {
        await supabase.from('users').update({ wallet_address: walletAddress }).eq('id', existing.id);
      }
      return existing;
    }

    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({
        role_id: citizenRole.id,
        full_name: fullName,
        email: cleanEmail,
        password_hash: '',
        national_id: cleanNid,
        phone: '+234-800-000-0000',
        wallet_address: walletAddress,
        is_active: true,
      })
      .select('*')
      .single();
    assertNoSupabaseError(createErr, 'Create demo seller in Supabase');
    return created;
  };

  const demoParcels = [
    {
      seller: {
        fullName: 'Amara Okafor',
        email: 'amara.okafor@demo.anagu.local',
        nationalId: 'NID-1001-AMA',
        walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      },
      parcelName: 'Yaba Commercial Plot A',
      headline: 'Yaba Commercial Plot A',
      description: 'Surveyed corner freehold parcel with verified municipal archive record and clean road access.',
      region: 'Zone 1',
      locationDescription: 'Plot 14 Commercial Avenue, Yaba District, Zone 1',
      ownershipType: 'FREEHOLD',
      declaredAreaSqm: 27700,
      centroidLat: 6.52075,
      centroidLng: 3.37575,
      ring: [
        [3.375, 6.52],
        [3.3765, 6.52],
        [3.3765, 6.5215],
        [3.375, 6.5215],
        [3.375, 6.52],
      ],
      priceUsd: 4500,
      pricePol: 4.5,
      priceWei: '4500000000000000000',
      verified: true,
      oracleScore: 96,
      oracleRemarks: 'Matched SAMPLE_MUNICIPAL_ARCHIVE (INST-2024-001) with intact SHA-256 conveyance deed.',
      deedFileName: 'yaba-plot-a-deed.pdf',
    },
    {
      seller: {
        fullName: 'Chidi Nwosu',
        email: 'chidi.nwosu@demo.anagu.local',
        nationalId: 'NID-1002-CHI',
        walletAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      },
      parcelName: 'Akoka Residential Plot B',
      headline: 'Akoka Residential Plot B',
      description: 'Community elders endorsed residential plot with clean GIS perimeter and active ERC-721 title.',
      region: 'Zone 1',
      locationDescription: '8 University Crescent, Akoka, Zone 1',
      ownershipType: 'CUSTOMARY',
      declaredAreaSqm: 27700,
      centroidLat: 6.52075,
      centroidLng: 3.37875,
      ring: [
        [3.378, 6.52],
        [3.3795, 6.52],
        [3.3795, 6.5215],
        [3.378, 6.5215],
        [3.378, 6.52],
      ],
      priceUsd: 6800,
      pricePol: 6.8,
      priceWei: '6800000000000000000',
      verified: true,
      oracleScore: 94,
      oracleRemarks: 'Matched SAMPLE_COMMUNITY_ELDERS_COUNCIL (COMM-2024-002) with zero boundary overlap.',
      deedFileName: 'akoka-plot-b-deed.pdf',
    },
    {
      seller: {
        fullName: 'Tunde Adeyemi',
        email: 'tunde.adeyemi@demo.anagu.local',
        nationalId: 'NID-DEMO-TUNDE',
        walletAddress: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
      },
      parcelName: 'Victoria Waterfront Lot C',
      headline: 'Victoria Waterfront Lot C',
      description: 'Waterfront lot posted prior to verification. Click Verify Land Before Buying to run live GIS, Oracle & NFT checks.',
      region: 'Zone 2',
      locationDescription: 'Waterfront Promenade Lot C, Victoria Annex, Zone 2',
      ownershipType: 'FREEHOLD',
      declaredAreaSqm: 27700,
      centroidLat: 6.52575,
      centroidLng: 3.38575,
      ring: [
        [3.385, 6.525],
        [3.3865, 6.525],
        [3.3865, 6.5265],
        [3.385, 6.5265],
        [3.385, 6.525],
      ],
      priceUsd: 12500,
      pricePol: 12.5,
      priceWei: '12500000000000000000',
      verified: false,
      deedFileName: 'victoria-waterfront-deed.pdf',
    },
    {
      seller: {
        fullName: 'Fatima Bello',
        email: 'fatima.bello@demo.anagu.local',
        nationalId: 'NID-1003-FAT',
        walletAddress: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
      },
      parcelName: 'Lekki Disputed Parcel D',
      headline: 'Lekki Disputed Parcel D',
      description: 'Demo disputed claim overlapping an active inheritance conflict record so buyers can test pre-purchase blocking.',
      region: 'Zone 3',
      locationDescription: 'Block 4 Expansion Corridor, Lekki, Zone 3',
      ownershipType: 'CUSTOMARY',
      declaredAreaSqm: 27700,
      centroidLat: 6.52275,
      centroidLng: 3.38175,
      ring: [
        [3.381, 6.522],
        [3.3825, 6.522],
        [3.3825, 6.5235],
        [3.381, 6.5235],
        [3.381, 6.522],
      ],
      priceUsd: 3200,
      pricePol: 3.2,
      priceWei: '3200000000000000000',
      verified: false,
      deedFileName: 'lekki-parcel-d-claim.pdf',
    },
  ];

  const year = new Date().getUTCFullYear();

  for (const item of demoParcels) {
    const seller = await findOrCreateDemoSeller(item.seller);
    const coordinatesGeojson = { type: 'Polygon', coordinates: [item.ring] };
    const tempRef = `ANG-APP-PENDING-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    const { data: insertedApp, error: appErr } = await supabase
      .from('land_applications')
      .insert({
        reference_code: tempRef,
        applicant_id: seller.id,
        parcel_name: item.parcelName,
        location_description: item.locationDescription,
        region: item.region,
        declared_area_sqm: item.declaredAreaSqm,
        ownership_type: item.ownershipType,
        claimant_name: item.seller.fullName,
        claimant_national_id: item.seller.nationalId,
        coordinates_geojson: coordinatesGeojson,
        status: item.verified ? 'TITLE_ISSUED' : 'SUBMITTED',
        rejection_reason: null,
      })
      .select('*')
      .single();
    assertNoSupabaseError(appErr, 'Seed demo land_application in Supabase');

    const refCode = `ANG-APP-${year}-${String(insertedApp.id).padStart(4, '0')}`;
    await supabase
      .from('land_applications')
      .update({ reference_code: refCode })
      .eq('id', insertedApp.id);

    const { error: docErr } = await supabase.from('supporting_documents').insert({
      application_id: insertedApp.id,
      uploaded_by: seller.id,
      document_type: 'DEED_OF_CONVEYANCE',
      file_name: item.deedFileName,
      mime_type: 'application/pdf',
      file_size_bytes: 24576,
      sha256_hash: createDemoSha256(`${item.parcelName}:${item.seller.nationalId}`),
      storage_path: `demo/${item.deedFileName}`,
      is_tampered_flag: false,
    });
    assertNoSupabaseError(docErr, 'Seed demo supporting_document in Supabase');

    let titleId = null;
    if (item.verified) {
      const zoneNum = String(item.region.match(/\d+/)?.[0] || '1');
      const tempParcelCode = `ANG-Z${zoneNum}-P-${insertedApp.id}`;
      const { data: parcel, error: parcelErr } = await supabase
        .from('land_parcels')
        .insert({
          application_id: insertedApp.id,
          parcel_code: tempParcelCode,
          boundary_geojson: coordinatesGeojson,
          area_sqm: item.declaredAreaSqm,
          centroid_lat: item.centroidLat,
          centroid_lng: item.centroidLng,
          is_geometry_valid: true,
          overlap_checked: true,
          validated_by: seller.id,
          validated_at: now,
          status: 'ACTIVE',
        })
        .select('*')
        .single();
      assertNoSupabaseError(parcelErr, 'Seed demo land_parcel in Supabase');

      const finalParcelCode = `ANG-Z${zoneNum}-${String(parcel.id).padStart(4, '0')}`;
      await supabase
        .from('land_parcels')
        .update({ parcel_code: finalParcelCode })
        .eq('id', parcel.id);

      const { error: verErr } = await supabase.from('verification_records').insert({
        application_id: insertedApp.id,
        officer_id: seller.id,
        oracle_match_score: item.oracleScore,
        conflict_detected: false,
        decision: 'APPROVED',
        remarks: item.oracleRemarks,
      });
      assertNoSupabaseError(verErr, 'Seed demo verification_record in Supabase');

      const tempTitleNum = `ANG-TITLE-PENDING-${insertedApp.id}`;
      const { data: title, error: titleErr } = await supabase
        .from('land_titles')
        .insert({
          title_number: tempTitleNum,
          application_id: insertedApp.id,
          parcel_id: parcel.id,
          owner_id: seller.id,
          token_id: String(parcel.id),
          contract_address: contractAddress,
          metadata_uri: 'data:application/json;base64,e30=',
          title_status: 'ACTIVE',
          issued_by: seller.id,
        })
        .select('*')
        .single();
      assertNoSupabaseError(titleErr, 'Seed demo land_title in Supabase');

      titleId = title.id;
      const titleNumber = `ANG-TITLE-${year}-${String(titleId).padStart(4, '0')}`;
      const metadataUri = `data:application/json;base64,${Buffer.from(
        JSON.stringify({
          name: `ANAGU Title · ${titleNumber}`,
          parcelName: item.parcelName,
          region: item.region,
        })
      ).toString('base64')}`;
      await supabase
        .from('land_titles')
        .update({ title_number: titleNumber, token_id: String(titleId), metadata_uri: metadataUri })
        .eq('id', titleId);
    }

    const { error: listingErr } = await supabase.from('land_listings').insert({
      title_id: titleId,
      application_id: insertedApp.id,
      seller_id: seller.id,
      seller_wallet: item.seller.walletAddress,
      price_wei: item.priceWei,
      price_pol: item.pricePol,
      price_usd: item.priceUsd,
      headline: item.headline,
      description: item.description,
      verification_status: item.verified ? 'VERIFIED' : 'PENDING_VERIFICATION',
      listing_status: 'LISTED',
    });
    assertNoSupabaseError(listingErr, 'Seed demo land_listing in Supabase');
  }

  return { seeded: true, count: demoParcels.length, target: 'supabase' };
}


