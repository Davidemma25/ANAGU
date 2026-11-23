import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  canBuyerConfirmPurchase,
  convertPolToUsd,
  convertUsdToPol,
  filterMarketplaceListings,
  formatFileSizeKb,
  formatPolPrice,
  formatSellerDisplayName,
  formatUsdPrice,
  getBuyerVerificationItems,
  getParcelImageKey,
  getSellerMonogram,
  getVerificationStepItems,
  resolveListingPriceUsd,
  resolveMarketplaceSigningState,
  toggleSavedListingId,
  validateLandRegistrationDraft,
  validateListingDraft,
} from './marketplaceUtils.js';

test('USD/POL conversion and formatting helpers calculate accurate dollar values', () => {
  assert.equal(convertUsdToPol(4250), 4.25);
  assert.equal(convertPolToUsd(4.25), 4250);
  assert.equal(formatUsdPrice(4250), '$4,250');
  assert.equal(formatUsdPrice(4250.5), '$4,250.50');
  assert.equal(formatPolPrice(4.25), '4.25');
  assert.equal(resolveListingPriceUsd({ price_usd: 18500, price_pol: 18.5 }), 18500);
  assert.equal(resolveListingPriceUsd({ price_pol: 2.5 }), 2500);
});

test('validateListingDraft accepts titleId or applicationId and rejects missing parcel or invalid USD price', () => {
  assert.equal(validateListingDraft({ titleId: '', applicationId: '', priceUsd: '3500' }).valid, false);
  assert.equal(validateListingDraft({ applicationId: 4, priceUsd: '3500', headline: 'Unverified Plot' }).valid, true);
  assert.equal(validateListingDraft({ titleId: 1, priceUsd: '0' }).valid, false);
  assert.equal(validateListingDraft({ titleId: 1, priceUsd: '-200' }).valid, false);
  assert.equal(
    validateListingDraft({ titleId: 1, priceUsd: '3500', headline: 'a'.repeat(141) }).valid,
    false
  );
  assert.equal(
    validateListingDraft({ titleId: 1, priceUsd: '3500', headline: 'Verified Residential Plot' }).valid,
    true
  );
});

test('validateLandRegistrationDraft requires valid USD price, deed document, and parcel coordinates', () => {
  const validCoords = JSON.stringify([
    [3.391, 6.531],
    [3.3925, 6.531],
    [3.3925, 6.5325],
    [3.391, 6.5325],
    [3.391, 6.531],
  ]);
  const baseDraft = {
    parcelName: 'Zone 4 Residential Plot',
    region: 'Zone 4',
    locationDescription: '14 Unity Crescent, Zone 4',
    declaredAreaSqm: '2750',
    claimantName: 'Adaeze Nwankwo',
    claimantNationalId: 'NID-2026-888',
    priceUsd: '4250',
    docFile: { name: 'deed.pdf', size: 2048 },
    coordinatesText: validCoords,
  };

  assert.equal(validateLandRegistrationDraft(baseDraft).valid, true);
  assert.equal(validateLandRegistrationDraft({ ...baseDraft, declaredAreaSqm: '' }).valid, true);
  assert.equal(validateLandRegistrationDraft({ ...baseDraft, priceUsd: '' }).valid, false);
  assert.equal(validateLandRegistrationDraft({ ...baseDraft, priceUsd: '0' }).valid, false);
  assert.equal(validateLandRegistrationDraft({ ...baseDraft, docFile: null }).valid, false);
  assert.equal(validateLandRegistrationDraft({ ...baseDraft, coordinatesText: 'not-json' }).valid, false);
  assert.equal(formatFileSizeKb(2048), '2.0 KB');
  assert.equal(formatFileSizeKb(512), '512 B');
});

