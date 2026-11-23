import { Router } from 'express';
import { requireUser } from '../middleware/authMiddleware.js';
import {
  getContractMetadata,
  getTitlesAndQueue,
  testDirectTransferBlock,
} from '../controllers/titleController.js';

const router = Router();

// Contract metadata (addresses, ABI, chain id) is public info that buyers need
// to sign on-chain purchases, even when they have not created an account.
router.get('/contract', getContractMetadata);

router.use(requireUser);

router.get('/', getTitlesAndQueue);
router.post('/:id/test-transfer-block', testDirectTransferBlock);

export default router;
