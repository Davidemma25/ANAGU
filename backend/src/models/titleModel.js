import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, saveLocalStore, nextSequence } from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';
import {
  recordLocalApplicationStatusHistory,
  transitionApplicationStatus,
} from './applicationModel.js';
import {
  convertPolToUsd,
  convertUsdToAnagu,
  anaguToWei,
  isListingVisibleOnCheckLands,
} from '../services/marketplaceService.js';

export function generateTitleNumber(id) {
  const year = new Date().getUTCFullYear();
  return `ANG-TITLE-${year}-${String(id).padStart(4, '0')}`;
}

export async function listIssuanceQueue() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT la.*, lp.id AS parcel_id, lp.parcel_code, lp.area_sqm,
              u.full_name AS applicant_name, u.wallet_address AS applicant_wallet,
              (SELECT vr.oracle_match_score FROM verification_records vr
               WHERE vr.application_id = la.id ORDER BY vr.verified_at DESC LIMIT 1) AS oracle_score
       FROM land_applications la
       JOIN land_parcels lp ON lp.application_id = la.id
       JOIN users u ON u.id = la.applicant_id
       WHERE la.status = 'APPROVED'
         AND NOT EXISTS (SELECT 1 FROM land_titles lt WHERE lt.application_id = la.id)
       ORDER BY la.updated_at DESC`
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [appsRes, parcelsRes, usersRes, titlesRes, verRes] = await Promise.all([
      sb
        .from('land_applications')
        .select('*')
        .eq('status', 'APPROVED')
        .order('updated_at', { ascending: false }),
      sb.from('land_parcels').select('id, application_id, parcel_code, area_sqm'),
      sb.from('users').select('id, full_name, wallet_address'),
      sb.from('land_titles').select('application_id'),
      sb
        .from('verification_records')
        .select('application_id, oracle_match_score, verified_at')
        .order('verified_at', { ascending: false }),
    ]);
    assertNoSupabaseError(appsRes.error, 'List issuance queue applications');
    assertNoSupabaseError(parcelsRes.error, 'List issuance queue parcels');
    assertNoSupabaseError(usersRes.error, 'List issuance queue users');
    assertNoSupabaseError(titlesRes.error, 'List issuance queue titles');
    assertNoSupabaseError(verRes.error, 'List issuance queue verifications');

    const parcelsByApp = new Map((parcelsRes.data || []).map((p) => [p.application_id, p]));
    const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));
    const titledApps = new Set((titlesRes.data || []).map((t) => t.application_id));
    const latestVerByApp = new Map();
    for (const v of verRes.data || []) {
      if (!latestVerByApp.has(v.application_id)) {
        latestVerByApp.set(v.application_id, v);
      }
    }

    return (appsRes.data || [])
      .filter((a) => !titledApps.has(a.id) && parcelsByApp.has(a.id))
      .map((app) => {
        const parcel = parcelsByApp.get(app.id);
        const applicant = usersById.get(app.applicant_id);
        const latestVer = latestVerByApp.get(app.id);
        return {
          ...app,
          parcel_id: parcel?.id || null,
          parcel_code: parcel?.parcel_code || null,
          area_sqm: parcel?.area_sqm || app.declared_area_sqm,
          applicant_name: applicant?.full_name || app.claimant_name,
          applicant_wallet: applicant?.wallet_address || '',
          oracle_score: latestVer?.oracle_match_score ?? null,
        };
      });
  }

  const store = loadLocalStore();
  const parcelsByApp = new Map((store.tables.land_parcels || []).map((p) => [p.application_id, p]));
  const usersById = new Map((store.tables.users || []).map((u) => [u.id, u]));
  const titledApps = new Set((store.tables.land_titles || []).map((t) => t.application_id));
  const verifications = store.tables.verification_records || [];

  return (store.tables.land_applications || [])
    .filter((a) => a.status === 'APPROVED' && !titledApps.has(a.id))
    .map((app) => {
      const parcel = parcelsByApp.get(app.id);
      const applicant = usersById.get(app.applicant_id);
      const latestVer = verifications
        .filter((v) => v.application_id === app.id)
        .sort((x, y) => new Date(y.verified_at) - new Date(x.verified_at))[0];
      return {
        ...app,
        parcel_id: parcel?.id || null,
        parcel_code: parcel?.parcel_code || null,
        area_sqm: parcel?.area_sqm || app.declared_area_sqm,
        applicant_name: applicant?.full_name || app.claimant_name,
        applicant_wallet: applicant?.wallet_address || '',
        oracle_score: latestVer?.oracle_match_score ?? null,
      };
    });
}

export async function listTitles() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT lt.*, lp.parcel_code, lp.area_sqm, lp.centroid_lat, lp.centroid_lng,
              la.reference_code, la.parcel_name, la.region, la.ownership_type,
              u.full_name AS owner_name, u.email AS owner_email, u.wallet_address AS owner_wallet,
              iss.full_name AS issued_by_name,
              rr.ground AS revocation_ground, rr.reason AS revocation_reason, rr.revoked_at
       FROM land_titles lt
       JOIN land_parcels lp ON lp.id = lt.parcel_id
       JOIN land_applications la ON la.id = lt.application_id
       JOIN users u ON u.id = lt.owner_id
       JOIN users iss ON iss.id = lt.issued_by
       LEFT JOIN revocation_records rr ON rr.title_id = lt.id
       ORDER BY lt.issued_at DESC`
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [titlesRes, parcelsRes, appsRes, usersRes, revRes] = await Promise.all([
      sb.from('land_titles').select('*').order('issued_at', { ascending: false }),
      sb.from('land_parcels').select('id, parcel_code, area_sqm, centroid_lat, centroid_lng'),
      sb.from('land_applications').select('id, reference_code, parcel_name, region, ownership_type'),
      sb.from('users').select('id, full_name, email, wallet_address'),
      sb.from('revocation_records').select('title_id, ground, reason, revoked_at'),
    ]);
    assertNoSupabaseError(titlesRes.error, 'List land titles');
    assertNoSupabaseError(parcelsRes.error, 'List title parcels');
    assertNoSupabaseError(appsRes.error, 'List title applications');
    assertNoSupabaseError(usersRes.error, 'List title users');
    assertNoSupabaseError(revRes.error, 'List title revocations');

    const parcelsById = new Map((parcelsRes.data || []).map((p) => [p.id, p]));
    const appsById = new Map((appsRes.data || []).map((a) => [a.id, a]));
    const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));
    const revByTitle = new Map((revRes.data || []).map((r) => [r.title_id, r]));

    return (titlesRes.data || []).map((lt) => {
      const parcel = parcelsById.get(lt.parcel_id);
      const app = appsById.get(lt.application_id);
      const owner = usersById.get(lt.owner_id);
      const issuer = usersById.get(lt.issued_by);
      const rev = revByTitle.get(lt.id);
      return {
        ...lt,
        parcel_code: parcel?.parcel_code || '',
        area_sqm: parcel?.area_sqm || 0,
        centroid_lat: parcel?.centroid_lat || 0,
        centroid_lng: parcel?.centroid_lng || 0,
        reference_code: app?.reference_code || '',
        parcel_name: app?.parcel_name || '',
        region: app?.region || '',
        ownership_type: app?.ownership_type || '',
        owner_name: owner?.full_name || 'Unknown',
        owner_email: owner?.email || '',
        owner_wallet: owner?.wallet_address || '',
        issued_by_name: issuer?.full_name || 'Registrar',
        revocation_ground: rev?.ground || null,
        revocation_reason: rev?.reason || null,
        revoked_at: rev?.revoked_at || null,
      };
    });
  }

  const store = loadLocalStore();
  const parcelsById = new Map((store.tables.land_parcels || []).map((p) => [p.id, p]));
  const appsById = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const usersById = new Map((store.tables.users || []).map((u) => [u.id, u]));
  const revByTitle = new Map((store.tables.revocation_records || []).map((r) => [r.title_id, r]));

  return [...(store.tables.land_titles || [])]
    .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))
    .map((lt) => {
      const parcel = parcelsById.get(lt.parcel_id);
      const app = appsById.get(lt.application_id);
      const owner = usersById.get(lt.owner_id);
      const issuer = usersById.get(lt.issued_by);
      const rev = revByTitle.get(lt.id);
      return {
        ...lt,
        parcel_code: parcel?.parcel_code || '',
        area_sqm: parcel?.area_sqm || 0,
        centroid_lat: parcel?.centroid_lat || 0,
        centroid_lng: parcel?.centroid_lng || 0,
        reference_code: app?.reference_code || '',
        parcel_name: app?.parcel_name || '',
        region: app?.region || '',
        ownership_type: app?.ownership_type || '',
        owner_name: owner?.full_name || 'Unknown',
        owner_email: owner?.email || '',
        owner_wallet: owner?.wallet_address || '',
        issued_by_name: issuer?.full_name || 'Registrar',
        revocation_ground: rev?.ground || null,
        revocation_reason: rev?.reason || null,
        revoked_at: rev?.revoked_at || null,
      };
    });
}

