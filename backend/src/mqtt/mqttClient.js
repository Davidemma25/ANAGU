import crypto from 'node:crypto';
import mqtt from 'mqtt';
import { env } from '../config/env.js';
import {
  createNotificationRecord,
  listQueuedNotifications,
  updateNotificationDelivery,
} from '../models/notificationModel.js';
import { getMqttBrokerStatus, startMqttBroker, stopMqttBroker } from './broker.js';

let clientInstance = null;
let activeBrokerUrl = null;
let simulatedOffline = false;
let recentDeliveries = [];
let deliveryListeners = new Set();

function recordRecentDelivery(entry) {
  recentDeliveries.unshift(entry);
  if (recentDeliveries.length > 50) {
    recentDeliveries = recentDeliveries.slice(0, 50);
  }
  for (const listener of deliveryListeners) {
    try {
      listener(entry);
    } catch {
      // ignore listener errors
    }
  }
}

function attachClientHandlers(client) {
  client.on('connect', () => {
    client.subscribe('anagu/#', { qos: 1 }, (err) => {
      if (!err) {
        flushOfflineQueue().catch((flushErr) => {
          console.error('MQTT offline queue flush error:', flushErr.message);
        });
      }
    });
  });

  client.on('message', (topic, messageBuffer) => {
    const receivedAtMs = Date.now();
    try {
      const parsed = JSON.parse(messageBuffer.toString('utf8'));
      const emittedAtMs = Number(parsed.emittedAtMs || receivedAtMs);
      const deliveryLatencyMs = Math.max(0, receivedAtMs - emittedAtMs);
      recordRecentDelivery({
        eventId: parsed.eventId,
        topic,
        eventType: parsed.eventType,
        targetRole: parsed.targetRole,
        emittedAt: parsed.emittedAt,
        receivedAt: new Date(receivedAtMs).toISOString(),
        deliveryLatencyMs,
        qos: 1,
        data: parsed.data || {},
      });
    } catch {
      recordRecentDelivery({
        topic,
        eventType: 'RAW_MESSAGE',
        receivedAt: new Date(receivedAtMs).toISOString(),
        deliveryLatencyMs: 0,
        raw: messageBuffer.toString('utf8'),
      });
    }
  });
}

export async function connectMqttClient(brokerUrl) {
  if (clientInstance) {
    await disconnectMqttClient();
  }

  activeBrokerUrl = brokerUrl;

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, {
      clientId: `anagu-registry-${crypto.randomBytes(4).toString('hex')}`,
      reconnectPeriod: 800,
      connectTimeout: 4000,
      clean: true,
    });

    clientInstance = client;
    attachClientHandlers(client);

    const timeout = setTimeout(() => {
      reject(new Error(`Timed out connecting to MQTT broker at ${brokerUrl}`));
    }, 5000);

    client.once('connect', () => {
      client.subscribe('anagu/#', { qos: 1 }, (err) => {
        clearTimeout(timeout);
        if (err) {
          reject(err);
        } else {
          resolve(client);
        }
      });
    });

    client.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function disconnectMqttClient() {
  if (!clientInstance) return;
  const client = clientInstance;
  clientInstance = null;
  await new Promise((resolve) => {
    client.end(true, {}, () => resolve());
  });
}

export async function initMqttInfrastructure({ port } = {}) {
  simulatedOffline = false;
  let brokerUrl = env.mqtt.brokerUrl;

  if (env.mqtt.useEmbeddedBroker) {
    const started = await startMqttBroker({ port });
    brokerUrl = started.brokerUrl;
  }

  await connectMqttClient(brokerUrl);
  const flushed = await flushOfflineQueue();

  return {
    brokerUrl,
    broker: getMqttBrokerStatus(),
    connected: Boolean(clientInstance?.connected),
    flushedCount: flushed.flushedCount,
  };
}

export async function stopMqttInfrastructure() {
  simulatedOffline = false;
  await disconnectMqttClient();
  await stopMqttBroker();
  activeBrokerUrl = null;
  recentDeliveries = [];
}

