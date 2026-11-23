import { useCallback, useEffect, useState } from 'react';
import { Gavel, ShieldAlert, FileWarning, History } from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';
import { adminApi } from '../services/adminApi.js';
import { shortenAddress } from '../services/walletService.js';
import { isAdminRole } from '../adminConfig';

export default function AdminRevocationPage() {
  const { user } = useAdminAuth();
  const canRevoke = isAdminRole(user?.roleCode);

  const [revocations, setRevocations] = useState([]);
  const [activeTitles, setActiveTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTitleId, setSelectedTitleId] = useState('');
  const [ground, setGround] = useState('OverridingPublicInterest');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [reuseProof, setReuseProof] = useState(null);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const loadRevocations = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/revocations');
      const actives = data.activeTitles || [];
      setRevocations(data.revocations || []);
      setActiveTitles(actives);
      setSelectedTitleId((prev) => prev || (actives[0] ? String(actives[0].id) : ''));
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to load statutory revocation records.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRevocations();
  }, [loadRevocations]);

  const handleRevoke = async (e) => {
    e.preventDefault();
    if (!selectedTitleId) return;
    setFeedback({ type: '', text: '' });
    setSubmitting(true);
    try {
      const { data } = await adminApi.post(`/revocations/${selectedTitleId}`, {
        ground,
        reason,
      });
      setFeedback({ type: 'success', text: data.message });
      setReason('');
      setSelectedTitleId('');
      await loadRevocations();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to execute statutory revocation.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestReuseBlock = async (titleId) => {
    setReuseProof(null);
    setTestingId(titleId);
    try {
      const { data } = await adminApi.post(`/titles/${titleId}/test-transfer-block`, {});
      setReuseProof(data);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to verify on-chain revocation lock.',
      });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Statutory Title Revocations
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Authorised statutory revocation under OverridingPublicInterest or BreachOfStatutoryCondition without deleting original title history.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="font-mono tabular-nums">Active Titles: {activeTitles.length}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">Revoked Titles: {revocations.length}</span>
        </div>
      </div>

      {feedback.text && (
        <div
          role="alert"
          className={`p-3.5 rounded-md border text-sm ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {reuseProof && (
        <section className="p-4 rounded-lg bg-slate-900 text-slate-100 border border-slate-800 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-amber-400">
            <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            <span>Revoked Title Transfer &amp; Reuse Permanently Blocked (Scenario 4 Verified)</span>
          </div>
          <p className="font-mono text-slate-300">On-Chain Revert: {reuseProof.reason}</p>
          <p className="font-mono text-slate-400 tabular-nums">
            Attempt from {shortenAddress(reuseProof.fromAddress)} rejected in {reuseProof.latencyMs} ms
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
            <Gavel className="w-4 h-4 text-[#0F1E36]" aria-hidden="true" />
            <span>Execute Statutory Revocation</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Strictly restricted to the designated Platform Administrator. Revocation records an immutable on-chain TitleRevoked event and preserves the original title.
          </p>

          {!canRevoke ? (
            <div className="mt-4 p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600">
              Restricted to the authenticated sole Administrator account.
            </div>
          ) : activeTitles.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">
              No ACTIVE digital land titles are available for statutory revocation.
            </p>
          ) : (
            <form onSubmit={handleRevoke} className="mt-4 space-y-4">
              <div>
                <label htmlFor="rev-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Active Land Title
                </label>
                <select
                  id="rev-title"
                  required
                  value={selectedTitleId}
                  onChange={(e) => setSelectedTitleId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  {activeTitles.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title_number} · {t.parcel_name} ({t.owner_name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="rev-ground" className="block text-xs font-medium text-slate-700 mb-1">
                  Statutory Ground
                </label>
                <select
                  id="rev-ground"
                  value={ground}
                  onChange={(e) => setGround(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="OverridingPublicInterest">OverridingPublicInterest</option>
                  <option value="BreachOfStatutoryCondition">BreachOfStatutoryCondition</option>
                </select>
              </div>

              <div>
                <label htmlFor="rev-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Statutory Justification (minimum 10 characters)
                </label>
                <textarea
                  id="rev-reason"
                  rows={4}
                  required
                  minLength={10}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Specify public infrastructure corridor order or statutory condition breach details..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
              >
                {submitting ? 'Revoking On-Chain...' : 'Execute Statutory Revocation'}
              </button>
            </form>
          )}
        </section>

        <section className="lg:col-span-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-slate-600" aria-hidden="true" />
              <span>Immutable Statutory Revocation Ledger</span>
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {revocations.length} record(s)
            </span>
          </div>

          {loading ? (
            <p className="p-6 text-center text-xs text-slate-500">Loading revocation ledger...</p>
          ) : revocations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 space-y-2">
              <FileWarning className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
              <p>No digital land titles have been statutorily revoked yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {revocations.map((rev) => (
                <div key={rev.id} className="p-5 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-slate-900">
                        {rev.title_number}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        Token #{rev.token_id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-red-700">
                        {rev.title_status}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {new Date(rev.revoked_at).toLocaleString()}
                    </span>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {rev.parcel_name} ({rev.parcel_code}) — {rev.region}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Ground: <span className="font-mono font-semibold text-red-800">{rev.ground}</span> ·
                      Authorised By: {rev.governor_name} · Holder at revocation: {rev.owner_name}
                    </p>
                  </div>

                  <p className="p-3 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    {rev.reason}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-500">
                      Tx: {shortenAddress(rev.tx_hash)}
                    </span>
                    <button
                      type="button"
                      disabled={testingId === rev.title_id}
                      onClick={() => handleTestReuseBlock(rev.title_id)}
                      className="px-3 py-1.5 font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md whitespace-nowrap"
                    >
                      {testingId === rev.title_id
                        ? 'Checking On-Chain Lock...'
                        : 'Verify Transfer & Reuse Block'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
