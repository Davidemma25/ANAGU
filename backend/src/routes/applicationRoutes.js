import { Router } from 'express';
import multer from 'multer';
import {
  getApplicationDetail,
  getApplications,
  submitApplication,
  uploadSupportingDocument,
} from '../controllers/applicationController.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/plain',
      'application/json',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: PDF, PNG, JPEG, TXT, JSON.'));
    }
  },
});

router.get('/', requireUser, getApplications);
router.post('/', requireUser, submitApplication);
router.get('/:id', requireUser, getApplicationDetail);
router.post(
  '/:id/documents',
  requireUser,
  upload.single('document'),
  uploadSupportingDocument
);

export default router;
