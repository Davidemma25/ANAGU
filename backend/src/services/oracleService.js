import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, saveLocalStore, nextSequence } from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';
import {
  findApplicationById,
  recordLocalApplicationStatusHistory,
  transitionApplicationStatus,
} from '../models/applicationModel.js';
import { readSupportingDocumentFile } from './documentStorage.js';
import { estimateOverlapSqm } from './gisService.js';

export const ALLOWED_VERIFICATION_DECISIONS = ['APPROVED', 'REJECTED', 'FLAGGED_CONFLICT'];
export const ALLOWED_CLAIM_STATUSES = ['ACTIVE_RECORD', 'DISPUTED', 'HISTORICAL'];

async function attachStoredDocumentContent(documents) {
  return Promise.all(
    documents.map(async (document) => {
      if (!document.storage_bucket) return document;
      const documentContent = await readSupportingDocumentFile(document);
      if (!documentContent) {
        throw new Error(`Supporting document ${document.id} is missing from private storage.`);
      }
      return { ...document, documentContent };
    })
  );
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

/**
 * Pure verification check across supporting documents (SHA-256 integrity)
 * and sample institutional/community ownership_records.
 */
export function evaluateOwnershipClaim({
  application,
  documents = [],
  ownershipRecords = [],
  parcel = null,
  priorVerifications = [],
  verifyFilesOnDisk = true,
}) {
  const startedAt = performance.now();
  const appRing = application?.coordinates_geojson?.coordinates?.[0] || [];
  const claimantNameNorm = normalizeText(application?.claimant_name);
  const claimantIdNorm = normalizeId(application?.claimant_national_id);

  // 1. Document SHA-256 & tamper verification (Fraud Scenario 1)
  const documentChecks = documents.map((doc) => {
    let diskHashMismatch = false;
    let storageHashMismatch = false;
    let filePresentOnDisk = false;
    let filePresentInStorage = false;

    if (doc.documentContent) {
      filePresentInStorage = true;
      const storedSha256 = crypto
        .createHash('sha256')
        .update(doc.documentContent)
        .digest('hex');
      storageHashMismatch = storedSha256 !== doc.sha256_hash;
    } else if (verifyFilesOnDisk && doc.storage_path) {
      const resolvedPath = path.resolve(process.cwd(), doc.storage_path);
      if (fs.existsSync(resolvedPath)) {
        filePresentOnDisk = true;
        const fileBuf = fs.readFileSync(resolvedPath);
        const liveSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
        if (liveSha256 !== doc.sha256_hash) {
          diskHashMismatch = true;
        }
      }
    }

    const tampered =
      Boolean(doc.is_tampered_flag) || diskHashMismatch || storageHashMismatch;
    return {
      documentId: doc.id,
      fileName: doc.file_name,
      documentType: doc.document_type,
      sha256Hash: doc.sha256_hash,
      filePresentOnDisk,
      filePresentInStorage,
      isTamperedFlag: Boolean(doc.is_tampered_flag),
      diskHashMismatch,
      storageHashMismatch,
      integrityStatus: tampered ? 'TAMPERED' : 'INTACT',
    };
  });

  const tamperedDocs = documentChecks.filter((d) => d.integrityStatus === 'TAMPERED');

  // 2. Cross-reference sample institutional & community ownership records
  const candidateMatches = ownershipRecords
    .map((record) => {
      const recRing = record.boundary_geojson?.coordinates?.[0] || [];
      const overlapAreaSqm =
        appRing.length >= 4 && recRing.length >= 4 ? estimateOverlapSqm(appRing, recRing) : 0;
      const spatialMatch = overlapAreaSqm > 1.0;
      const nationalIdMatch =
        Boolean(claimantIdNorm) && normalizeId(record.owner_national_id) === claimantIdNorm;
      const nameMatch =
        Boolean(claimantNameNorm) &&
        normalizeText(record.registered_owner_name) === claimantNameNorm;

      let score = 0;
      if (spatialMatch) score += 50;
      if (nationalIdMatch) score += 35;
      if (nameMatch) score += 15;

      return {
        record,
        overlapAreaSqm,
        spatialMatch,
        nationalIdMatch,
        nameMatch,
        rawScore: score,
      };
    })
    .filter((m) => m.spatialMatch || m.nationalIdMatch || m.nameMatch)
    .sort((a, b) => b.rawScore - a.rawScore);

  const bestMatch = candidateMatches[0] || null;
  const conflicts = [];

  if (tamperedDocs.length > 0) {
    conflicts.push({
      type: 'TAMPERED_DOCUMENT',
      severity: 'HIGH',
      message: `Document integrity failure on ${tamperedDocs.map((d) => d.fileName).join(', ')} (SHA-256 mismatch or tamper flag detected).`,
    });
  }

  for (const match of candidateMatches) {
    const rec = match.record;
    if (rec.claim_status === 'DISPUTED' && (match.spatialMatch || match.nationalIdMatch)) {
      conflicts.push({
        type: 'DISPUTED_ARCHIVE_RECORD',
        severity: 'HIGH',
        sourceReference: rec.source_reference,
        message: `Archive record ${rec.source_reference} (${rec.record_source}) is marked DISPUTED: ${rec.notes || 'Existing ownership dispute on file.'}`,
      });
    } else if (
      match.spatialMatch &&
      !match.nationalIdMatch &&
      !match.nameMatch &&
      rec.claim_status === 'ACTIVE_RECORD'
    ) {
      conflicts.push({
        type: 'OWNER_IDENTITY_MISMATCH',
        severity: 'HIGH',
        sourceReference: rec.source_reference,
        message: `Parcel overlaps (~${match.overlapAreaSqm} m²) active archive record ${rec.source_reference} registered to ${rec.registered_owner_name} (${rec.owner_national_id}), conflicting with claimant ${application.claimant_name} (${application.claimant_national_id}).`,
      });
    } else if (match.nationalIdMatch && !match.spatialMatch && rec.boundary_geojson) {
      conflicts.push({
        type: 'PARCEL_BOUNDARY_MISMATCH',
        severity: 'MEDIUM',
        sourceReference: rec.source_reference,
        message: `Claimant National ID matches ${rec.source_reference}, but submitted coordinates do not align spatially with the archive boundary.`,
      });
    }
  }

  const priorConflicts = priorVerifications.filter((v) => v.decision !== 'APPROVED');
  if (priorConflicts.length > 0) {
    conflicts.push({
      type: 'PRIOR_CONFLICT_HISTORY',
      severity: 'MEDIUM',
      message: `${priorConflicts.length} prior non-approved verification record(s) exist on this claim.`,
    });
  }

  const conflictDetected = conflicts.some((c) => c.severity === 'HIGH') || conflicts.length > 0;

  let oracleMatchScore;
  if (tamperedDocs.length > 0) {
    oracleMatchScore = 15.0;
  } else if (conflicts.some((c) => c.severity === 'HIGH')) {
    oracleMatchScore = 30.0;
  } else if (bestMatch && bestMatch.spatialMatch && (bestMatch.nationalIdMatch || bestMatch.nameMatch)) {
    oracleMatchScore = documentChecks.length > 0 ? 98.0 : 90.0;
  } else if (bestMatch && bestMatch.nationalIdMatch) {
    oracleMatchScore = 78.0;
  } else {
    oracleMatchScore = documentChecks.length > 0 ? 75.0 : 65.0;
  }

  let recommendedDecision = 'APPROVED';
  if (tamperedDocs.length > 0) {
    recommendedDecision = 'REJECTED';
  } else if (conflictDetected) {
    recommendedDecision = 'FLAGGED_CONFLICT';
  }

  const executionTimeMs = Number((performance.now() - startedAt).toFixed(2));

  return {
    applicationId: application.id,
    referenceCode: application.reference_code,
    parcelCode: parcel?.parcel_code || null,
    oracleMatchScore: Number(oracleMatchScore.toFixed(2)),
    conflictDetected,
    conflicts,
    recommendedDecision,
    executionTimeMs,
    documentsSummary: {
      totalDocuments: documentChecks.length,
      intactCount: documentChecks.filter((d) => d.integrityStatus === 'INTACT').length,
      tamperedCount: tamperedDocs.length,
      checks: documentChecks,
    },
    matchedRecord: bestMatch
      ? {
          id: bestMatch.record.id,
          sourceReference: bestMatch.record.source_reference,
          recordSource: bestMatch.record.record_source,
          parcelCode: bestMatch.record.parcel_code,
          registeredOwnerName: bestMatch.record.registered_owner_name,
          ownerNationalId: bestMatch.record.owner_national_id,
          claimStatus: bestMatch.record.claim_status,
          isSampleRecord: Boolean(bestMatch.record.is_sample_record),
          spatialMatch: bestMatch.spatialMatch,
          overlapAreaSqm: bestMatch.overlapAreaSqm,
          nationalIdMatch: bestMatch.nationalIdMatch,
          nameMatch: bestMatch.nameMatch,
          notes: bestMatch.record.notes,
        }
      : null,
  };
}

export async function listOwnershipRecords() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM ownership_records ORDER BY id ASC');
    return res.rows;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('ownership_records')
      .select('*')
      .order('id', { ascending: true });
    assertNoSupabaseError(error, 'List ownership records');
    return data || [];
  }
  const store = loadLocalStore();
  return [...(store.tables.ownership_records || [])].sort((a, b) => a.id - b.id);
}

