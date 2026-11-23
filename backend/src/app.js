import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { getDatabaseStatus } from './config/db.js';
import { ensureSupabaseBootstrappedIfReady } from './config/bootstrap.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import applicationRoutes from './routes/applicationRoutes.js';
import gisRoutes from './routes/gisRoutes.js';
import titleRoutes from './routes/titleRoutes.js';
import marketplaceRoutes from './routes/marketplaceRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import paymentRoutes from './payments/paymentRoutes.js';
import locationRoutes from './routes/locationRoutes.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', async (_req, _res, next) => {
    try {
      await ensureSupabaseBootstrappedIfReady({ force: false });
    } catch (err) {
      console.warn('Supabase readiness probe warning:', err?.message || err);
    }
    next();
  });

  app.get('/favicon.ico', (_req, res) => {
    res.redirect(301, '/favicon.svg');
  });

  app.get('/api/health', async (_req, res) => {
    await ensureSupabaseBootstrappedIfReady({ force: true }).catch(() => false);
    const database = await getDatabaseStatus();
    res.json({
      service: 'anagu-backend',
      status: 'ok',
      environment: env.nodeEnv,
      phase: 11,
      database,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', userRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/gis', gisRoutes);
  app.use('/api/gis/locations', locationRoutes);
  app.use('/api/titles', titleRoutes);
  app.use('/api/marketplace', marketplaceRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err, _req, res, _next) => {
    console.error('Unhandled API error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error.',
    });
  });

  return app;
}

export default createApp;
