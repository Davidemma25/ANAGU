import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, nextSequence, saveLocalStore } from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

let cachedSupabasePaymentSettings = null;

export async function hydratePaymentSettingsFromSupabase() {
  if (!isSupabaseActive()) return null;
  const sb = getSupabaseClient();
  try {
    const { data, error } = await sb
      .from('payment_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) {
      cachedSupabasePaymentSettings = {
        testFeeNgn: Number(data.test_fee_ngn || env.ethereumPayment.testFeeNgn),
        ethNgnExchangeRate: Number(
          data.eth_ngn_exchange_rate || env.ethereumPayment.ethNgnExchangeRate
        ),
        rateSource: String(data.rate_source || env.ethereumPayment.rateSource),
        quoteTtlSeconds: Number(data.quote_ttl_seconds || env.ethereumPayment.quoteTtlSeconds),
        updatedAt: String(data.updated_at || new Date().toISOString()),
      };
      return cachedSupabasePaymentSettings;
    }
  } catch {
    // Use env defaults if payment_settings row is not yet initialized
  }
  return null;
}

export function getPaymentSettings() {
  if (env.pg.enabled) {
    return {
      testFeeNgn: env.ethereumPayment.testFeeNgn,
      ethNgnExchangeRate: env.ethereumPayment.ethNgnExchangeRate,
      rateSource: env.ethereumPayment.rateSource,
      quoteTtlSeconds: env.ethereumPayment.quoteTtlSeconds,
      updatedAt: new Date().toISOString(),
    };
  }

  if (isSupabaseActive()) {
    const s = cachedSupabasePaymentSettings || {};
    return {
      testFeeNgn: Number(s.testFeeNgn || env.ethereumPayment.testFeeNgn),
      ethNgnExchangeRate: Number(s.ethNgnExchangeRate || env.ethereumPayment.ethNgnExchangeRate),
      rateSource: String(s.rateSource || env.ethereumPayment.rateSource),
      quoteTtlSeconds: Number(s.quoteTtlSeconds || env.ethereumPayment.quoteTtlSeconds),
      updatedAt: String(s.updatedAt || new Date().toISOString()),
    };
  }

  const store = loadLocalStore();
  const s = store.tables.payment_settings || {};
  return {
    testFeeNgn: Number(s.testFeeNgn || env.ethereumPayment.testFeeNgn),
    ethNgnExchangeRate: Number(s.ethNgnExchangeRate || env.ethereumPayment.ethNgnExchangeRate),
    rateSource: String(s.rateSource || env.ethereumPayment.rateSource),
    quoteTtlSeconds: Number(s.quoteTtlSeconds || env.ethereumPayment.quoteTtlSeconds),
    updatedAt: String(s.updatedAt || new Date().toISOString()),
  };
}

export function savePaymentSettings(patch) {
  const current = getPaymentSettings();
  const next = {
    testFeeNgn: patch.testFeeNgn ?? current.testFeeNgn,
    ethNgnExchangeRate: patch.ethNgnExchangeRate ?? current.ethNgnExchangeRate,
    rateSource: patch.rateSource ?? current.rateSource,
    quoteTtlSeconds: patch.quoteTtlSeconds ?? current.quoteTtlSeconds,
    updatedAt: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    cachedSupabasePaymentSettings = next;
    const sb = getSupabaseClient();
    sb.from('payment_settings')
      .upsert(
        {
          id: 1,
          test_fee_ngn: next.testFeeNgn,
          eth_ngn_exchange_rate: next.ethNgnExchangeRate,
          rate_source: next.rateSource,
          quote_ttl_seconds: next.quoteTtlSeconds,
          updated_at: next.updatedAt,
        },
        { onConflict: 'id' }
      )
      .then(({ error }) => {
        if (error) console.warn('Supabase payment_settings sync warning:', error.message);
      });
    return next;
  }

  if (!env.pg.enabled) {
    const store = loadLocalStore();
    store.tables.payment_settings = next;
    saveLocalStore(store);
  }
  return next;
}

