import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, saveLocalStore, nextSequence } from '../config/db.js';
import { assertNoSupabaseError, getSupabaseClient, isSupabaseActive } from '../config/supabase.js';
import {
  removeSupportingDocumentFile,
  storeSupportingDocumentFile,
} from '../services/documentStorage.js';

export const ALLOWED_OWNERSHIP_TYPES = ['FREEHOLD', 'CUSTOMARY', 'LEASEHOLD', 'FAMILY_TRUST'];
const ALLOWED_BOUNDARY_SOURCES = ['MAP_DRAWING', 'MANUAL_GPS', 'SURVEY_PLAN'];

export function normalizeBoundarySource(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!ALLOWED_BOUNDARY_SOURCES.includes(normalized)) {
    throw new Error(`Boundary source must be one of: ${ALLOWED_BOUNDARY_SOURCES.join(', ')}.`);
  }
  return normalized;
}

function recordLocalApplicationBoundaryVersion(store, application, changedBy, reason) {
  const versions = store.tables.parcel_boundary_versions || [];
  const boundary = JSON.parse(JSON.stringify(application.coordinates_geojson));
  const geometryHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(boundary))
    .digest('hex');
  const applicationVersions = versions.filter(
    (version) => version.application_id === application.id
  );
  const latest = applicationVersions.reduce(
    (current, version) =>
      !current || version.version_number > current.version_number ? version : current,
    null
  );
  if (latest?.geometry_hash === geometryHash) return latest;

  const versionNumber = (latest?.version_number || 0) + 1;
  versions.push({
    id: nextSequence(store, 'parcel_boundary_versions'),
    parcel_id: null,
    application_id: application.id,
    version_number: versionNumber,
    boundary_geojson: boundary,
    geometry_hash: geometryHash,
    boundary_source: application.boundary_source,
    change_reason: reason,
    changed_by: changedBy,
    created_at: new Date().toISOString(),
  });
  store.tables.parcel_boundary_versions = versions;
}

export function normalizeGeoJsonPolygon(rawInput) {
  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      throw new Error('Coordinates must be valid JSON GeoJSON or an array of [lng, lat] pairs.');
    }
  }

  let ring;
  if (Array.isArray(parsed)) {
    ring = parsed;
  } else if (parsed && parsed.type === 'Polygon' && Array.isArray(parsed.coordinates?.[0])) {
    ring = parsed.coordinates[0];
  } else {
    throw new Error('Provide a GeoJSON Polygon or an array of [longitude, latitude] coordinates.');
  }

  if (ring.length < 4) {
    throw new Error('A polygon boundary requires at least 4 coordinate pairs (first and last matching).');
  }

  const normalizedRing = ring.map((pt, idx) => {
    if (!Array.isArray(pt) || pt.length < 2) {
      throw new Error(`Coordinate #${idx + 1} must be [longitude, latitude].`);
    }
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new Error(`Coordinate #${idx + 1} contains non-numeric values.`);
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error(`Coordinate #${idx + 1} is out of WGS84 bounds (lng -180..180, lat -90..90).`);
    }
    return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
  });

  const first = normalizedRing[0];
  const last = normalizedRing[normalizedRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error('Polygon boundary ring must be closed (first and last coordinate must match).');
  }

  return {
    type: 'Polygon',
    coordinates: [normalizedRing],
  };
}

export function generateReferenceCode(id) {
  const year = new Date().getUTCFullYear();
  return `ANG-APP-${year}-${String(id).padStart(4, '0')}`;
}

export function recordLocalApplicationStatusHistory(
  store,
  application,
  fromStatus,
  toStatus,
  changedBy,
  actorRole,
  reason
) {
  const history = store.tables.application_status_history || [];
  history.push({
    id: nextSequence(store, 'application_status_history'),
    application_id: application.id,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy,
    actor_role: actorRole,
    reason,
    created_at: new Date().toISOString(),
  });
  store.tables.application_status_history = history;
}

