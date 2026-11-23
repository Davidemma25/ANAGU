import { Router } from 'express';
import {
  adminLogin,
  getAdminAuthStatus,
  getProfile,
  logout,
  refreshAuthSession,
  setupSoleAdmin,
  updateProfile,
} from '../../../../backend/src/controllers/authController.js';
import { requireAdminSession } from '../middleware/adminAuthMiddleware.js';

const router = Router();

router.get('/status', getAdminAuthStatus);
router.post('/setup', setupSoleAdmin);
router.post('/login', adminLogin);
router.post('/refresh', refreshAuthSession);
router.post('/logout', requireAdminSession, logout);
router.get('/me', requireAdminSession, getProfile);
router.patch('/profile', requireAdminSession, updateProfile);

export default router;
