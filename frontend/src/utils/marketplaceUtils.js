export const DEFAULT_USD_PER_POL = 1000;

// ANAGU token rate (default 1 ANAGU = $1 USD, matches AnaguEscrow marketplace model)
export const DEFAULT_USD_PER_ANAGU = 1;

export function convertUsdToAnagu(priceUsd, usdPerAnagu = DEFAULT_USD_PER_ANAGU) {
  const num = Number(priceUsd);
  const rate = Number(usdPerAnagu) > 0 ? Number(usdPerAnagu) : 1;
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Number((num / rate).toFixed(6));
}

export function convertAnaguToUsd(priceAnagu, usdPerAnagu = DEFAULT_USD_PER_ANAGU) {
  const num = Number(priceAnagu);
  const rate = Number(usdPerAnagu) > 0 ? Number(usdPerAnagu) : 1;
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Number((num * rate).toFixed(2));
}

export function formatAnaguPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '0');
  return Number.isInteger(num) ? String(num) : num.toFixed(4).replace(/\.?0+$/, '');
}

export function resolveListingPriceAnagu(listing = {}) {
  const direct = Number(listing?.price_anagu);
  if (Number.isFinite(direct) && direct > 0) return direct;
  // Fall back: derive from USD
  const usd = resolveListingPriceUsd(listing);
  return convertUsdToAnagu(usd);
}

export function convertUsdToPol(priceUsd, usdPerPol = DEFAULT_USD_PER_POL) {
  const num = Number(priceUsd);
  const rate = Number(usdPerPol) > 0 ? Number(usdPerPol) : DEFAULT_USD_PER_POL;
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Number((num / rate).toFixed(6));
}

export function convertPolToUsd(pricePol, usdPerPol = DEFAULT_USD_PER_POL) {
  const num = Number(pricePol);
  const rate = Number(usdPerPol) > 0 ? Number(usdPerPol) : DEFAULT_USD_PER_POL;
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Number((num * rate).toFixed(2));
}

export function resolveListingPriceUsd(listing = {}) {
  const directUsd = Number(listing?.price_usd);
  if (Number.isFinite(directUsd) && directUsd > 0) {
    return directUsd;
  }
  return convertPolToUsd(listing?.price_pol ?? 0);
}

export function formatUsdPrice(priceUsd) {
  const num = Number(priceUsd);
  if (!Number.isFinite(num) || num <= 0) return '$0';
  const isWhole = Math.abs(num - Math.round(num)) < 0.005;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatPolPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '0');
  return Number.isInteger(num) ? String(num) : num.toFixed(4).replace(/\.?0+$/, '');
}

export function validateListingDraft({ titleId, applicationId, priceUsd, pricePol, headline } = {}) {
  if (!titleId && !applicationId) {
    return {
      valid: false,
      error: 'Select a land parcel or verified title before publishing to the marketplace.',
    };
  }
  const rawPrice = priceUsd !== undefined ? priceUsd : pricePol;
  const numericPrice = Number(rawPrice);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return {
      valid: false,
      error: 'Enter an asking price in USD ($) greater than zero.',
    };
  }
  if (typeof headline === 'string' && headline.trim().length > 140) {
    return {
      valid: false,
      error: 'Listing headline must be 140 characters or fewer.',
    };
  }
  return { valid: true, error: '' };
}

export function formatFileSizeKb(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '0 KB';
  if (num < 1024) return `${num} B`;
  return `${(num / 1024).toFixed(1)} KB`;
}

