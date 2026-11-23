import { getPgPool, loadLocalStore, nextSequence, saveLocalStore } from '../config/db.js';
import { env } from '../config/env.js';
import { assertNoSupabaseError, getSupabaseClient, isSupabaseActive } from '../config/supabase.js';

export async function createNotificationRecord({
  userId = null,
  targetRole = 'ALL',
  topic,
  eventType,
  payload,
  deliveryStatus = 'PUBLISHED',
  retryCount = 0,
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `
      INSERT INTO notifications (
        user_id, target_role, topic, event_type, payload, delivery_status, retry_count
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING *
      `,
      [
        userId ? Number(userId) : null,
        targetRole || null,
        topic,
        eventType,
        JSON.stringify(payload || {}),
        deliveryStatus,
        retryCount,
      ]
    );
    return res.rows[0];
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId ? Number(userId) : null,
        target_role: targetRole || null,
        topic,
        event_type: eventType,
        payload: payload || {},
        delivery_status: deliveryStatus,
        retry_count: retryCount,
      })
      .select('*')
      .single();
    assertNoSupabaseError(error, 'Create notification in Supabase');
    return data;
  }

  const store = loadLocalStore();
  const id = nextSequence(store, 'notifications');
  const record = {
    id,
    user_id: userId ? Number(userId) : null,
    target_role: targetRole || null,
    topic,
    event_type: eventType,
    payload: payload || {},
    delivery_status: deliveryStatus,
    retry_count: retryCount,
    is_read: false,
    created_at: new Date().toISOString(),
  };

  store.tables.notifications.push(record);
  saveLocalStore(store);
  return record;
}

export async function updateNotificationDelivery(id, { deliveryStatus, retryCount, payload }) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `
      UPDATE notifications
      SET delivery_status = $2,
          retry_count = $3,
          payload = COALESCE($4::jsonb, payload)
      WHERE id = $1
      RETURNING *
      `,
      [Number(id), deliveryStatus, retryCount, payload ? JSON.stringify(payload) : null]
    );
    return res.rows[0] || null;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const patch = { delivery_status: deliveryStatus, retry_count: retryCount };
    if (payload) patch.payload = payload;
    const { data, error } = await supabase
      .from('notifications')
      .update(patch)
      .eq('id', Number(id))
      .select('*')
      .maybeSingle();
    assertNoSupabaseError(error, 'Update notification delivery in Supabase');
    return data || null;
  }

  const store = loadLocalStore();
  const idx = (store.tables.notifications || []).findIndex((n) => n.id === Number(id));
  if (idx === -1) return null;

  store.tables.notifications[idx] = {
    ...store.tables.notifications[idx],
    delivery_status: deliveryStatus,
    retry_count: retryCount,
    payload: payload || store.tables.notifications[idx].payload,
  };
  saveLocalStore(store);
  return store.tables.notifications[idx];
}

function isVisibleToUser(notification, user) {
  if (!user) return false;
  if (user.roleCode === 'LAND_ADMIN') return true;
  if (notification.user_id && Number(notification.user_id) === Number(user.id)) return true;
  if (notification.target_role === user.roleCode) return true;
  if (notification.target_role === 'ALL') return true;
  return false;
}

export async function listNotificationsForUser(user, { limit = 60, status } = {}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const params = [];
    const clauses = [];

    if (user.roleCode !== 'LAND_ADMIN') {
      params.push(user.id, user.roleCode);
      clauses.push(`(user_id = $1 OR target_role = $2 OR target_role = 'ALL')`);
    }
    if (status) {
      params.push(status);
      clauses.push(`delivery_status = $${params.length}`);
    }

    params.push(Number(limit));
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await pool.query(
      `
      SELECT * FROM notifications
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
      `,
      params
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('notifications')
      .select('*')
      .order('id', { ascending: false })
      .limit(Math.max(Number(limit) * 3, 200));
    if (status) {
      query = query.eq('delivery_status', status);
    }
    const { data, error } = await query;
    assertNoSupabaseError(error, 'List notifications in Supabase');
    return (data || []).filter((n) => isVisibleToUser(n, user)).slice(0, Number(limit));
  }

  const store = loadLocalStore();
  return (store.tables.notifications || [])
    .filter((n) => isVisibleToUser(n, user))
    .filter((n) => (!status ? true : n.delivery_status === status))
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, Number(limit));
}

export async function getNotificationStatsForUser(user) {
  const allVisible = await listNotificationsForUser(user, { limit: 500 });
  const unreadCount = allVisible.filter((n) => !n.is_read).length;
  const queuedCount = allVisible.filter((n) => n.delivery_status === 'QUEUED').length;
  const publishedCount = allVisible.filter((n) => n.delivery_status === 'PUBLISHED').length;
  const failedCount = allVisible.filter((n) => n.delivery_status === 'FAILED').length;

  return {
    totalVisible: allVisible.length,
    unreadCount,
    queuedCount,
    publishedCount,
    failedCount,
  };
}

export async function markNotificationRead(id, user) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1
        AND ($2 = 'LAND_ADMIN' OR user_id = $3 OR target_role = $2 OR target_role = 'ALL')
      RETURNING *
      `,
      [Number(id), user.roleCode, user.id]
    );
    return res.rows[0] || null;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: existing, error: findErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', Number(id))
      .maybeSingle();
    assertNoSupabaseError(findErr, 'Find notification in Supabase');
    if (!existing || !isVisibleToUser(existing, user)) return null;
    const { data: updated, error: updErr } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', Number(id))
      .select('*')
      .single();
    assertNoSupabaseError(updErr, 'Mark notification read in Supabase');
    return updated;
  }

  const store = loadLocalStore();
  const idx = (store.tables.notifications || []).findIndex(
    (n) => n.id === Number(id) && isVisibleToUser(n, user)
  );
  if (idx === -1) return null;

  store.tables.notifications[idx].is_read = true;
  saveLocalStore(store);
  return store.tables.notifications[idx];
}

export async function markAllNotificationsRead(user) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE is_read = FALSE
        AND ($1 = 'LAND_ADMIN' OR user_id = $2 OR target_role = $1 OR target_role = 'ALL')
      `,
      [user.roleCode, user.id]
    );
    return res.rowCount || 0;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: unread, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('is_read', false);
    assertNoSupabaseError(error, 'List unread notifications in Supabase');
    const visibleIds = (unread || []).filter((n) => isVisibleToUser(n, user)).map((n) => n.id);
    if (visibleIds.length === 0) return 0;
    const { error: updErr } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', visibleIds);
    assertNoSupabaseError(updErr, 'Mark all notifications read in Supabase');
    return visibleIds.length;
  }

  const store = loadLocalStore();
  let updated = 0;
  for (const n of store.tables.notifications || []) {
    if (!n.is_read && isVisibleToUser(n, user)) {
      n.is_read = true;
      updated += 1;
    }
  }
  if (updated > 0) {
    saveLocalStore(store);
  }
  return updated;
}

export async function listQueuedNotifications() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `
      SELECT * FROM notifications
      WHERE delivery_status IN ('QUEUED', 'FAILED')
      ORDER BY id ASC
      `
    );
    return res.rows;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .in('delivery_status', ['QUEUED', 'FAILED'])
      .order('id', { ascending: true });
    assertNoSupabaseError(error, 'List queued notifications in Supabase');
    return data || [];
  }

  const store = loadLocalStore();
  return (store.tables.notifications || [])
    .filter((n) => ['QUEUED', 'FAILED'].includes(n.delivery_status))
    .slice()
    .sort((a, b) => a.id - b.id);
}
