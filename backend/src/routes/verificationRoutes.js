import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware.js';
import {
  addSampleOwnershipRecord,
  downloadVerificationDocument,
  evaluateApplicationClaim,
  getApplicationVerificationHistory,
  getSampleOwnershipRecords,
  getVerificationQueue,
  recordVerificationDecision,
} from '../controllers/verificationController.js';

const router = Router();

router.use(requireAuth);

router.get('/queue', requireAdmin, getVerificationQueue);
router.get('/records', requireAdmin, getSampleOwnershipRecords);
router.post('/records', requireAdmin, addSampleOwnershipRecord);
router.get('/evaluate/:applicationId', requireAdmin, evaluateApplicationClaim);
router.get('/documents/:documentId/download', requireAdmin, downloadVerificationDocument);
router.post('/decide/:applicationId', requireAdmin, recordVerificationDecision);
router.get('/history/:applicationId', getApplicationVerificationHistory);

export default router;