export async function createApplication({
  applicantId,
  parcelName,
  locationDescription,
  region,
  declaredAreaSqm,
  ownershipType,
  claimantName,
  claimantNationalId,
  coordinatesGeojson,
  stateId = null,
  lgaId = null,
  communityId = null,
  boundarySource = null,
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const tempRef = `ANG-APP-PENDING-${Date.now()}`;
    const insertRes = await pool.query(
      `INSERT INTO land_applications (
        reference_code, applicant_id, parcel_name, location_description, region,
        declared_area_sqm, ownership_type, claimant_name, claimant_national_id,
        coordinates_geojson, state_id, lga_id, community_id, boundary_source,
        boundary_change_reason, boundary_changed_by, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,'SUBMITTED')
      RETURNING *`,
      [
        tempRef,
        applicantId,
        parcelName.trim(),
        locationDescription.trim(),
        region.trim(),
        Number(declaredAreaSqm),
        ownershipType,
        claimantName.trim(),
        claimantNationalId.trim().toUpperCase(),
        JSON.stringify(coordinatesGeojson),
        stateId,
        lgaId,
        communityId,
        boundarySource,
        'Boundary submitted with application',
        applicantId,
      ]
    );
    const created = insertRes.rows[0];
    const refCode = generateReferenceCode(created.id);
    const updated = await pool.query(
      'UPDATE land_applications SET reference_code = $1 WHERE id = $2 RETURNING *',
      [refCode, created.id]
    );
    return updated.rows[0];
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const tempRef = `ANG-APP-PENDING-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const { data: created, error: insErr } = await supabase
      .from('land_applications')
      .insert({
        reference_code: tempRef,
        applicant_id: applicantId,
        parcel_name: parcelName.trim(),
        location_description: locationDescription.trim(),
        region: region.trim(),
        declared_area_sqm: Number(declaredAreaSqm),
        ownership_type: ownershipType,
        claimant_name: claimantName.trim(),
        claimant_national_id: claimantNationalId.trim().toUpperCase(),
        coordinates_geojson: coordinatesGeojson,
        state_id: stateId,
        lga_id: lgaId,
        community_id: communityId,
        boundary_source: boundarySource,
        boundary_change_reason: 'Boundary submitted with application',
        boundary_changed_by: applicantId,
        status: 'SUBMITTED',
      })
      .select('*')
      .single();
    assertNoSupabaseError(insErr, 'Create application in Supabase');
    const refCode = generateReferenceCode(created.id);
    const { data: updated, error: updErr } = await supabase
      .from('land_applications')
      .update({ reference_code: refCode })
      .eq('id', created.id)
      .select('*')
      .single();
    assertNoSupabaseError(updErr, 'Update application reference code in Supabase');
    return updated;
  }

  const store = loadLocalStore();
  const id = nextSequence(store, 'land_applications');
  const now = new Date().toISOString();
  const record = {
    id,
    reference_code: generateReferenceCode(id),
    applicant_id: applicantId,
    parcel_name: parcelName.trim(),
    location_description: locationDescription.trim(),
    region: region.trim(),
    declared_area_sqm: Number(declaredAreaSqm),
    ownership_type: ownershipType,
    claimant_name: claimantName.trim(),
    claimant_national_id: claimantNationalId.trim().toUpperCase(),
    coordinates_geojson: coordinatesGeojson,
    state_id: stateId,
    lga_id: lgaId,
    community_id: communityId,
    boundary_source: boundarySource,
    boundary_change_reason: 'Boundary submitted with application',
    boundary_changed_by: applicantId,
    status: 'SUBMITTED',
    rejection_reason: null,
    submitted_at: now,
    updated_at: now,
  };
  store.tables.land_applications.push(record);
  recordLocalApplicationStatusHistory(
    store,
    record,
    null,
    'SUBMITTED',
    applicantId,
    'CITIZEN',
    'Application submitted'
  );
  recordLocalApplicationBoundaryVersion(
    store,
    record,
    applicantId,
    record.boundary_change_reason
  );
  saveLocalStore(store);
  return record;
}

export async function transitionApplicationStatus({
  applicationId,
  expectedStatus,
  nextStatus,
  changedBy,
  actorRole,
  reason,
}) {
  const numericId = Number(applicationId);

  if (env.pg.enabled) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('anagu.actor_id', $1, TRUE), set_config('anagu.actor_role', $2, TRUE), set_config('anagu.status_reason', $3, TRUE)",
        [String(changedBy), actorRole, reason]
      );
      const { rows } = await client.query(
        `UPDATE land_applications
         SET status = $1,
             rejection_reason = CASE
               WHEN $1 IN ('CORRECTION_REQUIRED', 'GIS_REJECTED', 'VERIFICATION_REJECTED', 'REJECTED')
                 THEN $2
               ELSE NULL
             END,
             updated_at = NOW()
         WHERE id = $3 AND status = $4
         RETURNING *`,
        [nextStatus, reason, numericId, expectedStatus]
      );
      if (!rows[0]) {
        const error = new Error('Application status changed before review could be saved.');
        error.statusCode = 409;
        throw error;
      }
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabaseClient().rpc(
      'anagu_transition_land_application_status',
      {
        p_application_id: numericId,
        p_expected_status: expectedStatus,
        p_next_status: nextStatus,
        p_actor_id: changedBy,
        p_actor_role: actorRole,
        p_reason: reason,
      }
    );
    if (error?.code === 'P2001' || error?.code === '40001') {
      const conflict = new Error('Application status changed before review could be saved.');
      conflict.statusCode = 409;
      throw conflict;
    }
    assertNoSupabaseError(error, 'Transition application review status in Supabase');
    return data;
  }

  const store = loadLocalStore();
  const application = (store.tables.land_applications || []).find(
    (record) => record.id === numericId
  );
  if (!application) return null;
  if (application.status !== expectedStatus) {
    const error = new Error('Application status changed before review could be saved.');
    error.statusCode = 409;
    throw error;
  }

  application.status = nextStatus;
  application.rejection_reason = [
    'CORRECTION_REQUIRED',
    'GIS_REJECTED',
    'VERIFICATION_REJECTED',
    'REJECTED',
  ].includes(nextStatus)
    ? reason
    : null;
  application.updated_at = new Date().toISOString();
  recordLocalApplicationStatusHistory(
    store,
    application,
    expectedStatus,
    nextStatus,
    changedBy,
    actorRole,
    reason
  );
  saveLocalStore(store);
  return application;
}

export async function listApplicationStatusHistory(applicationId) {
  const numericId = Number(applicationId);

  if (env.pg.enabled) {
    const { rows } = await getPgPool().query(
      `SELECT h.*, u.full_name AS actor_name
       FROM application_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.application_id = $1
       ORDER BY h.created_at, h.id`,
      [numericId]
    );
    return rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [{ data: history, error }, { data: users, error: usersError }] = await Promise.all([
      sb
        .from('application_status_history')
        .select('*')
        .eq('application_id', numericId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      sb.from('users').select('id, full_name'),
    ]);
    assertNoSupabaseError(error, 'List application status history in Supabase');
    assertNoSupabaseError(usersError, 'List application status history actors in Supabase');
    const usersById = new Map((users || []).map((user) => [user.id, user.full_name]));
    return (history || []).map((item) => ({
      ...item,
      actor_name: usersById.get(item.changed_by) || null,
    }));
  }

  const store = loadLocalStore();
  const usersById = new Map((store.tables.users || []).map((user) => [user.id, user.full_name]));
  return (store.tables.application_status_history || [])
    .filter((entry) => entry.application_id === numericId)
    .sort(
      (a, b) =>
        new Date(a.created_at) - new Date(b.created_at) || a.id - b.id
    )
    .map((entry) => ({
      ...entry,
      actor_name: usersById.get(entry.changed_by) || null,
    }));
}

function resolveAppPaymentStatus(payments, appId) {
  const appPayments = (payments || []).filter((p) => p.registration_id === appId);
  if (appPayments.some((p) => p.payment_status === 'PAID')) return 'PAID';
  if (appPayments.length === 0) return 'PENDING';
  const latest = appPayments.sort((a, b) => b.id - a.id)[0];
  return latest.payment_status || 'PENDING';
}

export async function listApplicationsForUser(user) {
  const isStaff = user.roleCode !== 'CITIZEN';

  if (env.pg.enabled) {
    const pool = getPgPool();
    const query = isStaff
      ? `SELECT la.*, u.full_name AS applicant_name, u.email AS applicant_email,
                (SELECT COUNT(*)::int FROM supporting_documents sd WHERE sd.application_id = la.id) AS document_count,
                COALESCE(
                  (SELECT p.payment_status FROM payments p WHERE p.registration_id = la.id AND p.payment_status = 'PAID' LIMIT 1),
                  (SELECT p.payment_status FROM payments p WHERE p.registration_id = la.id ORDER BY p.id DESC LIMIT 1),
                  'PENDING'
                ) AS payment_status
         FROM land_applications la
         JOIN users u ON u.id = la.applicant_id
         ORDER BY la.submitted_at DESC`
      : `SELECT la.*, u.full_name AS applicant_name, u.email AS applicant_email,
                (SELECT COUNT(*)::int FROM supporting_documents sd WHERE sd.application_id = la.id) AS document_count,
                COALESCE(
                  (SELECT p.payment_status FROM payments p WHERE p.registration_id = la.id AND p.payment_status = 'PAID' LIMIT 1),
                  (SELECT p.payment_status FROM payments p WHERE p.registration_id = la.id ORDER BY p.id DESC LIMIT 1),
                  'PENDING'
                ) AS payment_status
         FROM land_applications la
         JOIN users u ON u.id = la.applicant_id
         WHERE la.applicant_id = $1
         ORDER BY la.submitted_at DESC`;
    const res = await pool.query(query, isStaff ? [] : [user.id]);
    return res.rows;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    let appQuery = supabase
      .from('land_applications')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (!isStaff) {
      appQuery = appQuery.eq('applicant_id', user.id);
    }
    const [{ data: apps, error: appsErr }, { data: users }, { data: docs }, { data: payments }] =
      await Promise.all([
        appQuery,
        supabase.from('users').select('id, full_name, email'),
        supabase.from('supporting_documents').select('application_id'),
        supabase.from('payments').select('id, registration_id, payment_status'),
      ]);
    assertNoSupabaseError(appsErr, 'List applications in Supabase');
    const usersById = new Map((users || []).map((u) => [u.id, u]));
    return (apps || []).map((app) => {
      const applicant = usersById.get(app.applicant_id);
      return {
        ...app,
        applicant_name: applicant?.full_name || 'Unknown',
        applicant_email: applicant?.email || '',
        document_count: (docs || []).filter((d) => d.application_id === app.id).length,
        payment_status: resolveAppPaymentStatus(payments || [], app.id),
      };
    });
  }

  const store = loadLocalStore();
  const usersById = new Map((store.tables.users || []).map((u) => [u.id, u]));
  const docs = store.tables.supporting_documents || [];
  const payments = store.tables.payments || [];

  return (store.tables.land_applications || [])
    .filter((app) => isStaff || app.applicant_id === user.id)
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
    .map((app) => {
      const applicant = usersById.get(app.applicant_id);
      return {
        ...app,
        applicant_name: applicant?.full_name || 'Unknown',
        applicant_email: applicant?.email || '',
        document_count: docs.filter((d) => d.application_id === app.id).length,
        payment_status: resolveAppPaymentStatus(payments, app.id),
      };
    });
}

export async function findApplicationById(id) {
  const numericId = Number(id);
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT la.*, u.full_name AS applicant_name, u.email AS applicant_email,
              COALESCE(
                (SELECT p.payment_status FROM payments p WHERE p.registration_id = la.id AND p.payment_status = 'PAID' LIMIT 1),
                (SELECT p.payment_status FROM payments p WHERE p.registration_id = la.id ORDER BY p.id DESC LIMIT 1),
                'PENDING'
              ) AS payment_status
       FROM land_applications la
       JOIN users u ON u.id = la.applicant_id
       WHERE la.id = $1
       LIMIT 1`,
      [numericId]
    );
    return res.rows[0] || null;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: app, error } = await supabase
      .from('land_applications')
      .select('*')
      .eq('id', numericId)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find application by id in Supabase');
    if (!app) return null;
    const [{ data: applicant }, { data: payments }] = await Promise.all([
      supabase.from('users').select('id, full_name, email').eq('id', app.applicant_id).maybeSingle(),
      supabase
        .from('payments')
        .select('id, registration_id, payment_status')
        .eq('registration_id', app.id),
    ]);
    return {
      ...app,
      applicant_name: applicant?.full_name || 'Unknown',
      applicant_email: applicant?.email || '',
      payment_status: resolveAppPaymentStatus(payments || [], app.id),
    };
  }

  const store = loadLocalStore();
  const app = (store.tables.land_applications || []).find((a) => a.id === numericId);
  if (!app) return null;
  const applicant = (store.tables.users || []).find((u) => u.id === app.applicant_id);
  return {
    ...app,
    applicant_name: applicant?.full_name || 'Unknown',
    applicant_email: applicant?.email || '',
    payment_status: resolveAppPaymentStatus(store.tables.payments || [], app.id),
  };
}

