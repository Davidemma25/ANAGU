import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { bootstrapApplicationData } from '../../src/config/bootstrap.js';
import { initMqttInfrastructure } from '../../src/mqtt/mqttClient.js';
import { createAdminApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3001);
const NODE_ENV = process.env.NODE_ENV || 'development';

// Root of the repo (three levels up from backend/admin/src/)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// Admin frontend root
const ADMIN_FRONTEND_ROOT = path.resolve(REPO_ROOT, 'frontend', 'admin');

async function startAdminServer() {
  const boot = await bootstrapApplicationData({ forceSupabaseCheck: true });
  console.log(`ANAGU Admin data layer active: ${boot.target}`);

  try {
    await initMqttInfrastructure();
  } catch (err) {
    console.warn('Admin MQTT startup warning:', err?.message || err);
  }

  const root = express();

  // Admin API — all routes under /api/admin
  root.use('/api/admin', createAdminApp());

  if (NODE_ENV !== 'production') {
    // Dev: serve admin SPA via Vite in middleware mode (no basename, root is /)
    const adminVite = await createViteServer({
      configFile: false,
      root: ADMIN_FRONTEND_ROOT,
      base: '/',
      plugins: [
        (await import('@vitejs/plugin-react')).default(),
        (await import('@tailwindcss/vite')).default(),
      ],
      resolve: {
        dedupe: ['react', 'react-dom'],
      },
      server: { middlewareMode: true },
      appType: 'spa',
    });
    root.use(adminVite.middlewares);
  } else {
    // Production: serve pre-built admin dist
    const adminDist = path.resolve(REPO_ROOT, 'dist', 'admin');
    root.use(express.static(adminDist));
    root.get('*', (_req, res) => {
      res.sendFile(path.join(adminDist, 'index.html'));
    });
  }

  root.listen(ADMIN_PORT, '0.0.0.0', () => {
    console.log(`ANAGU Admin console → http://localhost:${ADMIN_PORT}`);
    console.log(`ANAGU Admin API     → http://localhost:${ADMIN_PORT}/api/admin`);
  });
}

startAdminServer().catch((err) => {
  console.error('Failed to start ANAGU Admin server:', err);
  process.exit(1);
});