export async function findTitleById(titleId) {
  const all = await listTitles();
  return all.find((t) => t.id === Number(titleId)) || null;
}

export async function createTitleRecord({
  applicationId,
  parcelId,
  ownerId,
  tokenId,
  contractAddress,
  metadataUri,
  issuedBy,
  actorRole = 'SYSTEM',
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const tempNum = `ANG-TITLE-PENDING-${Date.now()}`;
    const ins = await pool.query(
      `INSERT INTO land_titles (
        title_number, application_id, parcel_id, owner_id, token_id,
        contract_address, metadata_uri, title_status, issued_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8)
      RETURNING *`,
      [
        tempNum,
        applicationId,
        parcelId,
        ownerId,
        String(tokenId),
        contractAddress,
        metadataUri,
        issuedBy,
      ]
    );
    const titleNumber = generateTitleNumber(ins.rows[0].id);
    const upd = await pool.query(
      'UPDATE land_titles SET title_number = $1 WHERE id = $2 RETURNING *',
      [titleNumber, ins.rows[0].id]
    );
    await transitionApplicationStatus({
      applicationId,
      expectedStatus: 'APPROVED',
      nextStatus: 'TITLE_ISSUED',
      changedBy: issuedBy,
      actorRole,
      reason: 'Digital title issued after registrar approval',
    });
    await pool.query("UPDATE land_parcels SET status = 'ACTIVE' WHERE id = $1", [parcelId]);
    return upd.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const tempNum = `ANG-TITLE-PENDING-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const { data: inserted, error: insErr } = await sb
      .from('land_titles')
      .insert({
        title_number: tempNum,
        application_id: applicationId,
        parcel_id: parcelId,
        owner_id: ownerId,
        token_id: String(tokenId),
        contract_address: contractAddress,
        metadata_uri: metadataUri,
        title_status: 'ACTIVE',
        issued_by: issuedBy,
      })
      .select('*')
      .single();
    assertNoSupabaseError(insErr, 'Insert land title');

    const titleNumber = generateTitleNumber(inserted.id);
    const { data: updated, error: updErr } = await sb
      .from('land_titles')
      .update({ title_number: titleNumber })
      .eq('id', inserted.id)
      .select('*')
      .single();
    assertNoSupabaseError(updErr, 'Update land title number');

    await transitionApplicationStatus({
      applicationId,
      expectedStatus: 'APPROVED',
      nextStatus: 'TITLE_ISSUED',
      changedBy: issuedBy,
      actorRole,
      reason: 'Digital title issued after registrar approval',
    });
    const { error: parcelError } = await sb
      .from('land_parcels')
      .update({ status: 'ACTIVE' })
      .eq('id', parcelId);
    assertNoSupabaseError(parcelError, 'Update parcel status on title mint');

    return updated;
  }

  const store = loadLocalStore();
  const id = nextSequence(store, 'land_titles');
  const now = new Date().toISOString();
  const title = {
    id,
    title_number: generateTitleNumber(id),
    application_id: applicationId,
    parcel_id: parcelId,
    owner_id: ownerId,
    token_id: String(tokenId),
    contract_address: contractAddress,
    metadata_uri: metadataUri,
    title_status: 'ACTIVE',
    issued_by: issuedBy,
    issued_at: now,
  };
  store.tables.land_titles.push(title);

  const app = (store.tables.land_applications || []).find((a) => a.id === applicationId);
  if (app) {
    const previousStatus = app.status;
    app.status = 'TITLE_ISSUED';
    app.updated_at = now;
    recordLocalApplicationStatusHistory(
      store,
      app,
      previousStatus,
      'TITLE_ISSUED',
      issuedBy,
      actorRole,
      'Digital title issued after registrar approval'
    );
  }
  const parcel = (store.tables.land_parcels || []).find((p) => p.id === parcelId);
  if (parcel) {
    parcel.status = 'ACTIVE';
  }
  saveLocalStore(store);
  return title;
}

export async function recordBlockchainTransaction({
  titleId = null,
  applicationId = null,
  txType,
  txHash,
  blockNumber = null,
  fromAddress,
  toAddress = null,
  gasUsed = null,
  latencyMs = null,
  status = 'CONFIRMED',
  errorMessage = null,
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO blockchain_transactions (
        title_id, application_id, tx_type, tx_hash, block_number,
        from_address, to_address, gas_used, latency_ms, status, error_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        titleId,
        applicationId,
        txType,
        txHash,
        blockNumber,
        fromAddress,
        toAddress,
        gasUsed ? String(gasUsed) : null,
        latencyMs,
        status,
        errorMessage,
      ]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('blockchain_transactions')
      .insert({
        title_id: titleId,
        application_id: applicationId,
        tx_type: txType,
        tx_hash: txHash,
        block_number: blockNumber,
        from_address: fromAddress,
        to_address: toAddress,
        gas_used: gasUsed ? String(gasUsed) : null,
        latency_ms: latencyMs,
        status,
        error_message: errorMessage,
      })
      .select('*')
      .single();
    assertNoSupabaseError(error, 'Record blockchain transaction');
    return data;
  }

  const store = loadLocalStore();
  const entry = {
    id: nextSequence(store, 'blockchain_transactions'),
    title_id: titleId,
    application_id: applicationId,
    tx_type: txType,
    tx_hash: txHash,
    block_number: blockNumber,
    from_address: fromAddress,
    to_address: toAddress,
    gas_used: gasUsed ? String(gasUsed) : null,
    latency_ms: latencyMs,
    status,
    error_message: errorMessage,
    created_at: new Date().toISOString(),
  };
  store.tables.blockchain_transactions.push(entry);
  saveLocalStore(store);
  return entry;
}

export async function listBlockchainTransactions(limit = 50) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      'SELECT * FROM blockchain_transactions ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('blockchain_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    assertNoSupabaseError(error, 'List blockchain transactions');
    return data || [];
  }

  const store = loadLocalStore();
  return [...(store.tables.blockchain_transactions || [])]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

export async function listMarketplaceListings({ includePendingAdmin = false } = {}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const whereClause = includePendingAdmin
      ? ''
      : "WHERE COALESCE(ll.verification_status, 'VERIFIED') NOT IN ('PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED')";
    const res = await pool.query(
      `SELECT ll.*, lt.title_number, lt.token_id, lt.contract_address, lt.title_status,
              COALESCE(ll.application_id, lt.application_id) AS application_id,
              COALESCE(ll.verification_status, CASE WHEN lt.title_status = 'ACTIVE' THEN 'VERIFIED' ELSE 'PENDING_VERIFICATION' END) AS verification_status,
              lp.parcel_code,
              COALESCE(lp.area_sqm, la.declared_area_sqm, 0) AS area_sqm,
              lp.centroid_lat, lp.centroid_lng,
              COALESCE(ST_AsGeoJSON(lp.boundary)::jsonb, la.coordinates_geojson) AS boundary_geojson,
              COALESCE(lp.is_geometry_valid, FALSE) AS gis_validated,
              la.reference_code, la.parcel_name, la.region, la.ownership_type, la.status AS application_status,
              sel.full_name AS seller_name, buy.full_name AS buyer_name,
              (SELECT COUNT(*)::int FROM supporting_documents sd WHERE sd.application_id = la.id) AS document_count,
              (SELECT vr.oracle_match_score FROM verification_records vr
               WHERE vr.application_id = la.id ORDER BY vr.verified_at DESC LIMIT 1) AS oracle_score,
              EXISTS (SELECT 1 FROM verification_records vr
               WHERE vr.application_id = la.id AND vr.decision = 'APPROVED') AS oracle_verified
       FROM land_listings ll
       LEFT JOIN land_titles lt ON lt.id = ll.title_id
       LEFT JOIN land_applications la ON la.id = COALESCE(ll.application_id, lt.application_id)
       LEFT JOIN land_parcels lp ON lp.id = lt.parcel_id OR (lt.id IS NULL AND lp.application_id = la.id)
       JOIN users sel ON sel.id = ll.seller_id
       LEFT JOIN users buy ON buy.id = ll.buyer_id
       ${whereClause}
       ORDER BY ll.created_at DESC`
    );
    return res.rows.map((row) => ({
      ...row,
      price_usd:
        row.price_usd != null ? Number(row.price_usd) : convertPolToUsd(row.price_pol),
    }));
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [listingsRes, titlesRes, parcelsRes, appsRes, usersRes, verRes, docsRes] =
      await Promise.all([
        sb.from('land_listings').select('*').order('created_at', { ascending: false }),
        sb.from('land_titles').select('*'),
        sb.from('land_parcels').select('*'),
        sb.from('land_applications').select('*'),
        sb.from('users').select('id, full_name'),
        sb
          .from('verification_records')
          .select('application_id, decision, oracle_match_score, verified_at')
          .order('verified_at', { ascending: false }),
        sb.from('supporting_documents').select('application_id'),
      ]);
    assertNoSupabaseError(listingsRes.error, 'List marketplace listings');
    assertNoSupabaseError(titlesRes.error, 'List listing titles');
    assertNoSupabaseError(parcelsRes.error, 'List listing parcels');
    assertNoSupabaseError(appsRes.error, 'List listing applications');
    assertNoSupabaseError(usersRes.error, 'List listing users');
    assertNoSupabaseError(verRes.error, 'List listing verifications');
    assertNoSupabaseError(docsRes.error, 'List listing documents');

    const titlesById = new Map((titlesRes.data || []).map((t) => [t.id, t]));
    const parcelsById = new Map((parcelsRes.data || []).map((p) => [p.id, p]));
    const parcelsByApp = new Map((parcelsRes.data || []).map((p) => [p.application_id, p]));
    const appsById = new Map((appsRes.data || []).map((a) => [a.id, a]));
    const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));
    const latestVerByApp = new Map();
    for (const v of verRes.data || []) {
      if (!latestVerByApp.has(v.application_id)) {
        latestVerByApp.set(v.application_id, v);
      }
    }
    const docCounts = new Map();
    for (const d of docsRes.data || []) {
      docCounts.set(d.application_id, (docCounts.get(d.application_id) || 0) + 1);
    }

    const allRows = (listingsRes.data || []).map((ll) => {
      const title = ll.title_id ? titlesById.get(ll.title_id) : null;
      const resolvedAppId = ll.application_id ?? title?.application_id ?? null;
      const app = resolvedAppId ? appsById.get(resolvedAppId) : null;
      const parcel = title?.parcel_id
        ? parcelsById.get(title.parcel_id)
        : resolvedAppId
        ? parcelsByApp.get(resolvedAppId)
        : null;
      const seller = usersById.get(ll.seller_id);
      const buyer = usersById.get(ll.buyer_id);
      const latestVer = resolvedAppId ? latestVerByApp.get(resolvedAppId) : null;
      const verificationStatus =
        ll.verification_status || (title?.title_status === 'ACTIVE' ? 'VERIFIED' : 'PENDING_VERIFICATION');

      return {
        ...ll,
        price_pol: Number(ll.price_pol),
        price_usd:
          ll.price_usd != null ? Number(ll.price_usd) : convertPolToUsd(ll.price_pol),
        price_anagu:
          ll.price_anagu != null
            ? Number(ll.price_anagu)
            : convertUsdToAnagu(
                ll.price_usd != null ? Number(ll.price_usd) : convertPolToUsd(ll.price_pol)
              ),
        verification_status: verificationStatus,
        headline:
          ll.headline ||
          (app?.parcel_name
            ? `${app.parcel_name} · ${verificationStatus === 'VERIFIED' ? 'Verified Parcel' : 'Listed Before Verification'}`
            : ''),
        description: ll.description || '',
        application_id: resolvedAppId,
        reference_code: app?.reference_code || '',
        application_status: app?.status || '',
        title_number: title?.title_number || '',
        token_id: title?.token_id || '',
        contract_address: title?.contract_address || '',
        title_status: title?.title_status || '',
        parcel_code: parcel?.parcel_code || '',
        area_sqm: parcel?.area_sqm || app?.declared_area_sqm || 0,
        centroid_lat: parcel?.centroid_lat || 0,
        centroid_lng: parcel?.centroid_lng || 0,
        boundary_geojson: parcel?.boundary_geojson || app?.coordinates_geojson || null,
        gis_validated: Boolean(parcel?.is_geometry_valid),
        document_count: resolvedAppId ? docCounts.get(resolvedAppId) || 0 : 0,
        oracle_verified: latestVer?.decision === 'APPROVED',
        oracle_score:
          latestVer?.oracle_match_score != null ? Number(latestVer.oracle_match_score) : null,
        parcel_name: app?.parcel_name || '',
        region: app?.region || '',
        ownership_type: app?.ownership_type || '',
        seller_name: seller?.full_name || 'Seller',
        buyer_name: buyer?.full_name || null,
      };
    });

    return includePendingAdmin
      ? allRows
      : allRows.filter((row) => isListingVisibleOnCheckLands(row));
  }

  const store = loadLocalStore();
  const titlesById = new Map((store.tables.land_titles || []).map((t) => [t.id, t]));
  const parcelsById = new Map((store.tables.land_parcels || []).map((p) => [p.id, p]));
  const parcelsByApp = new Map((store.tables.land_parcels || []).map((p) => [p.application_id, p]));
  const appsById = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const usersById = new Map((store.tables.users || []).map((u) => [u.id, u]));
  const verifications = store.tables.verification_records || [];
  const docs = store.tables.supporting_documents || [];

  const allRows = [...(store.tables.land_listings || [])]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((ll) => {
      const title = ll.title_id ? titlesById.get(ll.title_id) : null;
      const resolvedAppId = ll.application_id ?? title?.application_id ?? null;
      const app = resolvedAppId ? appsById.get(resolvedAppId) : null;
      const parcel = title?.parcel_id
        ? parcelsById.get(title.parcel_id)
        : resolvedAppId
        ? parcelsByApp.get(resolvedAppId)
        : null;
      const seller = usersById.get(ll.seller_id);
      const buyer = usersById.get(ll.buyer_id);
      const latestVer = resolvedAppId
        ? verifications
            .filter((v) => v.application_id === resolvedAppId)
            .sort((x, y) => new Date(y.verified_at) - new Date(x.verified_at))[0]
        : null;
      const verificationStatus =
        ll.verification_status || (title?.title_status === 'ACTIVE' ? 'VERIFIED' : 'PENDING_VERIFICATION');

      return {
        ...ll,
        price_usd:
          ll.price_usd != null ? Number(ll.price_usd) : convertPolToUsd(ll.price_pol),
        price_anagu:
          ll.price_anagu != null
            ? Number(ll.price_anagu)
            : convertUsdToAnagu(
                ll.price_usd != null ? Number(ll.price_usd) : convertPolToUsd(ll.price_pol)
              ),
        verification_status: verificationStatus,
        headline:
          ll.headline ||
          (app?.parcel_name
            ? `${app.parcel_name} · ${verificationStatus === 'VERIFIED' ? 'Verified Parcel' : 'Listed Before Verification'}`
            : ''),
        description: ll.description || '',
        application_id: resolvedAppId,
        reference_code: app?.reference_code || '',
        application_status: app?.status || '',
        title_number: title?.title_number || '',
        token_id: title?.token_id || '',
        contract_address: title?.contract_address || '',
        title_status: title?.title_status || '',
        parcel_code: parcel?.parcel_code || '',
        area_sqm: parcel?.area_sqm || app?.declared_area_sqm || 0,
        centroid_lat: parcel?.centroid_lat || 0,
        centroid_lng: parcel?.centroid_lng || 0,
        boundary_geojson: parcel?.boundary_geojson || app?.coordinates_geojson || null,
        gis_validated: Boolean(parcel?.is_geometry_valid),
        document_count: resolvedAppId ? docs.filter((d) => d.application_id === resolvedAppId).length : 0,
        oracle_verified: latestVer?.decision === 'APPROVED',
        oracle_score:
          latestVer?.oracle_match_score != null ? Number(latestVer.oracle_match_score) : null,
        parcel_name: app?.parcel_name || '',
        region: app?.region || '',
        ownership_type: app?.ownership_type || '',
        seller_name: seller?.full_name || 'Seller',
        buyer_name: buyer?.full_name || null,
      };
    });

  return includePendingAdmin
    ? allRows
    : allRows.filter((row) => isListingVisibleOnCheckLands(row));
}

export async function createListingRecord({
  titleId = null,
  applicationId = null,
  sellerId,
  sellerWallet,
  priceWei,
  pricePol,
  priceUsd = null,
  priceAnagu = null,
  headline = '',
  description = '',
  verificationStatus = titleId ? 'VERIFIED' : 'PENDING_VERIFICATION',
}) {
  const resolvedPriceUsd =
    priceUsd != null && Number.isFinite(Number(priceUsd)) && Number(priceUsd) > 0
      ? Number(Number(priceUsd).toFixed(2))
      : convertPolToUsd(pricePol);

  // Derive ANAGU price from USD (1 ANAGU = $1 default rate)
  const resolvedPriceAnagu =
    priceAnagu != null && Number.isFinite(Number(priceAnagu)) && Number(priceAnagu) > 0
      ? Number(Number(priceAnagu).toFixed(6))
      : Number(convertUsdToAnagu(resolvedPriceUsd).toFixed(6));

  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO land_listings (
        title_id, application_id, seller_id, seller_wallet,
        price_wei, price_pol, price_usd, price_anagu,
        headline, description, verification_status, listing_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'LISTED')
      RETURNING *`,
      [
        titleId,
        applicationId,
        sellerId,
        sellerWallet,
        String(priceWei),
        Number(pricePol),
        resolvedPriceUsd,
        resolvedPriceAnagu,
        headline || null,
        description || null,
        verificationStatus,
      ]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('land_listings')
      .insert({
        title_id: titleId,
        application_id: applicationId,
        seller_id: sellerId,
        seller_wallet: sellerWallet,
        price_wei: String(priceWei),
        price_pol: Number(pricePol),
        price_usd: resolvedPriceUsd,
        price_anagu: resolvedPriceAnagu,
        headline: headline || null,
        description: description || null,
        verification_status: verificationStatus,
        listing_status: 'LISTED',
      })
      .select('*')
      .single();
    assertNoSupabaseError(error, 'Create marketplace listing');
    return data;
  }

  const store = loadLocalStore();
  const now = new Date().toISOString();
  const listing = {
    id: nextSequence(store, 'land_listings'),
    title_id: titleId,
    application_id: applicationId,
    seller_id: sellerId,
    seller_wallet: sellerWallet,
    buyer_id: null,
    buyer_wallet: null,
    price_wei: String(priceWei),
    price_pol: Number(pricePol),
    price_usd: resolvedPriceUsd,
    price_anagu: resolvedPriceAnagu,
    headline: headline || '',
    description: description || '',
    verification_status: verificationStatus,
    listing_status: 'LISTED',
    escrow_tx_hash: null,
    settlement_tx_hash: null,
    created_at: now,
    updated_at: now,
  };
  store.tables.land_listings.push(listing);
  saveLocalStore(store);
  return listing;
}