export async function expireStalePendingQuotes(
  registrationId,
  nowIso = new Date().toISOString()
) {
  const nowMs = new Date(nowIso).getTime();

  if (env.pg.enabled) {
    const pool = getPgPool();
    if (!pool) return;
    if (registrationId !== undefined) {
      await pool.query(
        `UPDATE payments
         SET payment_status = 'EXPIRED', updated_at = NOW()
         WHERE registration_id = $1
           AND payment_status = 'PENDING'
           AND quote_expires_at IS NOT NULL
           AND quote_expires_at < $2::timestamptz`,
        [registrationId, nowIso]
      );
    } else {
      await pool.query(
        `UPDATE payments
         SET payment_status = 'EXPIRED', updated_at = NOW()
         WHERE payment_status = 'PENDING'
           AND quote_expires_at IS NOT NULL
           AND quote_expires_at < $1::timestamptz`,
        [nowIso]
      );
    }
    return;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    let query = sb
      .from('payments')
      .update({ payment_status: 'EXPIRED', updated_at: nowIso })
      .eq('payment_status', 'PENDING')
      .not('quote_expires_at', 'is', null)
      .lt('quote_expires_at', nowIso);
    if (registrationId !== undefined) {
      query = query.eq('registration_id', Number(registrationId));
    }
    const { error } = await query;
    assertNoSupabaseError(error, 'Expire stale pending quotes');
    return;
  }

  const store = loadLocalStore();
  let changed = false;
  for (const row of store.tables.payments || []) {
    if (registrationId !== undefined && row.registration_id !== registrationId) continue;
    if (
      row.payment_status === 'PENDING' &&
      row.quote_expires_at &&
      new Date(row.quote_expires_at).getTime() < nowMs
    ) {
      row.payment_status = 'EXPIRED';
      row.updated_at = nowIso;
      changed = true;
    }
  }
  if (changed) saveLocalStore(store);
}

export async function createPaymentQuoteRecord(input) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO payments (
        registration_id, registration_reference, user_id, wallet_address,
        network, chain_id, amount_eth, amount_wei, amount_ngn, exchange_rate,
        rate_source, payment_status, contract_address, quote_id, quote_signature, quote_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',$12,$13,$14,$15::timestamptz)
      RETURNING *`,
      [
        input.registrationId,
        input.registrationReference,
        input.userId,
        input.walletAddress,
        input.network,
        input.chainId,
        input.amountEth,
        input.amountWei,
        input.amountNgn,
        input.exchangeRate,
        input.rateSource,
        input.contractAddress,
        input.quoteId,
        input.quoteSignature,
        input.quoteExpiresAt,
      ]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('payments')
      .insert({
        registration_id: input.registrationId,
        registration_reference: input.registrationReference,
        user_id: input.userId,
        wallet_address: input.walletAddress,
        network: input.network,
        chain_id: input.chainId,
        amount_eth: input.amountEth,
        amount_wei: input.amountWei,
        amount_ngn: input.amountNgn,
        exchange_rate: input.exchangeRate,
        rate_source: input.rateSource,
        payment_status: 'PENDING',
        contract_address: input.contractAddress,
        quote_id: input.quoteId,
        quote_signature: input.quoteSignature,
        quote_expires_at: input.quoteExpiresAt,
      })
      .select('*')
      .single();
    assertNoSupabaseError(error, 'Create payment quote record');
    return {
      ...data,
      amount_wei: String(data.amount_wei),
    };
  }

  const store = loadLocalStore();
  const id = nextSequence(store, 'payments');
  const now = new Date().toISOString();
  const record = {
    id,
    registration_id: input.registrationId,
    registration_reference: input.registrationReference,
    user_id: input.userId,
    wallet_address: input.walletAddress,
    transaction_hash: null,
    network: input.network,
    chain_id: input.chainId,
    amount_eth: input.amountEth,
    amount_wei: input.amountWei,
    amount_ngn: input.amountNgn,
    exchange_rate: input.exchangeRate,
    rate_source: input.rateSource,
    payment_status: 'PENDING',
    contract_address: input.contractAddress,
    quote_id: input.quoteId,
    quote_signature: input.quoteSignature,
    quote_expires_at: input.quoteExpiresAt,
    block_number: null,
    confirmations: 0,
    failure_reason: null,
    created_at: now,
    updated_at: now,
    confirmed_at: null,
  };
  store.tables.payments.push(record);
  saveLocalStore(store);
  return record;
}

export async function findPaymentById(id) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM payments WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('payments')
      .select('*')
      .eq('id', Number(id))
      .maybeSingle();
    assertNoSupabaseError(error, 'Find payment by ID');
    return data ? { ...data, amount_wei: String(data.amount_wei) } : null;
  }
  const store = loadLocalStore();
  return (store.tables.payments || []).find((p) => p.id === Number(id)) || null;
}

export async function findPaymentByTxHash(txHash) {
  const normalized = txHash.trim().toLowerCase();
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      'SELECT * FROM payments WHERE LOWER(transaction_hash) = $1 LIMIT 1',
      [normalized]
    );
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('payments')
      .select('*')
      .ilike('transaction_hash', normalized)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find payment by tx hash');
    return data ? { ...data, amount_wei: String(data.amount_wei) } : null;
  }
  const store = loadLocalStore();
  return (
    (store.tables.payments || []).find(
      (p) => (p.transaction_hash || '').toLowerCase() === normalized
    ) || null
  );
}

export async function findPaidPaymentByRegistrationId(registrationId) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      "SELECT * FROM payments WHERE registration_id = $1 AND payment_status = 'PAID' LIMIT 1",
      [registrationId]
    );
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('payments')
      .select('*')
      .eq('registration_id', Number(registrationId))
      .eq('payment_status', 'PAID')
      .maybeSingle();
    assertNoSupabaseError(error, 'Find paid payment by registration ID');
    return data ? { ...data, amount_wei: String(data.amount_wei) } : null;
  }
  const store = loadLocalStore();
  return (
    (store.tables.payments || []).find(
      (p) => p.registration_id === Number(registrationId) && p.payment_status === 'PAID'
    ) || null
  );
}

export async function findLatestPaymentForRegistration(registrationId) {
  const rows = await listPaymentsByRegistrationId(registrationId);
  return rows[0] || null;
}

export async function listPaymentsByRegistrationId(registrationId) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT p.*, la.parcel_name, u.full_name AS payer_name, u.email AS payer_email
       FROM payments p
       JOIN land_applications la ON la.id = p.registration_id
       JOIN users u ON u.id = p.user_id
       WHERE p.registration_id = $1
       ORDER BY p.created_at DESC, p.id DESC`,
      [registrationId]
    );
    return res.rows;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [payRes, appRes, usersRes] = await Promise.all([
      sb
        .from('payments')
        .select('*')
        .eq('registration_id', Number(registrationId))
        .order('id', { ascending: false }),
      sb.from('land_applications').select('id, parcel_name').eq('id', Number(registrationId)).maybeSingle(),
      sb.from('users').select('id, full_name, email'),
    ]);
    assertNoSupabaseError(payRes.error, 'List payments by registration');
    assertNoSupabaseError(appRes.error, 'List payment application');
    assertNoSupabaseError(usersRes.error, 'List payment users');
    const users = new Map((usersRes.data || []).map((u) => [u.id, u]));
    return (payRes.data || []).map((p) => ({
      ...p,
      amount_wei: String(p.amount_wei),
      parcel_name: appRes.data?.parcel_name || '',
      payer_name: users.get(p.user_id)?.full_name || '',
      payer_email: users.get(p.user_id)?.email || '',
    }));
  }
  const store = loadLocalStore();
  const apps = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const users = new Map((store.tables.users || []).map((u) => [u.id, u]));
  return (store.tables.payments || [])
    .filter((p) => p.registration_id === Number(registrationId))
    .sort((a, b) => b.id - a.id)
    .map((p) => ({
      ...p,
      parcel_name: apps.get(p.registration_id)?.parcel_name || '',
      payer_name: users.get(p.user_id)?.full_name || '',
      payer_email: users.get(p.user_id)?.email || '',
    }));
}

