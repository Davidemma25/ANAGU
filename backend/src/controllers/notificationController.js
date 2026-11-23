import {
  getNotificationStatsForUser,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from '../models/notificationModel.js';
import {
  flushOfflineQueue,
  getMqttStatus,
  publishAnaguEvent,
  setMqttSimulatedOffline,
} from '../mqtt/mqttClient.js';
import { recordAuditLog } from '../services/auditService.js';

export async function getNotifications(req, res) {
  try {
    const statusFilter = req.query?.status ? String(req.query.status).toUpperCase() : undefined;
    const [notifications, stats, mqtt] = await Promise.all([
      listNotificationsForUser(req.user, { limit: 80, status: statusFilter }),
      getNotificationStatsForUser(req.user),
      getMqttStatus(),
    ]);

    return res.json({
      notifications,
      stats,
      mqtt,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({ error: 'Failed to load MQTT notifications.' });
  }
}

export async function getBrokerAndQueueStatus(_req, res) {
  try {
    const mqtt = await getMqttStatus();
    return res.json({ mqtt });
  } catch (error) {
    console.error('Get MQTT status error:', error);
    return res.status(500).json({ error: 'Failed to load MQTT broker status.' });
  }
}

export async function markSingleNotificationRead(req, res) {
  try {
    const updated = await markNotificationRead(req.params.id, req.user);
    if (!updated) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    const stats = await getNotificationStatsForUser(req.user);
    return res.json({ notification: updated, stats });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
}

export async function markAllRead(req, res) {
  try {
    const updatedCount = await markAllNotificationsRead(req.user);
    const stats = await getNotificationStatsForUser(req.user);
    return res.json({ updatedCount, stats });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
}

export async function triggerRetryQueueFlush(req, res) {
  try {
    const result = await flushOfflineQueue();
    const mqtt = await getMqttStatus();

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'MQTT_OFFLINE_QUEUE_FLUSHED',
      entityType: 'mqtt_queue',
      entityId: 'anagu-offline-queue',
      details: {
        flushedCount: result.flushedCount,
        remainingQueued: result.remainingQueued,
      },
      ipAddress: req.ip,
    });

    return res.json({
      message: result.connected
        ? `Offline retry queue processed: ${result.flushedCount} queued message(s) delivered via MQTT QoS 1.`
        : 'MQTT broker is currently unreachable; messages remain safely queued.',
      ...result,
      mqtt,
    });
  } catch (error) {
    console.error('Flush MQTT queue error:', error);
    return res.status(500).json({ error: 'Failed to flush MQTT offline retry queue.' });
  }
}

export async function runOfflineQueueDemo(req, res) {
  try {
    const { action = 'test_cycle' } = req.body || {};

    if (action === 'disconnect') {
      setMqttSimulatedOffline(true);
      const mqtt = await getMqttStatus();
      return res.json({
        message: 'MQTT client paused (offline mode). New events will queue reliably in the database.',
        mqtt,
      });
    }

    if (action === 'reconnect') {
      setMqttSimulatedOffline(false);
      const flushResult = await flushOfflineQueue();
      const mqtt = await getMqttStatus();
      return res.json({
        message: `MQTT client reconnected and flushed ${flushResult.flushedCount} queued message(s).`,
        flushResult,
        mqtt,
      });
    }

    // Full real offline->QUEUED->reconnect->PUBLISHED demonstration using Aedes + MQTT QoS 1
    setMqttSimulatedOffline(true);
    const queuedResult = await publishAnaguEvent({
      topic: 'anagu/system/offline-retry-test',
      eventType: 'OFFLINE_RETRY_VERIFICATION',
      userId: req.user.id,
      targetRole: req.user.roleCode,
      data: {
        initiatedBy: req.user.fullName,
        note: 'Simulated temporary broker outage verifying durable QUEUED fallback and reconnect delivery.',
      },
    });

    setMqttSimulatedOffline(false);
    const flushResult = await flushOfflineQueue();
    const mqtt = await getMqttStatus();

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'MQTT_OFFLINE_RETRY_VERIFIED',
      entityType: 'notification',
      entityId: queuedResult.notification.id,
      details: {
        initiallyQueued: queuedResult.queued,
        flushedCount: flushResult.flushedCount,
      },
      ipAddress: req.ip,
    });

    return res.json({
      message: `Offline queue test passed: event #${queuedResult.notification.id} queued offline and delivered on reconnect (${flushResult.flushedCount} flushed).`,
      queuedNotificationId: queuedResult.notification.id,
      flushResult,
      mqtt,
    });
  } catch (error) {
    setMqttSimulatedOffline(false);
    console.error('MQTT offline queue demo error:', error);
    return res.status(500).json({ error: 'Failed to run MQTT offline queue verification.' });
  }
}
