import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { env } from './src/config/env.js';
import { createApp } from './src/app.js';
import { createAdminApp } from './admin/src/app.js';
import { bootstrapApplicationData } from './src/config/bootstrap.js';
import { initMqttInfrastructure } from './src/mqtt/mqttClient.js';

async function startServer() {
  const boot = await bootstrapApplicationData({ forceSupabaseCheck: true });
  console.log(`ANAGU data layer active: ${boot.target}`);
  try {
    const mqttInfo = await initMqttInfrastructure();
    console.log(`ANAGU MQTT broker & client active at ${mqttInfo.brokerUrl} (flushed: ${mqttInfo.flushedCount})`);
  } catch (mqttErr) {
    console.warn('MQTT startup warning (falling back to offline queue):', mqttErr.message);
  }

  const rootApp = express();

  // Admin API must be mounted before the public app's /api catch-all
  rootApp.use('/api/admin', createAdminApp());

  // Public API + SPA
  rootApp.use(createApp());

  if (env.nodeEnv !== 'production') {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), 'frontend', 'vite.config.ts'),
      root: path.resolve(process.cwd(), 'frontend'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    rootApp.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    rootApp.use(express.static(distDir));
    rootApp.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  rootApp.listen(env.port, '0.0.0.0', () => {
    console.log(`ANAGU → http://localhost:${env.port}`);
    console.log(`Admin  → http://localhost:${env.port}/admin`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ANAGU server:', err);
  process.exit(1);
});
