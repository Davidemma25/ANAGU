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
  disconnectMqttClient,
  flushOfflineQueue,
  getMqttStatus,
  initMqttInfrastructure,
  onMqttDelivery,
  publishAnaguEvent,
  stopMqttInfrastructure,
} from './mqtt/mqttClient.js';
import { stopMqttBroker } from './mqtt/broker.js';

const VALID_PARCEL_RING = [
  [3.390, 6.530],
  [3.3915, 6.530],
  [3.3915, 6.5315],
  [3.390, 6.5315],
  [3.390, 6.530],
];

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-mqtt-test-'));
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  await ensureSeedUsers();

  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}`, tmpDir };
}

import './testEnv.js';
import { getAdminEmail } from './config/env.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
} from './testHelpers/applicationReviews.js';

test('Phase 10 MQTT live pub/sub, workflow event delivery, and real offline broker retry queue', async () => {
  const prevReqPay = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.REQUIRE_PAYMENT_BEFORE_GIS = 'false';
  delete process.env.ADMIN_PASSWORD;

  const { server, baseUrl, tmpDir } = await startTestServer();

  try {
    // 1. Start embedded Aedes TCP broker + MQTT client on ephemeral port
    const mqttInit = await initMqttInfrastructure({ port: 0 });
    assert.equal(mqttInit.connected, true);
    assert.equal(mqttInit.broker.running, true);

    const deliveries = [];
    const unsubscribe = onMqttDelivery((entry) => deliveries.push(entry));

    // 2. Citizen submits application -> should publish QoS 1 MQTT event on anagu/applications/submitted
    const citRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Amara Okafor',
        email: 'mqtt-citizen@example.com',
        password: 'Password123!',
        nationalId: 'NID-MQTT-001',
      }),
    });
    assert.equal(citRes.status, 201);
    const citizen = await citRes.json();

    const adminRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    assert.equal(adminRes.status, 201);
    const admin = await adminRes.json();

    const submitRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({
        parcelName: 'MQTT Telemetry Plot M1',
        locationDescription: 'Northern Sector Telemetry Avenue',
        region: 'Zone 1 District',
        declaredAreaSqm: 24000,
        ownershipType: 'FREEHOLD',
        claimantName: 'Amara Okafor',
        claimantNationalId: 'NID-1001-AMA',
        coordinates: VALID_PARCEL_RING,
      }),
    });
    assert.equal(submitRes.status, 201);
    const submitBody = await submitRes.json();

    // Give QoS 1 subscriber loop a short tick to receive the packet
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(
      deliveries.some(
        (d) =>
          d.topic === 'anagu/applications/submitted' &&
          d.eventType === 'APPLICATION_SUBMITTED' &&
          d.data.referenceCode === submitBody.application.reference_code
      ),
      'Expected MQTT QoS 1 subscriber to receive APPLICATION_SUBMITTED'
    );

    // 3. Surveyor reviews the submission before GIS validation emits anagu/gis/validated
    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'mqtt');
    await completeSurveyorHandoff({
      baseUrl,
      applicationId: submitBody.application.id,
      token: surveyorToken,
    });
    const gisRes = await fetch(`${baseUrl}/api/admin/gis/validate/${submitBody.application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(gisRes.status, 200);

    await new Promise((r) => setTimeout(r, 80));
    assert.ok(
      deliveries.some(
        (d) => d.topic === 'anagu/gis/validated' && d.eventType === 'GIS_VALIDATION_PASSED'
      )
    );

    // 4. Stop real Aedes broker & client to simulate network/broker outage
    await disconnectMqttClient();
    await stopMqttBroker();

    const offlineStatus = await getMqttStatus();
    assert.equal(offlineStatus.broker.running, false);
    assert.equal(offlineStatus.client.connected, false);

    // Publish event while broker is genuinely down -> must persist as QUEUED
    const queuedPublish = await publishAnaguEvent({
      topic: 'anagu/titles/issued',
      eventType: 'OFFLINE_QUEUED_TEST_EVENT',
      userId: citizen.user.id,
      targetRole: 'CITIZEN',
      data: { ref: submitBody.application.reference_code },
    });
    assert.equal(queuedPublish.published, false);
    assert.equal(queuedPublish.queued, true);
    assert.equal(queuedPublish.notification.delivery_status, 'QUEUED');

    // 5. Restart Aedes broker & reconnect MQTT client -> should auto-flush offline retry queue
    const reconnectInfo = await initMqttInfrastructure({ port: 0 });
    assert.equal(reconnectInfo.connected, true);
    assert.ok(reconnectInfo.flushedCount >= 1);

    await new Promise((r) => setTimeout(r, 80));
    assert.ok(
      deliveries.some((d) => d.eventType === 'OFFLINE_QUEUED_TEST_EVENT'),
      'Expected queued message to be delivered via MQTT QoS 1 upon broker restart'
    );

    // 6. Verify Notifications API & RBAC
    const citizenNotifRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${citizen.token}` },
    });
    assert.equal(citizenNotifRes.status, 200);
    const citizenNotifs = await citizenNotifRes.json();
    const flushedRecord = citizenNotifs.notifications.find(
      (n) => n.id === queuedPublish.notification.id
    );
    assert.ok(flushedRecord);
    assert.equal(flushedRecord.delivery_status, 'PUBLISHED');
    assert.ok(flushedRecord.retry_count >= 1);

    // Mark notification as read
    const readRes = await fetch(`${baseUrl}/api/notifications/${flushedRecord.id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${citizen.token}` },
    });
    assert.equal(readRes.status, 200);
    const readBody = await readRes.json();
    assert.equal(readBody.notification.is_read, true);

    // Citizen cannot trigger admin outage demo
    const forbiddenDemo = await fetch(`${baseUrl}/api/admin/notifications/simulate-outage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizen.token}`,
      },
      body: JSON.stringify({ action: 'test_cycle' }),
    });
    assert.equal(forbiddenDemo.status, 403);

    // Admin can trigger offline queue verification cycle
    const adminDemo = await fetch(`${baseUrl}/api/admin/notifications/simulate-outage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({ action: 'test_cycle' }),
    });
    assert.equal(adminDemo.status, 200);
    const adminDemoBody = await adminDemo.json();
    assert.ok(adminDemoBody.flushResult.flushedCount >= 1);

    // Manual flush endpoint succeeds cleanly for Admin
    const retryRes = await fetch(`${baseUrl}/api/admin/notifications/retry-queue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(retryRes.status, 200);
    const manualFlush = await flushOfflineQueue();
    assert.equal(manualFlush.remainingQueued, 0);

    unsubscribe();
  } finally {
    await stopMqttInfrastructure();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ANAGU_STORE_PATH;
    if (prevReqPay === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
  }
});
