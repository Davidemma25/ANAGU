import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { createAdminApp } from '../admin/src/app.js';
import { ensureSeedUsers } from './models/userModel.js';
import {
  runFourFraudScenarios,
  runPerformanceBenchmarks,
} from './services/evaluationService.js';

test('Phase 11 Fraud Scenarios (1-4) all pass with real isolated execution', async () => {
  const scenarios = await runFourFraudScenarios();
  assert.equal(scenarios.length, 4);
  for (const scenario of scenarios) {
    assert.equal(scenario.passed, true, `Expected ${scenario.id} to pass, got: ${scenario.outcome}`);
    assert.ok(scenario.latencyMs >= 0);
  }
});

test('Phase 11 Repeated-Trial Performance Benchmarks measure real GIS, Oracle, EVM, and MQTT timings', async () => {
  const bench = await runPerformanceBenchmarks({ trials: 3 });
  assert.equal(bench.trials, 3);
  assert.equal(bench.subsystems.length, 6);
  for (const sub of bench.subsystems) {
    assert.equal(sub.trials, 3);
    assert.ok(sub.minMs >= 0);
    assert.ok(sub.meanMs >= sub.minMs);
    assert.ok(sub.maxMs >= sub.meanMs);
  }
  assert.ok(bench.storage.prototypeStoreBytes > 0);
});

import './testEnv.js';
import { getAdminEmail } from './config/env.js';

test('Phase 11 Evaluation API enforces Sole Admin RBAC', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-eval-api-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  delete process.env.ADMIN_PASSWORD;
  await ensureSeedUsers();

  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const citizenReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Eval Citizen',
        email: 'eval-rbac@example.com',
        password: 'Password123!',
        nationalId: 'NID-EVAL-RBAC',
      }),
    });
    const citizen = await citizenReg.json();

    const adminSetup = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const admin = await adminSetup.json();

    const citizenRes = await fetch(`${baseUrl}/api/admin/evaluation/latest`, {
      headers: { Authorization: `Bearer ${citizen.token}` },
    });
    assert.equal(citizenRes.status, 403);

    const adminRes = await fetch(`${baseUrl}/api/admin/evaluation/latest`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(adminRes.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
  }
});
