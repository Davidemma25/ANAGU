import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CheckCircle2,
  ExternalLink,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  getWalletProviderLabel,
  hasInjectedWallet,
  isValidPolygonAddress,
  shortenAddress,
} from '../services/walletService.js';
import { WalletBrandIcon } from './WalletBrandIcon.jsx';
import {
  buildExplorerAddressUrl,
  canBuyerConfirmPurchase,
  formatAnaguPrice,
  formatUsdPrice,
  getBuyerVerificationItems,
  resolveListingPriceAnagu,
  resolveListingPriceUsd,
} from '../utils/marketplaceUtils.js';

function ParcelPolygonMap({ boundaryGeojson, parcelCode, verifiedSafeToBuy }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const ring = boundaryGeojson?.coordinates?.[0];
    if (!containerRef.current || !Array.isArray(ring) || ring.length < 3) {
      return undefined;
    }

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const latLngs = ring.map(([lng, lat]) => [lat, lng]);
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const color = verifiedSafeToBuy ? '#047857' : '#dc2626';
    const polygon = L.polygon(latLngs, {
      color,
      weight: 2.5,
      fillColor: color,
      fillOpacity: 0.25,
    }).addTo(map);

    if (parcelCode) {
      polygon.bindPopup(`<strong>${parcelCode}</strong>`);
    }

    map.fitBounds(polygon.getBounds(), { padding: [24, 24], maxZoom: 17 });
    mapRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 60);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [boundaryGeojson, parcelCode, verifiedSafeToBuy]);

  if (!boundaryGeojson?.coordinates?.[0]?.length) {
    return (
      <div className="h-44 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-500">
        No GeoJSON boundary polygon attached to this parcel.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="buyer-verification-map"
      className="h-48 w-full rounded-md border border-slate-200 bg-slate-100 z-0"
    />
  );
}

