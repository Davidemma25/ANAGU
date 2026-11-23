import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware.js';
import { getRevocations, revokeLandTitle } from '../controllers/revocationController.js';

const router = Router();

router.use(requireAuth);

router.get('/', requireAdmin, getRevocations);
router.post('/:titleId', requireAdmin, revokeLandTitle);

export default router;