export async function listPaymentsForUser(user) {
  const isStaff = user.roleCode !== 'CITIZEN';
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      isStaff
        ? `SELECT p.*, la.parcel_name, u.full_name AS payer_name, u.email AS payer_email
           FROM payments p
           JOIN land_applications la ON la.id = p.registration_id
           JOIN users u ON u.id = p.user_id
           ORDER BY p.created_at DESC, p.id DESC
           LIMIT 100`
        : `SELECT p.*, la.parcel_name, u.full_name AS payer_name, u.email AS payer_email
           FROM payments p
           JOIN land_applications la ON la.id = p.registration_id
           JOIN users u ON u.id = p.user_id
           WHERE p.user_id = $1
           ORDER BY p.created_at DESC, p.id DESC
           LIMIT 100`,
      isStaff ? [] : [user.id]
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    let payQuery = sb.from('payments').select('*').order('id', { ascending: false }).limit(100);
    if (!isStaff) {
      payQuery = payQuery.eq('user_id', user.id);
    }
    const [payRes, appsRes, usersRes] = await Promise.all([
      payQuery,
      sb.from('land_applications').select('id, parcel_name'),
      sb.from('users').select('id, full_name, email'),
    ]);
    assertNoSupabaseError(payRes.error, 'List payments for user');
    assertNoSupabaseError(appsRes.error, 'List payment apps');
    assertNoSupabaseError(usersRes.error, 'List payment users');
    const apps = new Map((appsRes.data || []).map((a) => [a.id, a]));
    const users = new Map((usersRes.data || []).map((u) => [u.id, u]));
    return (payRes.data || []).map((p) => ({
      ...p,
      amount_wei: String(p.amount_wei),
      parcel_name: apps.get(p.registration_id)?.parcel_name || '',
      payer_name: users.get(p.user_id)?.full_name || '',
      payer_email: users.get(p.user_id)?.email || '',
    }));
  }

  const store = loadLocalStore();
  const apps = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const users = new Map((store.tables.users || []).map((u) => [u.id, u]));
  return (store.tables.payments || [])
    .filter((p) => isStaff || p.user_id === user.id)
    .sort((a, b) => b.id - a.id)
    .slice(0, 100)
    .map((p) => ({
      ...p,
      parcel_name: apps.get(p.registration_id)?.parcel_name || '',
      payer_name: users.get(p.user_id)?.full_name || '',
      payer_email: users.get(p.user_id)?.email || '',
    }));
}

