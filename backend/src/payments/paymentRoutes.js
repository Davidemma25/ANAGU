import { Router } from 'express';
import { requireUser } from '../middleware/authMiddleware.js';
import {
  checkPaymentStatus,
  createPaymentQuote,
  directWalletCheckout,
  getApplicationPaymentDetails,
  getPaymentConfig,
  listPaymentHistory,
  submitTransactionHash,
  verifyPaymentTransaction,
} from './paymentController.js';

const router = Router();

router.get('/config', getPaymentConfig);
router.get('/history', requireUser, listPaymentHistory);
router.get('/applications/:applicationId', requireUser, getApplicationPaymentDetails);
router.get('/status/:paymentId', requireUser, checkPaymentStatus);

router.post('/quotes', requireUser, createPaymentQuote);
router.post('/submit-tx', requireUser, submitTransactionHash);
router.post('/direct-checkout', requireUser, directWalletCheckout);
router.post('/verify', requireUser, verifyPaymentTransaction);

export default router;
