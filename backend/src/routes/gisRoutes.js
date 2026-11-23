import { Router } from 'express';
import {
  getApplicationBoundaryHistory,
  getGisMapData,
  lookupParcelByCoordinates,
  saveApplicationBoundary,
} from '../controllers/gisController.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/lookup', lookupParcelByCoordinates);
router.get('/parcels', requireUser, getGisMapData);
router.get(
  '/applications/:applicationId/boundary-history',
  requireUser,
  getApplicationBoundaryHistory
);
router.post(
  '/applications/:applicationId/boundary',
  requireUser,
  saveApplicationBoundary
);

export default router;