export async function createSampleOwnershipRecord({
  recordSource,
  sourceReference,
  parcelCode = '',
  registeredOwnerName,
  ownerNationalId,
  boundaryGeojson = null,
  claimStatus = 'ACTIVE_RECORD',
  notes = '',
}) {
  if (!ALLOWED_CLAIM_STATUSES.includes(claimStatus)) {
    throw new Error(`claimStatus must be one of: ${ALLOWED_CLAIM_STATUSES.join(', ')}`);
  }

  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO ownership_records (
        record_source, source_reference, parcel_code, registered_owner_name,
        owner_national_id, boundary_geojson, claim_status, notes, is_sample_record
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,TRUE)
      RETURNING *`,
      [
        recordSource.trim(),
        sourceReference.trim().toUpperCase(),
        parcelCode.trim() || null,
        registeredOwnerName.trim(),
        ownerNationalId.trim().toUpperCase(),
        boundaryGeojson ? JSON.stringify(boundaryGeojson) : null,
        claimStatus,
        notes.trim(),
      ]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const cleanRef = sourceReference.trim().toUpperCase();
    const { data: existing } = await sb
      .from('ownership_records')
      .select('id')
      .eq('source_reference', cleanRef)
      .maybeSingle();
    if (existing) {
      const err = new Error('A sample record with that source reference already exists.');
      err.code = 'DUPLICATE_SOURCE_REF';
      throw err;
    }

    const { data, error } = await sb
      .from('ownership_records')
      .insert({
        record_source: recordSource.trim(),
        source_reference: cleanRef,
        parcel_code: parcelCode.trim() || null,
        registered_owner_name: registeredOwnerName.trim(),
        owner_national_id: ownerNationalId.trim().toUpperCase(),
        boundary_geojson: boundaryGeojson || null,
        claim_status: claimStatus,
        notes: notes.trim(),
        is_sample_record: true,
      })
      .select('*')
      .single();
    if (error?.code === '23505') {
      const err = new Error('A sample record with that source reference already exists.');
      err.code = 'DUPLICATE_SOURCE_REF';
      throw err;
    }
    assertNoSupabaseError(error, 'Create sample ownership record');
    return data;
  }

  const store = loadLocalStore();
  const duplicate = (store.tables.ownership_records || []).find(
    (r) => r.source_reference.toUpperCase() === sourceReference.trim().toUpperCase()
  );
  if (duplicate) {
    const err = new Error('A sample record with that source reference already exists.');
    err.code = 'DUPLICATE_SOURCE_REF';
    throw err;
  }

  const record = {
    id: nextSequence(store, 'ownership_records'),
    record_source: recordSource.trim(),
    source_reference: sourceReference.trim().toUpperCase(),
    parcel_code: parcelCode.trim() || null,
    registered_owner_name: registeredOwnerName.trim(),
    owner_national_id: ownerNationalId.trim().toUpperCase(),
    boundary_geojson: boundaryGeojson || null,
    claim_status: claimStatus,
    notes: notes.trim(),
    is_sample_record: true,
    created_at: new Date().toISOString(),
  };
  store.tables.ownership_records.push(record);
  saveLocalStore(store);
  return record;
}

export async function runOracleEvaluation(applicationId) {
  const numericId = Number(applicationId);

  if (env.pg.enabled) {
    const pool = getPgPool();
    const [appRes, docRes, parcelRes, recRes, verRes] = await Promise.all([
      pool.query('SELECT * FROM land_applications WHERE id = $1 LIMIT 1', [numericId]),
      pool.query('SELECT * FROM supporting_documents WHERE application_id = $1', [numericId]),
      pool.query('SELECT * FROM land_parcels WHERE application_id = $1 LIMIT 1', [numericId]),
      pool.query('SELECT * FROM ownership_records ORDER BY id ASC'),
      pool.query(
        'SELECT * FROM verification_records WHERE application_id = $1 ORDER BY verified_at DESC',
        [numericId]
      ),
    ]);
    const application = appRes.rows[0];
    if (!application) return null;

    const documents = await attachStoredDocumentContent(docRes.rows);
    return evaluateOwnershipClaim({
      application,
      documents,
      ownershipRecords: recRes.rows,
      parcel: parcelRes.rows[0] || null,
      priorVerifications: verRes.rows,
    });
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [appRes, docRes, parcelRes, recRes, verRes] = await Promise.all([
      sb.from('land_applications').select('*').eq('id', numericId).maybeSingle(),
      sb.from('supporting_documents').select('*').eq('application_id', numericId),
      sb.from('land_parcels').select('*').eq('application_id', numericId).maybeSingle(),
      sb.from('ownership_records').select('*').order('id', { ascending: true }),
      sb
        .from('verification_records')
        .select('*')
        .eq('application_id', numericId)
        .order('verified_at', { ascending: false }),
    ]);
    assertNoSupabaseError(appRes.error, 'Oracle fetch application');
    assertNoSupabaseError(docRes.error, 'Oracle fetch documents');
    assertNoSupabaseError(parcelRes.error, 'Oracle fetch parcel');
    assertNoSupabaseError(recRes.error, 'Oracle fetch ownership records');
    assertNoSupabaseError(verRes.error, 'Oracle fetch prior verifications');

    const application = appRes.data;
    if (!application) return null;

    const documents = await attachStoredDocumentContent(docRes.data || []);
    return evaluateOwnershipClaim({
      application,
      documents,
      ownershipRecords: recRes.data || [],
      parcel: parcelRes.data || null,
      priorVerifications: verRes.data || [],
    });
  }

  const store = loadLocalStore();
  const application = (store.tables.land_applications || []).find((a) => a.id === numericId);
  if (!application) return null;

  const documents = (store.tables.supporting_documents || []).filter(
    (d) => d.application_id === numericId
  );
  const parcel = (store.tables.land_parcels || []).find((p) => p.application_id === numericId) || null;
  const ownershipRecords = store.tables.ownership_records || [];
  const priorVerifications = (store.tables.verification_records || []).filter(
    (v) => v.application_id === numericId
  );

  return evaluateOwnershipClaim({
    application,
    documents,
    ownershipRecords,
    parcel,
    priorVerifications,
  });
}

export async function findSupportingDocumentById(documentId) {
  const numericId = Number(documentId);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM supporting_documents WHERE id = $1 LIMIT 1', [
      numericId,
    ]);
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('supporting_documents')
      .select('*')
      .eq('id', numericId)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find supporting document');
    return data || null;
  }
  const store = loadLocalStore();
  return (store.tables.supporting_documents || []).find((d) => d.id === numericId) || null;
}

export async function listVerificationQueue() {
  const targetStatuses = [
    'SUBMITTED',
    'GIS_VALIDATED',
    'VERIFIED',
    'VERIFICATION_REJECTED',
    'APPROVED',
    'TITLE_ISSUED',
  ];

  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT la.*, lp.parcel_code, lp.area_sqm,
              (SELECT COUNT(*)::int FROM supporting_documents sd WHERE sd.application_id = la.id) AS document_count,
              (SELECT vr.decision FROM verification_records vr WHERE vr.application_id = la.id ORDER BY vr.verified_at DESC LIMIT 1) AS latest_decision,
              (SELECT vr.oracle_match_score FROM verification_records vr WHERE vr.application_id = la.id ORDER BY vr.verified_at DESC LIMIT 1) AS latest_score,
              (SELECT json_build_object(
                 'id', ll.id,
                 'price_usd', ll.price_usd,
                 'price_pol', ll.price_pol,
                 'headline', ll.headline,
                 'verification_status', ll.verification_status,
                 'listing_status', ll.listing_status
               )
               FROM land_listings ll
               WHERE ll.application_id = la.id
               ORDER BY ll.id DESC LIMIT 1) AS pending_listing
       FROM land_applications la
       LEFT JOIN land_parcels lp ON lp.application_id = la.id
       WHERE la.status = ANY($1)
       ORDER BY
         CASE
           WHEN la.status = 'SUBMITTED' THEN 0
           WHEN la.status = 'GIS_VALIDATED' THEN 1
           ELSE 2
         END,
         la.updated_at DESC`,
      [targetStatuses]
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [appsRes, parcelsRes, docsRes, verRes, listingsRes] = await Promise.all([
      sb
        .from('land_applications')
        .select('*')
        .in('status', targetStatuses)
        .order('updated_at', { ascending: false }),
      sb.from('land_parcels').select('application_id, parcel_code, area_sqm'),
      sb.from('supporting_documents').select('application_id'),
      sb
        .from('verification_records')
        .select('application_id, decision, oracle_match_score, verified_at')
        .order('verified_at', { ascending: false }),
      sb
        .from('land_listings')
        .select('id, application_id, price_usd, price_pol, headline, verification_status, listing_status')
        .order('id', { ascending: true }),
    ]);
    assertNoSupabaseError(appsRes.error, 'List verification queue applications');
    assertNoSupabaseError(parcelsRes.error, 'List verification queue parcels');
    assertNoSupabaseError(docsRes.error, 'List verification queue documents');
    assertNoSupabaseError(verRes.error, 'List verification queue records');
    assertNoSupabaseError(listingsRes.error, 'List verification queue listings');

    const parcelsByApp = new Map((parcelsRes.data || []).map((p) => [p.application_id, p]));
    const docCounts = new Map();
    for (const d of docsRes.data || []) {
      docCounts.set(d.application_id, (docCounts.get(d.application_id) || 0) + 1);
    }
    const latestVerByApp = new Map();
    for (const v of verRes.data || []) {
      if (!latestVerByApp.has(v.application_id)) {
        latestVerByApp.set(v.application_id, v);
      }
    }
    const listingsByApp = new Map();
    for (const ll of listingsRes.data || []) {
      if (ll.application_id) {
        listingsByApp.set(ll.application_id, ll);
      }
    }

    const priorityRank = (app) => {
      const ll = listingsByApp.get(app.id);
      if (ll?.verification_status === 'PENDING_ADMIN_APPROVAL') return 0;
      if (app.status === 'SUBMITTED') return 1;
      if (app.status === 'GIS_VALIDATED') return 2;
      return 3;
    };

    return (appsRes.data || [])
      .sort((a, b) => {
        const rankDiff = priorityRank(a) - priorityRank(b);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.updated_at || b.submitted_at) - new Date(a.updated_at || a.submitted_at);
      })
      .map((app) => {
        const parcel = parcelsByApp.get(app.id);
        const latestVer = latestVerByApp.get(app.id);
        const ll = listingsByApp.get(app.id) || null;
        return {
          ...app,
          parcel_code: parcel?.parcel_code || null,
          area_sqm: parcel?.area_sqm || app.declared_area_sqm || null,
          document_count: docCounts.get(app.id) || 0,
          latest_decision: latestVer?.decision || null,
          latest_score: latestVer?.oracle_match_score ?? null,
          pending_listing: ll
            ? {
                id: ll.id,
                price_usd: ll.price_usd,
                price_pol: ll.price_pol,
                headline: ll.headline,
                verification_status: ll.verification_status,
                listing_status: ll.listing_status,
              }
            : null,
        };
      });
  }

  const store = loadLocalStore();
  const parcelsByApp = new Map((store.tables.land_parcels || []).map((p) => [p.application_id, p]));
  const docs = store.tables.supporting_documents || [];
  const verifications = store.tables.verification_records || [];
  const listingsByApp = new Map();
  for (const ll of store.tables.land_listings || []) {
    if (ll.application_id) {
      listingsByApp.set(ll.application_id, ll);
    }
  }

  const priorityRank = (app) => {
    const ll = listingsByApp.get(app.id);
    if (ll?.verification_status === 'PENDING_ADMIN_APPROVAL') return 0;
    if (app.status === 'SUBMITTED') return 1;
    if (app.status === 'GIS_VALIDATED') return 2;
    return 3;
  };

  return (store.tables.land_applications || [])
    .filter((a) => targetStatuses.includes(a.status))
    .sort((a, b) => {
      const rankDiff = priorityRank(a) - priorityRank(b);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.updated_at || b.submitted_at) - new Date(a.updated_at || a.submitted_at);
    })
    .map((app) => {
      const parcel = parcelsByApp.get(app.id);
      const appVers = verifications
        .filter((v) => v.application_id === app.id)
        .sort((x, y) => new Date(y.verified_at) - new Date(x.verified_at));
      const ll = listingsByApp.get(app.id) || null;
      return {
        ...app,
        parcel_code: parcel?.parcel_code || null,
        area_sqm: parcel?.area_sqm || app.declared_area_sqm || null,
        document_count: docs.filter((d) => d.application_id === app.id).length,
        latest_decision: appVers[0]?.decision || null,
        latest_score: appVers[0]?.oracle_match_score ?? null,
        pending_listing: ll
          ? {
              id: ll.id,
              price_usd: ll.price_usd,
              price_pol: ll.price_pol,
              headline: ll.headline,
              verification_status: ll.verification_status,
              listing_status: ll.listing_status,
            }
          : null,
      };
    });
}

