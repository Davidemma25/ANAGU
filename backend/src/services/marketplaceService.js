import { detectPolygonOverlap, validatePolygonGeometry } from './gisService.js';
import { evaluateOwnershipClaim } from './oracleService.js';
import { env } from '../config/env.js';

export const DEFAULT_USD_PER_POL = Number(process.env.USD_PER_POL || 1000);

// ANAGU token rate: how many USD buys 1 ANAGU token.
// Default: 1 ANAGU = $1 USD  (matches the AnaguEscrow fixed marketplace model).
export const DEFAULT_USD_PER_ANAGU = Number(process.env.USD_PER_ANAGU || env.token?.usdPerAnagu || 1);

export function convertUsdToAnagu(priceUsd, usdPerAnagu = DEFAULT_USD_PER_ANAGU) {
  const numericUsd = Number(priceUsd);
  const rate = Number(usdPerAnagu) > 0 ? Number(usdPerAnagu) : 1;
  if (!Number.isFinite(numericUsd) || numericUsd <= 0) return 0;
  return Number((numericUsd / rate).toFixed(6));
}

export function convertAnaguToUsd(priceAnagu, usdPerAnagu = DEFAULT_USD_PER_ANAGU) {
  const numericAnagu = Number(priceAnagu);
  const rate = Number(usdPerAnagu) > 0 ? Number(usdPerAnagu) : 1;
  if (!Number.isFinite(numericAnagu) || numericAnagu <= 0) return 0;
  return Number((numericAnagu * rate).toFixed(2));
}

// Convert ANAGU amount to 18-decimal wei string (for AnaguEscrow.fundEscrow)
export function anaguToWei(priceAnagu) {
  const n = Number(priceAnagu);
  if (!Number.isFinite(n) || n <= 0) return '0';
  // 18 decimals — multiply by 1e18, truncate to integer
  return BigInt(Math.round(n * 1e9)) * BigInt(1e9) + '';
}

export function convertUsdToPol(priceUsd, usdPerPol = DEFAULT_USD_PER_POL) {
  const numericUsd = Number(priceUsd);
  const rate = Number(usdPerPol) > 0 ? Number(usdPerPol) : 1000;
  if (!Number.isFinite(numericUsd) || numericUsd <= 0) return 0;
  return Number((numericUsd / rate).toFixed(6));
}

export function convertPolToUsd(pricePol, usdPerPol = DEFAULT_USD_PER_POL) {
  const numericPol = Number(pricePol);
  const rate = Number(usdPerPol) > 0 ? Number(usdPerPol) : 1000;
  if (!Number.isFinite(numericPol) || numericPol <= 0) return 0;
  return Number((numericPol * rate).toFixed(2));
}

