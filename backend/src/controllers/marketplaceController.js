import crypto from 'node:crypto';
import { isAddress, parseEther } from 'ethers';
import {
  ALLOWED_OWNERSHIP_TYPES,
  createApplication,
  normalizeGeoJsonPolygon,
  normalizeBoundarySource,
  uploadAndAddSupportingDocument,
} from '../models/applicationModel.js';
import {
  isLocationReferenceSchemaMissing,
  LOCATION_REFERENCE_MIGRATION_ERROR,
  validateLocationSelection,
} from '../models/locationModel.js';
import { createUser, listAllUsers } from '../models/userModel.js';
import { signAuthToken } from '../middleware/authMiddleware.js';
import {
  attachTitleToListing,
  cancelListingRecord,
  completeListingSale,
  createListingRecord,
  createTitleRecord,
  findApplicationVerificationContext,
  findBuyerVerificationReceipt,
  findListingVerificationContext,
  findTitleById,
  findTitleVerificationContext,
  listMarketplaceListings,
  listVerificationContextsForUser,
  recordBlockchainTransaction,
  recordBuyerVerificationReceipt,
  updateListingEscrowFunded,
} from '../models/titleModel.js';
import {
  cancelListingOnChain,
  fundEscrowOnChain,
  getActiveEscrowConfig,
  hasServerSignerForAddress,
  listParcelOnChain,
  mintTitleOnChain,
  resolveSigningWalletAddress,
  settleSaleOnChain,
  verifyListingOnChain,
} from '../services/blockchainService.js';
import {
  anaguToWei,
  convertPolToUsd,
  convertUsdToAnagu,
  convertUsdToPol,
  evaluateApplicationVerification,
  evaluateBuyerPurchaseVerification,
  formatUsdPrice,
  sanitizeListingDetails,
} from '../services/marketplaceService.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';

const ALLOWED_DOCUMENT_TYPES = [
  'DEED_OF_CONVEYANCE',
  'SURVEY_PLAN',
  'COMMUNITY_LETTER',
  'TAX_RECEIPT',
  'ID_DOCUMENT',
];

const PUBLIC_PROTOTYPE_WALLETS = [
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
  '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
];