export function validateLandRegistrationDraft({
  parcelName,
  region,
  locationDescription,
  declaredAreaSqm,
  claimantName,
  claimantNationalId,
  priceUsd,
  pricePol,
  docFile,
  coordinatesText,
} = {}) {
  if (!String(parcelName || '').trim() || String(parcelName).trim().length < 3) {
    return { valid: false, error: 'Parcel title must be at least 3 characters.' };
  }
  if (!String(region || '').trim() || String(region).trim().length < 2) {
    return { valid: false, error: 'Region or municipality is required.' };
  }
  if (!String(locationDescription || '').trim() || String(locationDescription).trim().length < 5) {
    return { valid: false, error: 'Location description must be at least 5 characters.' };
  }
  if (!String(claimantName || '').trim() || String(claimantName).trim().length < 2) {
    return { valid: false, error: 'Owner / claimant legal name is required.' };
  }
  if (!String(claimantNationalId || '').trim() || String(claimantNationalId).trim().length < 4) {
    return { valid: false, error: 'Owner National ID must be at least 4 characters.' };
  }

  let ring;
  try {
    const parsed = JSON.parse(String(coordinatesText || ''));
    ring = Array.isArray(parsed) ? parsed : parsed?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) {
      return {
        valid: false,
        error: 'Parcel boundary requires at least 3 corners (closed 4-point GeoJSON ring).',
      };
    }
  } catch {
    return {
      valid: false,
      error: 'Coordinates must be valid JSON (array of [longitude, latitude] pairs or GeoJSON Polygon).',
    };
  }

  const areaNum = Number(declaredAreaSqm);
  if (declaredAreaSqm !== undefined && declaredAreaSqm !== '' && (!Number.isFinite(areaNum) || areaNum <= 0)) {
    return { valid: false, error: 'Parcel boundary area (m²) must be greater than zero.' };
  }

  const rawPrice = priceUsd !== undefined ? priceUsd : pricePol;
  const numericPrice = Number(rawPrice);
  if (
    rawPrice === '' ||
    rawPrice === null ||
    rawPrice === undefined ||
    !Number.isFinite(numericPrice) ||
    numericPrice <= 0
  ) {
    return { valid: false, error: 'Enter a land price in USD ($) greater than zero.' };
  }
  if (!docFile) {
    return {
      valid: false,
      error: 'Upload your land document or deed (PDF, PNG, JPEG, TXT, or JSON) for verification.',
    };
  }
  return { valid: true, error: '' };
}

