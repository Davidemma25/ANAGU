import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAdminHtmlRequest, isAdminRoutePath } from './hostingRouting.js';

test('isAdminHtmlRequest routes /admin, /admin/, and /admin/login to admin HTML while skipping API and asset files', () => {
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/admin' }), true);
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/admin/' }), true);
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/admin/login' }), true);
  assert.equal(isAdminHtmlRequest({ method: 'HEAD', reqPath: '/admin/verification' }), true);

  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/api/admin/auth/status' }), false);
  assert.equal(isAdminHtmlRequest({ method: 'POST', reqPath: '/admin/login' }), false);
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/admin/src/main.jsx' }), false);
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/assets/admin-123.js' }), false);
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/register' }), false);
  assert.equal(isAdminHtmlRequest({ method: 'GET', reqPath: '/' }), false);
});

test('isAdminRoutePath detects /admin and nested admin routes accurately', () => {
  assert.equal(isAdminRoutePath('/admin'), true);
  assert.equal(isAdminRoutePath('/admin/login'), true);
  assert.equal(isAdminRoutePath('/admin/verification'), true);
  assert.equal(isAdminRoutePath('/marketplace'), false);
  assert.equal(isAdminRoutePath('/administer'), false);
});

test('vercel.json rewrites all app routes including /admin/login to unified /index.html', () => {
  const vercelRaw = fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8');
  const vercelCfg = JSON.parse(vercelRaw);
  const rewrites = vercelCfg.rewrites || [];
  const apiIdx = rewrites.findIndex((r) => r.destination === '/api/index.ts');
  const spaFallbackIdx = rewrites.findIndex((r) => r.destination === '/index.html');

  assert.ok(apiIdx >= 0, 'vercel.json must route /api/* to /api/index.ts');
  assert.ok(spaFallbackIdx > apiIdx, 'unified SPA rewrite must follow /api/* rewrite');
  assert.ok(
    rewrites.some((r) => r.destination === '/index.html' && r.source.includes('assets')),
    'unified /index.html rewrite must cover / and /admin/login while excluding static assets'
  );
});