export default function BuyerVerificationModal({
  listing,
  report,
  loading,
  error,
  currentUserId,
  currentUserWallet = '',
  walletInfo = null,
  manualWalletAddress = '',
  onConnectWallet,
  onSetManualWallet,
  onDisconnectWallet,
  onSwitchNetwork,
  onActivateOnChain,
  busyId,
  onReverify,
  onConfirmBuy,
  onClose,
}) {
  const [connectingWallet, setConnectingWallet] = useState('');
  const [walletError, setWalletError] = useState('');
  const [walletInput, setWalletInput] = useState(manualWalletAddress || '');
  const walletInputRef = useRef(null);

  useEffect(() => {
    setWalletInput(manualWalletAddress || '');
    setWalletError('');
  }, [manualWalletAddress, listing?.id]);

  useEffect(() => {
    if (!listing) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listing, onClose]);

  if (!listing) return null;

  const items = getBuyerVerificationItems(report);
  const purchaseCheck = canBuyerConfirmPurchase({
    listing,
    currentUserId,
    verificationReport: report,
  });
  const isBuying = busyId === `buy-${listing.id}`;
  const isSeller = Boolean(currentUserId && listing.seller_id === currentUserId);
  const canCheckout = !isSeller && listing.listing_status === 'LISTED';

  const priceUsd = resolveListingPriceUsd(listing);
  const formattedUsd = formatUsdPrice(priceUsd);
  const priceAnagu = resolveListingPriceAnagu(listing);
  const formattedAnagu = `${formatAnaguPrice(priceAnagu)} ANAGU`;
  const isRealOnChain = Boolean(
    report?.details?.isRealOnChain ||
      (report?.details?.chainId && Number(report.details.chainId) !== 31337)
  );
  const effectiveWallet = isRealOnChain
    ? walletInfo?.address || ''
    : walletInfo?.address || manualWalletAddress || currentUserWallet || '';
  const isWrongWalletChain = Boolean(
    isRealOnChain &&
      walletInfo?.address &&
      report?.details?.chainId &&
      Number(walletInfo.chainId) !== Number(report.details.chainId)
  );
  const canSellerActivateOnChain = Boolean(
    isSeller &&
      listing.token_id &&
      listing.listing_status === 'LISTED' &&
      report &&
      report.checks?.gisClean &&
      report.checks?.oracleClean &&
      report.checks?.notRevoked &&
      !report.checks?.onChainVerified &&
      onActivateOnChain
  );
  const connectedWalletLabel = getWalletProviderLabel(walletInfo);
  const injectedAvailable = hasInjectedWallet();

  const handleConnectWallet = async (walletType = 'auto') => {
    setWalletError('');
    if (!onConnectWallet) return;
    setConnectingWallet(walletType);
    try {
      await onConnectWallet(walletType);
    } catch (err) {
      const targetName =
        walletType === 'trustwallet'
          ? 'Trust Wallet'
          : walletType === 'metamask'
          ? 'MetaMask'
          : 'MetaMask or Trust Wallet';
      setWalletError(
        err?.message ||
          `${targetName} browser extension was not detected. Enter an EVM 0x wallet address below to complete checkout.`
      );
      setTimeout(() => {
        walletInputRef.current?.focus();
      }, 50);
    } finally {
      setConnectingWallet('');
    }
  };

  const handleApplyManualWallet = (e) => {
    e.preventDefault();
    setWalletError('');
    const trimmed = walletInput.trim();
    if (!isValidPolygonAddress(trimmed)) {
      setWalletError('Enter a valid 42-character EVM 0x wallet address.');
      return;
    }
    onSetManualWallet?.(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="buyer-verify-dialog-title"
        className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-2xl w-full my-8 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E5CF5D] flex items-start justify-between gap-4 bg-[#FEF7D1]">
          <div>
            <p className="font-mono text-xs text-[#2D312E]/80">
              Pre-Purchase Due Diligence · {listing.title_number || listing.reference_code || 'Land Claim'} · {listing.parcel_code || listing.region}
            </p>
            <h2
              id="buyer-verify-dialog-title"
              className="mt-0.5 font-display text-lg font-bold text-[#1F2421]"
            >
              Verify Land Before Buying
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close verification dialog"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {loading ? (
            <div className="p-6 rounded-md border border-slate-200 bg-slate-50 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900">
                Verifying Parcel Spatial Boundaries, Oracle Records &amp; On-Chain Title...
              </p>
              <p className="text-xs text-slate-600">
                Running ST_IsValid(), ST_Intersects() overlap, Community Oracle deed integrity, and ERC-721 verification on-chain.
              </p>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="p-4 rounded-md bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          ) : report ? (
            <>
              {/* Overall Verdict Banner */}
              <div
                data-testid="buyer-verification-verdict"
                className={`p-4 rounded-md border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  report.verifiedSafeToBuy
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-200 text-red-950'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {report.verifiedSafeToBuy ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-sm font-bold">
                      {report.verifiedSafeToBuy
                        ? 'VERIFIED SAFE TO BUY'
                        : 'VERIFICATION BLOCKED — DO NOT BUY'}
                    </p>
                    <p className="text-xs mt-0.5 opacity-90">{report.verificationSummary}</p>
                  </div>
                </div>
                <div className="text-left sm:text-right font-mono text-xs shrink-0">
                  <p className="font-semibold">{report.verificationCode}</p>
                  <p className="opacity-75">
                    {new Date(report.verifiedAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>

              {/* Blockers list if failed */}
              {Array.isArray(report.blockers) && report.blockers.length > 0 && (
                <div className="p-3.5 rounded-md bg-red-50/70 border border-red-200 space-y-1">
                  <p className="text-xs font-semibold text-red-900">Detected Blockers:</p>
                  <ul className="list-disc pl-4 text-xs text-red-800 space-y-0.5">
                    {report.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Map + Key Parcel Facts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-[#1F2421] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#1F2421]" aria-hidden="true" />
                    <span>Verified Parcel Boundary (WGS84)</span>
                  </p>
                  <ParcelPolygonMap
                    boundaryGeojson={report.details?.boundaryGeojson || listing.boundary_geojson}
                    parcelCode={report.details?.parcelCode}
                    verifiedSafeToBuy={report.verifiedSafeToBuy}
                  />
                </div>

                <dl className="bg-slate-50 border border-slate-200 rounded-md p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                  <div>
                    <dt className="text-slate-500">Parcel Name</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {report.details?.parcelName || listing.parcel_name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Asking Price</dt>
                    <dd className="mt-0.5">
                      <span className="font-mono font-bold text-sm text-[#1F2421] tabular-nums">
                        {formattedUsd}
                      </span>
                      <span className="block font-mono text-[11px] text-slate-500 tabular-nums">
                        {formattedAnagu} into ANAGU escrow
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Region &amp; Tenure</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {report.details?.region || listing.region} ·{' '}
                      {report.details?.ownershipType || listing.ownership_type}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Geodesic Area</dt>
                    <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                      {report.details?.areaSqm
                        ? `${Number(report.details.areaSqm).toLocaleString()} m²`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">On-Chain Owner</dt>
                    <dd className="font-mono text-slate-900 mt-0.5">
                      {report.details?.onChainOwner
                        ? shortenAddress(report.details.onChainOwner)
                        : 'Unavailable'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Transfer History</dt>
                    <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                      {report.details?.transferHistoryCount ?? 0} event(s)
                    </dd>
                  </div>
                  <div className="sm:col-span-2 pt-1 border-t border-slate-200">
                    <dt className="text-slate-500">
                      Smart Contract ({report.details?.networkName || 'Polygon Escrow'})
                    </dt>
                    <dd className="font-mono text-[11px] text-slate-700 mt-0.5 break-all">
                      {buildExplorerAddressUrl(
                        report.details?.contractAddress || listing.contract_address,
                        report.details?.explorerBaseUrl
                      ) ? (
                        <a
                          href={buildExplorerAddressUrl(
                            report.details?.contractAddress || listing.contract_address,
                            report.details?.explorerBaseUrl
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline hover:text-black"
                        >
                          <span>{report.details?.contractAddress || listing.contract_address}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                      ) : (
                        report.details?.contractAddress || listing.contract_address
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* 4-Gate Checklist */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  4-Gate Pre-Purchase Verification Results
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className={`p-3 rounded-md border text-xs flex items-start gap-2.5 ${
                        item.state === 'PASSED'
                          ? 'bg-emerald-50/50 border-emerald-200'
                          : 'bg-red-50/60 border-red-200'
                      }`}
                    >
                      {item.state === 'PASSED' ? (
                        <CheckCircle2
                          className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="w-4 h-4 text-red-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{item.label}</p>
                        <p className="text-slate-600 mt-0.5">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Wallet Connection & Payment Section */}
              {canCheckout && report.verifiedSafeToBuy && (
                <section
                  data-testid="wallet-payment-panel"
                  className="p-4 rounded-md border border-[#E5CF5D] bg-[#FEF9DB] space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
                      <h3 className="text-xs font-bold text-[#1F2421] uppercase tracking-wider">
                        Connect Wallet to Pay ({formattedUsd})
                      </h3>
                    </div>
                    <span className="font-mono text-[11px] text-[#2D312E]">
                      Settles {formattedAnagu} into ANAGU Escrow
                    </span>
                  </div>

                  {walletInfo?.address ? (
                    <div className="p-3 rounded-md bg-white border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                          <span>
                            {connectedWalletLabel} Connected: {shortenAddress(walletInfo.address)}
                          </span>
                        </p>
                        <p className="font-mono text-[11px] text-slate-600">
                          {walletInfo.networkName} · {walletInfo.balancePol || walletInfo.balanceEth} POL
                          {walletInfo.balanceAnagu && walletInfo.balanceAnagu !== '0.0000'
                            ? ` · ${walletInfo.balanceAnagu} ANAGU`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isWrongWalletChain && onSwitchNetwork && (
                          <button
                            type="button"
                            onClick={onSwitchNetwork}
                            className="px-2.5 py-1 text-[11px] font-semibold bg-[#1F2421] text-[#FDE878] hover:bg-black rounded"
                          >
                            Switch to Chain {report.details?.chainId}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleConnectWallet(walletInfo.walletType || 'auto')}
                          disabled={Boolean(connectingWallet)}
                          className="px-2.5 py-1 text-[11px] font-medium border border-slate-300 rounded bg-white hover:bg-slate-50"
                        >
                          Switch Account
                        </button>
                        {onDisconnectWallet && (
                          <button
                            type="button"
                            onClick={onDisconnectWallet}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-red-700"
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  ) : effectiveWallet ? (
                    <div className="p-3 rounded-md bg-white border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                          <span>
                            {manualWalletAddress ? 'Connected Payment Wallet:' : 'Account Linked Wallet:'}{' '}
                            <span className="font-mono">{shortenAddress(effectiveWallet)}</span>
                          </span>
                        </p>
                        <p className="font-mono text-[11px] text-slate-600 break-all">
                          {effectiveWallet}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleConnectWallet('metamask')}
                          disabled={Boolean(connectingWallet)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold bg-[#1F2421] text-white hover:bg-black rounded"
                        >
                          <WalletBrandIcon walletType="metamask" className="w-3.5 h-3.5" />
                          <span>{connectingWallet === 'metamask' ? 'Connecting...' : 'MetaMask'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConnectWallet('trustwallet')}
                          disabled={Boolean(connectingWallet)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold bg-white border border-slate-300 text-[#1F2421] hover:bg-slate-50 rounded"
                        >
                          <WalletBrandIcon walletType="trustwallet" className="w-3.5 h-3.5" />
                          <span>{connectingWallet === 'trustwallet' ? 'Connecting...' : 'Trust Wallet'}</span>
                        </button>
                        {manualWalletAddress && (
                          <button
                            type="button"
                            onClick={() => onSetManualWallet?.('')}
                            className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-red-700"
                          >
                            Change
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <p className="text-xs text-[#2D312E]">
                          Connect <strong className="font-semibold">MetaMask</strong> or{' '}
                          <strong className="font-semibold">Trust Wallet</strong> to pay{' '}
                          <strong className="font-mono">{formattedUsd}</strong> ({formattedAnagu}) safely into ANAGU escrow.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            data-testid="modal-connect-metamask-btn"
                            onClick={() => handleConnectWallet('metamask')}
                            disabled={Boolean(connectingWallet)}
                            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                          >
                            <WalletBrandIcon walletType="metamask" className="w-3.5 h-3.5" />
                            <span>
                              {connectingWallet === 'metamask' ? 'Connecting...' : 'MetaMask'}
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid="modal-connect-trustwallet-btn"
                            onClick={() => handleConnectWallet('trustwallet')}
                            disabled={Boolean(connectingWallet)}
                            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1F2421] bg-white hover:bg-slate-50 border border-[#1F2421]/30 disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                          >
                            <WalletBrandIcon walletType="trustwallet" className="w-3.5 h-3.5" />
                            <span>
                              {connectingWallet === 'trustwallet'
                                ? 'Connecting...'
                                : 'Trust Wallet'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {(!injectedAvailable || walletError) && (
                        <div className="p-3 rounded-md bg-white border border-slate-200 space-y-2">
                          <p className="text-[11px] text-slate-700">
                            {isRealOnChain
                              ? walletError ||
                                `MetaMask or Trust Wallet browser extension on ${
                                  report.details?.networkName || 'Polygon Amoy'
                                } (Chain ${report.details?.chainId || 80002}) is required to sign and fund real on-chain escrow.`
                              : walletError ||
                                'MetaMask or Trust Wallet extension not detected in this browser. Install MetaMask or Trust Wallet to sign directly, or connect a 0x wallet address below to complete checkout.'}
                          </p>
                          {!isRealOnChain && (
                            <form onSubmit={handleApplyManualWallet} className="flex flex-col sm:flex-row gap-2">
                              <input
                                ref={walletInputRef}
                                type="text"
                                value={walletInput}
                                onChange={(e) => setWalletInput(e.target.value)}
                                placeholder="Enter 0x EVM wallet address (e.g. 0x90F7...)"
                                aria-label="Buyer EVM wallet address"
                                className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                              />
                              <button
                                type="submit"
                                className="px-3.5 py-1.5 text-xs font-semibold bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 text-[#1F2421] rounded-md whitespace-nowrap"
                              >
                                Connect Wallet Address
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md"
            >
              Close
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => onReverify(listing)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Re-run Verification</span>
            </button>
          </div>

          {canSellerActivateOnChain && (
            <button
              type="button"
              disabled={loading || busyId === `activate-${listing.id}`}
              onClick={() => onActivateOnChain(listing)}
              className="px-4 py-2 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
            >
              {busyId === `activate-${listing.id}`
                ? 'Activating in Wallet...'
                : 'Activate Escrow Listing in Wallet'}
            </button>
          )}

          {canCheckout && (
            !purchaseCheck.allowed ? (
              <button
                type="button"
                disabled
                className="px-4 py-2 text-xs font-semibold bg-slate-200 text-slate-500 border border-slate-300 rounded-md whitespace-nowrap"
              >
                Purchase Locked Until Verified
              </button>
            ) : !effectiveWallet ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loading || Boolean(connectingWallet)}
                  onClick={() => handleConnectWallet('metamask')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                >
                  <WalletBrandIcon walletType="metamask" className="w-3.5 h-3.5" />
                  <span>
                    {connectingWallet === 'metamask'
                      ? 'Connecting...'
                      : 'Pay via MetaMask'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading || Boolean(connectingWallet)}
                  onClick={() => handleConnectWallet('trustwallet')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1F2421] bg-white hover:bg-slate-100 border border-[#1F2421]/30 disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                >
                  <WalletBrandIcon walletType="trustwallet" className="w-3.5 h-3.5" />
                  <span>
                    {connectingWallet === 'trustwallet'
                      ? 'Connecting...'
                      : 'Pay via Trust Wallet'}
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={loading || isBuying}
                onClick={() => onConfirmBuy(listing, report, effectiveWallet)}
                className="px-4 py-2 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
              >
                {isBuying
                  ? 'Processing Wallet Payment...'
                  : `Pay ${formattedUsd} via ${walletInfo?.address ? connectedWalletLabel : 'Wallet'} (${shortenAddress(effectiveWallet)})`}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
