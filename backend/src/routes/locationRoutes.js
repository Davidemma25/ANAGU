import { Router } from 'express';
import {
  getCommunities,
  getLgas,
  getStates,
} from '../controllers/locationController.js';

const router = Router();

router.get('/states', getStates);
router.get('/lgas/:stateId', getLgas);
router.get('/communities/:lgaId', getCommunities);

export default router;