export async function listVerificationHistory(applicationId) {
  const numericId = Number(applicationId);
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT vr.*, u.full_name AS officer_name,
              orr.source_reference AS matched_source_reference,
              orr.record_source AS matched_record_source
       FROM verification_records vr
       JOIN users u ON u.id = vr.officer_id
       LEFT JOIN ownership_records orr ON orr.id = vr.matched_record_id
       WHERE vr.application_id = $1
       ORDER BY vr.verified_at DESC`,
      [numericId]
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [verRes, usersRes, recsRes] = await Promise.all([
      sb
        .from('verification_records')
        .select('*')
        .eq('application_id', numericId)
        .order('verified_at', { ascending: false }),
      sb.from('users').select('id, full_name'),
      sb.from('ownership_records').select('id, source_reference, record_source'),
    ]);
    assertNoSupabaseError(verRes.error, 'List verification history');
    assertNoSupabaseError(usersRes.error, 'List verification users');
    assertNoSupabaseError(recsRes.error, 'List verification ownership records');

    const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));
    const recsById = new Map((recsRes.data || []).map((r) => [r.id, r]));

    return (verRes.data || []).map((v) => {
      const officer = usersById.get(v.officer_id);
      const matched = recsById.get(v.matched_record_id);
      return {
        ...v,
        officer_name: officer?.full_name || 'Officer',
        matched_source_reference: matched?.source_reference || null,
        matched_record_source: matched?.record_source || null,
      };
    });
  }

  const store = loadLocalStore();
  const usersById = new Map((store.tables.users || []).map((u) => [u.id, u]));
  const recsById = new Map((store.tables.ownership_records || []).map((r) => [r.id, r]));

  return (store.tables.verification_records || [])
    .filter((v) => v.application_id === numericId)
    .sort((a, b) => new Date(b.verified_at) - new Date(a.verified_at))
    .map((v) => {
      const officer = usersById.get(v.officer_id);
      const matched = recsById.get(v.matched_record_id);
      return {
        ...v,
        officer_name: officer?.full_name || 'Officer',
        matched_source_reference: matched?.source_reference || null,
        matched_record_source: matched?.record_source || null,
      };
    });
}

export async function submitVerificationDecision({
  applicationId,
  officerId,
  actorRole = 'SYSTEM',
  decision,
  remarks,
}) {
  const numericId = Number(applicationId);
  const oracle = await runOracleEvaluation(numericId);
  if (!oracle) {
    const err = new Error('Land application not found.');
    err.status = 404;
    throw err;
  }

  if (decision === 'APPROVED' && oracle.conflictDetected) {
    const err = new Error(
      'Oracle detected unresolved ownership or document integrity conflict. Direct approval is blocked and logged as a potential collusion risk; flag conflict or reject instead.'
    );
    err.status = 409;
    err.code = 'ORACLE_CONFLICT_OVERRIDE_BLOCKED';
    err.oracle = oracle;
    throw err;
  }

  const nextAppStatus = decision === 'APPROVED' ? 'VERIFIED' : 'VERIFICATION_REJECTED';
  const rejectionReason =
    decision === 'APPROVED'
      ? null
      : oracle.conflicts[0]?.message || remarks.trim();

  if (env.pg.enabled) {
    const pool = getPgPool();
    const verRes = await pool.query(
      `INSERT INTO verification_records (
        application_id, officer_id, matched_record_id, oracle_match_score,
        conflict_detected, conflict_details, decision, remarks
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
      RETURNING *`,
      [
        numericId,
        officerId,
        oracle.matchedRecord?.id || null,
        oracle.oracleMatchScore,
        oracle.conflictDetected,
        JSON.stringify(oracle.conflicts),
        decision,
        remarks.trim(),
      ]
    );

    const currentApplication = await findApplicationById(numericId);
    if (!currentApplication) {
      const err = new Error('Land application not found.');
      err.status = 404;
      throw err;
    }
    const application = await transitionApplicationStatus({
      applicationId: numericId,
      expectedStatus: currentApplication.status,
      nextStatus: nextAppStatus,
      changedBy: officerId,
      actorRole,
      reason: rejectionReason || remarks.trim(),
    });

    return {
      verification: verRes.rows[0],
      application,
      oracle,
    };
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data: verification, error: verErr } = await sb
      .from('verification_records')
      .insert({
        application_id: numericId,
        officer_id: officerId,
        matched_record_id: oracle.matchedRecord?.id || null,
        oracle_match_score: oracle.oracleMatchScore,
        conflict_detected: oracle.conflictDetected,
        conflict_details: oracle.conflicts,
        decision,
        remarks: remarks.trim(),
      })
      .select('*')
      .single();
    assertNoSupabaseError(verErr, 'Insert verification decision');

    const currentApplication = await findApplicationById(numericId);
    if (!currentApplication) {
      const err = new Error('Land application not found.');
      err.status = 404;
      throw err;
    }
    const application = await transitionApplicationStatus({
      applicationId: numericId,
      expectedStatus: currentApplication.status,
      nextStatus: nextAppStatus,
      changedBy: officerId,
      actorRole,
      reason: rejectionReason || remarks.trim(),
    });

    return { verification, application, oracle };
  }

  const store = loadLocalStore();
  const appRecord = (store.tables.land_applications || []).find((a) => a.id === numericId);
  const now = new Date().toISOString();

  const verification = {
    id: nextSequence(store, 'verification_records'),
    application_id: numericId,
    officer_id: officerId,
    matched_record_id: oracle.matchedRecord?.id || null,
    oracle_match_score: oracle.oracleMatchScore,
    conflict_detected: oracle.conflictDetected,
    conflict_details: oracle.conflicts,
    decision,
    remarks: remarks.trim(),
    verified_at: now,
  };
  store.tables.verification_records.push(verification);

  const previousStatus = appRecord.status;
  appRecord.status = nextAppStatus;
  appRecord.rejection_reason = rejectionReason;
  appRecord.updated_at = now;
  recordLocalApplicationStatusHistory(
    store,
    appRecord,
    previousStatus,
    nextAppStatus,
    officerId,
    actorRole,
    remarks.trim()
  );
  saveLocalStore(store);

  return {
    verification,
    application: appRecord,
    oracle,
  };
}
