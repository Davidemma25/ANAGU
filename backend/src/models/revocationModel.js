import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, saveLocalStore, nextSequence } from '../config/db.js';
import { assertNoSupabaseError, getSupabaseClient, isSupabaseActive } from '../config/supabase.js';

export const ALLOWED_REVOCATION_GROUNDS = [
  'OverridingPublicInterest',
  'BreachOfStatutoryCondition',
];

export async function listRevocationRecords() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT rr.*, lt.title_number, lt.token_id, lt.title_status, lt.contract_address,
              lp.parcel_code, lp.area_sqm,
              la.reference_code, la.parcel_name, la.region,
              own.full_name AS owner_name, own.wallet_address AS owner_wallet,
              gov.full_name AS governor_name
       FROM revocation_records rr
       JOIN land_titles lt ON lt.id = rr.title_id
       JOIN land_parcels lp ON lp.id = lt.parcel_id
       JOIN land_applications la ON la.id = lt.application_id
       JOIN users own ON own.id = lt.owner_id
       JOIN users gov ON gov.id = rr.governor_id
       ORDER BY rr.revoked_at DESC`
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const [
      { data: revocations, error: revErr },
      { data: titles },
      { data: parcels },
      { data: apps },
      { data: users },
    ] = await Promise.all([
      supabase.from('revocation_records').select('*').order('revoked_at', { ascending: false }),
      supabase.from('land_titles').select('*'),
      supabase.from('land_parcels').select('id, parcel_code, area_sqm'),
      supabase.from('land_applications').select('id, reference_code, parcel_name, region'),
      supabase.from('users').select('id, full_name, wallet_address'),
    ]);
    assertNoSupabaseError(revErr, 'List revocations in Supabase');
    const titlesById = new Map((titles || []).map((t) => [t.id, t]));
    const parcelsById = new Map((parcels || []).map((p) => [p.id, p]));
    const appsById = new Map((apps || []).map((a) => [a.id, a]));
    const usersById = new Map((users || []).map((u) => [u.id, u]));

    return (revocations || []).map((rr) => {
      const title = titlesById.get(rr.title_id);
      const parcel = parcelsById.get(title?.parcel_id);
      const app = appsById.get(title?.application_id);
      const owner = usersById.get(title?.owner_id);
      const governor = usersById.get(rr.governor_id);
      return {
        ...rr,
        title_number: title?.title_number || '',
        token_id: title?.token_id || '',
        title_status: title?.title_status || 'REVOKED',
        contract_address: title?.contract_address || '',
        parcel_code: parcel?.parcel_code || '',
        area_sqm: parcel?.area_sqm || 0,
        reference_code: app?.reference_code || '',
        parcel_name: app?.parcel_name || '',
        region: app?.region || '',
        owner_name: owner?.full_name || 'Unknown',
        owner_wallet: owner?.wallet_address || '',
        governor_name: governor?.full_name || 'Administrator',
      };
    });
  }

  const store = loadLocalStore();
  const titlesById = new Map((store.tables.land_titles || []).map((t) => [t.id, t]));
  const parcelsById = new Map((store.tables.land_parcels || []).map((p) => [p.id, p]));
  const appsById = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const usersById = new Map((store.tables.users || []).map((u) => [u.id, u]));

  return [...(store.tables.revocation_records || [])]
    .sort((a, b) => new Date(b.revoked_at) - new Date(a.revoked_at))
    .map((rr) => {
      const title = titlesById.get(rr.title_id);
      const parcel = parcelsById.get(title?.parcel_id);
      const app = appsById.get(title?.application_id);
      const owner = usersById.get(title?.owner_id);
      const governor = usersById.get(rr.governor_id);
      return {
        ...rr,
        title_number: title?.title_number || '',
        token_id: title?.token_id || '',
        title_status: title?.title_status || 'REVOKED',
        contract_address: title?.contract_address || '',
        parcel_code: parcel?.parcel_code || '',
        area_sqm: parcel?.area_sqm || 0,
        reference_code: app?.reference_code || '',
        parcel_name: app?.parcel_name || '',
        region: app?.region || '',
        owner_name: owner?.full_name || 'Unknown',
        owner_wallet: owner?.wallet_address || '',
        governor_name: governor?.full_name || 'Administrator',
      };
    });
}

export async function executeStatutoryRevocationRecord({
  titleId,
  governorId,
  ground,
  reason,
  txHash,
}) {
  const numericTitleId = Number(titleId);

  if (env.pg.enabled) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const titleRes = await client.query('SELECT * FROM land_titles WHERE id = $1 LIMIT 1', [
        numericTitleId,
      ]);
      const title = titleRes.rows[0];
      if (!title) {
        throw new Error('Land title not found.');
      }

      await client.query("UPDATE land_titles SET title_status = 'REVOKED' WHERE id = $1", [
        numericTitleId,
      ]);
      await client.query("UPDATE land_parcels SET status = 'REVOKED' WHERE id = $1", [
        title.parcel_id,
      ]);
      await client.query(
        "UPDATE land_applications SET status = 'REVOKED', updated_at = NOW() WHERE id = $1",
        [title.application_id]
      );
      const blockedListings = await client.query(
        `UPDATE land_listings
         SET listing_status = 'BLOCKED_REVOKED', updated_at = NOW()
         WHERE title_id = $1 AND listing_status IN ('LISTED', 'ESCROW_FUNDED')
         RETURNING id`,
        [numericTitleId]
      );

      const revRes = await client.query(
        `INSERT INTO revocation_records (title_id, governor_id, ground, reason, tx_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [numericTitleId, governorId, ground, reason.trim(), txHash]
      );

      await client.query('COMMIT');
      return {
        revocation: revRes.rows[0],
        blockedListingCount: blockedListings.rowCount,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: title, error: titleErr } = await supabase
      .from('land_titles')
      .select('*')
      .eq('id', numericTitleId)
      .maybeSingle();
    assertNoSupabaseError(titleErr, 'Find land title for revocation in Supabase');
    if (!title) {
      throw new Error('Land title not found.');
    }

    const now = new Date().toISOString();
    const [updTitle, updParcel, updApp, updListings] = await Promise.all([
      supabase.from('land_titles').update({ title_status: 'REVOKED' }).eq('id', numericTitleId),
      supabase.from('land_parcels').update({ status: 'REVOKED' }).eq('id', title.parcel_id),
      supabase
        .from('land_applications')
        .update({ status: 'REVOKED', updated_at: now })
        .eq('id', title.application_id),
      supabase
        .from('land_listings')
        .update({ listing_status: 'BLOCKED_REVOKED', updated_at: now })
        .eq('title_id', numericTitleId)
        .in('listing_status', ['LISTED', 'ESCROW_FUNDED'])
        .select('id'),
    ]);
    assertNoSupabaseError(updTitle.error, 'Revoke land_title in Supabase');
    assertNoSupabaseError(updParcel.error, 'Revoke land_parcel in Supabase');
    assertNoSupabaseError(updApp.error, 'Revoke land_application in Supabase');
    assertNoSupabaseError(updListings.error, 'Block revoked land_listings in Supabase');

    const { data: revocation, error: revErr } = await supabase
      .from('revocation_records')
      .insert({
        title_id: numericTitleId,
        governor_id: governorId,
        ground,
        reason: reason.trim(),
        tx_hash: txHash,
      })
      .select('*')
      .single();
    assertNoSupabaseError(revErr, 'Insert revocation record in Supabase');

    return {
      revocation,
      blockedListingCount: (updListings.data || []).length,
    };
  }

  const store = loadLocalStore();
  const title = (store.tables.land_titles || []).find((t) => t.id === numericTitleId);
  if (!title) {
    throw new Error('Land title not found.');
  }

  const now = new Date().toISOString();
  title.title_status = 'REVOKED';

  const parcel = (store.tables.land_parcels || []).find((p) => p.id === title.parcel_id);
  if (parcel) parcel.status = 'REVOKED';

  const app = (store.tables.land_applications || []).find((a) => a.id === title.application_id);
  if (app) {
    app.status = 'REVOKED';
    app.updated_at = now;
  }

  let blockedListingCount = 0;
  for (const listing of store.tables.land_listings || []) {
    if (
      listing.title_id === numericTitleId &&
      ['LISTED', 'ESCROW_FUNDED'].includes(listing.listing_status)
    ) {
      listing.listing_status = 'BLOCKED_REVOKED';
      listing.updated_at = now;
      blockedListingCount += 1;
    }
  }

  const revocation = {
    id: nextSequence(store, 'revocation_records'),
    title_id: numericTitleId,
    governor_id: governorId,
    ground,
    reason: reason.trim(),
    tx_hash: txHash,
    revoked_at: now,
  };
  store.tables.revocation_records.push(revocation);
  saveLocalStore(store);

  return { revocation, blockedListingCount };
}
