import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { createApp } from '../src/app.js';
import { createAdminApp } from '../admin/src/app.js';
import { bootstrapApplicationData } from '../src/config/bootstrap.js';

let appPromise: Promise<express.Express> | null = null;

async function getInitializedApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await bootstrapApplicationData({ forceSupabaseCheck: true });
      const rootApp = express();
      // Admin API must be before the public app's /api catch-all
      rootApp.use('/api/admin', createAdminApp());
      rootApp.use(createApp());
      return rootApp;
    })().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getInitializedApp();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        res.off('finish', onFinish);
        res.off('close', onFinish);
        res.off('error', onError);
      };
      const onFinish = () => { cleanup(); resolve(); };
      const onError = (err: Error) => { cleanup(); reject(err); };

      res.once('finish', onFinish);
      res.once('close', onFinish);
      res.once('error', onError);

      app(req as any, res as any, (err?: any) => {
        if (err) { cleanup(); reject(err); }
        else if (!res.writableEnded) { /* wait for async flush */ }
        else { cleanup(); resolve(); }
      });
    });
  } catch (err: any) {
    console.error('Vercel API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || 'ANAGU backend failed to process request.' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
