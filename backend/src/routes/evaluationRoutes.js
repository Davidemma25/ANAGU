import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware.js';
import {
  getLatestEvaluation,
  triggerLiveEvaluation,
} from '../controllers/evaluationController.js';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/latest', getLatestEvaluation);
router.post('/run', triggerLiveEvaluation);

export default router;
