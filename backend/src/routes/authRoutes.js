import { Router } from 'express';
import {
  getProfile,
  getRoles,
  register,
  updateProfile,
  login,
  logout,
  requestPasswordReset,
  confirmPasswordReset,
  refreshAuthSession,
} from '../controllers/authController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { createRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = Router();

// All account holders use the same public authentication flow.
router.post('/register', createRateLimit({ keyPrefix: 'register', max: 10 }), register);
router.post('/login', createRateLimit({ keyPrefix: 'login', max: 10 }), login);
router.post('/logout', requireUser, logout);
router.post('/password-reset/request', createRateLimit({ keyPrefix: 'reset-request', max: 5 }), requestPasswordReset);
router.post('/password-reset/confirm', createRateLimit({ keyPrefix: 'reset-confirm', max: 5 }), confirmPasswordReset);
router.post('/refresh', createRateLimit({ keyPrefix: 'auth-refresh', max: 30 }), refreshAuthSession);
router.get('/roles', getRoles);
router.get('/me', requireUser, getProfile);
router.patch('/profile', requireUser, updateProfile);

export default router;