export async function attachTitleToListing({
  listingId,
  titleId,
  sellerWallet = '',
  verificationStatus = 'VERIFIED',
  listingStatus = 'LISTED',
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE land_listings
       SET title_id = $1,
           seller_wallet = COALESCE(NULLIF($2, ''), seller_wallet),
           verification_status = $3,
           listing_status = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [titleId, sellerWallet, verificationStatus, listingStatus, Number(listingId)]
    );
    return res.rows[0] || null;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const patch = {
      title_id: titleId,
      verification_status: verificationStatus,
      listing_status: listingStatus,
      updated_at: new Date().toISOString(),
    };
    if (sellerWallet) {
      patch.seller_wallet = sellerWallet;
    }
    const { data, error } = await sb
      .from('land_listings')
      .update(patch)
      .eq('id', Number(listingId))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Attach title to listing');
    return data || null;
  }

  const store = loadLocalStore();
  const listing = (store.tables.land_listings || []).find((l) => l.id === Number(listingId));
  if (!listing) return null;
  listing.title_id = titleId;
  if (sellerWallet) {
    listing.seller_wallet = sellerWallet;
  }
  listing.verification_status = verificationStatus;
  listing.listing_status = listingStatus;
  listing.updated_at = new Date().toISOString();
  saveLocalStore(store);
  return listing;
}

