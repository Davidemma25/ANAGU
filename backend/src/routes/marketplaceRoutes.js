import { Router } from 'express';
import multer from 'multer';
import { optionalUser, requireUser } from '../middleware/authMiddleware.js';
import {
  activateParcelListingOnChain,
  buyParcelIntoEscrow,
  cancelParcelListing,
  createParcelListing,
  getMarketplaceEligibility,
  getMarketplaceListings,
  registerAndUploadLand,
  settleParcelSale,
  verifyParcelBeforePurchase,
} from '../controllers/marketplaceController.js';

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

router.get('/listings', optionalUser, getMarketplaceListings);
router.post('/listings/:listingId/verify', optionalUser, verifyParcelBeforePurchase);
router.post('/listings/:listingId/buy', optionalUser, buyParcelIntoEscrow);
router.post('/listings/:listingId/settle', requireUser, settleParcelSale);
router.post('/register-land', optionalUser, upload.single('document'), registerAndUploadLand);

router.use(requireUser);

router.get('/eligibility', getMarketplaceEligibility);
router.post('/listings', createParcelListing);
router.post('/listings/:listingId/activate', activateParcelListingOnChain);
router.post('/listings/:listingId/cancel', cancelParcelListing);

export default router;
