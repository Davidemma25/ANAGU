import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  LocateFixed,
  ShieldCheck,
  Upload,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';
import OsmParcelPicker from '../components/OsmParcelPicker.jsx';
import GeographicLocationSelector from '../components/GeographicLocationSelector.jsx';
import { WalletBrandIcon } from '../components/WalletBrandIcon.jsx';
import {
  getWalletProviderLabel,
  isValidPolygonAddress,
  shortenAddress,
} from '../services/walletService.js';
import {
  computeAreaFromPointsSqm,
  parseLocatedCoordinatesParams,
  parseRingToLatLngPoints,
} from '../utils/osmMap.js';
import {
  convertUsdToAnagu,
  formatAnaguPrice,
  formatFileSizeKb,
  validateLandRegistrationDraft,
} from '../utils/marketplaceUtils.js';

const DOCUMENT_TYPE_LABELS = {
  DEED_OF_CONVEYANCE: 'Deed of Conveyance',
  SURVEY_PLAN: 'Survey Plan',
  COMMUNITY_LETTER: 'Community Endorsement Letter',
  TAX_RECEIPT: 'Land Tax Receipt',
  ID_DOCUMENT: 'National ID Copy',
};

export default function RegisterPage() {
  const {
    user,
    loading,
    walletInfo,
    manualWalletAddress,
    connectWallet,
    connectManualWallet,
    disconnectWallet,
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef(null);

  const focusLocation = useMemo(
    () => parseLocatedCoordinatesParams(searchParams),
    [searchParams]
  );

  // Pre-fill coordinates from GIS map drawing (passed as ?prefill=<GeoJSON>)
  const prefillGeoJson = useMemo(() => {
    const raw = searchParams.get('prefill');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw));
      // Accept GeoJSON Polygon or raw ring array
      if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates?.[0])) {
        return JSON.stringify(parsed);
      }
      if (Array.isArray(parsed)) {
        return JSON.stringify({ type: 'Polygon', coordinates: [parsed] });
      }
    } catch {
      // ignore malformed prefill
    }
    return null;
  }, [searchParams]);

  const [form, setForm] = useState(() => ({
    parcelName: '',
    region: '',
    locationDescription: focusLocation
      ? `Located parcel near ${focusLocation.lat.toFixed(5)}, ${focusLocation.lng.toFixed(5)}`
      : '',
    declaredAreaSqm: '0',
    ownershipType: 'FREEHOLD',
    claimantName: user?.fullName?.replace(/\s*\(Sample.*?\)/i, '') || '',
    claimantNationalId: user?.nationalId || '',
    priceUsd: '',
    headline: '',
    description: '',
    walletAddress: walletInfo?.address || manualWalletAddress || user?.walletAddress || '',
    coordinatesText: prefillGeoJson || '[]',
    stateId: '',
    lgaId: '',
    communityId: '',
    boundarySource: prefillGeoJson ? 'MAP_DRAWING' : null,
  }));
  const [locatedBanner, setLocatedBanner] = useState(focusLocation);
  const [prefillBanner, setPrefillBanner] = useState(Boolean(prefillGeoJson));
  const [docType, setDocType] = useState('DEED_OF_CONVEYANCE');
  const [docFile, setDocFile] = useState(null);
  const [error, setError] = useState('');
  const [walletConnectError, setWalletConnectError] = useState('');
  const [connectingWallet, setConnectingWallet] = useState('');
  const [submittedRecord, setSubmittedRecord] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [focusLocation?.lat, focusLocation?.lng]);

  useEffect(() => {
    if (!focusLocation) return;
    setLocatedBanner(focusLocation);
    setForm((prev) => {
      const shouldPrefillDesc =
        !prev.locationDescription.trim() || prev.locationDescription.startsWith('Located parcel near ');
      return {
        ...prev,
        locationDescription: shouldPrefillDesc
          ? `Located parcel near ${focusLocation.lat.toFixed(5)}, ${focusLocation.lng.toFixed(5)}`
          : prev.locationDescription,
      };
    });
  }, [focusLocation]);

  useEffect(() => {
    const syncedWallet = walletInfo?.address || manualWalletAddress || user?.walletAddress || '';
    if (syncedWallet) {
      setForm((prev) => (prev.walletAddress.trim() ? prev : { ...prev, walletAddress: syncedWallet }));
    }
  }, [walletInfo?.address, manualWalletAddress, user?.walletAddress]);

  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      claimantName:
        prev.claimantName.trim() ||
        user.fullName?.replace(/\s*\(Sample.*?\)/i, '') ||
        '',
      claimantNationalId: prev.claimantNationalId.trim() || user.nationalId || '',
    }));
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading land registration form...
      </div>
    );
  }

  const handleClearFile = () => {
    setDocFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCoordinatesChange = (nextText, boundarySource = 'MANUAL_GPS') => {
    const parsedPoints = parseRingToLatLngPoints(nextText);
    const computedArea =
      parsedPoints && parsedPoints.length >= 3 ? computeAreaFromPointsSqm(parsedPoints) : 0;
    setForm((p) => ({
      ...p,
      coordinatesText: nextText,
      boundarySource,
      declaredAreaSqm: computedArea > 0 ? String(computedArea) : '',
    }));
  };

  const activeWalletAddress =
    walletInfo?.address || manualWalletAddress || form.walletAddress.trim();

  const handleConnectWallet = async (walletType) => {
    setWalletConnectError('');
    setConnectingWallet(walletType);
    try {
      const info = await connectWallet(walletType);
      if (info?.address) {
        setForm((p) => ({ ...p, walletAddress: info.address }));
      }
    } catch (err) {
      setWalletConnectError(
        err?.message ||
          `${
            walletType === 'trustwallet' ? 'Trust Wallet' : 'MetaMask'
          } extension not detected. You can paste a 0x wallet address below.`
      );
    } finally {
      setConnectingWallet('');
    }
  };

  const handleApplyManualWallet = () => {
    setWalletConnectError('');
    const trimmed = form.walletAddress.trim();
    if (!trimmed) {
      connectManualWallet('');
      return;
    }
    if (!isValidPolygonAddress(trimmed)) {
      setWalletConnectError('Enter a valid 42-character EVM 0x wallet address.');
      return;
    }
    connectManualWallet(trimmed);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validation = validateLandRegistrationDraft({
      ...form,
      docFile,
    });
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    if (form.walletAddress.trim() && !isValidPolygonAddress(form.walletAddress.trim())) {
      setError('Wallet address must be a valid 42-character EVM 0x address (or leave blank).');
      return;
    }

    const parsedCoords = JSON.parse(form.coordinatesText);
    const parsedPoints = parseRingToLatLngPoints(parsedCoords);
    const resolvedAreaSqm =
      parsedPoints && parsedPoints.length >= 3
        ? computeAreaFromPointsSqm(parsedPoints)
        : Number(form.declaredAreaSqm);

    if (!Number.isFinite(resolvedAreaSqm) || resolvedAreaSqm <= 0) {
      setError('Boundary coordinates must form a closed polygon with positive area.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = new FormData();
      payload.append('parcelName', form.parcelName.trim());
      payload.append('region', form.region.trim());
      payload.append('locationDescription', form.locationDescription.trim());
      payload.append('declaredAreaSqm', String(resolvedAreaSqm));
      payload.append('ownershipType', form.ownershipType);
      payload.append('claimantName', form.claimantName.trim());
      payload.append('claimantNationalId', form.claimantNationalId.trim());
      if (form.stateId) payload.append('stateId', form.stateId);
      if (form.lgaId) payload.append('lgaId', form.lgaId);
      if (form.communityId) payload.append('communityId', form.communityId);
      if (form.boundarySource) payload.append('boundarySource', form.boundarySource);
      payload.append('priceUsd', String(Number(form.priceUsd)));
      if (activeWalletAddress && isValidPolygonAddress(activeWalletAddress)) {
        payload.append('walletAddress', activeWalletAddress);
      }
      if (form.headline.trim()) {
        payload.append('headline', form.headline.trim());
      }
      if (form.description.trim()) {
        payload.append('description', form.description.trim());
      }
      payload.append('coordinates', JSON.stringify(parsedCoords));
      payload.append('documentType', docType);
      payload.append('document', docFile);

      const { data } = await api.post('/marketplace/register-land', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setSubmittedRecord(data);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          'Failed to register land parcel. Please verify your inputs and deed document.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col justify-between">
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
        <section className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-200">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-medium text-emerald-900 mb-2">
                <UserCheck className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>
                  {user ? (
                    <>
                      Registered account: <strong>{user.fullName}</strong> ({user.email})
                    </>
                  ) : (
                    'Direct Land Registration — no sign-in required'
                  )}
                </span>
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Register Land &amp; Submit Deed to Sell
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Enter your parcel details, set your price in US Dollars ($), and upload your land deed. The Administrator verifies your deed before your parcel appears on Check Lands.
              </p>
            </div>
            <Link
              to="/marketplace"
              className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#E5CF5D] rounded-md whitespace-nowrap shrink-0 transition-colors"
            >
              View Check Lands
            </Link>
          </div>

          {locatedBanner && (
            <div
              role="status"
              data-testid="located-parcel-location-banner"
              className="mt-5 p-3.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-900 flex items-start gap-2.5"
            >
              <LocateFixed className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-semibold">
                  Map focused on located coordinates ({locatedBanner.lat.toFixed(5)},{' '}
                  {locatedBanner.lng.toFixed(5)}).
                </span>{' '}
                <span>
                  Draw the actual parcel boundary on the map or enter its GPS coordinates below. A location pin does not define a parcel boundary.
                </span>
              </div>
            </div>
          )}

          {prefillBanner && (
            <div
              role="status"
              className="mt-5 p-3.5 rounded-md bg-blue-50 border border-blue-200 text-xs sm:text-sm text-blue-900 flex items-start justify-between gap-2.5"
            >
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="font-semibold">Boundary pre-filled from GIS Map drawing.</span>{' '}
                  <span>
                    Your drawn polygon coordinates have been loaded into the form below. Review them on the map, then complete the registration details.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPrefillBanner(false)}
                className="text-blue-600 hover:text-blue-900 shrink-0 p-0.5"
                aria-label="Dismiss pre-fill notice"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-5 p-3.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {submittedRecord?.application ? (
            <div className="mt-6 space-y-6" data-testid="registration-submitted-step">
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span>Land &amp; Deed Submitted for Verification — Free Registration</span>
                  </p>
                  <span className="font-mono text-xs bg-white px-2.5 py-1 rounded border border-emerald-200">
                    {submittedRecord.application.reference_code}
                  </span>
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  {submittedRecord.message}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSubmittedRecord(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
                >
                  Register Another Parcel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate('/marketplace', {
                      state: {
                        registeredMessage: submittedRecord.message,
                        pendingAdminListing: submittedRecord.listing || null,
                      },
                    })
                  }
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#1F2421] hover:bg-black rounded-md transition-colors"
                >
                  <span>Proceed to Check Lands</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              1. Parcel Details &amp; Ownership
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="reg-parcel-name" className="block text-sm font-medium text-slate-700 mb-1">
                  Parcel Title / Plot Name
                </label>
                <input
                  id="reg-parcel-name"
                  type="text"
                  required
                  value={form.parcelName}
                  onChange={(e) => setForm((p) => ({ ...p, parcelName: e.target.value }))}
                  placeholder="e.g. Plot A Residential Zone 1"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                />
              </div>
              <div>
                <label htmlFor="reg-region" className="block text-sm font-medium text-slate-700 mb-1">
                  Region / Municipality
                </label>
                <input
                  id="reg-region"
                  type="text"
                  required
                  value={form.region}
                  onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))}
                  placeholder="e.g. Zone 1 District"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-location" className="block text-sm font-medium text-slate-700 mb-1">
                Location Description &amp; Landmarks
              </label>
              <input
                id="reg-location"
                type="text"
                required
                value={form.locationDescription}
                onChange={(e) => setForm((p) => ({ ...p, locationDescription: e.target.value }))}
                placeholder="Street, survey beacon, and adjacent landmarks"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
              />
            </div>

            <GeographicLocationSelector
              value={form}
              onChange={(location) => setForm((prev) => ({ ...prev, ...location }))}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="reg-ownership" className="block text-sm font-medium text-slate-700 mb-1">
                  Ownership Type
                </label>
                <select
                  id="reg-ownership"
                  value={form.ownershipType}
                  onChange={(e) => setForm((p) => ({ ...p, ownershipType: e.target.value }))}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                >
                  <option value="FREEHOLD">Freehold</option>
                  <option value="CUSTOMARY">Customary</option>
                  <option value="LEASEHOLD">Leasehold</option>
                  <option value="FAMILY_TRUST">Family Trust</option>
                </select>
              </div>
              <div>
                <label htmlFor="reg-claimant" className="block text-sm font-medium text-slate-700 mb-1">
                  Owner / Claimant Name
                </label>
                <input
                  id="reg-claimant"
                  type="text"
                  required
                  value={form.claimantName}
                  onChange={(e) => setForm((p) => ({ ...p, claimantName: e.target.value }))}
                  placeholder="e.g. Chidinma Okafor"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                />
              </div>
              <div>
                <label htmlFor="reg-claimant-id" className="block text-sm font-medium text-slate-700 mb-1">
                  Owner National ID
                </label>
                <input
                  id="reg-claimant-id"
                  type="text"
                  required
                  value={form.claimantNationalId}
                  onChange={(e) => setForm((p) => ({ ...p, claimantNationalId: e.target.value }))}
                  placeholder="NID-2026-001"
                  className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-coords" className="block text-sm font-medium text-slate-700 mb-1">
                Boundary Coordinates (JSON [lng, lat] Ring)
              </label>
              <textarea
                id="reg-coords"
                rows={2}
                required
                value={form.coordinatesText}
                onChange={(e) => handleCoordinatesChange(e.target.value)}
                placeholder="[[3.391, 6.531], [3.3925, 6.531], [3.3925, 6.5325], [3.391, 6.5325], [3.391, 6.531]]"
                className="w-full px-3.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
              />
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                {(() => {
                  const pts = parseRingToLatLngPoints(form.coordinatesText);
                  const area = pts && pts.length >= 3 ? computeAreaFromPointsSqm(pts) : 0;
                  return area > 0
                    ? `Geodesic area: ${area.toLocaleString()} m² · ${(area / 10000).toFixed(2)} ha · ${(area / 4046.8564224).toFixed(2)} acres (${pts.length} vertices)`
                    : 'Paste a closed WGS84 [lng, lat] JSON ring or draw parcel corners on the map below.';
                })()}
              </p>
            </div>

            {/* Step 2: Price & Deed Upload for Verification */}
            <div className="p-5 rounded-lg bg-[#FEF9DB] border border-[#E5CF5D] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#1F2421] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
                  <span>2. Set Land Price &amp; Upload Deed for Admin Verification</span>
                </h2>
                <span className="text-xs font-medium text-[#2D312E]">
                  Verified by Admin before Check Lands
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="reg-price-usd" className="block text-sm font-semibold text-[#1F2421] mb-1">
                    Land Price (USD $) <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono font-semibold text-slate-500"
                    >
                      $
                    </span>
                    <input
                      id="reg-price-usd"
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={form.priceUsd}
                      onChange={(e) => setForm((p) => ({ ...p, priceUsd: e.target.value }))}
                      placeholder="e.g. 4250"
                      className="w-full pl-7 pr-3.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#2D312E]/80">
                    {Number(form.priceUsd) > 0
                      ? `Listed in USD · ≈ ${formatAnaguPrice(convertUsdToAnagu(form.priceUsd))} ANAGU on-chain escrow`
                      : 'Displayed in dollars ($) to buyers on Check Lands.'}
                  </p>
                </div>
                <div>
                  <label htmlFor="reg-headline" className="block text-sm font-medium text-[#1F2421] mb-1">
                    Check Lands Headline (Optional)
                  </label>
                  <input
                    id="reg-headline"
                    type="text"
                    maxLength={140}
                    value={form.headline}
                    onChange={(e) => setForm((p) => ({ ...p, headline: e.target.value }))}
                    placeholder="e.g. Prime Residential Corner Plot"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                  />
                </div>
                <div>
                  <label htmlFor="reg-desc" className="block text-sm font-medium text-[#1F2421] mb-1">
                    Notes / Sale Terms (Optional)
                  </label>
                  <input
                    id="reg-desc"
                    type="text"
                    maxLength={1000}
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Surveyed plot ready for verification"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                  />
                </div>
              </div>

              <div className="p-4 rounded-md bg-white border border-[#1F2421]/15 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      Land Document or Deed for Verification <span className="text-red-600">*</span>
                    </span>
                  </p>
                  <span className="text-[11px] text-slate-500">
                    Sealed with SHA-256 &amp; sent to Admin for deed verification
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-doc-type" className="block text-xs font-medium text-slate-700 mb-1">
                      Document Type
                    </label>
                    <select
                      id="reg-doc-type"
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                    >
                      <option value="DEED_OF_CONVEYANCE">Deed of Conveyance</option>
                      <option value="SURVEY_PLAN">Survey Plan</option>
                      <option value="COMMUNITY_LETTER">Community Endorsement Letter</option>
                      <option value="TAX_RECEIPT">Land Tax Receipt</option>
                      <option value="ID_DOCUMENT">National ID Copy</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="reg-doc-file" className="block text-xs font-medium text-slate-700 mb-1">
                      Upload Deed / Document (PDF, PNG, JPEG, TXT, JSON — max 5 MB)
                    </label>
                    <input
                      ref={fileInputRef}
                      id="reg-doc-file"
                      type="file"
                      required
                      accept=".pdf,.png,.jpg,.jpeg,.txt,.json"
                      onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-800 hover:file:bg-slate-100"
                    />
                  </div>
                </div>

                {docFile && (
                  <div
                    data-testid="selected-deed-preview"
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-900"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCheck2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                      <span className="font-semibold truncate">{docFile.name}</span>
                      <span className="font-mono text-emerald-700 shrink-0">
                        ({formatFileSizeKb(docFile.size)})
                      </span>
                      <span className="text-emerald-800 hidden sm:inline">
                        · {DOCUMENT_TYPE_LABELS[docType] || docType} · Ready for Admin verification
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearFile}
                      aria-label="Remove uploaded deed document"
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:text-red-700"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Wallet Connection for Escrow Payouts */}
              <div
                data-testid="register-wallet-card"
                className="p-4 rounded-md bg-white border border-[#1F2421]/15 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[#1F2421] flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Seller Wallet Connection (Optional — For Sale Escrow Payouts)</span>
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Registration is completely free. Connect MetaMask, Trust Wallet, or paste an EVM 0x address to receive escrow payouts when your land sells.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 font-mono text-[11px] font-semibold text-emerald-800 whitespace-nowrap shrink-0">
                    Registration: FREE
                  </span>
                </div>

                {walletInfo?.address ? (
                  <div className="p-2.5 rounded-md bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <WalletBrandIcon
                        walletType={walletInfo.walletType || 'auto'}
                        className="w-4 h-4 shrink-0"
                      />
                      <span className="font-semibold text-emerald-900">
                        {getWalletProviderLabel(walletInfo)} Connected:
                      </span>
                      <span className="font-mono text-emerald-800 truncate">
                        {shortenAddress(walletInfo.address)}
                      </span>
                      <span className="text-[11px] text-emerald-700 hidden sm:inline">
                        ({walletInfo.networkName})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        disconnectWallet();
                        setForm((p) => ({ ...p, walletAddress: '' }));
                      }}
                      className="text-[11px] font-medium text-emerald-900 underline hover:text-red-700"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleConnectWallet('metamask')}
                        disabled={Boolean(connectingWallet)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1F2421] text-white hover:bg-black rounded-md whitespace-nowrap transition-colors disabled:opacity-60"
                      >
                        <WalletBrandIcon walletType="metamask" className="w-3.5 h-3.5" />
                        <span>{connectingWallet === 'metamask' ? 'Connecting...' : 'MetaMask'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConnectWallet('trustwallet')}
                        disabled={Boolean(connectingWallet)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-[#1F2421] border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap transition-colors disabled:opacity-60"
                      >
                        <WalletBrandIcon walletType="trustwallet" className="w-3.5 h-3.5" />
                        <span>
                          {connectingWallet === 'trustwallet' ? 'Connecting...' : 'Trust Wallet'}
                        </span>
                      </button>
                    </div>
                    <div className="flex flex-1 items-center gap-1.5 min-w-0">
                      <input
                        id="reg-wallet-address"
                        type="text"
                        value={form.walletAddress}
                        onChange={(e) => setForm((p) => ({ ...p, walletAddress: e.target.value }))}
                        onBlur={handleApplyManualWallet}
                        placeholder="Or paste 0x EVM wallet address (optional)"
                        className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                      />
                    </div>
                  </div>
                )}

                {walletConnectError && (
                  <p role="alert" className="text-[11px] text-amber-800">
                    {walletConnectError}
                  </p>
                )}
              </div>
            </div>

            {/* Step 3: Parcel Boundary */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    3. Interactive OpenStreetMap Parcel Boundary Picker
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Search any place or click points directly on OpenStreetMap to draw your parcel corners, drag numbered markers to refine, or paste the JSON ring in Section 1 above.
                  </p>
                </div>
              </div>

              <OsmParcelPicker
                coordinatesText={form.coordinatesText}
                focusLocation={focusLocation}
                onChangeCoordinates={handleCoordinatesChange}
                onSyncAreaSqm={(nextArea) =>
                  setForm((p) => ({ ...p, declaredAreaSqm: nextArea }))
                }
                onLocateCoordinates={({ lat, lng }) => {
                  setLocatedBanner({ lat, lng });
                  setForm((p) => {
                    const shouldPrefillDesc =
                      !p.locationDescription.trim() ||
                      p.locationDescription.startsWith('Located parcel near ');
                    return {
                      ...p,
                      locationDescription: shouldPrefillDesc
                        ? `Located parcel near ${lat.toFixed(5)}, ${lng.toFixed(5)}`
                        : p.locationDescription,
                    };
                  });
                }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-60 rounded-md transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#FDE878]" aria-hidden="true" />
              <span>
                {submitting
                  ? 'Submitting Land & Deed for Admin Verification...'
                  : 'Register & Submit Deed for Verification'}
              </span>
            </button>
          </form>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
        Uploaded deeds are sealed with SHA-256 and verified by the Administrator before appearing on Check Lands.
      </footer>
    </div>
  );
}
