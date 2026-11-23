import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  Heart,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import OsmParcelPreviewMap from './OsmParcelPreviewMap.jsx';
import { WalletBrandIcon } from './WalletBrandIcon.jsx';
import {
  getWalletProviderLabel,
  isValidPolygonAddress,
  shortenAddress,
} from '../services/walletService.js';
import {
  canBuyerConfirmPurchase,
  convertUsdToAnagu,
  convertUsdToPol,
  filterMarketplaceListings,
  formatAnaguPrice,
  formatPolPrice,
  formatSellerDisplayName,
  formatUsdPrice,
  getSellerMonogram,
  resolveListingPriceAnagu,
  resolveListingPriceUsd,
  toggleSavedListingId,
  validateListingDraft,
} from '../utils/marketplaceUtils.js';

const SELLER_BADGE_TONES = [
  'bg-[#1F2421] text-[#FDE878]',
  'bg-[#2D312E] text-[#FDE878]',
  'bg-[#FDE878] text-[#1F2421]',
  'bg-[#1F2421] text-white',
];

const VERIFICATION_FILTERS = [
  { value: 'ALL', label: 'All Parcels' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
  { value: 'SAVED', label: 'Saved' },
];

const SAVED_STORAGE_KEY = 'anagu_saved_parcel_ids';

function loadSavedIds() {
  try {
    const raw = window.localStorage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function getParcelOptionKey(item) {
  return item.titleId ? `title:${item.titleId}` : `app:${item.applicationId}`;
}

function getSellerToneClass(sellerName = '') {
  const sum = String(sellerName)
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return SELLER_BADGE_TONES[sum % SELLER_BADGE_TONES.length];
}

function ParcelStorefrontCard({
  listing,
  user,
  connectedWallet = '',
  isRegistrar,
  busyId,
  buyerReport,
  isSaved,
  onToggleSave,
  onVerifyBeforeBuy,
  onBuyEscrow,
  onSettleSale,
  onCancelListing,
}) {

  const isSeller = listing.seller_id === user?.id;
  const isBlocked =
    listing.listing_status === 'BLOCKED_REVOKED' || listing.title_status === 'REVOKED';
  const isPendingVerification =
    !isBlocked && (!listing.title_id || listing.verification_status === 'PENDING_VERIFICATION');
  const canBuy = !isSeller && !isBlocked && listing.listing_status === 'LISTED';
  const canSettle = isSeller && !isBlocked && listing.listing_status === 'ESCROW_FUNDED';
  const canCancel = isSeller && !isBlocked && listing.listing_status === 'LISTED';

  const purchaseCheck = canBuyerConfirmPurchase({
    listing,
    currentUserId: user?.id,
    verificationReport: buyerReport,
  });

  const displayTitle = listing.headline || listing.parcel_name || 'Land Parcel';
  const verificationLabel = isBlocked
    ? 'Revoked'
    : listing.listing_status === 'COMPLETED'
    ? 'Settled'
    : listing.listing_status === 'ESCROW_FUNDED'
    ? 'In Escrow'
    : isPendingVerification
    ? 'Pending Verification'
    : 'Verified Title';

  const subtitleParts = [
    listing.region || 'Zone',
    listing.ownership_type ? listing.ownership_type.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'Freehold',
    verificationLabel,
  ];
  const sellerDisplayName = formatSellerDisplayName(listing.seller_name);
  const monogram = getSellerMonogram(sellerDisplayName);
  const sellerTone = getSellerToneClass(sellerDisplayName);

  return (
    <article
      data-testid={`marketplace-listing-${listing.id}`}
      className="group rounded-2xl bg-white/90 hover:bg-white backdrop-blur-md border border-[#1F2421]/15 p-3 flex flex-col transition-all duration-200 hover:-translate-y-0.5 shadow-xs"
    >
      {/* Top 4:3 OpenStreetMap Parcel Boundary Demarcation with Save Heart */}
      <div className="relative isolate aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 border border-[#1F2421]/10">
        <button
          type="button"
          onClick={() => onVerifyBeforeBuy?.(listing)}
          aria-label={`Inspect and verify ${displayTitle}`}
          className="relative z-10 block w-full h-full text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#1F2421]"
        >
          <OsmParcelPreviewMap
            boundaryGeojson={listing.boundary_geojson}
            title={displayTitle}
            isBlocked={isBlocked}
            isPendingVerification={isPendingVerification}
          />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSave(listing.id);
          }}
          aria-label={isSaved ? `Remove ${displayTitle} from saved parcels` : `Save ${displayTitle}`}
          aria-pressed={isSaved}
          className="absolute top-2.5 right-2.5 z-20 w-8 h-8 rounded-full bg-[#1F2421]/75 hover:bg-[#1F2421]/90 backdrop-blur-md border border-white/30 flex items-center justify-center text-white transition-colors"
        >
          <Heart
            className={`w-4 h-4 transition-colors ${
              isSaved ? 'fill-rose-400 text-rose-400' : 'text-white'
            }`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Middle Title & Unboxed Subtitle */}
      <button
        type="button"
        onClick={() => onVerifyBeforeBuy?.(listing)}
        className="mt-3 text-left focus:outline-hidden"
      >
        <h3 className="font-display text-sm font-semibold text-[#1F2421] truncate">
          {displayTitle}
        </h3>
        <p className="mt-0.5 text-xs text-[#2D312E]/75 truncate">
          {subtitleParts.join(' · ')}
        </p>
      </button>

      {/* Bottom Seller Emblem & Price Row */}
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className={`w-6 h-6 rounded-full border border-[#1F2421]/20 flex items-center justify-center text-[10px] font-bold shrink-0 ${sellerTone}`}
          >
            {monogram}
          </span>
          <span className="text-xs font-medium text-[#1F2421]/90 truncate">
            {sellerDisplayName}
          </span>
        </div>

        <div className="text-right shrink-0">
          <span className="font-mono text-sm sm:text-[15px] font-bold text-[#1F2421] tabular-nums whitespace-nowrap block">
            {formatUsdPrice(resolveListingPriceUsd(listing))}
          </span>
          <span className="font-mono text-[10px] text-[#2D312E]/70 tabular-nums whitespace-nowrap block">
            {formatAnaguPrice(resolveListingPriceAnagu(listing))} ANAGU
          </span>
        </div>
      </div>

      {/* Action Footer */}
      <div className="mt-3 pt-2.5 border-t border-[#1F2421]/10 flex items-center gap-2">
        {canBuy ? (
          <>
            <button
              type="button"
              disabled={busyId === `verify-${listing.id}`}
              onClick={() => onVerifyBeforeBuy?.(listing)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-[#1F2421] hover:bg-black text-xs font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-50 truncate"
            >
              {busyId === `verify-${listing.id}`
                ? 'Verifying...'
                : buyerReport
                ? buyerReport.verifiedSafeToBuy
                  ? 'Verified'
                  : 'Blocked'
                : 'Verify Land Before Buying'}
            </button>
            {purchaseCheck.allowed && (
              <button
                type="button"
                disabled={busyId === `buy-${listing.id}`}
                onClick={() => {
                  if (connectedWallet) {
                    onBuyEscrow(listing, buyerReport, connectedWallet);
                  } else {
                    onVerifyBeforeBuy?.(listing);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 text-xs font-semibold text-[#1F2421] whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
              >
                {busyId === `buy-${listing.id}`
                  ? 'Paying...'
                  : connectedWallet
                  ? 'Pay Now'
                  : 'Connect & Pay'}
              </button>
            )}
          </>
        ) : canSettle ? (
          <button
            type="button"
            disabled={busyId === `settle-${listing.id}`}
            onClick={() => onSettleSale(listing.id)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 text-xs font-semibold text-[#1F2421] whitespace-nowrap transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{busyId === `settle-${listing.id}` ? 'Confirming...' : 'Confirm Sale'}</span>
          </button>
        ) : canCancel ? (
          <div className="flex items-center justify-between w-full gap-2">
            <span className="text-[11px] font-medium text-[#2D312E]/75 truncate">
              {isPendingVerification ? 'Listed (Pre-Verify)' : 'Your Listing'}
            </span>
            <button
              type="button"
              disabled={busyId === `cancel-${listing.id}`}
              onClick={() => onCancelListing(listing)}
              className="px-3 py-1 rounded-lg bg-white hover:bg-red-50 border border-slate-300 hover:border-red-300 text-[11px] font-medium text-[#1F2421] hover:text-red-700 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
            >
              Cancel Listing
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onVerifyBeforeBuy?.(listing)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-[#1F2421]/10 hover:bg-[#1F2421] border border-[#1F2421]/15 text-xs font-semibold text-[#1F2421] hover:text-white whitespace-nowrap transition-colors"
          >
            {isBlocked
              ? 'Blocked — Title Revoked'
              : listing.listing_status === 'ESCROW_FUNDED'
              ? 'In Escrow · Inspect'
              : listing.listing_status === 'COMPLETED'
              ? 'Settled · Inspect'
              : 'Inspect Parcel'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function MarketplaceTabPanel({
  user,
  isRegistrar,
  listings,
  eligibility,
  loading,
  busyId,
  connectedWallet = '',
  walletInfo = null,
  onConnectWallet,
  onSetManualWallet,
  verifiedReportsByListing = {},
  onVerifyBeforeBuy,
  onPublishListing,
  onBuyEscrow,
  onSettleSale,
  onCancelListing,
  onValidationError,
}) {
  const readyToList = useMemo(
    () => eligibility?.readyToList || [],
    [eligibility?.readyToList]
  );
  const unverifiedParcels = useMemo(
    () => eligibility?.unverifiedParcels || [],
    [eligibility?.unverifiedParcels]
  );
  const postableParcels = useMemo(() => {
    if (Array.isArray(eligibility?.postableParcels) && eligibility.postableParcels.length > 0) {
      return eligibility.postableParcels;
    }
    const pendingPostable = unverifiedParcels.filter(
      (p) => p.canPost !== false && p.statusLabel !== 'REVOKED'
    );
    return [...readyToList, ...pendingPostable];
  }, [eligibility?.postableParcels, readyToList, unverifiedParcels]);

  const [postOpen, setPostOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualInputError, setManualInputError] = useState('');
  const [selectedParcelKey, setSelectedParcelKey] = useState('');
  const [priceUsd, setPriceUsd] = useState('2500');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('ALL');
  const [savedIds, setSavedIds] = useState(() => loadSavedIds());
  const [expandRecommended, setExpandRecommended] = useState(false);
  const [expandSearch, setExpandSearch] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedIds));
    } catch {
      // ignore storage quota errors
    }
  }, [savedIds]);

  useEffect(() => {
    if (postableParcels.length === 0) {
      setSelectedParcelKey('');
      return;
    }
    const stillValid = postableParcels.some(
      (item) => getParcelOptionKey(item) === selectedParcelKey
    );
    if (!stillValid) {
      const first = postableParcels[0];
      setSelectedParcelKey(getParcelOptionKey(first));
      setHeadline(
        `${first.parcelName} · ${first.eligible ? 'Verified Parcel' : 'Listed Before Verification'}`
      );
    }
  }, [postableParcels, selectedParcelKey]);

  const selectedParcel = useMemo(
    () =>
      postableParcels.find((item) => getParcelOptionKey(item) === selectedParcelKey) || null,
    [postableParcels, selectedParcelKey]
  );

  // Recommend For You: prioritizes active verified titles first, then active pending parcels
  const recommendedListings = useMemo(() => {
    const active = (listings || []).filter((item) => item.listing_status === 'LISTED');
    const pool = active.length > 0 ? active : listings || [];
    return [...pool].sort((a, b) => {
      const aVerified = a.title_id && a.verification_status !== 'PENDING_VERIFICATION' ? 1 : 0;
      const bVerified = b.title_id && b.verification_status !== 'PENDING_VERIFICATION' ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;
      return Number(a.id) - Number(b.id);
    });
  }, [listings]);

  // Based On Your Search: filtered catalog (shows newest / pending + verified parcels)
  const filteredListings = useMemo(
    () =>
      filterMarketplaceListings(listings, {
        query: searchQuery,
        status: 'ALL',
        verification: verificationFilter,
        savedIds,
      }),
    [listings, searchQuery, verificationFilter, savedIds]
  );

  const visibleRecommended = expandRecommended
    ? recommendedListings
    : recommendedListings.slice(0, 4);

  const isActivelyFiltering =
    Boolean(searchQuery.trim()) || verificationFilter !== 'ALL' || expandSearch;
  const visibleSearchResults = isActivelyFiltering
    ? filteredListings
    : filteredListings.slice(0, 4);

  const handleToggleSave = (listingId) => {
    setSavedIds((prev) => toggleSavedListingId(prev, listingId));
  };

  const handleSelectParcel = (nextKey) => {
    setSelectedParcelKey(nextKey);
    const match = postableParcels.find((item) => getParcelOptionKey(item) === nextKey);
    if (match) {
      setHeadline(
        `${match.parcelName} · ${match.eligible ? 'Verified Parcel' : 'Listed Before Verification'}`
      );
    }
  };

  const handleSubmitListing = async (event) => {
    event.preventDefault();
    const check = validateListingDraft({
      titleId: selectedParcel?.titleId || null,
      applicationId: selectedParcel?.applicationId || null,
      priceUsd,
      headline,
      description,
    });
    if (!check.valid) {
      onValidationError?.(check.error);
      return;
    }
    if (!selectedParcel) return;

    const succeeded = await onPublishListing({
      titleId: selectedParcel.titleId || null,
      applicationId: selectedParcel.applicationId || null,
      tokenId: selectedParcel.tokenId || null,
      ownerWallet: selectedParcel.ownerWallet || '',
      priceUsd: Number(priceUsd),
      headline: headline.trim(),
      description: description.trim(),
    });
    if (succeeded) {
      setDescription('');
      setPostOpen(false);
    }
  };

  const activeBusyKey = selectedParcel
    ? `list-${selectedParcel.titleId || `app-${selectedParcel.applicationId}`}`
    : '';

  return (
    <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-[linear-gradient(135deg,#FDE878_0%,#FCE364_55%,#F6D74D_100%)] p-3.5 sm:p-8 text-[#1F2421] shadow-sm border border-[#E5CF5D] space-y-6 sm:space-y-8">
      {/* Subtle Warm Studio Highlights matching Landing Hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 w-80 h-80 rounded-full bg-[#FFF9D6]/60 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-[#E5CF5D]/45 blur-3xl"
      />

      {/* Top Search, Filter & Post Land Toolbar */}
      <div className="relative z-30 flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-5 border-b border-[#1F2421]/15">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 w-full xl:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search
              className="w-3.5 h-3.5 text-[#2D312E]/70 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search marketplace parcels"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search parcel, zone, title..."
              className="w-full sm:w-64 pl-9 pr-4 py-2 rounded-full bg-white/85 border border-[#1F2421]/20 text-xs text-[#1F2421] placeholder:text-[#2D312E]/60 focus:outline-hidden focus:ring-2 focus:ring-[#1F2421]/30"
            />
          </div>

          <div className="flex flex-wrap sm:inline-flex items-center gap-1 p-1 rounded-2xl sm:rounded-full bg-white/65 border border-[#1F2421]/15 w-full sm:w-auto">
            {VERIFICATION_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setVerificationFilter(f.value)}
                className={`px-3 py-1.5 sm:py-1 rounded-xl sm:rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  verificationFilter === f.value
                    ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                    : 'text-[#1F2421]/85 hover:text-[#1F2421] hover:bg-white/80'
                }`}
              >
                {f.label}
                {f.value === 'SAVED' && savedIds.length > 0 ? ` (${savedIds.length})` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start xl:self-auto">
          {onConnectWallet && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setManualInputError('');
                  if (walletInfo?.address) {
                    onConnectWallet(walletInfo.walletType || 'auto');
                  } else {
                    setWalletMenuOpen((prev) => !prev);
                  }
                }}
                aria-expanded={!walletInfo?.address ? walletMenuOpen : undefined}
                title={
                  walletInfo?.address
                    ? `${getWalletProviderLabel(walletInfo)}: ${walletInfo.address}`
                    : connectedWallet || 'Connect MetaMask, Trust Wallet, or 0x Address'
                }
                className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  walletInfo?.address || connectedWallet
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 font-mono'
                    : 'bg-white/90 hover:bg-white border-[#1F2421]/20 text-[#1F2421]'
                }`}
              >
                {walletInfo?.address ? (
                  <WalletBrandIcon
                    walletType={walletInfo.walletType || (walletInfo.isTrustWallet ? 'trustwallet' : walletInfo.isMetaMask ? 'metamask' : 'auto')}
                    className="w-3.5 h-3.5"
                  />
                ) : (
                  <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>
                  {walletInfo?.address
                    ? shortenAddress(walletInfo.address)
                    : connectedWallet
                    ? shortenAddress(connectedWallet)
                    : 'Connect Wallet'}
                </span>
              </button>

              {walletMenuOpen && !walletInfo?.address && (
                <div
                  role="dialog"
                  aria-label="Choose wallet provider"
                  className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-[#1F2421]/20 bg-white p-2.5 shadow-xl z-40 space-y-2 text-xs text-[#1F2421]"
                >
                  {connectedWallet && (
                    <div className="px-2.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-emerald-900 truncate">
                        {shortenAddress(connectedWallet)}
                      </span>
                      {onSetManualWallet && (
                        <button
                          type="button"
                          onClick={() => {
                            onSetManualWallet('');
                            setWalletMenuOpen(false);
                          }}
                          className="text-[11px] font-semibold text-red-700 hover:underline shrink-0"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  )}
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setWalletMenuOpen(false);
                        onConnectWallet('metamask');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#FEF9DB]/70 text-left font-semibold transition-colors"
                    >
                      <WalletBrandIcon walletType="metamask" className="w-4 h-4 shrink-0" />
                      <span>MetaMask</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWalletMenuOpen(false);
                        onConnectWallet('trustwallet');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#FEF9DB]/70 text-left font-semibold transition-colors"
                    >
                      <WalletBrandIcon walletType="trustwallet" className="w-4 h-4 shrink-0" />
                      <span>Trust Wallet</span>
                    </button>
                  </div>

                  {onSetManualWallet && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = manualInput.trim();
                        if (!isValidPolygonAddress(trimmed)) {
                          setManualInputError('Enter a valid 42-char 0x address.');
                          return;
                        }
                        onSetManualWallet(trimmed);
                        setManualInput('');
                        setManualInputError('');
                        setWalletMenuOpen(false);
                      }}
                      className="pt-2 border-t border-slate-200 space-y-1.5"
                    >
                      <label htmlFor="marketplace-manual-wallet-input" className="block text-[11px] font-medium text-slate-600">
                        Or paste EVM 0x Wallet Address
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="marketplace-manual-wallet-input"
                          type="text"
                          value={manualInput}
                          onChange={(e) => setManualInput(e.target.value)}
                          placeholder="0x..."
                          className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1.5 text-[11px] font-semibold bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 text-[#1F2421] rounded-md shrink-0"
                        >
                          Use 0x
                        </button>
                      </div>
                      {manualInputError && (
                        <p className="text-[11px] text-red-700">{manualInputError}</p>
                      )}
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setPostOpen((prev) => !prev)}
            aria-expanded={postOpen}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-[#1F2421] text-white hover:bg-black text-xs font-semibold whitespace-nowrap shrink-0 shadow-xs transition-colors"
          >
            {postOpen ? (
              <>
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Close Post Form</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Post Land for Sale</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expandable Post Land for Sale (Before or After Verification) Drawer */}
      {postOpen && (
        <section className="relative z-10 rounded-2xl bg-white/95 backdrop-blur-md border border-[#1F2421]/15 p-5 space-y-4 text-[#1F2421] shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1F2421] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
                <span>Post Land for Sale (Before or After Verification)</span>
              </h2>
              <p className="text-xs text-[#2D312E]/80 mt-0.5">
                List your registered land immediately — even before verification completes. Buyers still run mandatory GIS, Oracle &amp; ERC-721 verification before purchasing.
              </p>
            </div>
            {user && (
              <span className="font-mono text-xs text-[#2D312E] tabular-nums whitespace-nowrap">
                {readyToList.length} verified · {Math.max(0, postableParcels.length - readyToList.length)} pending
              </span>
            )}
          </div>

          {loading ? (
            <p className="text-xs text-[#2D312E]/80">Checking your registered land parcels...</p>
          ) : !user ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <p className="text-xs text-[#2D312E] max-w-2xl">
                Register your land parcel directly with your USD ($) price, coordinates, and deed document to submit it for verification and listing on Check Lands.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <Link
                  to="/register"
                  className="px-4 py-2 rounded-full bg-[#1F2421] text-white hover:bg-black text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  Register Land to Sell
                </Link>
              </div>
            </div>
          ) : postableParcels.length === 0 ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <p className="text-xs text-[#2D312E] max-w-2xl">
                You have no unlisted land parcels yet. Register a parcel with coordinates, price in USD ($), and deed document to submit it for verification and listing.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <Link
                  to="/register"
                  className="px-4 py-2 rounded-full bg-[#1F2421] text-white hover:bg-black text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  Register Land to Sell
                </Link>
                <Link
                  to="/gis-map"
                  className="px-4 py-2 rounded-full bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 text-xs font-medium text-[#1F2421] whitespace-nowrap transition-colors"
                >
                  Explore GIS Map
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitListing} className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <label
                    htmlFor="market-title-select"
                    className="block text-xs font-medium text-[#1F2421] mb-1"
                  >
                    Select Your Parcel to Post for Sale
                  </label>
                  <select
                    id="market-title-select"
                    value={selectedParcelKey}
                    onChange={(e) => handleSelectParcel(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-slate-300 text-[#1F2421] focus:outline-hidden focus:ring-2 focus:ring-[#1F2421]/30"
                  >
                    {postableParcels.map((item) => {
                      const key = getParcelOptionKey(item);
                      const badge = item.eligible ? 'Verified Title' : 'Pending Verification';
                      const idLabel = item.titleNumber || item.referenceCode;
                      return (
                        <option key={key} value={key} className="bg-white text-[#1F2421]">
                          {idLabel} · {item.parcelName} ({item.parcelCode || item.region}) · {badge} · {item.areaSqm} m²
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="market-price-usd"
                    className="block text-xs font-medium text-[#1F2421] mb-1"
                  >
                    Asking Price (USD $)
                  </label>
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-slate-500"
                    >
                      $
                    </span>
                    <input
                      id="market-price-usd"
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={priceUsd}
                      onChange={(e) => setPriceUsd(e.target.value)}
                      placeholder="2500"
                      className="w-full pl-6 pr-3 py-2 text-xs font-mono tabular-nums rounded-xl bg-white border border-slate-300 text-[#1F2421] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#1F2421]/30"
                    />
                  </div>
                  {Number(priceUsd) > 0 && (
                    <p className="mt-1 text-[10px] font-mono text-[#2D312E]/75">
                      ≈ {formatAnaguPrice(convertUsdToAnagu(priceUsd))} ANAGU escrow
                    </p>
                  )}
                </div>
              </div>

              {selectedParcel && (
                selectedParcel.eligible ? (
                  <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-900">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span className="font-semibold">Verification Cleared:</span>
                    <span>GIS Validated ({selectedParcel.parcelCode})</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">Oracle {selectedParcel.oracleScore ?? 100}/100</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">NFT #{selectedParcel.tokenId}</span>
                  </div>
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-900">
                    <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                    <span className="font-semibold">Posting Before Verification:</span>
                    <span>
                      Buyers can see this parcel immediately and run live GIS, Oracle &amp; ERC-721 checks before buying.
                    </span>
                  </div>
                )
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="market-listing-headline"
                    className="block text-xs font-medium text-[#1F2421] mb-1"
                  >
                    Listing Headline
                  </label>
                  <input
                    id="market-listing-headline"
                    type="text"
                    maxLength={140}
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="e.g., Prime Commercial Plot · Direct Road Access"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-slate-300 text-[#1F2421] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#1F2421]/30"
                  />
                </div>

                <div>
                  <label
                    htmlFor="market-listing-description"
                    className="block text-xs font-medium text-[#1F2421] mb-1"
                  >
                    Parcel Description &amp; Sale Terms (Optional)
                  </label>
                  <input
                    id="market-listing-description"
                    type="text"
                    maxLength={1000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Surveyed freehold plot ready for pre-purchase verification"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-slate-300 text-[#1F2421] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#1F2421]/30"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-[#2D312E]/80 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#1F2421]/75" aria-hidden="true" />
                  <span>Buyers must pass 4-gate verification before funding Polygon escrow.</span>
                </p>
                <button
                  type="submit"
                  disabled={busyId === activeBusyKey}
                  className="px-5 py-2 rounded-full bg-[#1F2421] text-white hover:bg-black disabled:opacity-50 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                >
                  {busyId === activeBusyKey
                    ? 'Publishing Listing...'
                    : selectedParcel?.eligible
                    ? 'Publish Land Listing'
                    : 'Post Land Before Verification'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Section 1: Recommend For You */}
      <section className="relative z-10 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1F2421] tracking-tight">
            Recommend For You
          </h2>
          {recommendedListings.length > 4 && (
            <button
              type="button"
              onClick={() => setExpandRecommended((prev) => !prev)}
              className="px-4 py-1.5 rounded-full bg-white/80 hover:bg-white border border-[#1F2421]/20 backdrop-blur-sm text-xs font-semibold text-[#1F2421] whitespace-nowrap shrink-0 transition-colors"
            >
              {expandRecommended ? 'Show Less −' : 'View More +'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="rounded-2xl bg-white/60 border border-[#1F2421]/10 p-3 h-72 animate-pulse"
              />
            ))}
          </div>
        ) : visibleRecommended.length === 0 ? (
          <div className="rounded-2xl bg-white/80 border border-[#1F2421]/15 p-8 text-center text-xs text-[#2D312E]">
            No land parcels are currently posted for sale. Click &ldquo;Post Land for Sale&rdquo; above to list a parcel.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {visibleRecommended.map((listing) => (
              <ParcelStorefrontCard
                key={`rec-${listing.id}`}
                listing={listing}
                user={user}
                connectedWallet={connectedWallet}
                isRegistrar={isRegistrar}
                busyId={busyId}
                buyerReport={verifiedReportsByListing[listing.id] || null}
                isSaved={savedIds.includes(Number(listing.id))}
                onToggleSave={handleToggleSave}
                onVerifyBeforeBuy={onVerifyBeforeBuy}
                onBuyEscrow={onBuyEscrow}
                onSettleSale={onSettleSale}
                onCancelListing={onCancelListing}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Based On Your Search */}
      <section className="relative z-10 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1F2421] tracking-tight">
            Based On Your Search
          </h2>
          {filteredListings.length > 4 && !searchQuery.trim() && verificationFilter === 'ALL' && (
            <button
              type="button"
              onClick={() => setExpandSearch((prev) => !prev)}
              className="px-4 py-1.5 rounded-full bg-white/80 hover:bg-white border border-[#1F2421]/20 backdrop-blur-sm text-xs font-semibold text-[#1F2421] whitespace-nowrap shrink-0 transition-colors"
            >
              {expandSearch ? 'Show Less −' : 'View More +'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="rounded-2xl bg-white/60 border border-[#1F2421]/10 p-3 h-72 animate-pulse"
              />
            ))}
          </div>
        ) : visibleSearchResults.length === 0 ? (
          <div className="rounded-2xl bg-white/80 border border-[#1F2421]/15 p-8 text-center text-xs text-[#2D312E] space-y-2">
            <p>
              {verificationFilter === 'SAVED'
                ? 'You have not saved any parcels yet. Tap the heart icon on any parcel card to save it here.'
                : 'No land listings match your current search or verification filter.'}
            </p>
            {(searchQuery || verificationFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setVerificationFilter('ALL');
                }}
                className="px-4 py-1.5 rounded-full bg-[#1F2421] hover:bg-black text-xs font-medium text-white transition-colors"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {visibleSearchResults.map((listing) => (
              <ParcelStorefrontCard
                key={`search-${listing.id}`}
                listing={listing}
                user={user}
                connectedWallet={connectedWallet}
                isRegistrar={isRegistrar}
                busyId={busyId}
                buyerReport={verifiedReportsByListing[listing.id] || null}
                isSaved={savedIds.includes(Number(listing.id))}
                onToggleSave={handleToggleSave}
                onVerifyBeforeBuy={onVerifyBeforeBuy}
                onBuyEscrow={onBuyEscrow}
                onSettleSale={onSettleSale}
                onCancelListing={onCancelListing}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
