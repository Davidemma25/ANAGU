import express from 'express';
import cors from 'cors';
import { env } from '../../src/config/env.js';
import { getDatabaseStatus } from '../../src/config/db.js';
import { ensureSupabaseBootstrappedIfReady } from '../../src/config/bootstrap.js';
import adminAuthRoutes from './routes/adminAuthRoutes.js';
import adminConsoleRoutes from './routes/adminConsoleRoutes.js';

export function createAdminApp() {
  const adminApp = express();

  adminApp.use(cors());
  adminApp.use(express.json({ limit: '5mb' }));

  adminApp.use(async (_req, _res, next) => {
    try {
      await ensureSupabaseBootstrappedIfReady({ force: false });
    } catch (err) {
      console.warn('Admin Supabase readiness probe warning:', err?.message || err);
    }
    next();
  });

  adminApp.get('/health', async (_req, res) => {
    await ensureSupabaseBootstrappedIfReady({ force: true }).catch(() => false);
    const database = await getDatabaseStatus();
    res.json({
      service: 'anagu-admin-backend',
      status: 'ok',
      environment: env.nodeEnv,
      database,
      timestamp: new Date().toISOString(),
    });
  });

  adminApp.use('/auth', adminAuthRoutes);
  adminApp.use('/', adminConsoleRoutes);

  adminApp.use((_req, res) => {
    res.status(404).json({ error: 'Admin API endpoint not found.' });
  });

  adminApp.use((err, _req, res, _next) => {
    console.error('Unhandled Admin API error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal admin server error.',
    });
  });

  return adminApp;
}

export default createAdminApp;
