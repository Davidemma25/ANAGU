import { Router } from 'express';
import { requireUser } from '../middleware/authMiddleware.js';
import {
  getBrokerAndQueueStatus,
  getNotifications,
  markAllRead,
  markSingleNotificationRead,
  triggerRetryQueueFlush,
} from '../controllers/notificationController.js';

const router = Router();

router.use(requireUser);

router.get('/', getNotifications);
router.get('/status', getBrokerAndQueueStatus);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markSingleNotificationRead);
router.post('/retry-queue', triggerRetryQueueFlush);

export default router;