test('filterMarketplaceListings filters by status, verification state, saved ids, and search text', () => {
  const sample = [
    {
      id: 1,
      title_id: 1,
      title_status: 'ACTIVE',
      verification_status: 'VERIFIED',
      headline: 'Yaba Corner Freehold',
      parcel_name: 'Plot A',
      parcel_code: 'ANG-Z1-0001',
      title_number: 'ANG-TITLE-2026-0001',
      region: 'Zone 1',
      seller_name: 'Amara Okafor',
      listing_status: 'LISTED',
    },
    {
      id: 2,
      title_id: 2,
      title_status: 'ACTIVE',
      verification_status: 'VERIFIED',
      headline: 'Ikoyi Waterfront Parcel',
      parcel_name: 'Plot B',
      parcel_code: 'ANG-Z2-0002',
      title_number: 'ANG-TITLE-2026-0002',
      region: 'Zone 2',
      seller_name: 'Tunde Adeyemi',
      listing_status: 'COMPLETED',
    },
    {
      id: 3,
      title_id: null,
      headline: 'Lekki Expansion Parcel D · Listed Before Verification',
      parcel_name: 'Lekki Expansion Parcel D',
      reference_code: 'ANG-APP-2026-0004',
      region: 'Zone 3',
      seller_name: 'Amara Okafor',
      verification_status: 'PENDING_VERIFICATION',
      listing_status: 'LISTED',
    },
  ];

  assert.equal(filterMarketplaceListings(sample, { status: 'LISTED' }).length, 2);
  assert.equal(filterMarketplaceListings(sample, { query: 'waterfront' }).length, 1);
  assert.equal(filterMarketplaceListings(sample, { query: 'ang-app-2026-0004', status: 'LISTED' }).length, 1);
  assert.equal(filterMarketplaceListings(sample, { query: 'ang-z1-0001', status: 'COMPLETED' }).length, 0);
  assert.equal(filterMarketplaceListings(sample, { verification: 'VERIFIED' }).length, 2);
  assert.equal(filterMarketplaceListings(sample, { verification: 'PENDING_VERIFICATION' }).length, 1);
  assert.equal(filterMarketplaceListings(sample, { verification: 'SAVED', savedIds: [2, 3] }).length, 2);
});

test('getParcelImageKey, formatSellerDisplayName, getSellerMonogram, and toggleSavedListingId behave deterministically', () => {
  assert.equal(getParcelImageKey({ id: 1, parcel_name: 'Victoria Annex Waterfront Lot C' }), 'waterfront');
  assert.equal(getParcelImageKey({ id: 2, parcel_name: 'Akoka Residential Freehold Plot B' }), 'residential');
  assert.equal(getParcelImageKey({ id: 3, parcel_name: 'Lekki Expansion Parcel D' }), 'expansion');
  assert.equal(getParcelImageKey({ id: 4, parcel_name: 'Yaba Commercial Corner Plot A' }), 'urban');

  assert.equal(formatSellerDisplayName('Ngozi Eze (Sample)'), 'Ngozi Eze');
  assert.equal(getSellerMonogram('Amara Okafor'), 'AO');
  assert.equal(getSellerMonogram('Tunde'), 'TU');
  assert.equal(getSellerMonogram(''), 'LA');

  assert.deepEqual(toggleSavedListingId([1, 2], 3), [1, 2, 3]);
  assert.deepEqual(toggleSavedListingId([1, 2, 3], 2), [1, 3]);
});

test('getVerificationStepItems maps 3 verification gates cleanly', () => {
  const steps = getVerificationStepItems({
    statusLabel: 'AWAITING_ORACLE',
    parcelCode: 'ANG-Z1-0005',
    checks: {
      gisValidated: true,
      oracleVerified: false,
      titleActive: false,
      notRevoked: true,
    },
  });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].state, 'PASSED');
  assert.match(steps[0].detail, /ANG-Z1-0005/);
  assert.equal(steps[1].state, 'PENDING');
  assert.equal(steps[2].state, 'PENDING');
});

