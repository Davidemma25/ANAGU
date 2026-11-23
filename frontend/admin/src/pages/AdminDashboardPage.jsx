import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';
import { adminApi, extractErrorMessage } from '../services/adminApi.js';
import { shortenAddress } from '../services/walletService.js';
import { formatUsdPrice } from '../utils/marketplaceUtils.js';

export default function AdminDashboardPage() {
  const { user } = useAdminAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [publishingAppId, setPublishingAppId] = useState(null);
  const [lastVerifiedListing, setLastVerifiedListing] = useState(null);

  const loadAdminOverview = useCallback(async () => {
    try {
      const [summaryRes, queueRes] = await Promise.all([
        adminApi.get('/dashboard/summary'),
        adminApi.get('/verification/queue').catch(() => ({ data: { queue: [] } })),
      ]);
      setSummary(summaryRes.data);
      setVerificationQueue(queueRes.data?.queue || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to load admin console metrics.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminOverview();
  }, [loadAdminOverview]);

  const handleQuickVerifyCheckLands = async (appId) => {
    setFeedback({ type: '', text: '' });
    setLastVerifiedListing(null);
    setPublishingAppId(appId);
    try {
      const { data } = await adminApi.post(`/verification/publish-checklands/${appId}`, {});
      navigate('/marketplace', {
        state: {
          registeredMessage:
            data.message || 'Parcel verified and published on Check Lands as Verified.',
          fromAdminVerification: true,
        },
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Failed to verify and publish parcel to Check Lands.'),
      });
    } finally {
      setPublishingAppId(null);
    }
  };

  const metrics = summary?.metrics || {};
  const queues = summary?.queues || {};
  const pendingCheckLandsItems = verificationQueue.filter(
    (item) =>
      item.status !== 'REVOKED' &&
      item.status !== 'VERIFICATION_REJECTED' &&
      item.pending_listing?.verification_status !== 'VERIFIED'
  );

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1F2421] text-[#FDE878] font-mono text-[11px] font-semibold">
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                <span>SOLE ADMINISTRATOR</span>
              </span>
              <span>{user?.email}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">ID #{user?.id}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {user?.walletAddress ? shortenAddress(user.walletAddress) : 'No wallet linked'}
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold text-[#1F2421]">
              Administrator Console — {user?.fullName}
            </h1>
            <p className="mt-1 text-sm text-slate-600 max-w-3xl leading-relaxed">
              Manage registry verification queues, GIS boundary checks, ERC-721 title issuance,
              statutory revocations, audit logs, and registered citizen access.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              to="/admin/verification"
              className="px-4 py-2 text-sm font-medium text-white bg-[#1F2421] hover:bg-black rounded-md whitespace-nowrap transition-colors"
            >
              Verify Land Deeds
            </Link>
            <Link
              to="/admin/gis-validation"
              className="px-4 py-2 text-sm font-medium text-[#1F2421] bg-[#FDE878] border border-[#E5CF5D] hover:bg-[#f7de59] rounded-md whitespace-nowrap transition-colors"
            >
              GIS Validation Queue
            </Link>
            <Link
              to="/admin/titles"
              className="px-4 py-2 text-sm font-medium text-[#1F2421] bg-[#FDE878] border border-[#E5CF5D] hover:bg-[#f7de59] rounded-md whitespace-nowrap transition-colors"
            >
              Title Issuance &amp; Escrow
            </Link>
            <Link
              to="/admin/users"
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md whitespace-nowrap transition-colors"
            >
              Registered Users
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-4 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {feedback.text && (
        <div
          role="alert"
          className={`p-4 rounded-md border text-sm flex flex-wrap items-center justify-between gap-2 ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{feedback.text}</span>
          {feedback.type === 'success' && lastVerifiedListing && (
            <a
              href="/marketplace"
              className="inline-flex items-center gap-1 font-semibold underline hover:opacity-80 whitespace-nowrap"
            >
              <span>View Verified on Check Lands</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      )}

      {/* Registry KPIs */}
      <section aria-labelledby="admin-kpis-heading">
        <h2 id="admin-kpis-heading" className="text-sm font-semibold text-slate-700 mb-3">
          Registry Totals &amp; Operational Queues
        </h2>
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Registered Accounts</p>
            <p className="mt-1 font-display text-2xl font-bold text-[#1F2421] tabular-nums">
              {loading ? '—' : metrics.totalUsers ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Awaiting GIS Validation</p>
            <p className="mt-1 font-display text-2xl font-bold text-amber-700 tabular-nums">
              {loading ? '—' : queues.awaitingGis ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Deed &amp; Oracle Review</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {loading
                ? '—'
                : `${queues.awaitingDeedReview ?? 0} deed · ${queues.awaitingOracle ?? 0} oracle`}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Ready to Mint / Settle</p>
            <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {loading
                ? '—'
                : `${queues.awaitingMint ?? 0} mint · ${queues.awaitingEscrowSettlement ?? 0} escrow`}
            </p>
          </div>
        </div>
      </section>

      {/* 1-Click Check Lands Verification */}
      <section
        aria-labelledby="dashboard-quick-verify-heading"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="dashboard-quick-verify-heading"
              className="font-display text-base font-semibold text-[#1F2421] flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              <span>Pending Check Lands Approvals ({pendingCheckLandsItems.length})</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click once to verify a parcel and display it as Verified on public Check Lands.
            </p>
          </div>
          <Link
            to="/admin/verification"
            className="text-xs font-medium text-[#1F2421] underline hover:opacity-80 whitespace-nowrap"
          >
            Open Full Oracle Queue
          </Link>
        </div>

        {loading ? (
          <p className="p-5 text-xs text-slate-500">Loading parcels awaiting Check Lands verification...</p>
        ) : pendingCheckLandsItems.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">
            All active land registrations are already verified on Check Lands.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendingCheckLandsItems.map((item) => (
              <li
                key={item.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {item.reference_code}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                      {item.status}
                    </span>
                    {item.pending_listing?.price_usd != null && (
                      <span className="font-mono text-xs text-slate-600 tabular-nums">
                        {formatUsdPrice(item.pending_listing.price_usd)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 truncate mt-0.5">
                    {item.parcel_name}
                  </p>
                  <p className="text-xs text-slate-600">
                    {item.claimant_name} · {item.claimant_national_id} · {item.region}
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="dashboard-verify-checklands-btn"
                  disabled={publishingAppId === item.id}
                  onClick={() => handleQuickVerifyCheckLands(item.id)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#E5CF5D] disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {publishingAppId === item.id
                      ? 'Verifying...'
                      : 'Verify & Show on Check Lands'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="mb-4">
          <h2 className="font-display text-base font-semibold text-[#1F2421]">
            Registry Pipeline Breakdown
          </h2>
          <p className="text-xs text-slate-500">
            All citizen submissions across GIS, Oracle verification, minted titles, and statutory revocations
          </p>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={summary?.pipelineBreakdown || []}
              margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="stage" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1F2421" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
