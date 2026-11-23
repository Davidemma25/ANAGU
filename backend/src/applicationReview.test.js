import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from './app.js';

test('public runtime does not expose staff review or administrative endpoints', async () => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const path of [
      '/api/applications/1/reviews',
      '/api/gis/applications/1/validate',
      '/api/admin/auth/status',
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method: 'POST' });
      assert.equal(response.status, 404, `${path} should not be exposed`);
    }

    const unsignedPurchase = await fetch(
      `${baseUrl}/api/marketplace/listings/1/buy`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(unsignedPurchase.status, 401, 'buying must require a public account');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