export function setMqttSimulatedOffline(offline) {
  simulatedOffline = Boolean(offline);
  return {
    simulatedOffline,
    clientConnected: Boolean(clientInstance?.connected) && !simulatedOffline,
  };
}

function publishQoS1(topic, messageString) {
  return new Promise((resolve, reject) => {
    if (!clientInstance || !clientInstance.connected || simulatedOffline) {
      return reject(new Error('MQTT client offline or disconnected from broker.'));
    }
    const startNs = process.hrtime.bigint();
    clientInstance.publish(topic, messageString, { qos: 1, retain: false }, (err) => {
      if (err) return reject(err);
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      resolve(Number(elapsedMs.toFixed(2)));
    });
  });
}

/**
 * @param {{
 *   topic: string,
 *   eventType: string,
 *   userId?: number | null,
 *   targetRole?: string,
 *   data?: Record<string, any>,
 * }} params
 */
export async function publishAnaguEvent({
  topic,
  eventType,
  userId = null,
  targetRole = 'ALL',
  data = {},
}) {
  const eventId = crypto.randomUUID();
  const emittedAtMs = Date.now();
  const payload = {
    eventId,
    topic,
    eventType,
    targetRole,
    emittedAt: new Date(emittedAtMs).toISOString(),
    emittedAtMs,
    data,
  };

  try {
    const publishLatencyMs = await publishQoS1(topic, JSON.stringify(payload));
    payload.publishLatencyMs = publishLatencyMs;

    const notification = await createNotificationRecord({
      userId,
      targetRole,
      topic,
      eventType,
      payload,
      deliveryStatus: 'PUBLISHED',
      retryCount: 0,
    });

    return {
      notification,
      published: true,
      queued: false,
      publishLatencyMs,
    };
  } catch (err) {
    payload.queueReason = err.message;
    const notification = await createNotificationRecord({
      userId,
      targetRole,
      topic,
      eventType,
      payload,
      deliveryStatus: 'QUEUED',
      retryCount: 0,
    });

    return {
      notification,
      published: false,
      queued: true,
      reason: err.message,
    };
  }
}

export async function flushOfflineQueue() {
  if (!clientInstance || !clientInstance.connected || simulatedOffline) {
    const queued = await listQueuedNotifications();
    return {
      flushedCount: 0,
      remainingQueued: queued.length,
      connected: false,
    };
  }

  const pending = await listQueuedNotifications();
  let flushedCount = 0;

  for (const item of pending) {
    const retryCount = Number(item.retry_count || 0) + 1;
    const payload = {
      ...(item.payload || {}),
      emittedAtMs: Date.now(),
      flushedAt: new Date().toISOString(),
      retryAttempt: retryCount,
    };

    try {
      const publishLatencyMs = await publishQoS1(item.topic, JSON.stringify(payload));
      payload.publishLatencyMs = publishLatencyMs;
      delete payload.queueReason;

      await updateNotificationDelivery(item.id, {
        deliveryStatus: 'PUBLISHED',
        retryCount,
        payload,
      });
      flushedCount += 1;
    } catch (err) {
      payload.lastRetryError = err.message;
      await updateNotificationDelivery(item.id, {
        deliveryStatus: 'QUEUED',
        retryCount,
        payload,
      });
    }
  }

  const remaining = await listQueuedNotifications();
  return {
    flushedCount,
    remainingQueued: remaining.length,
    connected: true,
  };
}

export async function getMqttStatus() {
  const pending = await listQueuedNotifications();
  return {
    broker: getMqttBrokerStatus(),
    client: {
      connected: Boolean(clientInstance?.connected) && !simulatedOffline,
      rawConnected: Boolean(clientInstance?.connected),
      simulatedOffline,
      brokerUrl: activeBrokerUrl || env.mqtt.brokerUrl,
      subscribedTopic: 'anagu/#',
      qos: 1,
    },
    queuedCount: pending.length,
    recentDeliveries: recentDeliveries.slice(0, 20),
  };
}

export function onMqttDelivery(listener) {
  deliveryListeners.add(listener);
  return () => deliveryListeners.delete(listener);
}