export async function findListingByApplicationId(applicationId) {
  const numericAppId = Number(applicationId);
  const all = await listMarketplaceListings({ includePendingAdmin: true });
  return (
    all.find(
      (l) =>
        Number(l.application_id) === numericAppId &&
        l.listing_status !== 'CANCELLED' &&
        l.listing_status !== 'COMPLETED'
    ) ||
    all.find((l) => Number(l.application_id) === numericAppId) ||
    null
  );
}

export async function updateListingAdminRejected(listingId) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE land_listings
       SET verification_status = 'ADMIN_REJECTED',
           listing_status = 'CANCELLED',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [Number(listingId)]
    );
    return res.rows[0] || null;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('land_listings')
      .update({
        verification_status: 'ADMIN_REJECTED',
        listing_status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(listingId))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Reject listing');
    return data || null;
  }

  const store = loadLocalStore();
  const listing = (store.tables.land_listings || []).find((l) => l.id === Number(listingId));
  if (!listing) return null;
  listing.verification_status = 'ADMIN_REJECTED';
  listing.listing_status = 'CANCELLED';
  listing.updated_at = new Date().toISOString();
  saveLocalStore(store);
  return listing;
}

export async function findTitleVerificationContext(titleId) {
  const numericTitleId = Number(titleId);
  if (env.pg.enabled) {
    const pool = getPgPool();
    const title = await findTitleById(numericTitleId);
    if (!title) return null;
    const [appRes, parcelRes, verRes] = await Promise.all([
      pool.query('SELECT * FROM land_applications WHERE id = $1 LIMIT 1', [title.application_id]),
      pool.query('SELECT * FROM land_parcels WHERE id = $1 LIMIT 1', [title.parcel_id]),
      pool.query(
        'SELECT * FROM verification_records WHERE application_id = $1 ORDER BY verified_at DESC',
        [title.application_id]
      ),
    ]);
    return {
      title,
      application: appRes.rows[0] || null,
      parcel: parcelRes.rows[0] || null,
      verificationRecords: verRes.rows || [],
    };
  }

  if (isSupabaseActive()) {
    const title = await findTitleById(numericTitleId);
    if (!title) return null;
    const sb = getSupabaseClient();
    const [appRes, parcelRes, verRes] = await Promise.all([
      sb.from('land_applications').select('*').eq('id', title.application_id).maybeSingle(),
      sb.from('land_parcels').select('*').eq('id', title.parcel_id).maybeSingle(),
      sb
        .from('verification_records')
        .select('*')
        .eq('application_id', title.application_id)
        .order('verified_at', { ascending: false }),
    ]);
    assertNoSupabaseError(appRes.error, 'Find title context application');
    assertNoSupabaseError(parcelRes.error, 'Find title context parcel');
    assertNoSupabaseError(verRes.error, 'Find title context verifications');
    return {
      title,
      application: appRes.data || null,
      parcel: parcelRes.data || null,
      verificationRecords: verRes.data || [],
    };
  }

  const title = await findTitleById(numericTitleId);
  if (!title) return null;
  const store = loadLocalStore();
  const application =
    (store.tables.land_applications || []).find((a) => a.id === title.application_id) || null;
  const parcel = (store.tables.land_parcels || []).find((p) => p.id === title.parcel_id) || null;
  const verificationRecords = (store.tables.verification_records || []).filter(
    (v) => v.application_id === title.application_id
  );
  return { title, application, parcel, verificationRecords };
}

