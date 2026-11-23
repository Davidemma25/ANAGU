import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from './app.js';

test('GET /api/health returns service ok status for Phase 1', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.service, 'anagu-backend');
    assert.equal(body.status, 'ok');
    assert.equal(body.phase, 11);
    assert.equal(body.database.connected, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