export function filterMarketplaceListings(
  listings = [],
  { query = '', status = 'ALL', verification = 'ALL', savedIds = [] } = {}
) {
  const q = String(query || '').trim().toLowerCase();
  const savedSet = new Set((savedIds || []).map((id) => Number(id)));

  return (listings || []).filter((item) => {
    if (status && status !== 'ALL' && item.listing_status !== status) {
      return false;
    }
    if (verification === 'VERIFIED') {
      const isVerified =
        item.verification_status === 'VERIFIED' ||
        (Boolean(item.title_id) && item.title_status !== 'REVOKED');
      if (!isVerified) return false;
    } else if (verification === 'PENDING_VERIFICATION') {
      const isPending =
        !item.title_id || item.verification_status === 'PENDING_VERIFICATION';
      if (!isPending) return false;
    } else if (verification === 'SAVED') {
      if (!savedSet.has(Number(item.id))) return false;
    }
    if (!q) return true;
    const haystack = [
      item.headline,
      item.description,
      item.parcel_name,
      item.parcel_code,
      item.reference_code,
      item.title_number,
      item.region,
      item.seller_name,
      item.ownership_type,
      item.verification_status,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function getParcelImageKey(listing = {}) {
  const text = `${listing.parcel_name || ''} ${listing.headline || ''} ${listing.region || ''}`.toLowerCase();
  if (text.includes('waterfront') || text.includes('canal') || text.includes('victoria annex')) {
    return 'waterfront';
  }
  if (text.includes('residential') || text.includes('akoka') || text.includes('garden')) {
    return 'residential';
  }
  if (text.includes('expansion') || text.includes('layout') || text.includes('lekki') || text.includes('parkside') || text.includes('ikoyi')) {
    return 'expansion';
  }
  if (text.includes('corner') || text.includes('commercial') || text.includes('crest')) {
    return 'urban';
  }
  const keys = ['urban', 'residential', 'waterfront', 'expansion'];
  const idNum = Math.abs(Number(listing.id) || 0);
  return keys[idNum % keys.length];
}

export function formatSellerDisplayName(name = '') {
  return String(name || 'Landowner')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Landowner';
}

export function getSellerMonogram(name = '') {
  const clean = formatSellerDisplayName(name);
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AN';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function toggleSavedListingId(savedIds = [], listingId) {
  const numericId = Number(listingId);
  if (!Number.isFinite(numericId)) return savedIds;
  const exists = savedIds.some((id) => Number(id) === numericId);
  if (exists) {
    return savedIds.filter((id) => Number(id) !== numericId);
  }
  return [...savedIds, numericId];
}

export function getVerificationStepItems(item = {}) {
  const checks = item.checks || {};
  const statusLabel = item.statusLabel || '';

  return [
    {
      key: 'gis',
      label: '1. Spatial GIS Check',
      state: checks.gisValidated
        ? 'PASSED'
        : statusLabel === 'GIS_REJECTED'
        ? 'FAILED'
        : 'PENDING',
      detail: checks.gisValidated
        ? item.parcelCode
          ? `Validated (${item.parcelCode})`
          : 'Geometry valid'
        : statusLabel === 'GIS_REJECTED'
        ? 'Geometry or overlap rejected'
        : 'Runs live when buyer verifies',
    },
    {
      key: 'oracle',
      label: '2. Community Oracle',
      state: checks.oracleVerified
        ? 'PASSED'
        : statusLabel === 'ORACLE_REJECTED'
        ? 'FAILED'
        : 'PENDING',
      detail: checks.oracleVerified
        ? item.oracleScore != null
          ? `Approved (${item.oracleScore}/100)`
          : 'Ownership verified'
        : statusLabel === 'ORACLE_REJECTED'
        ? 'Conflict or rejection logged'
        : 'Runs live when buyer verifies',
    },
    {
      key: 'title',
      label: '3. Active ERC-721 Title',
      state: !checks.notRevoked
        ? 'FAILED'
        : checks.titleActive
        ? 'PASSED'
        : 'PENDING',
      detail: !checks.notRevoked
        ? 'Statutorily revoked'
        : checks.titleActive
        ? item.titleNumber || 'Active NFT Title'
        : 'Issued when verification clears',
    },
  ];
}

export function getBuyerVerificationItems(report = null) {
  if (!report) return [];
  const checks = report.checks || {};
  const details = report.details || {};

  return [
    {
      key: 'gisClean',
      label: '1. Spatial GIS & Overlap Check',
      state: checks.gisClean ? 'PASSED' : 'FAILED',
      detail: checks.gisClean
        ? `${details.parcelCode || 'Parcel'} · ${details.areaSqm ? `${Number(details.areaSqm).toLocaleString()} m² · ` : ''}0 overlaps`
        : 'Geometry invalid or boundary overlap detected',
    },
    {
      key: 'oracleClean',
      label: '2. Community Oracle & Deed Integrity',
      state: checks.oracleClean ? 'PASSED' : 'FAILED',
      detail: checks.oracleClean
        ? `Approved (${details.oracleScore ?? '—'}/100) · ${details.intactDocumentsCount ?? 0}/${details.documentsCount ?? 0} docs intact`
        : 'Conflict, dispute, or tampered document detected',
    },
    {
      key: 'notRevoked',
      label: '3. Statutory & Title Status',
      state: checks.notRevoked ? 'PASSED' : 'FAILED',
      detail: checks.notRevoked
        ? `${details.titleNumber || 'Title'} ACTIVE · Not revoked`
        : details.titleNumber
        ? 'Title revoked or listing unavailable'
        : 'Verification failed — ERC-721 title not issued',
    },
    {
      key: 'onChainVerified',
      label: '4. On-Chain ERC-721 & Escrow Proof',
      state: checks.onChainVerified ? 'PASSED' : 'FAILED',
      detail: checks.onChainVerified
        ? `Token #${details.tokenId ?? '—'} owned by seller · ${details.networkName || 'EVM'}`
        : details.tokenId
        ? 'On-chain owner, status, or escrow price mismatch'
        : 'Not minted on-chain until verification passes',
    },
  ];
}

export function canBuyerConfirmPurchase({
  listing = null,
  currentUserId = null,
  verificationReport = null,
} = {}) {
  if (!listing) {
    return { allowed: false, reason: 'Listing not found.' };
  }
  if (listing.seller_id === currentUserId) {
    return { allowed: false, reason: 'Seller cannot buy their own listed parcel.' };
  }
  if (listing.title_status === 'REVOKED' || listing.listing_status === 'BLOCKED_REVOKED') {
    return { allowed: false, reason: 'Title has been statutorily REVOKED.' };
  }
  if (listing.listing_status !== 'LISTED') {
    return { allowed: false, reason: `Listing is currently ${listing.listing_status}.` };
  }
  if (!verificationReport) {
    return {
      allowed: false,
      reason: 'Run Pre-Purchase Land Verification before buying.',
    };
  }
  if (!verificationReport.verifiedSafeToBuy) {
    return {
      allowed: false,
      reason:
        verificationReport.blockers?.[0] ||
        'Pre-purchase verification detected blockers.',
    };
  }
  return { allowed: true, reason: '' };
}

export function buildExplorerTxUrl(txHash, explorerBaseUrl = '') {
  if (!explorerBaseUrl || !txHash) return null;
  const cleanHash = String(txHash).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanHash)) return null;
  return `${String(explorerBaseUrl).trim().replace(/\/+$/, '')}/tx/${cleanHash}`;
}

export function buildExplorerAddressUrl(address, explorerBaseUrl = '') {
  if (!explorerBaseUrl || !address) return null;
  const cleanAddr = String(address).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(cleanAddr)) return null;
  return `${String(explorerBaseUrl).trim().replace(/\/+$/, '')}/address/${cleanAddr}`;
}

export function resolveMarketplaceSigningState({
  contractInfo = null,
  walletInfo = null,
  hasInjected = false,
} = {}) {
  const isRealOnChain = Boolean(
    contractInfo?.isRealOnChain ||
      (contractInfo?.chainId && Number(contractInfo.chainId) !== 31337)
  );
  const walletConnected = Boolean(walletInfo?.address);
  const matchingChain = Boolean(
    walletConnected &&
      contractInfo?.chainId &&
      Number(walletInfo.chainId) === Number(contractInfo.chainId)
  );
  const useBrowserWallet = Boolean(hasInjected && walletConnected && matchingChain);
  const needsWalletConnect = isRealOnChain && !walletConnected;
  const needsNetworkSwitch = isRealOnChain && walletConnected && !matchingChain;

  return {
    isRealOnChain,
    useBrowserWallet,
    requiresWalletSignature: isRealOnChain,
    needsWalletConnect,
    needsNetworkSwitch,
    modeBadgeLabel: isRealOnChain
      ? `Real On-Chain · ${contractInfo?.networkName || 'Polygon Amoy'}`
      : `Prototype Mode · ${contractInfo?.networkName || 'Local Hardhat'}`,
  };
}



// Convert ANAGU float to 18-decimal wei string (for AnaguEscrow.fundEscrow)
export function anaguToWei(priceAnagu) {
  const n = Number(priceAnagu);
  if (!Number.isFinite(n) || n <= 0) return '0';
  // Use BigInt arithmetic to avoid floating-point rounding at 18 decimals
  const wholePart = Math.floor(n);
  const fracPart = n - wholePart;
  const frac18 = BigInt(Math.round(fracPart * 1e9)) * BigInt(1e9);
  return (BigInt(wholePart) * BigInt('1000000000000000000') + frac18).toString();
}