export async function findApplicationVerificationContext(applicationId) {
  const numericAppId = Number(applicationId);
  if (env.pg.enabled) {
    const pool = getPgPool();
    const [appRes, parcelRes, verRes, titleRes] = await Promise.all([
      pool.query('SELECT * FROM land_applications WHERE id = $1 LIMIT 1', [numericAppId]),
      pool.query('SELECT * FROM land_parcels WHERE application_id = $1 LIMIT 1', [numericAppId]),
      pool.query(
        'SELECT * FROM verification_records WHERE application_id = $1 ORDER BY verified_at DESC',
        [numericAppId]
      ),
      pool.query('SELECT * FROM land_titles WHERE application_id = $1 LIMIT 1', [numericAppId]),
    ]);
    const application = appRes.rows[0] || null;
    if (!application) return null;
    const title = titleRes.rows[0] ? await findTitleById(titleRes.rows[0].id) : null;
    return {
      application,
      parcel: parcelRes.rows[0] || null,
      verificationRecords: verRes.rows || [],
      title,
    };
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [appRes, parcelRes, verRes, titleRes] = await Promise.all([
      sb.from('land_applications').select('*').eq('id', numericAppId).maybeSingle(),
      sb.from('land_parcels').select('*').eq('application_id', numericAppId).maybeSingle(),
      sb
        .from('verification_records')
        .select('*')
        .eq('application_id', numericAppId)
        .order('verified_at', { ascending: false }),
      sb.from('land_titles').select('id').eq('application_id', numericAppId).maybeSingle(),
    ]);
    assertNoSupabaseError(appRes.error, 'Find application verification context');
    assertNoSupabaseError(parcelRes.error, 'Find application context parcel');
    assertNoSupabaseError(verRes.error, 'Find application context verifications');
    assertNoSupabaseError(titleRes.error, 'Find application context title');
    const application = appRes.data || null;
    if (!application) return null;
    const title = titleRes.data ? await findTitleById(titleRes.data.id) : null;
    return {
      application,
      parcel: parcelRes.data || null,
      verificationRecords: verRes.data || [],
      title,
    };
  }

  const store = loadLocalStore();
  const application =
    (store.tables.land_applications || []).find((a) => a.id === numericAppId) || null;
  if (!application) return null;
  const parcel =
    (store.tables.land_parcels || []).find((p) => p.application_id === numericAppId) || null;
  const verificationRecords = (store.tables.verification_records || []).filter(
    (v) => v.application_id === numericAppId
  );
  const rawTitle =
    (store.tables.land_titles || []).find((t) => t.application_id === numericAppId) || null;
  const title = rawTitle ? await findTitleById(rawTitle.id) : null;
  return { application, parcel, verificationRecords, title };
}