async function resolvePublicLandowner({ reqUser, claimantName, claimantNationalId, requestedWallet }) {
  if (reqUser?.id) {
    return {
      id: reqUser.id,
      roleCode: reqUser.roleCode || 'CITIZEN',
      walletAddress: reqUser.walletAddress || '',
    };
  }

  const normalizedNid = String(claimantNationalId).trim().toUpperCase();
  const existingUsers = await listAllUsers();
  const matchingCitizen = existingUsers.find(
    (u) => u.roleCode === 'CITIZEN' && String(u.nationalId || '').toUpperCase() === normalizedNid
  );
  if (matchingCitizen) {
    return matchingCitizen;
  }

  const fallbackWallet =
    (isAddress(requestedWallet || '') ? requestedWallet.trim() : '') ||
    PUBLIC_PROTOTYPE_WALLETS[existingUsers.length % PUBLIC_PROTOTYPE_WALLETS.length];

  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const generatedEmail = `landowner.${uniqueSuffix}@public.anagu.local`;
  const generatedPassword = crypto.randomBytes(16).toString('hex');

  try {
    return await createUser({
      fullName: claimantName.trim(),
      email: generatedEmail,
      password: generatedPassword,
      nationalId: normalizedNid,
      phone: '',
      walletAddress: fallbackWallet,
      roleCode: 'CITIZEN',
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_NATIONAL_ID' || err.code === '23505') {
      return createUser({
        fullName: claimantName.trim(),
        email: `landowner.${uniqueSuffix}.alt@public.anagu.local`,
        password: generatedPassword,
        nationalId: `${normalizedNid}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        phone: '',
        walletAddress: fallbackWallet,
        roleCode: 'CITIZEN',
      });
    }
    throw err;
  }
}

// Resolves a buyer account for an anonymous wallet-only purchase. Logged-in
// users are reused as-is. Otherwise an existing user matching the connected
// wallet is reused, and only when none exists is a lightweight public buyer
// account created so the escrow / title transfer has a valid buyer_id.
async function resolvePublicBuyer({ reqUser, requestedWallet }) {
  if (reqUser?.id) {
    return {
      id: reqUser.id,
      roleCode: reqUser.roleCode || 'CITIZEN',
      walletAddress: reqUser.walletAddress || '',
    };
  }

  const normalizedWallet = isAddress(requestedWallet || '') ? requestedWallet.trim() : '';
  if (normalizedWallet) {
    const existingUsers = await listAllUsers();
    const matchingWallet = existingUsers.find(
      (u) =>
        u.roleCode === 'CITIZEN' &&
        String(u.walletAddress || '').toLowerCase() === normalizedWallet.toLowerCase()
    );
    if (matchingWallet) {
      return matchingWallet;
    }
  }

  const fallbackWallet =
    normalizedWallet ||
    PUBLIC_PROTOTYPE_WALLETS[Math.floor(Math.random() * PUBLIC_PROTOTYPE_WALLETS.length)];

  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const walletSlug = fallbackWallet.toLowerCase().replace(/^0x/, '').slice(0, 8);
  const generatedEmail = `buyer.${uniqueSuffix}@public.anagu.local`;
  const generatedPassword = crypto.randomBytes(16).toString('hex');
  const generatedNationalId = `NID-WALLET-${walletSlug.toUpperCase()}`;

  return createUser({
    fullName: `Wallet Buyer ${walletSlug.slice(0, 6)}`,
    email: generatedEmail,
    password: generatedPassword,
    nationalId: generatedNationalId,
    phone: '',
    walletAddress: fallbackWallet,
    roleCode: 'CITIZEN',
  });
}

function resolveListingPricing({ priceUsd, pricePol }) {
  const hasUsd = priceUsd !== undefined && priceUsd !== null && String(priceUsd).trim() !== '';
  const hasPol = pricePol !== undefined && pricePol !== null && String(pricePol).trim() !== '';

  if (hasUsd) {
    const numericUsd = Number(priceUsd);
    if (!Number.isFinite(numericUsd) || numericUsd <= 0) {
      return { error: 'Land price in USD ($) must be greater than zero.' };
    }
    const cleanUsd = Number(numericUsd.toFixed(2));
    const numericPol = convertUsdToPol(cleanUsd);
    if (!Number.isFinite(numericPol) || numericPol <= 0) {
      return { error: 'Land price in USD ($) is too small to convert into on-chain escrow.' };
    }
    return { numericUsd: cleanUsd, numericPol };
  }

  if (hasPol) {
    const numericPol = Number(pricePol);
    if (!Number.isFinite(numericPol) || numericPol <= 0) {
      return { error: 'Listing price must be greater than zero.' };
    }
    return {
      numericUsd: convertPolToUsd(numericPol),
      numericPol,
    };
  }

  return { error: 'Land price in USD ($) is required and must be greater than zero.' };
}

export async function registerAndUploadLand(req, res) {
  try {
    const {
      parcelName,
      locationDescription,
      region,
      declaredAreaSqm,
      ownershipType = 'FREEHOLD',
      claimantName,
      claimantNationalId,
      coordinates,
      stateId,
      lgaId,
      communityId,
      boundarySource,
      priceUsd,
      pricePol,
      headline = '',
      description = '',
      walletAddress = '',
    } = req.body || {};

    if (!parcelName || String(parcelName).trim().length < 3) {
      return res.status(400).json({ error: 'Parcel name must be at least 3 characters.' });
    }
    if (!locationDescription || String(locationDescription).trim().length < 5) {
      return res.status(400).json({ error: 'Location description must be at least 5 characters.' });
    }
    if (!region || String(region).trim().length < 2) {
      return res.status(400).json({ error: 'Region / District is required.' });
    }
    const areaNum = Number(declaredAreaSqm);
    if (!Number.isFinite(areaNum) || areaNum <= 0) {
      return res.status(400).json({ error: 'Declared area (m²) must be greater than zero.' });
    }
    const normalizedOwnership = String(ownershipType || 'FREEHOLD').trim().toUpperCase();
    if (!ALLOWED_OWNERSHIP_TYPES.includes(normalizedOwnership)) {
      return res.status(400).json({
        error: `Ownership type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(', ')}.`,
      });
    }
    if (!claimantName || String(claimantName).trim().length < 2) {
      return res.status(400).json({ error: 'Claimant legal name is required.' });
    }
    if (!claimantNationalId || String(claimantNationalId).trim().length < 4) {
      return res.status(400).json({ error: 'Claimant National ID is required.' });
    }

    const pricing = resolveListingPricing({ priceUsd, pricePol });
    if (pricing.error) {
      return res.status(400).json({ error: pricing.error });
    }
    const { numericUsd, numericPol: numericPrice } = pricing;

    let coordinatesGeojson;
    try {
      coordinatesGeojson = normalizeGeoJsonPolygon(coordinates);
    } catch (geoErr) {
      return res.status(400).json({ error: geoErr.message });
    }

    let location;
    let normalizedBoundarySource;
    try {
      location = await validateLocationSelection({ stateId, lgaId, communityId });
      normalizedBoundarySource = normalizeBoundarySource(boundarySource);
    } catch (locationErr) {
      if (isLocationReferenceSchemaMissing(locationErr)) {
        return res.status(503).json({
          error: LOCATION_REFERENCE_MIGRATION_ERROR,
          code: 'GIS_REFERENCE_MIGRATION_REQUIRED',
        });
      }
      return res.status(400).json({ error: locationErr.message });
    }

    const landowner = await resolvePublicLandowner({
      reqUser: req.user,
      claimantName,
      claimantNationalId,
      requestedWallet: walletAddress,
    });

    const application = await createApplication({
      applicantId: landowner.id,
      parcelName,
      locationDescription,
      region,
      declaredAreaSqm: areaNum,
      ownershipType: normalizedOwnership,
      claimantName,
      claimantNationalId,
      coordinatesGeojson,
      ...location,
      boundarySource: normalizedBoundarySource,
    });

    let uploadedDocument = null;
    if (req.file) {
      const documentType = String(req.body?.documentType || 'DEED_OF_CONVEYANCE').toUpperCase();
      if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
        return res.status(400).json({
          error: `Document type must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}.`,
        });
      }
      uploadedDocument = await uploadAndAddSupportingDocument({
        applicationId: application.id,
        uploadedBy: landowner.id,
        documentType,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype || 'application/octet-stream',
        fileSizeBytes: req.file.size,
        buffer: req.file.buffer,
        isTamperedFlag: false,
      });
    }

    const preferredWallet = (walletAddress || landowner.walletAddress || '').trim();
    const sellerWallet = isAddress(preferredWallet)
      ? await resolveSigningWalletAddress(preferredWallet)
      : await resolveSigningWalletAddress('');

    const sanitized = sanitizeListingDetails({
      headline: String(headline || '').trim() || application.parcel_name,
      description,
      fallbackTitle: application,
      isPendingVerification: true,
    });

    const listing = await createListingRecord({
      titleId: null,
      applicationId: application.id,
      sellerId: landowner.id,
      sellerWallet,
      priceWei: parseEther(String(numericPrice)).toString(),
      pricePol: numericPrice,
      priceUsd: numericUsd,
      priceAnagu: numericUsd,   // 1 ANAGU = $1 USD default rate
      headline: sanitized.headline,
      description: sanitized.description,
      verificationStatus: 'PENDING_ADMIN_APPROVAL',
    });

    const enrichedListing =
      (await listMarketplaceListings({ includePendingAdmin: true })).find(
        (item) => item.id === listing.id
      ) || listing;

    await recordAuditLog({
      actorId: landowner.id,
      actorRole: landowner.roleCode || 'CITIZEN',
      action: 'PUBLIC_LAND_SUBMITTED_FOR_ADMIN_VERIFICATION',
      entityType: 'land_listing',
      entityId: enrichedListing.id,
      details: {
        applicationId: application.id,
        referenceCode: application.reference_code,
        parcelName: application.parcel_name,
        region: application.region,
        priceUsd: numericUsd,
        pricePol: numericPrice,
        headline: sanitized.headline,
        hasDocument: Boolean(uploadedDocument),
        documentSha256: uploadedDocument?.sha256_hash || null,
        verificationStatus: enrichedListing.verification_status,
        publishedToCheckLands: false,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/applications/submitted',
      eventType: 'LAND_DEED_AWAITING_ADMIN_VERIFICATION',
      userId: landowner.id,
      targetRole: 'LAND_ADMIN',
      data: {
        listingId: enrichedListing.id,
        applicationId: application.id,
        referenceCode: application.reference_code,
        parcelName: application.parcel_name,
        priceUsd: numericUsd,
        pricePol: numericPrice,
        headline: sanitized.headline,
        hasDocument: Boolean(uploadedDocument),
        verificationStatus: enrichedListing.verification_status,
      },
    });

    const formattedUsd = formatUsdPrice(numericUsd);
    const message = uploadedDocument
      ? `${application.parcel_name} (${application.reference_code}) submitted at ${formattedUsd} (${numericPrice} POL) with deed SHA-256 ${uploadedDocument.sha256_hash.slice(0, 12)}... Pending Administrator verification of your land deed before appearing on Check Lands.`
      : `${application.parcel_name} (${application.reference_code}) submitted at ${formattedUsd} (${numericPrice} POL). Pending Administrator deed verification before appearing on Check Lands.`;

    const paymentToken = signAuthToken({
      id: landowner.id,
      email: landowner.email || '',
      roleCode: landowner.roleCode || 'CITIZEN',
      fullName: landowner.fullName || claimantName.trim(),
      nationalId: landowner.nationalId || claimantNationalId.trim(),
      walletAddress: sellerWallet || landowner.walletAddress || '',
    });

    return res.status(201).json({
      message,
      application,
      listing: enrichedListing,
      document: uploadedDocument,
      verificationReport: null,
      paymentToken,
    });
  } catch (error) {
    console.error('Public register and upload land error:', error);
    if (isLocationReferenceSchemaMissing(error)) {
      return res.status(503).json({
        error: 'GIS Phase 4 schema is not installed. Apply migration 013_gis_measurements_and_boundary_history.sql.',
        code: 'GIS_PHASE4_MIGRATION_REQUIRED',
      });
    }
    return res.status(500).json({ error: error.message || 'Failed to register and upload land parcel.' });
  }
}

export async function getMarketplaceListings(_req, res) {
  try {
    const listings = await listMarketplaceListings();
    return res.json({ listings });
  } catch (error) {
    console.error('Marketplace listings error:', error);
    return res.status(500).json({ error: 'Failed to load Polygon marketplace listings.' });
  }
}

export async function getMarketplaceEligibility(req, res) {
  try {
    const [contexts, allListings] = await Promise.all([
      listVerificationContextsForUser(req.user),
      listMarketplaceListings({ includePendingAdmin: true }),
    ]);

    const evaluated = contexts.map((ctx) =>
      evaluateApplicationVerification({
        ...ctx,
        activeListings: allListings,
      })
    );

    const readyToList = evaluated.filter((item) => item.eligible);
    const activeListings = evaluated.filter((item) => item.statusLabel === 'ALREADY_LISTED');
    const unverifiedParcels = evaluated.filter(
      (item) => !item.eligible && item.statusLabel !== 'ALREADY_LISTED'
    );
    const postableParcels = evaluated.filter((item) => item.canPost);

    return res.json({
      readyToList,
      unverifiedParcels,
      postableParcels,
      activeListings,
      summary: {
        readyCount: readyToList.length,
        unverifiedCount: unverifiedParcels.length,
        postableCount: postableParcels.length,
        activeCount: activeListings.length,
      },
    });
  } catch (error) {
    console.error('Marketplace eligibility error:', error);
    return res.status(500).json({ error: 'Failed to evaluate parcel verification eligibility.' });
  }
}

export async function createParcelListing(req, res) {
  try {
    const {
      titleId,
      applicationId,
      priceUsd,
      pricePol,
      headline,
      description,
      sellerWallet: requestedWallet,
      txHash,
    } = req.body || {};

    const pricing = resolveListingPricing({ priceUsd, pricePol });
    if (pricing.error) {
      return res.status(400).json({ error: pricing.error });
    }
    const { numericUsd, numericPol: numericPrice } = pricing;

    const allListings = await listMarketplaceListings({ includePendingAdmin: true });
    let resolvedTitleId = titleId ? Number(titleId) : null;

    if (!resolvedTitleId && applicationId) {
      const appCtx = await findApplicationVerificationContext(applicationId);
      if (!appCtx) {
        return res.status(404).json({ error: 'Land application not found.' });
      }
      if (
        appCtx.application.applicant_id !== req.user.id &&
        req.user.roleCode !== 'LAND_ADMIN'
      ) {
        return res.status(403).json({
          error: 'Only the applicant or Land Admin can post this parcel for sale.',
        });
      }

      const appEligibility = evaluateApplicationVerification({
        ...appCtx,
        activeListings: allListings,
      });

      if (!appEligibility.checks.notRevoked) {
        return res.status(409).json({
          error: 'This parcel has been statutorily REVOKED and cannot be posted for sale.',
          verificationRequired: true,
          eligibility: appEligibility,
        });
      }

      if (!appEligibility.checks.notAlreadyListed) {
        return res.status(409).json({
          error: 'An active sale listing already exists for this parcel.',
          eligibility: appEligibility,
        });
      }

      if (appEligibility.eligible && appEligibility.titleId) {
        resolvedTitleId = appEligibility.titleId;
      } else {
        // Post parcel BEFORE verification so buyers can browse it and run live verification before buying
        const preferredWallet = (requestedWallet || req.user.walletAddress || '').trim();
        const sellerWallet = isAddress(preferredWallet)
          ? await resolveSigningWalletAddress(preferredWallet)
          : await resolveSigningWalletAddress('');

        const sanitized = sanitizeListingDetails({
          headline,
          description,
          fallbackTitle: appCtx.application,
          isPendingVerification: true,
        });

        const listing = await createListingRecord({
          titleId: null,
          applicationId: appCtx.application.id,
          sellerId: appCtx.application.applicant_id,
          sellerWallet,
          priceWei: parseEther(String(numericPrice)).toString(),
          pricePol: numericPrice,
          priceUsd: numericUsd,
          priceAnagu: numericUsd,
          headline: sanitized.headline,
          description: sanitized.description,
          verificationStatus: 'PENDING_VERIFICATION',
        });

        await recordAuditLog({
          actorId: req.user.id,
          actorRole: req.user.roleCode,
          action: 'PRE_VERIFICATION_PARCEL_LISTED',
          entityType: 'land_listing',
          entityId: listing.id,
          details: {
            applicationId: appCtx.application.id,
            referenceCode: appCtx.application.reference_code,
            priceUsd: numericUsd,
            pricePol: numericPrice,
            headline: sanitized.headline,
          },
          ipAddress: req.ip,
        });

        await publishAnaguEvent({
          topic: 'anagu/marketplace/updated',
          eventType: 'PRE_VERIFICATION_PARCEL_LISTED',
          userId: appCtx.application.applicant_id,
          targetRole: 'ALL',
          data: {
            listingId: listing.id,
            applicationId: appCtx.application.id,
            referenceCode: appCtx.application.reference_code,
            priceUsd: numericUsd,
            pricePol: numericPrice,
            headline: sanitized.headline,
            verificationStatus: 'PENDING_VERIFICATION',
          },
        });

        const enriched =
          (await listMarketplaceListings()).find((item) => item.id === listing.id) || listing;

        return res.status(201).json({
          message: `Parcel ${appCtx.application.reference_code} posted publicly for ${formatUsdPrice(numericUsd)} (${numericPrice} POL, Pending Verification). Buyers will verify GIS, Oracle & ERC-721 title before purchasing.`,
          listing: enriched,
        });
      }
    }

    if (!resolvedTitleId) {
      return res.status(400).json({
        error: 'Select a land parcel or verified ERC-721 Land Title before posting land for sale.',
      });
    }

    const titleCtx = await findTitleVerificationContext(resolvedTitleId);
    const title = titleCtx?.title || (await findTitleById(resolvedTitleId));
    if (!title) {
      return res.status(404).json({ error: 'NFT land title not found.' });
    }

    if (title.title_status === 'REVOKED') {
      return res.status(409).json({
        error: 'This land title has been statutorily REVOKED by the Administrator and cannot be listed or sold.',
        verificationRequired: true,
      });
    }

    if (title.owner_id !== req.user.id && req.user.roleCode !== 'LAND_ADMIN') {
      return res.status(403).json({
        error: 'Only the registered title owner can list this parcel on the Polygon marketplace.',
      });
    }

    const eligibility = evaluateApplicationVerification({
      application: titleCtx?.application || null,
      parcel: titleCtx?.parcel || null,
      verificationRecords: titleCtx?.verificationRecords || [],
      title,
      activeListings: allListings,
    });

    if (!eligibility.checks.notAlreadyListed) {
      return res.status(409).json({
        error: 'An active sale listing already exists for this title.',
        eligibility,
      });
    }

    if (
      !eligibility.checks.gisValidated ||
      !eligibility.checks.oracleVerified ||
      !eligibility.checks.titleActive
    ) {
      return res.status(409).json({
        error: `Verification required before posting this title: ${eligibility.missingSteps.join(
          ' '
        )}`,
        verificationRequired: true,
        eligibility,
      });
    }

    const sellerWallet = (requestedWallet || req.user.walletAddress || title.owner_wallet || '').trim();
    if (!isAddress(sellerWallet)) {
      return res.status(400).json({ error: 'A valid Polygon wallet address is required to list.' });
    }

    const sanitized = sanitizeListingDetails({
      headline,
      description,
      fallbackTitle: title,
    });

    const chainResult = await listParcelOnChain({
      sellerWallet,
      tokenId: title.token_id,
      pricePol: numericPrice,
      priceAnagu: convertUsdToAnagu(numericUsd),
      txHash: txHash || null,
    });

    const listing = await createListingRecord({
      titleId: title.id,
      applicationId: title.application_id,
      sellerId: title.owner_id,
      sellerWallet: chainResult.sellerWallet,
      priceWei: chainResult.priceWei,
      pricePol: numericPrice,
      priceUsd: numericUsd,
      priceAnagu: numericUsd,
      headline: sanitized.headline,
      description: sanitized.description,
      verificationStatus: 'VERIFIED',
    });

    await recordBlockchainTransaction({
      titleId: title.id,
      applicationId: title.application_id,
      txType: 'LIST_PARCEL',
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      fromAddress: chainResult.sellerWallet,
      gasUsed: chainResult.gasUsed,
      latencyMs: chainResult.latencyMs,
      status: 'CONFIRMED',
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'POLYGON_PARCEL_LISTED',
      entityType: 'land_listing',
      entityId: listing.id,
      details: {
        titleNumber: title.title_number,
        tokenId: title.token_id,
        priceUsd: numericUsd,
        pricePol: numericPrice,
        headline: sanitized.headline,
        oracleScore: eligibility.oracleScore,
        txHash: chainResult.txHash,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/marketplace/updated',
      eventType: 'POLYGON_PARCEL_LISTED',
      userId: title.owner_id,
      targetRole: 'ALL',
      data: {
        listingId: listing.id,
        titleNumber: title.title_number,
        tokenId: title.token_id,
        priceUsd: numericUsd,
        pricePol: numericPrice,
        headline: sanitized.headline,
      },
    });

    const enriched =
      (await listMarketplaceListings()).find((item) => item.id === listing.id) || listing;

    return res.status(201).json({
      message: `Title ${title.title_number} verified and listed on Polygon marketplace for ${formatUsdPrice(numericUsd)} (${numericPrice} POL).`,
      listing: enriched,
    });
  } catch (error) {
    console.error('Create listing error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to create Polygon listing.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

async function runListingBuyerVerification(listing) {
  const ctx = await findListingVerificationContext(listing.id);
  const { escrowAddress } = await getActiveEscrowConfig();
  const useAnaguEscrow = isAddress(escrowAddress) && (listing.price_anagu || listing.price_usd);
  const expectedPriceWei = useAnaguEscrow
    ? anaguToWei(listing.price_anagu || convertUsdToAnagu(listing.price_usd))
    : listing.price_wei;
  const onChainStatus = listing.token_id
    ? await verifyListingOnChain({
        tokenId: listing.token_id,
        expectedSellerWallet: listing.seller_wallet,
        expectedPriceWei,
      })
    : {
        ok: false,
        error: 'ERC-721 NFT title has not been minted on-chain yet because verification did not clear.',
      };

  return evaluateBuyerPurchaseVerification({
    listing: ctx?.listing || listing,
    title: ctx?.title || null,
    parcel: ctx?.parcel || null,
    application: ctx?.application || null,
    documents: ctx?.documents || [],
    verificationRecords: ctx?.verificationRecords || [],
    ownershipRecords: ctx?.ownershipRecords || [],
    existingParcels: ctx?.existingParcels || [],
    onChainStatus,
    verifyFilesOnDisk: false,
  });
}

async function verifyPendingListingOnDemand(listing, actorId = null, actorRole = 'SYSTEM') {
  let activeListing = listing;
  if (activeListing.title_id && activeListing.token_id) {
    if (
      activeListing.verification_status !== 'VERIFIED' ||
      activeListing.listing_status === 'CANCELLED'
    ) {
      await attachTitleToListing({
        listingId: activeListing.id,
        titleId: activeListing.title_id,
        sellerWallet: activeListing.seller_wallet || '',
        verificationStatus: 'VERIFIED',
        listingStatus:
          activeListing.listing_status === 'CANCELLED'
            ? 'LISTED'
            : activeListing.listing_status || 'LISTED',
      });
      const refreshed = (await listMarketplaceListings({ includePendingAdmin: true })).find(
        (l) => l.id === activeListing.id
      );
      return refreshed || activeListing;
    }
    return activeListing;
  }

  const ctx = await findListingVerificationContext(activeListing.id);
  const app = ctx?.application;
  if (!app || app.status === 'REVOKED' || ctx?.title?.title_status === 'REVOKED') {
    return activeListing;
  }

  const appCtx = await findApplicationVerificationContext(app.id);
  if (
    !appCtx?.application ||
    appCtx.application.status === 'REVOKED' ||
    (appCtx.application.status !== 'APPROVED' && !appCtx.title)
  ) {
    return activeListing;
  }

  // Buyers may only trigger issuance after the registrar has approved the application.
  if (appCtx?.application?.status === 'APPROVED' && appCtx.parcel && !appCtx.title) {
    const recipientWallet = await resolveSigningWalletAddress(activeListing.seller_wallet);
    const metadataPayload = {
      name: `ANAGU Title · ${appCtx.parcel.parcel_code}`,
      description: `Verified digital land title for ${appCtx.application.parcel_name} (${appCtx.application.region}).`,
      parcelCode: appCtx.parcel.parcel_code,
      applicationRef: appCtx.application.reference_code,
      areaSqm: appCtx.parcel.area_sqm,
      ownershipType: appCtx.application.ownership_type,
    };
    const metadataUri = `data:application/json;base64,${Buffer.from(
      JSON.stringify(metadataPayload)
    ).toString('base64')}`;

    const mintResult = await mintTitleOnChain({
      toWallet: recipientWallet,
      parcelCode: appCtx.parcel.parcel_code,
      applicationRef: appCtx.application.reference_code,
      metadataUri,
    });

    const title = await createTitleRecord({
      applicationId: appCtx.application.id,
      parcelId: appCtx.parcel.id,
      ownerId: appCtx.application.applicant_id,
      tokenId: mintResult.tokenId,
      contractAddress: mintResult.contractAddress,
      metadataUri,
      issuedBy: actorId || appCtx.application.applicant_id,
      actorRole,
    });

    await recordBlockchainTransaction({
      titleId: title.id,
      applicationId: appCtx.application.id,
      txType: 'MINT_TITLE',
      txHash: mintResult.txHash,
      blockNumber: mintResult.blockNumber,
      fromAddress: mintResult.fromAddress,
      toAddress: mintResult.toAddress,
      gasUsed: mintResult.gasUsed,
      latencyMs: mintResult.latencyMs,
      status: 'CONFIRMED',
    });

    const canServerList = await hasServerSignerForAddress(recipientWallet);
    let resolvedSeller = recipientWallet;

    if (canServerList) {
      const chainListResult = await listParcelOnChain({
        sellerWallet: recipientWallet,
        tokenId: title.token_id,
        pricePol: activeListing.price_pol,
        priceAnagu: activeListing.price_anagu || convertUsdToAnagu(activeListing.price_usd || 0),
      });
      resolvedSeller = chainListResult.sellerWallet;

      await recordBlockchainTransaction({
        titleId: title.id,
        applicationId: appCtx.application.id,
        txType: 'LIST_PARCEL',
        txHash: chainListResult.txHash,
        blockNumber: chainListResult.blockNumber,
        fromAddress: chainListResult.sellerWallet,
        gasUsed: chainListResult.gasUsed,
        latencyMs: chainListResult.latencyMs,
        status: 'CONFIRMED',
      });
    }

    await attachTitleToListing({
      listingId: activeListing.id,
      titleId: title.id,
      sellerWallet: resolvedSeller,
      verificationStatus: 'VERIFIED',
    });

    await publishAnaguEvent({
      topic: 'anagu/marketplace/updated',
      eventType: 'POLYGON_PARCEL_VERIFIED_AND_LISTED',
      userId: appCtx.application.applicant_id,
      targetRole: 'ALL',
      data: {
        listingId: activeListing.id,
        titleId: title.id,
        titleNumber: title.title_number,
        tokenId: title.token_id,
        pricePol: activeListing.price_pol,
        onChainListed: canServerList,
      },
    });
  } else if (appCtx?.title && !activeListing.title_id) {
    // Handle case where title existed on application but listing was created unlinked
    const recipientWallet = await resolveSigningWalletAddress(activeListing.seller_wallet);
    const { escrowAddress: activeEscrowAddress } = await getActiveEscrowConfig();
    const expectedCheckPriceWei =
      isAddress(activeEscrowAddress) && (activeListing.price_anagu || activeListing.price_usd)
        ? anaguToWei(activeListing.price_anagu || convertUsdToAnagu(activeListing.price_usd))
        : activeListing.price_wei;
    const chainCheck = await verifyListingOnChain({
      tokenId: appCtx.title.token_id,
      expectedSellerWallet: recipientWallet,
      expectedPriceWei: expectedCheckPriceWei,
    });
    let resolvedSeller = recipientWallet;
    if (!chainCheck.isListed && !chainCheck.isRevoked && !chainCheck.escrowFunded) {
      const canServerList = await hasServerSignerForAddress(recipientWallet);
      if (canServerList) {
        const chainListResult = await listParcelOnChain({
          sellerWallet: recipientWallet,
          tokenId: appCtx.title.token_id,
          pricePol: activeListing.price_pol,
          priceAnagu: activeListing.price_anagu || convertUsdToAnagu(activeListing.price_usd || 0),
        });
        resolvedSeller = chainListResult.sellerWallet;
      }
    }
    await attachTitleToListing({
      listingId: activeListing.id,
      titleId: appCtx.title.id,
      sellerWallet: resolvedSeller,
      verificationStatus: 'VERIFIED',
    });
  }

  const refreshed = (await listMarketplaceListings({ includePendingAdmin: true })).find(
    (l) => l.id === activeListing.id
  );
  return refreshed || activeListing;
}

export async function publishListingOnAdminApproval({
  listing,
  adminId,
  actorRole = 'LAND_ADMIN',
}) {
  if (!listing) return null;
  const published = await verifyPendingListingOnDemand(listing, adminId, actorRole);
  return (
    (await listMarketplaceListings()).find((item) => item.id === published.id) || published
  );
}

export async function publishApplicationToCheckLands({ applicationId, adminId, priceUsd = null }) {
  const numericAppId = Number(applicationId);
  const allListings = await listMarketplaceListings({ includePendingAdmin: true });
  const existingListing =
    allListings.find(
      (l) =>
        Number(l.application_id) === numericAppId && l.listing_status !== 'COMPLETED'
    ) || null;

  if (existingListing) {
    return publishListingOnAdminApproval({ listing: existingListing, adminId });
  }

  const appCtx = await findApplicationVerificationContext(numericAppId);
  if (!appCtx?.application) return null;

  const users = await listAllUsers();
  const applicant = users.find((u) => Number(u.id) === Number(appCtx.application.applicant_id));
  const sellerWallet = await resolveSigningWalletAddress(applicant?.walletAddress || '');
  const numericUsd =
    Number.isFinite(Number(priceUsd)) && Number(priceUsd) > 0 ? Number(priceUsd) : 5000;
  const numericPol = convertUsdToPol(numericUsd);

  const sanitized = sanitizeListingDetails({
    fallbackTitle: appCtx.application,
    isPendingVerification: false,
  });

  const created = await createListingRecord({
    titleId: appCtx.title?.id || null,
    applicationId: appCtx.application.id,
    sellerId: appCtx.application.applicant_id,
    sellerWallet,
    priceWei: parseEther(String(numericPol)).toString(),
    pricePol: numericPol,
    priceUsd: numericUsd,
    priceAnagu: numericUsd,
    headline: sanitized.headline,
    description: sanitized.description,
    verificationStatus: appCtx.title ? 'VERIFIED' : 'PENDING_ADMIN_APPROVAL',
  });

  return publishListingOnAdminApproval({ listing: created, adminId });
}

export async function verifyParcelBeforePurchase(req, res) {
  try {
    const allListings = await listMarketplaceListings({ includePendingAdmin: true });
    const initialListing = allListings.find((l) => l.id === Number(req.params.listingId));
    if (!initialListing) {
      return res.status(404).json({ error: 'Marketplace listing not found.' });
    }
    if (
      ['PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED'].includes(
        String(initialListing.verification_status || '').toUpperCase()
      )
    ) {
      return res.status(409).json({
        error:
          'This parcel is awaiting Administrator verification of its land deed before appearing on Check Lands.',
      });
    }

    const listing = await verifyPendingListingOnDemand(
      initialListing,
      req.user?.id || null,
      req.user?.roleCode || 'PUBLIC_VISITOR'
    );
    const report = await runListingBuyerVerification(listing);
    const receipt = req.user
      ? recordBuyerVerificationReceipt({
          listingId: listing.id,
          buyerId: req.user.id,
          verificationCode: report.verificationCode,
          verifiedSafeToBuy: report.verifiedSafeToBuy,
          verifiedAt: report.verifiedAt,
          checks: report.checks,
        })
      : {
          listingId: listing.id,
          buyerId: null,
          verificationCode: report.verificationCode,
          verifiedSafeToBuy: report.verifiedSafeToBuy,
          verifiedAt: report.verifiedAt,
          checks: report.checks,
        };

    await recordAuditLog({
      actorId: req.user?.id || null,
      actorRole: req.user?.roleCode || 'PUBLIC_VISITOR',
      action: report.verifiedSafeToBuy
        ? 'BUYER_LAND_VERIFICATION_PASSED'
        : 'BUYER_LAND_VERIFICATION_BLOCKED',
      entityType: 'land_listing',
      entityId: listing.id,
      details: {
        titleNumber: listing.title_number || listing.reference_code,
        parcelCode: listing.parcel_code,
        verificationCode: report.verificationCode,
        verifiedSafeToBuy: report.verifiedSafeToBuy,
        checks: report.checks,
        blockers: report.blockers,
      },
      ipAddress: req.ip,
    });

    return res.json({
      message: report.verificationSummary,
      verificationReport: report,
      receipt,
      listing,
    });
  } catch (error) {
    console.error('Verify parcel before purchase error:', error);
    return res.status(500).json({ error: error.message || 'Failed to verify parcel before purchase.' });
  }
}

export async function buyParcelIntoEscrow(req, res) {
  try {
    const requestedBuyerWallet = String(req.body?.buyerWallet || '').trim();

    const listings = await listMarketplaceListings({ includePendingAdmin: true });
    const listing = listings.find((l) => l.id === Number(req.params.listingId));
    if (!listing) {
      return res.status(404).json({ error: 'Marketplace listing not found.' });
    }
    if (
      ['PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED'].includes(
        String(listing.verification_status || '').toUpperCase()
      )
    ) {
      return res.status(409).json({
        error:
          'Purchase blocked: this parcel is awaiting Administrator verification of its land deed before Check Lands publication.',
      });
    }

    if (listing.title_status === 'REVOKED' || listing.listing_status === 'BLOCKED_REVOKED') {
      return res.status(409).json({
        error: 'Purchase blocked: this title was statutorily REVOKED and cannot be transferred or sold.',
      });
    }

    if (listing.listing_status !== 'LISTED') {
      return res.status(409).json({
        error: `Listing is currently ${listing.listing_status} and unavailable for purchase.`,
      });
    }

    // Logged-in users buy as themselves. Anonymous visitors buy with their
    // connected wallet — a public buyer account is resolved or created on
    // demand so the escrow and on-chain title transfer have a valid buyer_id.
    let buyer;
    if (req.user?.id) {
      buyer = {
        id: req.user.id,
        roleCode: req.user.roleCode || 'CITIZEN',
        walletAddress: req.user.walletAddress || '',
      };
    } else {
      if (!isAddress(requestedBuyerWallet)) {
        return res.status(400).json({
          error:
            'Connect your MetaMask or Trust Wallet, or paste a valid 0x wallet address before paying.',
        });
      }
      buyer = await resolvePublicBuyer({
        reqUser: req.user,
        requestedWallet: requestedBuyerWallet,
      });
    }

    const buyerWallet = (requestedBuyerWallet || buyer.walletAddress || '').trim();
    if (!isAddress(buyerWallet)) {
      return res.status(400).json({
        error: 'Connect your MetaMask wallet or link a valid 0x wallet address before paying.',
      });
    }

    if (
      listing.seller_id === buyer.id ||
      (listing.seller_wallet && listing.seller_wallet.toLowerCase() === buyerWallet.toLowerCase())
    ) {
      return res.status(400).json({ error: 'Seller cannot buy their own listed parcel.' });
    }

    if (req.body?.requireVerificationConfirmation) {
      const priorReceipt = findBuyerVerificationReceipt({
        listingId: listing.id,
        buyerId: buyer.id,
      });
      if (priorReceipt) {
        if (
          !priorReceipt.verifiedSafeToBuy ||
          (req.body?.verificationCode &&
            priorReceipt.verificationCode !== req.body.verificationCode)
        ) {
          return res.status(409).json({
            error:
              'Pre-purchase land verification required before buying. Run "Verify Land Before Buying" on this parcel first.',
            verificationRequired: true,
          });
        }
      } else if (!req.body?.verificationCode) {
        // Anonymous wallet buyers have no cached receipt; require a fresh
        // verificationCode (the live re-run below still enforces safe-to-buy).
        return res.status(409).json({
          error:
            'Pre-purchase land verification required before buying. Run "Verify Land Before Buying" on this parcel first.',
          verificationRequired: true,
        });
      }
    }

    const verificationReport = await runListingBuyerVerification(listing);
    if (!verificationReport.verifiedSafeToBuy) {
      return res.status(409).json({
        error: `Purchase blocked by pre-purchase land verification: ${verificationReport.blockers.join(
          ' '
        )}`,
        verificationRequired: true,
        verificationReport,
      });
    }
    if (
      req.body?.requireVerificationConfirmation &&
      req.body?.verificationCode &&
      verificationReport.verificationCode !== req.body.verificationCode
    ) {
      return res.status(409).json({
        error:
          'Verification code does not match this parcel. Run "Verify Land Before Buying" again.',
        verificationRequired: true,
      });
    }

    // When ANAGU escrow is active, priceWei must be denominated in ANAGU wei (18 dec).
    // When the POL path is active, use the existing price_wei (POL wei).
    const { escrowAddress } = await getActiveEscrowConfig();
    const effectivePriceWei =
      isAddress(escrowAddress) && (listing.price_anagu || listing.price_usd)
        ? anaguToWei(listing.price_anagu || convertUsdToAnagu(listing.price_usd))
        : listing.price_wei;

    const chainResult = await fundEscrowOnChain({
      buyerWallet,
      tokenId: listing.token_id,
      priceWei: effectivePriceWei,
      txHash: req.body?.txHash || null,
    });

    const updated = await updateListingEscrowFunded({
      listingId: listing.id,
      buyerId: buyer.id,
      buyerWallet: chainResult.buyerWallet,
      escrowTxHash: chainResult.txHash,
    });

    await recordBlockchainTransaction({
      titleId: listing.title_id,
      txType: 'BUY_ESCROW',
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      fromAddress: chainResult.buyerWallet,
      toAddress: listing.contract_address,
      gasUsed: chainResult.gasUsed,
      latencyMs: chainResult.latencyMs,
      status: 'CONFIRMED',
    });

    const resolvedUsd =
      listing.price_usd != null ? Number(listing.price_usd) : convertPolToUsd(listing.price_pol);

    await recordAuditLog({
      actorId: buyer.id,
      actorRole: buyer.roleCode || 'CITIZEN',
      action: 'POLYGON_ESCROW_FUNDED',
      entityType: 'land_listing',
      entityId: listing.id,
      details: {
        titleNumber: listing.title_number,
        priceUsd: resolvedUsd,
        pricePol: listing.price_pol,
        buyerWallet: chainResult.buyerWallet,
        txHash: chainResult.txHash,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/marketplace/updated',
      eventType: 'POLYGON_ESCROW_FUNDED',
      userId: listing.seller_id,
      targetRole: 'LAND_ADMIN',
      data: {
        listingId: listing.id,
        titleNumber: listing.title_number,
        priceUsd: resolvedUsd,
        pricePol: listing.price_pol,
        buyerWallet: chainResult.buyerWallet,
      },
    });

    return res.json({
      message: `Payment of ${formatUsdPrice(resolvedUsd)} (${listing.price_pol} POL) is held in escrow. The seller must confirm the sale to transfer the title and release payment.`,
      listing: updated,
    });
  } catch (error) {
    console.error('Buy parcel escrow error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to fund Polygon escrow.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

export async function settleParcelSale(req, res) {
  try {
    const listings = await listMarketplaceListings();
    const listing = listings.find((l) => l.id === Number(req.params.listingId));
    if (!listing) {
      return res.status(404).json({ error: 'Marketplace listing not found.' });
    }
    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the listing seller can confirm this sale.' });
    }

    if (listing.title_status === 'REVOKED') {
      return res.status(409).json({
        error: 'Settlement blocked because the land title is revoked.',
      });
    }

    if (listing.listing_status !== 'ESCROW_FUNDED') {
      return res.status(409).json({
        error: 'The buyer must fund escrow before you can confirm this sale.',
      });
    }

    const txHash = String(req.body?.txHash || '').trim();
    if (!txHash) {
      return res.status(400).json({ error: 'Seller wallet transaction hash is required.' });
    }

    const { escrowAddress } = await getActiveEscrowConfig();
    const expectedSettlementWei =
      isAddress(escrowAddress) && (listing.price_anagu || listing.price_usd)
        ? anaguToWei(listing.price_anagu || convertUsdToAnagu(listing.price_usd))
        : listing.price_wei;

    const chainResult = await settleSaleOnChain({
      tokenId: listing.token_id,
      sellerWallet: listing.seller_wallet,
      buyerWallet: listing.buyer_wallet,
      priceWei: expectedSettlementWei,
      txHash,
    });
    const completed = await completeListingSale({
      listingId: listing.id,
      settlementTxHash: chainResult.txHash,
    });

    await recordBlockchainTransaction({
      titleId: listing.title_id,
      txType: 'SETTLE_SALE',
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      fromAddress: chainResult.fromAddress,
      toAddress: listing.buyer_wallet,
      gasUsed: chainResult.gasUsed,
      latencyMs: chainResult.latencyMs,
      status: 'CONFIRMED',
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'POLYGON_SALE_SETTLED',
      entityType: 'land_listing',
      entityId: listing.id,
      details: {
        titleNumber: listing.title_number,
        sellerWallet: listing.seller_wallet,
        buyerWallet: listing.buyer_wallet,
        pricePol: listing.price_pol,
        txHash: chainResult.txHash,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/marketplace/updated',
      eventType: 'POLYGON_SALE_SETTLED',
      userId: listing.buyer_id,
      targetRole: 'ALL',
      data: {
        listingId: listing.id,
        titleNumber: listing.title_number,
        sellerWallet: listing.seller_wallet,
        buyerWallet: listing.buyer_wallet,
        pricePol: listing.price_pol,
      },
    });

    return res.json({
      message: `Sale settled on-chain! POL released to seller and NFT Title ${listing.title_number} transferred to buyer.`,
      listing: completed,
    });
  } catch (error) {
    console.error('Settle sale error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to confirm sale.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

export async function cancelParcelListing(req, res) {
  try {
    const listings = await listMarketplaceListings();
    const listing = listings.find((l) => l.id === Number(req.params.listingId));
    if (!listing) {
      return res.status(404).json({ error: 'Marketplace listing not found.' });
    }
    if (listing.listing_status !== 'LISTED') {
      return res.status(409).json({ error: 'Only unfunded LISTED parcels can be cancelled.' });
    }
    if (
      listing.seller_id !== req.user.id &&
      req.user.roleCode !== 'LAND_ADMIN'
    ) {
      return res.status(403).json({ error: 'Only seller or Administrator may cancel this listing.' });
    }

    let chainResult = null;
    if (listing.title_id && listing.token_id) {
      chainResult = await cancelListingOnChain({
        callerWallet: req.user.walletAddress || listing.seller_wallet,
        tokenId: listing.token_id,
        txHash: req.body?.txHash || null,
      });
    }

    const cancelled = await cancelListingRecord(listing.id);

    if (chainResult) {
      await recordBlockchainTransaction({
        titleId: listing.title_id,
        txType: 'CANCEL_LISTING',
        txHash: chainResult.txHash,
        blockNumber: chainResult.blockNumber,
        fromAddress: req.user.walletAddress || listing.seller_wallet,
        gasUsed: chainResult.gasUsed,
        latencyMs: chainResult.latencyMs,
        status: 'CONFIRMED',
      });
    }

    await publishAnaguEvent({
      topic: 'anagu/marketplace/updated',
      eventType: 'POLYGON_LISTING_CANCELLED',
      userId: listing.seller_id,
      targetRole: 'ALL',
      data: {
        listingId: listing.id,
        titleNumber: listing.title_number || listing.reference_code,
      },
    });

    return res.json({ message: 'Parcel listing cancelled.', listing: cancelled });
  } catch (error) {
    console.error('Cancel listing error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to cancel listing.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

export async function activateParcelListingOnChain(req, res) {
  try {
    const listings = await listMarketplaceListings();
    const listing = listings.find((l) => l.id === Number(req.params.listingId));
    if (!listing) {
      return res.status(404).json({ error: 'Marketplace listing not found.' });
    }
    if (!listing.title_id || !listing.token_id) {
      return res.status(409).json({
        error: 'An ERC-721 title must be minted before activating on-chain escrow listing.',
      });
    }
    if (listing.listing_status !== 'LISTED') {
      return res.status(409).json({ error: `Listing is currently ${listing.listing_status}.` });
    }
    if (
      listing.seller_id !== req.user.id &&
      req.user.roleCode !== 'LAND_ADMIN'
    ) {
      return res.status(403).json({ error: 'Only the title seller or Admin may activate this listing.' });
    }

    const sellerWallet = (req.body?.sellerWallet || req.user.walletAddress || listing.seller_wallet || '').trim();
    const chainResult = await listParcelOnChain({
      sellerWallet,
      tokenId: listing.token_id,
      pricePol: listing.price_pol,
      priceAnagu: listing.price_anagu || convertUsdToAnagu(listing.price_usd || 0),
      txHash: req.body?.txHash || null,
    });

    await attachTitleToListing({
      listingId: listing.id,
      titleId: listing.title_id,
      sellerWallet: chainResult.sellerWallet,
      verificationStatus: 'VERIFIED',
    });

    await recordBlockchainTransaction({
      titleId: listing.title_id,
      applicationId: listing.application_id,
      txType: 'LIST_PARCEL',
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      fromAddress: chainResult.sellerWallet,
      gasUsed: chainResult.gasUsed,
      latencyMs: chainResult.latencyMs,
      status: 'CONFIRMED',
    });

    const refreshed =
      (await listMarketplaceListings()).find((item) => item.id === listing.id) || listing;

    return res.json({
      message: `Listing #${listing.token_id} is now active on-chain for escrow purchase.`,
      listing: refreshed,
      txHash: chainResult.txHash,
    });
  } catch (error) {
    console.error('Activate listing on-chain error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to activate listing on-chain.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
}
