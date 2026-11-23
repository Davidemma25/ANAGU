import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let supabaseClient = null;
let supabaseAuthClient = null;
let supabaseSchemaReady = false;
let lastSchemaError = null;
let lastSchemaCheckAt = 0;

export function getSupabaseClient() {
  if (!env.supabase.enabled || !env.supabase.url || !env.supabase.secretKey) {
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(env.supabase.url, env.supabase.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseClient;
}

export function getSupabaseAuthClient() {
  if (!env.supabase.enabled || !env.supabase.url || !env.supabase.publishableKey) {
    return null;
  }
  if (!supabaseAuthClient) {
    supabaseAuthClient = createClient(env.supabase.url, env.supabase.publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        flowType: 'implicit',
      },
    });
  }
  return supabaseAuthClient;
}

export function isSupabaseSchemaReady() {
  return supabaseSchemaReady;
}

export function isSupabaseActive() {
  if (process.env.SUPABASE_FORCE === 'true') {
    return Boolean(env.supabase.enabled && supabaseSchemaReady);
  }
  if (process.env.ANAGU_STORE_PATH) {
    return false;
  }
  if (env.pg.enabled) {
    return false;
  }
  return Boolean(env.supabase.enabled && supabaseSchemaReady);
}

export function assertNoSupabaseError(error, context = 'Supabase query') {
  if (!error) return;
  const err = new Error(`${context}: ${error.message || 'Unknown Supabase error'}`);
  err.code = error.code;
  err.details = error.details;
  err.hint = error.hint;
  if (error.code === '23505') {
    err.statusCode = 409;
  }
  throw err;
}

export async function checkSupabaseSchemaReady({ force = false } = {}) {
  const client = getSupabaseClient();
  if (!client) {
    supabaseSchemaReady = false;
    lastSchemaError = null;
    return { configured: false, schemaReady: false, error: null };
  }

  const now = Date.now();
  if (!force && supabaseSchemaReady && now - lastSchemaCheckAt < 30000) {
    return { configured: true, schemaReady: true, error: null };
  }
  if (!force && !supabaseSchemaReady && lastSchemaCheckAt > 0 && now - lastSchemaCheckAt < 10000) {
    return { configured: true, schemaReady: false, error: lastSchemaError };
  }

  lastSchemaCheckAt = now;
  try {
    const { error } = await client.from('roles').select('id').limit(1);
    if (error) {
      supabaseSchemaReady = false;
      lastSchemaError = error.message || error.code || 'Schema tables not found';
      return {
        configured: true,
        schemaReady: false,
        code: error.code || null,
        error: lastSchemaError,
      };
    }

    supabaseSchemaReady = true;
    lastSchemaError = null;
    return { configured: true, schemaReady: true, error: null };
  } catch (err) {
    supabaseSchemaReady = false;
    lastSchemaError = err?.message || 'Supabase connection failed';
    return {
      configured: true,
      schemaReady: false,
      error: lastSchemaError,
    };
  }
}

export async function getSupabaseDatabaseStatus() {
  const check = await checkSupabaseSchemaReady({ force: true });
  const client = getSupabaseClient();
  if (!client) {
    return {
      mode: 'supabase',
      connected: false,
      schemaReady: false,
      error: 'Supabase environment variables are not configured.',
    };
  }

  if (!check.schemaReady) {
    return {
      mode: 'supabase-pending-schema',
      connected: true,
      schemaReady: false,
      url: env.supabase.url,
      error: check.error,
      message: 'Connected to Supabase; run database/supabase_schema.sql in Supabase SQL Editor to create tables.',
    };
  }

  const [rolesRes, recordsRes] = await Promise.all([
    client.from('roles').select('id', { count: 'exact', head: true }),
    client.from('ownership_records').select('id', { count: 'exact', head: true }),
  ]);

  return {
    mode: 'supabase',
    connected: true,
    schemaReady: true,
    url: env.supabase.url,
    rolesCount: rolesRes.count ?? 0,
    sampleOwnershipRecordsCount: recordsRes.count ?? 0,
  };
}