export async function listVerificationContextsForUser(user) {
  const isAdmin = user?.roleCode === 'LAND_ADMIN';
  const allTitles = await listTitles();

  if (env.pg.enabled) {
    const pool = getPgPool();
    const [appsRes, parcelsRes, versRes] = await Promise.all([
      isAdmin
        ? pool.query('SELECT * FROM land_applications ORDER BY updated_at DESC')
        : pool.query(
            `SELECT DISTINCT la.* FROM land_applications la
             LEFT JOIN land_titles lt ON lt.application_id = la.id
             WHERE (lt.id IS NOT NULL AND lt.owner_id = $1)
                OR (lt.id IS NULL AND la.applicant_id = $1)
             ORDER BY la.updated_at DESC`,
            [user.id]
          ),
      pool.query('SELECT * FROM land_parcels'),
      pool.query('SELECT * FROM verification_records ORDER BY verified_at DESC'),
    ]);
    const parcelsByApp = new Map(parcelsRes.rows.map((p) => [p.application_id, p]));
    const titlesByApp = new Map(allTitles.map((t) => [t.application_id, t]));
    const versByApp = new Map();
    for (const v of versRes.rows) {
      if (!versByApp.has(v.application_id)) versByApp.set(v.application_id, []);
      versByApp.get(v.application_id).push(v);
    }
    return appsRes.rows.map((application) => ({
      application,
      parcel: parcelsByApp.get(application.id) || null,
      verificationRecords: versByApp.get(application.id) || [],
      title: titlesByApp.get(application.id) || null,
    }));
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [appsRes, parcelsRes, versRes] = await Promise.all([
      sb.from('land_applications').select('*').order('updated_at', { ascending: false }),
      sb.from('land_parcels').select('*'),
      sb.from('verification_records').select('*').order('verified_at', { ascending: false }),
    ]);
    assertNoSupabaseError(appsRes.error, 'List user verification applications');
    assertNoSupabaseError(parcelsRes.error, 'List user verification parcels');
    assertNoSupabaseError(versRes.error, 'List user verification records');

    const parcelsByApp = new Map((parcelsRes.data || []).map((p) => [p.application_id, p]));
    const titlesByApp = new Map(allTitles.map((t) => [t.application_id, t]));
    const versByApp = new Map();
    for (const v of versRes.data || []) {
      if (!versByApp.has(v.application_id)) versByApp.set(v.application_id, []);
      versByApp.get(v.application_id).push(v);
    }

    return (appsRes.data || [])
      .filter((app) => {
        if (isAdmin) return true;
        const title = titlesByApp.get(app.id);
        if (title) return title.owner_id === user.id;
        return app.applicant_id === user.id;
      })
      .map((application) => ({
        application,
        parcel: parcelsByApp.get(application.id) || null,
        verificationRecords: versByApp.get(application.id) || [],
        title: titlesByApp.get(application.id) || null,
      }));
  }

  const store = loadLocalStore();
  const parcelsByApp = new Map((store.tables.land_parcels || []).map((p) => [p.application_id, p]));
  const titlesByApp = new Map(allTitles.map((t) => [t.application_id, t]));
  const versByApp = new Map();
  for (const v of store.tables.verification_records || []) {
    if (!versByApp.has(v.application_id)) versByApp.set(v.application_id, []);
    versByApp.get(v.application_id).push(v);
  }

  return [...(store.tables.land_applications || [])]
    .filter((app) => {
      if (isAdmin) return true;
      const title = titlesByApp.get(app.id);
      if (title) return title.owner_id === user.id;
      return app.applicant_id === user.id;
    })
    .sort((a, b) => new Date(b.updated_at || b.submitted_at) - new Date(a.updated_at || a.submitted_at))
    .map((application) => ({
      application,
      parcel: parcelsByApp.get(application.id) || null,
      verificationRecords: versByApp.get(application.id) || [],
      title: titlesByApp.get(application.id) || null,
    }));
}

