import { Router } from 'express';
import { getDashboardSummary } from '../controllers/userController.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/dashboard/summary', requireUser, getDashboardSummary);

export default router;