export async function updateApplicationBoundary({
  applicationId,
  coordinatesGeojson,
  boundarySource,
  changeReason,
  changedBy,
}) {
  const numericId = Number(applicationId);
  if (env.pg.enabled) {
    const { rows } = await getPgPool().query(
      `UPDATE land_applications
       SET coordinates_geojson = $1::jsonb,
           boundary_source = $2,
           boundary_change_reason = $3,
           boundary_changed_by = $4,
           status = 'SUBMITTED',
           rejection_reason = NULL,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        JSON.stringify(coordinatesGeojson),
        boundarySource,
        changeReason,
        changedBy,
        numericId,
      ]
    );
    return rows[0] || null;
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabaseClient()
      .from('land_applications')
      .update({
        coordinates_geojson: coordinatesGeojson,
        boundary_source: boundarySource,
        boundary_change_reason: changeReason,
        boundary_changed_by: changedBy,
        status: 'SUBMITTED',
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', numericId)
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Update application boundary in Supabase');
    return data || null;
  }

  const store = loadLocalStore();
  const application = (store.tables.land_applications || []).find(
    (record) => record.id === numericId
  );
  if (!application) return null;
  const previousStatus = application.status;
  application.coordinates_geojson = coordinatesGeojson;
  application.boundary_source = boundarySource;
  application.boundary_change_reason = changeReason;
  application.boundary_changed_by = changedBy;
  application.status = 'SUBMITTED';
  application.rejection_reason = null;
  application.updated_at = new Date().toISOString();
  if (previousStatus !== 'SUBMITTED') {
    recordLocalApplicationStatusHistory(
      store,
      application,
      previousStatus,
      'SUBMITTED',
      changedBy,
      'CITIZEN',
      `Boundary correction submitted: ${changeReason}`
    );
  }
  recordLocalApplicationBoundaryVersion(store, application, changedBy, changeReason);
  saveLocalStore(store);
  return application;
}

export async function addSupportingDocument({
  applicationId,
  uploadedBy,
  documentType,
  fileName,
  mimeType,
  fileSizeBytes,
  sha256Hash,
  storagePath,
  storageBucket = null,
  isTamperedFlag = false,
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO supporting_documents (
        application_id, uploaded_by, document_type, file_name, mime_type,
        file_size_bytes, sha256_hash, storage_path, storage_bucket, is_tampered_flag
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        applicationId,
        uploadedBy,
        documentType,
        fileName,
        mimeType,
        fileSizeBytes,
        sha256Hash,
        storagePath,
        storageBucket,
        isTamperedFlag,
      ]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('supporting_documents')
      .insert({
        application_id: applicationId,
        uploaded_by: uploadedBy,
        document_type: documentType,
        file_name: fileName,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        sha256_hash: sha256Hash,
        storage_path: storagePath,
        storage_bucket: storageBucket,
        is_tampered_flag: Boolean(isTamperedFlag),
      })
      .select('*')
      .single();
    assertNoSupabaseError(error, 'Insert supporting document in Supabase');
    return data;
  }

  const store = loadLocalStore();
  const doc = {
    id: nextSequence(store, 'supporting_documents'),
    application_id: applicationId,
    uploaded_by: uploadedBy,
    document_type: documentType,
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    sha256_hash: sha256Hash,
    storage_path: storagePath,
    storage_bucket: storageBucket,
    is_tampered_flag: Boolean(isTamperedFlag),
    uploaded_at: new Date().toISOString(),
  };
  store.tables.supporting_documents.push(doc);
  saveLocalStore(store);
  return doc;
}

export async function uploadAndAddSupportingDocument({
  applicationId,
  uploadedBy,
  documentType,
  fileName,
  mimeType,
  fileSizeBytes,
  buffer,
  isTamperedFlag = false,
}) {
  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const storedFile = await storeSupportingDocumentFile({
    applicationId,
    fileName,
    mimeType,
    buffer,
  });
  const document = {
    ...storedFile,
    file_name: fileName,
  };

  try {
    return await addSupportingDocument({
      applicationId,
      uploadedBy,
      documentType,
      fileName,
      mimeType,
      fileSizeBytes,
      sha256Hash,
      storagePath: storedFile.storagePath,
      storageBucket: storedFile.storageBucket,
      isTamperedFlag,
    });
  } catch (error) {
    try {
      await removeSupportingDocumentFile(document);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Could not save supporting document metadata or clean up its uploaded file.'
      );
    }
    throw error;
  }
}

export async function listDocumentsByApplicationId(applicationId) {
  const numericId = Number(applicationId);
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      'SELECT * FROM supporting_documents WHERE application_id = $1 ORDER BY uploaded_at DESC',
      [numericId]
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('supporting_documents')
      .select('*')
      .eq('application_id', numericId)
      .order('uploaded_at', { ascending: false });
    assertNoSupabaseError(error, 'List supporting documents in Supabase');
    return data || [];
  }

  const store = loadLocalStore();
  return (store.tables.supporting_documents || [])
    .filter((d) => d.application_id === numericId)
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
}
