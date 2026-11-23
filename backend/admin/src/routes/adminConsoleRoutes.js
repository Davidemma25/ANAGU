import { Router } from 'express';
import {
  createStaffAccount,
  getAuditLogs,
  getDashboardSummary,
  getUsers,
  updateUserAccess,
} from '../../../../backend/src/controllers/userController.js';
import {
  getApplicationDetail,
  getApplications,
} from '../../../../backend/src/controllers/applicationController.js';
import {
  getGisMapData,
  validateApplicationParcel,
} from '../../../../backend/src/controllers/gisController.js';
import {
  addSampleOwnershipRecord,
  downloadVerificationDocument,
  evaluateApplicationClaim,
  getApplicationVerificationHistory,
  getSampleOwnershipRecords,
  getVerificationQueue,
  quickPublishToCheckLands,
  recordVerificationDecision,
} from '../../../../backend/src/controllers/verificationController.js';
import {
  getContractMetadata,
  getTitlesAndQueue,
  mintLandTitleNft,
  testDirectTransferBlock,
} from '../../../../backend/src/controllers/titleController.js';
import {
  cancelParcelListing,
  getMarketplaceListings,
  settleParcelSale,
} from '../../../../backend/src/controllers/marketplaceController.js';
import {
  getRevocations,
  revokeLandTitle,
} from '../../../../backend/src/controllers/revocationController.js';
import {
  getBrokerAndQueueStatus,
  getNotifications,
  markAllRead,
  markSingleNotificationRead,
  runOfflineQueueDemo,
  triggerRetryQueueFlush,
} from '../../../../backend/src/controllers/notificationController.js';
import {
  getLatestEvaluation,
  triggerLiveEvaluation,
} from '../../../../backend/src/controllers/evaluationController.js';
import {
  getPaymentConfig,
  handleBlockchainPaymentEvents,
  updateFeeConfig,
} from '../../../../backend/src/payments/paymentController.js';
import { requireAdminSession } from '../middleware/adminAuthMiddleware.js';

const router = Router();

router.use(requireAdminSession);

// Dashboard & Users & Audit
router.get('/dashboard/summary', getDashboardSummary);
router.get('/users', getUsers);
router.post('/users', createStaffAccount);
router.patch('/users/:id', updateUserAccess);
router.get('/audit-logs', getAuditLogs);
router.get('/applications', getApplications);
router.get('/applications/:id', getApplicationDetail);

// GIS Validation
router.get('/gis/parcels', getGisMapData);
router.post('/gis/validate/:applicationId', validateApplicationParcel);

// Ownership Verification Oracle & Deed Review
router.get('/verification/queue', getVerificationQueue);
router.get('/verification/records', getSampleOwnershipRecords);
router.post('/verification/records', addSampleOwnershipRecord);
router.get('/verification/evaluate/:applicationId', evaluateApplicationClaim);
router.get('/verification/documents/:documentId/download', downloadVerificationDocument);
router.post('/verification/decide/:applicationId', recordVerificationDecision);
router.post('/verification/publish-checklands/:applicationId', quickPublishToCheckLands);
router.get('/verification/history/:applicationId', getApplicationVerificationHistory);

// Titles & Marketplace Escrow Settlement
router.get('/titles', getTitlesAndQueue);
router.get('/titles/contract', getContractMetadata);
router.post('/titles/mint/:applicationId', mintLandTitleNft);
router.post('/titles/:id/test-transfer-block', testDirectTransferBlock);
router.post('/titles/:id/revoke', revokeLandTitle);

router.get('/marketplace/listings', getMarketplaceListings);
router.post('/marketplace/listings/:listingId/settle', settleParcelSale);
router.post('/marketplace/listings/:listingId/cancel', cancelParcelListing);

// Statutory Revocations
router.get('/revocations', getRevocations);
router.post('/revocations/:titleId', revokeLandTitle);

// Admin Notifications & MQTT Offline Queue
router.get('/notifications', getNotifications);
router.get('/notifications/status', getBrokerAndQueueStatus);
router.patch('/notifications/read-all', markAllRead);
router.patch('/notifications/:id/read', markSingleNotificationRead);
router.post('/notifications/retry-queue', triggerRetryQueueFlush);
router.post('/notifications/simulate-outage', runOfflineQueueDemo);

// Fraud Simulations & Benchmarks
router.get('/evaluation/latest', getLatestEvaluation);
router.post('/evaluation/run', triggerLiveEvaluation);

// Sepolia Fee Configuration & Event Sync
router.get('/payments/config', getPaymentConfig);
router.post('/payments/events/sync', handleBlockchainPaymentEvents);
router.patch('/payments/fee-config', updateFeeConfig);
router.patch('/payments/admin/fee-config', updateFeeConfig);

export default router;