export async function updateListingEscrowFunded({ listingId, buyerId, buyerWallet, escrowTxHash }) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE land_listings
       SET buyer_id = $1, buyer_wallet = $2, escrow_tx_hash = $3,
           listing_status = 'ESCROW_FUNDED', updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [buyerId, buyerWallet, escrowTxHash, listingId]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('land_listings')
      .update({
        buyer_id: buyerId,
        buyer_wallet: buyerWallet,
        escrow_tx_hash: escrowTxHash,
        listing_status: 'ESCROW_FUNDED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(listingId))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Update listing escrow funded');
    return data || null;
  }

  const store = loadLocalStore();
  const listing = (store.tables.land_listings || []).find((l) => l.id === Number(listingId));
  if (!listing) return null;
  listing.buyer_id = buyerId;
  listing.buyer_wallet = buyerWallet;
  listing.escrow_tx_hash = escrowTxHash;
  listing.listing_status = 'ESCROW_FUNDED';
  listing.updated_at = new Date().toISOString();
  saveLocalStore(store);
  return listing;
}

export async function completeListingSale({ listingId, settlementTxHash }) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const listingRes = await pool.query(
      `UPDATE land_listings
       SET listing_status = 'COMPLETED', settlement_tx_hash = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [settlementTxHash, listingId]
    );
    const listing = listingRes.rows[0];
    await pool.query('UPDATE land_titles SET owner_id = $1 WHERE id = $2', [
      listing.buyer_id,
      listing.title_id,
    ]);
    return listing;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data: listing, error } = await sb
      .from('land_listings')
      .update({
        listing_status: 'COMPLETED',
        settlement_tx_hash: settlementTxHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(listingId))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Complete listing sale');
    if (listing && listing.title_id && listing.buyer_id) {
      const { error: titleErr } = await sb
        .from('land_titles')
        .update({ owner_id: listing.buyer_id })
        .eq('id', listing.title_id);
      assertNoSupabaseError(titleErr, 'Transfer title ownership after sale');
    }
    return listing || null;
  }

  const store = loadLocalStore();
  const listing = (store.tables.land_listings || []).find((l) => l.id === Number(listingId));
  if (!listing) return null;
  listing.listing_status = 'COMPLETED';
  listing.settlement_tx_hash = settlementTxHash;
  listing.updated_at = new Date().toISOString();

  const title = (store.tables.land_titles || []).find((t) => t.id === listing.title_id);
  if (title && listing.buyer_id) {
    title.owner_id = listing.buyer_id;
  }
  saveLocalStore(store);
  return listing;
}

export async function cancelListingRecord(listingId) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE land_listings SET listing_status = 'CANCELLED', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [listingId]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('land_listings')
      .update({
        listing_status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(listingId))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Cancel listing');
    return data || null;
  }

  const store = loadLocalStore();
  const listing = (store.tables.land_listings || []).find((l) => l.id === Number(listingId));
  if (!listing) return null;
  listing.listing_status = 'CANCELLED';
  listing.updated_at = new Date().toISOString();
  saveLocalStore(store);
  return listing;
}

const buyerVerificationReceiptCache = new Map();

export async function findListingVerificationContext(listingId) {
  const numericId = Number(listingId);
  const listings = await listMarketplaceListings({ includePendingAdmin: true });
  const listing = listings.find((l) => l.id === numericId) || null;
  if (!listing) return null;

  const baseCtx = listing.title_id
    ? await findTitleVerificationContext(listing.title_id)
    : listing.application_id
    ? await findApplicationVerificationContext(listing.application_id)
    : null;
  if (!baseCtx) return null;

  const resolvedAppId = baseCtx.title?.application_id ?? baseCtx.application?.id ?? listing.application_id;

  if (env.pg.enabled) {
    const pool = getPgPool();
    const [docsRes, recsRes, parcelsRes] = await Promise.all([
      resolvedAppId
        ? pool.query('SELECT * FROM supporting_documents WHERE application_id = $1', [resolvedAppId])
        : Promise.resolve({ rows: [] }),
      pool.query('SELECT * FROM ownership_records ORDER BY id ASC'),
      pool.query(
        'SELECT *, ST_AsGeoJSON(boundary)::jsonb AS boundary_geojson FROM land_parcels'
      ),
    ]);
    return {
      listing,
      ...baseCtx,
      documents: docsRes.rows || [],
      ownershipRecords: recsRes.rows || [],
      existingParcels: parcelsRes.rows || [],
    };
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [docsRes, recsRes, parcelsRes] = await Promise.all([
      resolvedAppId
        ? sb.from('supporting_documents').select('*').eq('application_id', resolvedAppId)
        : Promise.resolve({ data: [], error: null }),
      sb.from('ownership_records').select('*').order('id', { ascending: true }),
      sb.from('land_parcels').select('*'),
    ]);
    assertNoSupabaseError(docsRes.error, 'Find listing verification documents');
    assertNoSupabaseError(recsRes.error, 'Find listing verification ownership records');
    assertNoSupabaseError(parcelsRes.error, 'Find listing verification parcels');
    return {
      listing,
      ...baseCtx,
      documents: docsRes.data || [],
      ownershipRecords: recsRes.data || [],
      existingParcels: parcelsRes.data || [],
    };
  }

  const store = loadLocalStore();
  const documents = resolvedAppId
    ? (store.tables.supporting_documents || []).filter((d) => d.application_id === resolvedAppId)
    : [];
  const ownershipRecords = store.tables.ownership_records || [];
  const existingParcels = store.tables.land_parcels || [];

  return {
    listing,
    ...baseCtx,
    documents,
    ownershipRecords,
    existingParcels,
  };
}

export function recordBuyerVerificationReceipt({
  listingId,
  buyerId,
  verificationCode,
  verifiedSafeToBuy,
  verifiedAt,
  checks,
}) {
  const key = `${Number(listingId)}:${Number(buyerId)}`;
  const receipt = {
    listingId: Number(listingId),
    buyerId: Number(buyerId),
    verificationCode,
    verifiedSafeToBuy: Boolean(verifiedSafeToBuy),
    verifiedAt,
    checks,
  };
  buyerVerificationReceiptCache.set(key, receipt);
  return receipt;
}

export function findBuyerVerificationReceipt({ listingId, buyerId }) {
  const key = `${Number(listingId)}:${Number(buyerId)}`;
  return buyerVerificationReceiptCache.get(key) || null;
}