export function formatUsdPrice(priceUsd) {
  const num = Number(priceUsd);
  if (!Number.isFinite(num)) return '$0';
  const isWhole = Math.abs(num - Math.round(num)) < 0.005;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function evaluateApplicationVerification({
  application = null,
  parcel = null,
  verificationRecords = [],
  title = null,
  activeListings = [],
} = {}) {
  const sortedVerifications = [...(verificationRecords || [])].sort(
    (a, b) => new Date(b.verified_at || 0) - new Date(a.verified_at || 0)
  );
  const latestVerification = sortedVerifications[0] || null;

  const gisValidated = Boolean(
    parcel &&
      parcel.is_geometry_valid &&
      parcel.overlap_checked !== false &&
      application?.status !== 'GIS_REJECTED' &&
      application?.status !== 'SUBMITTED'
  );

  const oracleVerified = Boolean(
    latestVerification &&
      latestVerification.decision === 'APPROVED' &&
      application?.status !== 'VERIFICATION_REJECTED'
  );

  const notRevoked = Boolean(
    title?.title_status !== 'REVOKED' &&
      parcel?.status !== 'REVOKED' &&
      application?.status !== 'REVOKED'
  );

  const titleActive = Boolean(title && title.title_status === 'ACTIVE');

  const resolvedAppId = application?.id ?? title?.application_id ?? null;
  const existingListing = (activeListings || []).find(
    (l) =>
      ['LISTED', 'ESCROW_FUNDED'].includes(l.listing_status) &&
      ((title && l.title_id && l.title_id === title.id) ||
        (resolvedAppId && l.application_id && Number(l.application_id) === Number(resolvedAppId)))
  ) || null;
  const notAlreadyListed = !existingListing;

  const missingSteps = [];
  if (!gisValidated) {
    missingSteps.push(
      application?.status === 'GIS_REJECTED'
        ? 'Spatial GIS geometry check rejected — resubmit a non-overlapping boundary polygon.'
        : 'Surveyor Spatial GIS geometry & overlap validation required.'
    );
  }
  if (!oracleVerified) {
    missingSteps.push(
      application?.status === 'VERIFICATION_REJECTED' ||
        latestVerification?.decision === 'REJECTED' ||
        latestVerification?.decision === 'FLAGGED_CONFLICT'
        ? 'Community Ownership Oracle flagged a conflict or rejected this claim.'
        : 'Community Ownership Oracle approval required.'
    );
  }
  if (!notRevoked) {
    missingSteps.push('Land title has been statutorily REVOKED and cannot be posted for sale.');
  } else if (!titleActive) {
    missingSteps.push('Registrar must mint an ACTIVE ERC-721 Land Title before settlement.');
  }
  if (!notAlreadyListed) {
    missingSteps.push(
      `${title?.title_number || application?.reference_code || 'Parcel'} already has an active listing (${existingListing.listing_status}).`
    );
  }

  let statusLabel = 'AWAITING_GIS';
  let nextAction = 'Post now as Pending Verification, or complete GIS & Oracle checks first.';

  if (!notRevoked) {
    statusLabel = 'REVOKED';
    nextAction = 'Statutorily revoked parcels are permanently barred from marketplace sale.';
  } else if (!notAlreadyListed) {
    statusLabel = 'ALREADY_LISTED';
    nextAction = `Currently ${existingListing.listing_status} on the marketplace.`;
  } else if (gisValidated && oracleVerified && titleActive) {
    statusLabel = 'READY_TO_LIST';
    nextAction = 'All verification gates cleared. Ready to post on the marketplace.';
  } else if (application?.status === 'GIS_REJECTED') {
    statusLabel = 'GIS_REJECTED';
    nextAction = 'Can be posted with Pending Verification warning; buyers will see GIS overlap blockers.';
  } else if (!gisValidated) {
    statusLabel = 'AWAITING_GIS';
    nextAction = 'Can be posted now so buyers can inspect & trigger live verification before buying.';
  } else if (
    application?.status === 'VERIFICATION_REJECTED' ||
    latestVerification?.decision === 'REJECTED' ||
    latestVerification?.decision === 'FLAGGED_CONFLICT'
  ) {
    statusLabel = 'ORACLE_REJECTED';
    nextAction = 'Institutional conflict flagged; buyer pre-purchase verification will block sale.';
  } else if (!oracleVerified) {
    statusLabel = 'AWAITING_ORACLE';
    nextAction = 'Can be posted now; live Oracle & ERC-721 check runs when buyer verifies.';
  } else if (!titleActive) {
    statusLabel = 'AWAITING_TITLE_MINT';
    nextAction = 'Can be posted now; ERC-721 title mints automatically after buyer verification passes.';
  }

  const eligible =
    gisValidated && oracleVerified && titleActive && notRevoked && notAlreadyListed;
  const canPost = Boolean(notRevoked && notAlreadyListed && (application || title));
  const postingMode = eligible
    ? 'VERIFIED'
    : canPost
    ? 'PENDING_VERIFICATION'
    : 'BLOCKED';

  return {
    eligible,
    canPost,
    postingMode,
    verificationStatus: eligible ? 'VERIFIED' : 'PENDING_VERIFICATION',
    statusLabel,
    nextAction,
    missingSteps,
    checks: {
      gisValidated,
      oracleVerified,
      titleActive,
      notRevoked,
      notAlreadyListed,
    },
    oracleScore:
      latestVerification?.oracle_match_score != null
        ? Number(latestVerification.oracle_match_score)
        : null,
    oracleDecision: latestVerification?.decision || null,
    oracleRemarks: latestVerification?.remarks || null,
    applicationId: application?.id ?? title?.application_id ?? null,
    referenceCode: application?.reference_code ?? title?.reference_code ?? null,
    parcelName: application?.parcel_name ?? title?.parcel_name ?? 'Land Parcel',
    region: application?.region ?? title?.region ?? '',
    ownershipType: application?.ownership_type ?? title?.ownership_type ?? '',
    parcelId: parcel?.id ?? title?.parcel_id ?? null,
    parcelCode: parcel?.parcel_code ?? title?.parcel_code ?? null,
    areaSqm: parcel?.area_sqm ?? application?.declared_area_sqm ?? title?.area_sqm ?? null,
    titleId: title?.id ?? null,
    titleNumber: title?.title_number ?? null,
    tokenId: title?.token_id ?? null,
    titleStatus: title?.title_status ?? null,
    ownerId: title?.owner_id ?? application?.applicant_id ?? null,
    ownerWallet: title?.owner_wallet ?? '',
    activeListingId: existingListing?.id ?? null,
    activeListingStatus: existingListing?.listing_status ?? null,
  };
}

export function evaluateBuyerPurchaseVerification({
  listing = null,
  title = null,
  parcel = null,
  application = null,
  documents = [],
  verificationRecords = [],
  ownershipRecords = [],
  existingParcels = [],
  onChainStatus = null,
  verifyFilesOnDisk = false,
} = {}) {
  const blockers = [];

  // 1. Spatial GIS & Overlap Re-Verification
  const geometryToCheck = parcel?.boundary_geojson || application?.coordinates_geojson || null;
  let geomResult = { isValid: false, validityReason: 'Parcel geometry missing.' };
  let overlapResult = { hasOverlap: false, overlappingParcels: [] };

  if (geometryToCheck) {
    geomResult = validatePolygonGeometry(geometryToCheck);
    if (geomResult.isValid) {
      overlapResult = detectPolygonOverlap(
        geometryToCheck,
        existingParcels || [],
        application?.id ?? parcel?.application_id ?? null
      );
    }
  }

  const gisClean = Boolean(
    parcel &&
      parcel.is_geometry_valid &&
      parcel.overlap_checked !== false &&
      geomResult.isValid &&
      !overlapResult.hasOverlap
  );

  if (overlapResult.hasOverlap) {
    const codes = overlapResult.overlappingParcels.map((p) => p.parcelCode).join(', ');
    blockers.push(`Boundary encroachment detected against existing parcel(s): ${codes}.`);
  } else if (!geomResult.isValid) {
    blockers.push(
      `Spatial GIS geometry check failed: ${geomResult.validityReason || 'Invalid polygon.'}`
    );
  } else if (!parcel || !parcel.is_geometry_valid) {
    blockers.push(
      application?.rejection_reason ||
        'Spatial GIS geometry check has not cleared for this parcel.'
    );
  }

  // 2. Community Ownership Oracle & Deed Integrity Check
  const sortedVerifications = [...(verificationRecords || [])].sort(
    (a, b) => new Date(b.verified_at || 0) - new Date(a.verified_at || 0)
  );
  const latestVerification = sortedVerifications[0] || null;
  const oracleEval = application
    ? evaluateOwnershipClaim({
        application,
        documents,
        ownershipRecords,
        parcel,
        priorVerifications: verificationRecords,
        verifyFilesOnDisk,
      })
    : null;

  const oracleApproved = Boolean(
    latestVerification &&
      latestVerification.decision === 'APPROVED' &&
      application?.status !== 'VERIFICATION_REJECTED'
  );
  const noActiveConflicts = Boolean(
    oracleEval &&
      !oracleEval.conflictDetected &&
      (oracleEval.documentsSummary?.tamperedCount || 0) === 0
  );
  const oracleClean = Boolean(oracleApproved && noActiveConflicts);

  if (!noActiveConflicts && oracleEval?.conflicts?.length > 0) {
    const firstConflict = oracleEval.conflicts[0]?.message || 'Unresolved ownership or document integrity conflict.';
    blockers.push(`Pre-purchase Oracle conflict detected: ${firstConflict}`);
  } else if (!oracleApproved) {
    blockers.push('Community Ownership Oracle approval is missing or was rejected.');
  }

  // 3. Statutory & Listing Status Clearance
  const explicitlyRevoked = Boolean(
    title?.title_status === 'REVOKED' ||
      parcel?.status === 'REVOKED' ||
      application?.status === 'REVOKED' ||
      listing?.listing_status === 'BLOCKED_REVOKED'
  );
  const notRevoked = Boolean(
    !explicitlyRevoked &&
      title &&
      title.title_status === 'ACTIVE' &&
      listing &&
      listing.listing_status === 'LISTED'
  );

  if (explicitlyRevoked) {
    blockers.push('Land title has been statutorily REVOKED and is permanently barred from sale.');
  } else if (!title) {
    blockers.push('ERC-721 Land Title has not been minted because pre-sale verification has not cleared.');
  } else if (listing && listing.listing_status !== 'LISTED') {
    blockers.push(`Listing status is ${listing.listing_status} and not available for purchase.`);
  }

  // 4. Live Smart-Contract ERC-721 Verification
  const onChainVerified = Boolean(
    onChainStatus &&
      onChainStatus.ok &&
      !onChainStatus.isRevoked &&
      onChainStatus.isListed &&
      !onChainStatus.escrowFunded
  );

  if (!onChainStatus) {
    blockers.push('Live on-chain ERC-721 title verification status unavailable.');
  } else if (!onChainVerified) {
    if (onChainStatus.isRevoked) {
      blockers.push('Smart contract reports this ERC-721 token is REVOKED on-chain.');
    } else if (onChainStatus.escrowFunded) {
      blockers.push('Smart contract escrow is already funded by another buyer.');
    } else if (onChainStatus.error) {
      blockers.push(onChainStatus.error);
    } else if (!onChainStatus.isListed) {
      blockers.push('Smart contract reports this parcel is not actively listed for escrow.');
    } else if (!onChainStatus.ownerMatchesSeller) {
      blockers.push('On-chain ERC-721 owner does not match the listing seller wallet.');
    } else if (!onChainStatus.priceMatches) {
      blockers.push('On-chain listing price does not match the displayed POL price.');
    } else {
      blockers.push('Smart contract verification check failed.');
    }
  }

  const verifiedSafeToBuy = Boolean(gisClean && oracleClean && notRevoked && onChainVerified);
  const verifiedAt = new Date().toISOString();

  return {
    verifiedSafeToBuy,
    verificationCode: listing
      ? `VER-BUY-${listing.id}-${title?.token_id || '0'}`
      : 'VER-BUY-PREVIEW',
    verifiedAt,
    verificationSummary: verifiedSafeToBuy
      ? 'All 4 spatial, community oracle, statutory, and on-chain checks passed. Safe to fund Polygon escrow.'
      : `Verification blocked (${blockers.length} issue${blockers.length === 1 ? '' : 's'} detected). Do not fund escrow.`,
    checks: {
      gisClean,
      oracleClean,
      notRevoked,
      onChainVerified,
    },
    blockers,
    details: {
      listingId: listing?.id ?? null,
      titleId: title?.id ?? null,
      titleNumber: title?.title_number ?? listing?.title_number ?? null,
      tokenId: title?.token_id ?? listing?.token_id ?? null,
      parcelCode: parcel?.parcel_code ?? listing?.parcel_code ?? null,
      parcelName: application?.parcel_name ?? listing?.parcel_name ?? null,
      referenceCode: application?.reference_code ?? listing?.reference_code ?? null,
      region: application?.region ?? listing?.region ?? null,
      ownershipType: application?.ownership_type ?? listing?.ownership_type ?? null,
      areaSqm: parcel?.area_sqm ?? listing?.area_sqm ?? geomResult.areaSqm ?? null,
      centroid:
        parcel?.centroid_lat != null && parcel?.centroid_lng != null
          ? { lat: Number(parcel.centroid_lat), lng: Number(parcel.centroid_lng) }
          : geomResult.centroid || null,
      boundaryGeojson: geometryToCheck,
      overlappingParcels: overlapResult.overlappingParcels || [],
      oracleScore:
        latestVerification?.oracle_match_score != null
          ? Number(latestVerification.oracle_match_score)
          : oracleEval?.oracleMatchScore ?? null,
      matchedSourceReference: oracleEval?.matchedRecord?.sourceReference || null,
      documentsCount: documents?.length || 0,
      intactDocumentsCount: oracleEval?.documentsSummary?.intactCount ?? documents?.length ?? 0,
      sellerName: listing?.seller_name || title?.owner_name || null,
      sellerWallet: listing?.seller_wallet || title?.owner_wallet || null,
      priceUsd:
        listing?.price_usd != null
          ? Number(listing.price_usd)
          : convertPolToUsd(listing?.price_pol ?? 0),
      pricePol: listing?.price_pol ?? null,
      priceWei: listing?.price_wei ?? null,
      onChainOwner: onChainStatus?.onChainOwner || null,
      contractAddress: onChainStatus?.contractAddress || title?.contract_address || null,
      chainId: onChainStatus?.chainId || null,
      networkName: onChainStatus?.networkName || null,
      onChainMode: onChainStatus?.onChainMode || null,
      isRealOnChain: Boolean(onChainStatus?.isRealOnChain),
      explorerBaseUrl: onChainStatus?.explorerBaseUrl || '',
      transferHistoryCount: onChainStatus?.transferHistoryCount ?? 0,
      onChainLatencyMs: onChainStatus?.latencyMs ?? null,
    },
  };
}

export const HIDDEN_CHECKLANDS_VERIFICATION_STATUSES = [
  'PENDING_ADMIN_APPROVAL',
  'ADMIN_REJECTED',
];

export function isListingVisibleOnCheckLands(listing) {
  if (!listing) return false;
  const vStatus = String(listing.verification_status || '').toUpperCase();
  const lStatus = String(listing.listing_status || '').toUpperCase();
  if (HIDDEN_CHECKLANDS_VERIFICATION_STATUSES.includes(vStatus)) {
    return false;
  }
  if (['PENDING_ADMIN_APPROVAL', 'REJECTED_BY_ADMIN'].includes(lStatus)) {
    return false;
  }
  return true;
}

export function resolveAdminDeedApprovalOutcome({
  decision,
  hasPendingListing = false,
  oracleConflictDetected = false,
} = {}) {
  const normalized = String(decision || '').toUpperCase();
  if (normalized === 'APPROVED' && oracleConflictDetected) {
    return {
      allowed: false,
      publishToCheckLands: false,
      rejectPendingListing: false,
      reason: 'Oracle conflict or tampered document blocks approval.',
    };
  }
  if (normalized === 'APPROVED') {
    return {
      allowed: true,
      publishToCheckLands: Boolean(hasPendingListing),
      rejectPendingListing: false,
      reason: hasPendingListing
        ? 'Deed approved — mint ERC-721 title and publish parcel to Check Lands.'
        : 'Claim approved — advance application to VERIFIED.',
    };
  }
  return {
    allowed: true,
    publishToCheckLands: false,
    rejectPendingListing: Boolean(hasPendingListing),
    reason: hasPendingListing
      ? 'Deed rejected or flagged — keep parcel hidden from Check Lands.'
      : 'Claim rejected or flagged.',
  };
}

export function sanitizeListingDetails({
  headline,
  description,
  fallbackTitle,
  isPendingVerification = false,
} = {}) {
  const defaultHeadline = fallbackTitle?.parcel_name
    ? `${fallbackTitle.parcel_name} · ${isPendingVerification ? 'Listed Before Verification' : 'Verified Parcel'}`
    : isPendingVerification
    ? 'Land Parcel · Listed Before Verification'
    : 'Verified Land Parcel';
  const cleanHeadline =
    typeof headline === 'string' && headline.trim().length > 0
      ? headline.trim().slice(0, 140)
      : defaultHeadline;
  const cleanDescription =
    typeof description === 'string' && description.trim().length > 0
      ? description.trim().slice(0, 1000)
      : '';

  return {
    headline: cleanHeadline,
    description: cleanDescription,
  };
}