export async function updatePaymentRecord(id, patch) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE payments
       SET wallet_address = COALESCE($2, wallet_address),
           transaction_hash = COALESCE($3, transaction_hash),
           payment_status = COALESCE($4, payment_status),
           block_number = COALESCE($5, block_number),
           confirmations = COALESCE($6, confirmations),
           failure_reason = $7,
           confirmed_at = COALESCE($8::timestamptz, confirmed_at),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.wallet_address ?? null,
        patch.transaction_hash ?? null,
        patch.payment_status ?? null,
        patch.block_number ?? null,
        patch.confirmations ?? null,
        patch.failure_reason ?? null,
        patch.confirmed_at ?? null,
      ]
    );
    return res.rows[0] || null;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };
    if (patch.wallet_address !== undefined) updatePayload.wallet_address = patch.wallet_address;
    if (patch.transaction_hash !== undefined) updatePayload.transaction_hash = patch.transaction_hash;
    if (patch.payment_status !== undefined) updatePayload.payment_status = patch.payment_status;
    if (patch.block_number !== undefined) updatePayload.block_number = patch.block_number;
    if (patch.confirmations !== undefined) updatePayload.confirmations = patch.confirmations;
    if (patch.failure_reason !== undefined) updatePayload.failure_reason = patch.failure_reason;
    if (patch.confirmed_at !== undefined) updatePayload.confirmed_at = patch.confirmed_at;

    const { data, error } = await sb
      .from('payments')
      .update(updatePayload)
      .eq('id', Number(id))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Update payment record');
    return data ? { ...data, amount_wei: String(data.amount_wei) } : null;
  }

  const store = loadLocalStore();
  const row = (store.tables.payments || []).find((p) => p.id === Number(id));
  if (!row) return null;
  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  saveLocalStore(store);
  return row;
}

export async function recordEventLogIdempotently(input) {
  const normalizedHash = input.txHash.trim().toLowerCase();
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO payment_event_logs (
        tx_hash, log_index, block_number, registration_reference, payer_address, amount_wei
      ) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tx_hash, log_index) DO NOTHING
      RETURNING id`,
      [
        normalizedHash,
        input.logIndex,
        input.blockNumber,
        input.registrationReference,
        input.payerAddress,
        input.amountWei,
      ]
    );
    return { inserted: (res.rowCount || 0) > 0 };
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data: existing } = await sb
      .from('payment_event_logs')
      .select('id')
      .eq('tx_hash', normalizedHash)
      .eq('log_index', input.logIndex)
      .maybeSingle();
    if (existing) {
      return { inserted: false };
    }
    const { error } = await sb.from('payment_event_logs').insert({
      tx_hash: normalizedHash,
      log_index: input.logIndex,
      block_number: input.blockNumber,
      registration_reference: input.registrationReference,
      payer_address: input.payerAddress,
      amount_wei: input.amountWei,
    });
    if (error?.code === '23505') {
      return { inserted: false };
    }
    assertNoSupabaseError(error, 'Record payment event log');
    return { inserted: true };
  }

  const store = loadLocalStore();
  store.tables.payment_event_logs = store.tables.payment_event_logs || [];
  const exists = store.tables.payment_event_logs.some(
    (e) =>
      String(e.tx_hash || '').toLowerCase() === normalizedHash &&
      Number(e.log_index) === Number(input.logIndex)
  );
  if (exists) {
    return { inserted: false };
  }
  store.tables.payment_event_logs.push({
    id: nextSequence(store, 'payment_event_logs'),
    tx_hash: normalizedHash,
    log_index: input.logIndex,
    block_number: input.blockNumber,
    registration_reference: input.registrationReference,
    payer_address: input.payerAddress,
    amount_wei: input.amountWei,
    processed_at: new Date().toISOString(),
  });
  saveLocalStore(store);
  return { inserted: true };
}