test('getBuyerVerificationItems & canBuyerConfirmPurchase enforce pre-purchase verification', () => {
  const listing = {
    id: 10,
    seller_id: 2,
    listing_status: 'LISTED',
    title_status: 'ACTIVE',
  };

  const beforeVerify = canBuyerConfirmPurchase({
    listing,
    currentUserId: 1,
    verificationReport: null,
  });
  assert.equal(beforeVerify.allowed, false);
  assert.match(beforeVerify.reason, /verification/i);

  const failedReport = {
    verifiedSafeToBuy: false,
    checks: { gisClean: true, oracleClean: false, notRevoked: true, onChainVerified: true },
    blockers: ['Oracle conflict detected.'],
    details: { parcelCode: 'ANG-PARCEL-0002', titleNumber: 'ANG-TITLE-2026-0002', tokenId: '2' },
  };
  assert.equal(
    canBuyerConfirmPurchase({ listing, currentUserId: 1, verificationReport: failedReport }).allowed,
    false
  );

  const passedReport = {
    verifiedSafeToBuy: true,
    checks: { gisClean: true, oracleClean: true, notRevoked: true, onChainVerified: true },
    blockers: [],
    details: {
      parcelCode: 'ANG-PARCEL-0002',
      areaSqm: 27700,
      oracleScore: 98,
      intactDocumentsCount: 1,
      documentsCount: 1,
      titleNumber: 'ANG-TITLE-2026-0002',
      tokenId: '2',
      networkName: 'Hardhat In-Process EVM',
    },
  };
  const items = getBuyerVerificationItems(passedReport);
  assert.equal(items.length, 4);
  assert.equal(items.every((i) => i.state === 'PASSED'), true);

  assert.equal(
    canBuyerConfirmPurchase({ listing, currentUserId: 1, verificationReport: passedReport }).allowed,
    true
  );
  assert.equal(
    canBuyerConfirmPurchase({ listing, currentUserId: 2, verificationReport: passedReport }).allowed,
    false
  );
});

test('explorer URL helpers validate hashes/addresses and filter synthetic local hashes', () => {
  const validHash = `0x${'f'.repeat(64)}`;
  const validAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  assert.equal(
    buildExplorerTxUrl(validHash, 'https://amoy.polygonscan.com/'),
    `https://amoy.polygonscan.com/tx/${validHash}`
  );
  assert.equal(buildExplorerTxUrl('0xblocked-transfer-1234', 'https://amoy.polygonscan.com'), null);
  assert.equal(buildExplorerTxUrl(validHash, ''), null);

  assert.equal(
    buildExplorerAddressUrl(validAddr, 'https://amoy.polygonscan.com/'),
    `https://amoy.polygonscan.com/address/${validAddr}`
  );
  assert.equal(buildExplorerAddressUrl('not-an-address', 'https://amoy.polygonscan.com'), null);
});

test('resolveMarketplaceSigningState flags wallet connection, chain switch, and MetaMask enforcement accurately', () => {
  const prototypeState = resolveMarketplaceSigningState({
    contractInfo: { isRealOnChain: false, chainId: 31337, networkName: 'Hardhat In-Process EVM' },
    walletInfo: null,
    hasInjected: false,
  });
  assert.equal(prototypeState.isRealOnChain, false);
  assert.equal(prototypeState.requiresWalletSignature, false);
  assert.match(prototypeState.modeBadgeLabel, /Prototype Mode/i);

  const realNeedsConnect = resolveMarketplaceSigningState({
    contractInfo: { isRealOnChain: true, chainId: 80002, networkName: 'Polygon Amoy Testnet' },
    walletInfo: null,
    hasInjected: true,
  });
  assert.equal(realNeedsConnect.isRealOnChain, true);
  assert.equal(realNeedsConnect.needsWalletConnect, true);
  assert.equal(realNeedsConnect.useBrowserWallet, false);

  const realWrongNet = resolveMarketplaceSigningState({
    contractInfo: { isRealOnChain: true, chainId: 80002, networkName: 'Polygon Amoy Testnet' },
    walletInfo: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', chainId: 1 },
    hasInjected: true,
  });
  assert.equal(realWrongNet.needsNetworkSwitch, true);
  assert.equal(realWrongNet.useBrowserWallet, false);

  const realReady = resolveMarketplaceSigningState({
    contractInfo: { isRealOnChain: true, chainId: 80002, networkName: 'Polygon Amoy Testnet' },
    walletInfo: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', chainId: 80002 },
    hasInjected: true,
  });
  assert.equal(realReady.useBrowserWallet, true);
  assert.equal(realReady.needsNetworkSwitch, false);
  assert.match(realReady.modeBadgeLabel, /Real On-Chain/i);
});


