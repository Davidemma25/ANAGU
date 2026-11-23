import { env } from './env.js';
import { checkSupabaseSchemaReady, isSupabaseActive } from './supabase.js';
import { ensureSeedUsers } from '../models/userModel.js';
import { hydratePaymentSettingsFromSupabase } from '../payments/paymentStore.js';

let supabaseBootstrapped = false;
let bootstrapInFlight = null;

export async function bootstrapApplicationData({ forceSupabaseCheck = false } = {}) {
  if (env.supabase.enabled && !process.env.ANAGU_STORE_PATH) {
    await checkSupabaseSchemaReady({ force: forceSupabaseCheck });
  }

  if (isSupabaseActive()) {
    if (supabaseBootstrapped) {
      return { target: 'supabase', alreadyBootstrapped: true };
    }
    if (bootstrapInFlight) {
      return bootstrapInFlight;
    }
    bootstrapInFlight = (async () => {
      await ensureSeedUsers({
        defaultAdminEmail: env.admin.email,
        defaultAdminPassword: env.admin.password,
        syncDefaultPassword: Boolean(env.admin.password),
      });
      await hydratePaymentSettingsFromSupabase();
      supabaseBootstrapped = true;
      return { target: 'supabase', alreadyBootstrapped: false };
    })().finally(() => {
      bootstrapInFlight = null;
    });
    return bootstrapInFlight;
  }

  await ensureSeedUsers({
    defaultAdminEmail: env.admin.email,
    defaultAdminPassword: env.admin.password,
    syncDefaultPassword: Boolean(env.admin.password),
  });
  return { target: env.pg.enabled ? 'postgresql' : 'local-store', alreadyBootstrapped: false };
}

export async function ensureSupabaseBootstrappedIfReady({ force = false } = {}) {
  if (!env.supabase.enabled || process.env.ANAGU_STORE_PATH || env.pg.enabled) {
    return false;
  }
  if (supabaseBootstrapped) {
    return true;
  }
  const status = await checkSupabaseSchemaReady({ force });
  if (status.schemaReady) {
    await bootstrapApplicationData({ forceSupabaseCheck: false });
    return true;
  }
  return false;
}
