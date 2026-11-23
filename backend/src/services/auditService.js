import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, saveLocalStore, nextSequence } from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

/**
 * @param {{
 *   actorId?: number | null,
 *   actorRole?: string,
 *   action: string,
 *   entityType: string,
 *   entityId: string | number,
 *   details?: Record<string, any>,
 *   ipAddress?: string,
 * }} params
 */
export async function recordAuditLog({
  actorId = null,
  actorRole = 'SYSTEM',
  action,
  entityType,
  entityId,
  details = {},
  ipAddress = '127.0.0.1',
}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const result = await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [actorId, actorRole, action, entityType, String(entityId), JSON.stringify(details), ipAddress]
    );
    return result.rows[0];
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('audit_logs')
      .insert({
        actor_id: actorId,
        actor_role: actorRole,
        action,
        entity_type: entityType,
        entity_id: String(entityId),
        details,
        ip_address: ipAddress,
      })
      .select('*')
      .single();
    assertNoSupabaseError(error, 'Record audit log');
    return data;
  }

  const store = loadLocalStore();
  const entry = {
    id: nextSequence(store, 'audit_logs'),
    actor_id: actorId,
    actor_role: actorRole,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    details,
    ip_address: ipAddress,
    created_at: new Date().toISOString(),
  };
  store.tables.audit_logs.push(entry);
  saveLocalStore(store);
  return entry;
}

export async function listAuditLogs({ limit = 100 } = {}) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [logsRes, usersRes] = await Promise.all([
      sb
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit),
      sb.from('users').select('id, full_name, email'),
    ]);
    assertNoSupabaseError(logsRes.error, 'List audit logs');
    assertNoSupabaseError(usersRes.error, 'List audit log users');

    const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));
    return (logsRes.data || []).map((entry) => {
      const actor = usersById.get(entry.actor_id);
      return {
        ...entry,
        actor_name: actor ? actor.full_name : 'System',
        actor_email: actor ? actor.email : null,
      };
    });
  }

  const store = loadLocalStore();
  const usersById = new Map(store.tables.users.map((u) => [u.id, u]));
  return [...store.tables.audit_logs]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map((entry) => {
      const actor = usersById.get(entry.actor_id);
      return {
        ...entry,
        actor_name: actor ? actor.full_name : 'System',
        actor_email: actor ? actor.email : null,
      };
    });
}
