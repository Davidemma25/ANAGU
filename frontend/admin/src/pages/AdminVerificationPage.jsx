import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  FileCheck,
  Eye,
  Download,
  X,
} from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';
import { adminApi } from '../services/adminApi.js';
import { isAdminRole } from '../adminConfig';
import { formatFileSizeKb, formatUsdPrice } from '../utils/marketplaceUtils.js';

export default function AdminVerificationPage() {
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  const canDecide = isAdminRole(user?.roleCode);
  const canAddSampleRecord = isAdminRole(user?.roleCode);

  const [activeTab, setActiveTab] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [sampleRecords, setSampleRecords] = useState([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [publishingAppId, setPublishingAppId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [deedPreview, setDeedPreview] = useState({
    doc: null,
    url: '',
    mimeType: '',
    textContent: '',
    loading: false,
    error: '',
  });

  const [decision, setDecision] = useState('APPROVED');
  const [remarks, setRemarks] = useState('');

  const [recordForm, setRecordForm] = useState({
    recordSource: 'SAMPLE_MUNICIPAL_ARCHIVE',
    sourceReference: '',
    parcelCode: '',
    registeredOwnerName: '',
    ownerNationalId: '',
    claimStatus: 'ACTIVE_RECORD',
    notes: '',
  });
  const [savingRecord, setSavingRecord] = useState(false);

  const loadQueueAndRecords = useCallback(async () => {
    try {
      const [queueRes, recordsRes] = await Promise.all([
        adminApi.get('/verification/queue'),
        adminApi.get('/verification/records'),
      ]);
      const items = queueRes.data.queue || [];
      setQueue(items);
      setSampleRecords(recordsRes.data.records || []);
      setDisclaimer(recordsRes.data.disclaimer || '');
      setSelectedAppId((prev) => prev || items[0]?.id || null);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to load Ownership Verification Oracle data.',
      });
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    loadQueueAndRecords();
  }, [loadQueueAndRecords]);

  const runEvaluation = useCallback(async (appId) => {
    if (!appId) return;
    setEvaluating(true);
    try {
      const { data } = await adminApi.get(`/verification/evaluate/${appId}`);
      setEvaluation(data);
      setHistory(data.history || []);
      if (data.oracle?.recommendedDecision) {
        setDecision(data.oracle.recommendedDecision);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to evaluate claim against Oracle records.',
      });
    } finally {
      setEvaluating(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAppId) {
      runEvaluation(selectedAppId);
    }
  }, [selectedAppId, runEvaluation]);

  const closeDeedPreview = useCallback(() => {
    setDeedPreview((prev) => {
      if (prev.url) {
        URL.revokeObjectURL(prev.url);
      }
      return { doc: null, url: '', mimeType: '', textContent: '', loading: false, error: '' };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (deedPreview.url) {
        URL.revokeObjectURL(deedPreview.url);
      }
    };
  }, [deedPreview.url]);

  const handleOpenDeed = async (doc, mode = 'preview') => {
    setFeedback({ type: '', text: '' });
    if (mode === 'preview') {
      if (deedPreview.url) URL.revokeObjectURL(deedPreview.url);
      setDeedPreview({
        doc,
        url: '',
        mimeType: doc.mimeType || '',
        textContent: '',
        loading: true,
        error: '',
      });
    }
    try {
      const response = await adminApi.get(`/verification/documents/${doc.documentId}/download`, {
        responseType: 'blob',
      });
      const blob = response.data;
      const mimeType = doc.mimeType || blob.type || 'application/octet-stream';
      const objectUrl = URL.createObjectURL(blob);

      if (mode === 'download') {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = doc.fileName || `deed-${doc.documentId}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return;
      }

      let textContent = '';
      if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        textContent = await blob.text();
      }
      setDeedPreview({
        doc,
        url: objectUrl,
        mimeType,
        textContent,
        loading: false,
        error: '',
      });
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        'Physical deed file preview unavailable for this record (metadata & SHA-256 verified).';
      if (mode === 'preview') {
        setDeedPreview({
          doc,
          url: '',
          mimeType: doc.mimeType || '',
          textContent: '',
          loading: false,
          error: msg,
        });
      } else {
        setFeedback({ type: 'error', text: msg });
      }
    }
  };

  const handleRecordDecision = async (e) => {
    e.preventDefault();
    if (!selectedAppId) return;
    setFeedback({ type: '', text: '' });
    setSubmittingDecision(true);
    try {
      const { data } = await adminApi.post(`/verification/decide/${selectedAppId}`, {
        decision,
        remarks,
      });
      if (
        data.publishedListing?.verification_status === 'VERIFIED' &&
        data.publishedListing?.listing_status === 'LISTED'
      ) {
        navigate('/marketplace', {
          state: {
            registeredMessage:
              data.message || 'Land deed verified and published on Check Lands.',
            fromAdminVerification: true,
          },
        });
        return;
      }
      setFeedback({
        type: 'success',
        text: `${data.message} Application status updated to ${data.application.status}.`,
      });
      setRemarks('');
      await loadQueueAndRecords();
      await runEvaluation(selectedAppId);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to record verification decision.',
      });
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleQuickPublishToCheckLands = async (appId) => {
    if (!appId) return;
    setFeedback({ type: '', text: '' });
    setPublishingAppId(appId);
    try {
      const { data } = await adminApi.post(`/verification/publish-checklands/${appId}`, {});
      if (
        data.publishedListing?.verification_status === 'VERIFIED' &&
        data.publishedListing?.listing_status === 'LISTED'
      ) {
        navigate('/marketplace', {
          state: {
            registeredMessage: data.message,
            fromAdminVerification: true,
          },
        });
      } else {
        setFeedback({ type: 'success', text: data.message });
        await loadQueueAndRecords();
        await runEvaluation(appId);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err.response?.data?.error ||
          'Failed to verify and publish parcel to Check Lands.',
      });
    } finally {
      setPublishingAppId(null);
    }
  };

  const handleAddSampleRecord = async (e) => {
    e.preventDefault();
    setFeedback({ type: '', text: '' });
    setSavingRecord(true);
    try {
      const { data } = await adminApi.post('/verification/records', recordForm);
      setFeedback({
        type: 'success',
        text: `Sample archive record ${data.record.source_reference} created.`,
      });
      setRecordForm({
        recordSource: 'SAMPLE_MUNICIPAL_ARCHIVE',
        sourceReference: '',
        parcelCode: '',
        registeredOwnerName: '',
        ownerNationalId: '',
        claimStatus: 'ACTIVE_RECORD',
        notes: '',
      });
      await loadQueueAndRecords();
      if (selectedAppId) await runEvaluation(selectedAppId);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to add sample institutional record.',
      });
    } finally {
      setSavingRecord(false);
    }
  };

  const filteredQueue = queue.filter((item) => {
    if (statusFilter === 'PENDING_CHECKLANDS') {
      if (item.pending_listing?.verification_status !== 'PENDING_ADMIN_APPROVAL') return false;
    } else if (statusFilter !== 'ALL' && item.status !== statusFilter) {
      return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      item.reference_code.toLowerCase().includes(q) ||
      item.parcel_name.toLowerCase().includes(q) ||
      item.claimant_name.toLowerCase().includes(q) ||
      (item.parcel_code || '').toLowerCase().includes(q)
    );
  });

  const selectedApp = evaluation?.application || queue.find((q) => q.id === selectedAppId) || null;
  const oracle = evaluation?.oracle || null;
  const pendingListing =
    evaluation?.pendingListing ||
    queue.find((q) => q.id === selectedAppId)?.pending_listing ||
    null;
  const isPendingCheckLandsDeed =
    pendingListing?.verification_status === 'PENDING_ADMIN_APPROVAL';
  const docMetadataById = new Map((evaluation?.documents || []).map((d) => [d.id, d]));
  const canDecideSelected =
    canDecide &&
    selectedApp &&
    ['SUBMITTED', 'GIS_VALIDATED', 'VERIFIED', 'VERIFICATION_REJECTED'].includes(
      selectedApp.status
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Land Deed Verification &amp; Ownership Oracle
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Verify submitted citizen land deeds, inspect SHA-256 document integrity and archive records, and approve parcels to publish them onto Check Lands.
          </p>
        </div>

        <div className="inline-flex flex-wrap sm:flex-nowrap shrink-0 items-center gap-1 p-1 bg-[#FDE878]/50 border border-[#E5CF5D] rounded-lg self-start whitespace-nowrap">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'queue'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            Verification Queue
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('records')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'records'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            Archive Records ({sampleRecords.length})
          </button>
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

      {activeTab === 'queue' ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <section className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold text-slate-900">Claims Ready for Oracle Review</span>
                <span className="font-mono tabular-nums">{filteredQueue.length} item(s)</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="search"
                  aria-label="Search verification queue"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reference, parcel, claimant..."
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                />
                <select
                  aria-label="Filter verification queue by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="ALL">All Stages</option>
                  <option value="PENDING_CHECKLANDS">Pending Check Lands Approval</option>
                  <option value="SUBMITTED">Submitted (New Deeds)</option>
                  <option value="GIS_VALIDATED">GIS Validated</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="VERIFICATION_REJECTED">Rejected / Flagged</option>
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
              {loadingQueue ? (
                <p className="p-6 text-center text-xs text-slate-500">
                  Loading verification queue...
                </p>
              ) : filteredQueue.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">
                  No land registrations or claims match your filter.
                </p>
              ) : (
                filteredQueue.map((item) => {
                  const isSelected = item.id === selectedAppId;
                  const awaitingCheckLands =
                    item.pending_listing?.verification_status === 'PENDING_ADMIN_APPROVAL';
                  const isVerifiedOnCheckLands =
                    item.pending_listing?.verification_status === 'VERIFIED';
                  const canQuickVerify =
                    canDecide && item.status !== 'REVOKED' && !isVerifiedOnCheckLands;
                  return (
                    <div
                      key={item.id}
                      className={`p-4 transition-colors hover:bg-slate-50 ${
                        isSelected ? 'bg-slate-100/80' : 'bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedAppId(item.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-mono text-xs font-medium text-slate-900 tabular-nums">
                                {item.reference_code}
                                {item.parcel_code ? ` · ${item.parcel_code}` : ''}
                              </p>
                              {awaitingCheckLands && (
                                <span className="px-1.5 py-0.5 rounded bg-[#FDE878] text-[#1F2421] font-semibold text-[10px]">
                                  Pending Deed Review
                                </span>
                              )}
                              {isVerifiedOnCheckLands && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[10px]">
                                  Verified on Check Lands
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-semibold text-slate-900 truncate mt-0.5">
                              {item.parcel_name}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {item.claimant_name} · {item.claimant_national_id}
                              {item.pending_listing?.price_usd != null
                                ? ` · ${formatUsdPrice(item.pending_listing.price_usd)}`
                                : ''}
                            </p>
                          </div>
                          <div className="text-right shrink-0 text-xs">
                            <p className="font-medium text-slate-800">{item.status}</p>
                            <p className="font-mono text-slate-500 tabular-nums mt-0.5">
                              {item.latest_score !== null ? `${item.latest_score}/100` : 'Unchecked'}
                            </p>
                          </div>
                        </div>
                      </button>

                      {canQuickVerify && (
                        <div className="mt-2.5 flex items-center justify-end">
                          <button
                            type="button"
                            data-testid="quick-verify-checklands-btn"
                            disabled={publishingAppId === item.id}
                            onClick={() => handleQuickPublishToCheckLands(item.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#E5CF5D] disabled:opacity-60 rounded-md whitespace-nowrap transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {publishingAppId === item.id
                                ? 'Verifying...'
                                : 'Run Ownership Check'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <aside className="lg:col-span-3 space-y-5">
            {!selectedApp ? (
              <section className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
                Select a land registration or claim from the queue to verify its deed, check Oracle matching, and publish to Check Lands.
              </section>
            ) : (
              <>
                <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-slate-500 tabular-nums">
                        {selectedApp.reference_code} · {selectedApp.status}
                      </p>
                      <h2 className="mt-0.5 font-display text-lg font-semibold text-slate-900">
                        {selectedApp.parcel_name}
                      </h2>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Claimant: <span className="font-medium text-slate-900">{selectedApp.claimant_name}</span> ·{' '}
                        <span className="font-mono">{selectedApp.claimant_national_id}</span> ·{' '}
                        <span>{selectedApp.region}</span> ·{' '}
                        <span className="font-mono tabular-nums">
                          {Number(selectedApp.area_sqm || selectedApp.declared_area_sqm || 0).toLocaleString()} m²
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canDecide &&
                        selectedApp.status !== 'REVOKED' &&
                        pendingListing?.verification_status !== 'VERIFIED' && (
                          <button
                            type="button"
                            data-testid="detail-verify-checklands-btn"
                            disabled={publishingAppId === selectedApp.id}
                            onClick={() => handleQuickPublishToCheckLands(selectedApp.id)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#E5CF5D] disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {publishingAppId === selectedApp.id
                                ? 'Verifying...'
                                : 'Run Ownership Check'}
                            </span>
                          </button>
                        )}
                      <button
                        type="button"
                        disabled={evaluating}
                        onClick={() => runEvaluation(selectedApp.id)}
                        className="px-3.5 py-2 text-xs font-medium text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        {evaluating ? 'Cross-Checking...' : 'Run Oracle Cross-Check'}
                      </button>
                    </div>
                  </div>

                  {pendingListing && (
                    <div
                      data-testid="admin-pending-checklands-banner"
                      className={`p-3 rounded-md border text-xs flex flex-wrap items-center justify-between gap-2 ${
                        isPendingCheckLandsDeed
                          ? 'bg-[#FEF9DB] border-[#E5CF5D] text-[#1F2421]'
                          : pendingListing.verification_status === 'ADMIN_REJECTED'
                          ? 'bg-red-50 border-red-200 text-red-900'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      <div>
                        <span className="font-semibold">
                          {isPendingCheckLandsDeed
                            ? 'Check Lands Publication Hold: '
                            : pendingListing.verification_status === 'ADMIN_REJECTED'
                            ? 'Check Lands Rejected: '
                            : 'Check Lands Live Status: '}
                        </span>
                        <span>
                          {isPendingCheckLandsDeed
                            ? 'Hidden from public Check Lands until Administrator verifies the uploaded land deed.'
                            : pendingListing.verification_status === 'ADMIN_REJECTED'
                            ? 'Land deed rejected by Administrator and hidden from Check Lands.'
                            : 'Deed verified and published publicly on Check Lands.'}
                        </span>
                      </div>
                      <span className="font-mono font-bold tabular-nums shrink-0">
                        {formatUsdPrice(pendingListing.price_usd)} ({pendingListing.price_pol} POL)
                      </span>
                    </div>
                  )}

                  {oracle && (
                    <>
                      <div
                        className={`p-4 rounded-md border text-xs space-y-2 ${
                          oracle.conflictDetected
                            ? 'bg-red-50/80 border-red-200 text-red-950'
                            : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-semibold text-sm">
                            {oracle.conflictDetected ? (
                              <AlertTriangle className="w-4 h-4 text-red-700" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                            )}
                            <span>
                              {oracle.conflictDetected
                                ? 'Oracle Conflict or Integrity Alert Detected'
                                : 'Oracle Ownership Verification Clean'}
                            </span>
                          </div>
                          <span className="font-mono font-semibold tabular-nums">
                            Score: {oracle.oracleMatchScore} / 100
                          </span>
                        </div>

                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-black/10">
                          <div>
                            <dt className="opacity-70">Recommended</dt>
                            <dd className="font-mono font-medium">{oracle.recommendedDecision}</dd>
                          </div>
                          <div>
                            <dt className="opacity-70">Matched Record</dt>
                            <dd className="font-mono font-medium">
                              {oracle.matchedRecord?.sourceReference || 'No archive hit'}
                            </dd>
                          </div>
                          <div>
                            <dt className="opacity-70">Docs Checked</dt>
                            <dd className="font-mono tabular-nums">
                              {oracle.documentsSummary?.intactCount ?? 0} intact /{' '}
                              {oracle.documentsSummary?.tamperedCount ?? 0} tampered
                            </dd>
                          </div>
                          <div>
                            <dt className="opacity-70">Oracle Latency</dt>
                            <dd className="font-mono tabular-nums">{oracle.executionTimeMs} ms</dd>
                          </div>
                        </dl>
                      </div>

                      {oracle.matchedRecord && (
                        <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <Database className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                              <span>Matched Sample Record: {oracle.matchedRecord.sourceReference}</span>
                            </span>
                            <span className="font-mono text-slate-600">
                              {oracle.matchedRecord.claimStatus}
                            </span>
                          </div>
                          <p className="text-slate-600">
                            Source: {oracle.matchedRecord.recordSource} · Owner:{' '}
                            {oracle.matchedRecord.registeredOwnerName} (
                            <span className="font-mono">{oracle.matchedRecord.ownerNationalId}</span>)
                          </p>
                          <p className="text-slate-500">
                            Spatial match: {String(oracle.matchedRecord.spatialMatch)} (~
                            <span className="font-mono tabular-nums">
                              {oracle.matchedRecord.overlapAreaSqm}
                            </span>{' '}
                            m²) · National ID match: {String(oracle.matchedRecord.nationalIdMatch)} ·
                            Name match: {String(oracle.matchedRecord.nameMatch)}
                          </p>
                        </div>
                      )}

                      {oracle.conflicts?.length > 0 && (
                        <div className="space-y-2">
                          <h3 className="text-xs font-semibold text-red-800">
                            Detected Conflicts ({oracle.conflicts.length})
                          </h3>
                          <ul className="space-y-2">
                            {oracle.conflicts.map((conflict, idx) => (
                              <li
                                key={`${conflict.type}-${idx}`}
                                className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-900"
                              >
                                <p className="font-mono font-semibold">
                                  {conflict.type} · Severity: {conflict.severity}
                                </p>
                                <p className="mt-1">{conflict.message}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-100">
                        <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 mb-2">
                          <FileCheck className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                          <span>
                            Uploaded Land Deeds &amp; Evidence Integrity ({oracle.documentsSummary?.totalDocuments ?? 0})
                          </span>
                        </h3>
                        {oracle.documentsSummary?.checks?.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No supporting deeds or documents uploaded to this application.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {oracle.documentsSummary.checks.map((doc) => {
                              const rawDoc = docMetadataById.get(doc.documentId);
                              const enrichedDoc = {
                                ...doc,
                                mimeType: rawDoc?.mime_type || '',
                                fileSizeBytes: rawDoc?.file_size_bytes || 0,
                              };
                              return (
                                <li
                                  key={doc.documentId}
                                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 rounded bg-slate-50 border border-slate-200 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-semibold text-slate-900 truncate">{doc.fileName}</p>
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                                        {doc.documentType}
                                      </span>
                                      {enrichedDoc.fileSizeBytes > 0 && (
                                        <span className="font-mono text-[10px] text-slate-500">
                                          {formatFileSizeKb(enrichedDoc.fileSizeBytes)}
                                        </span>
                                      )}
                                      <span
                                        className={`font-mono font-semibold text-[11px] ${
                                          doc.integrityStatus === 'TAMPERED'
                                            ? 'text-red-700'
                                            : 'text-emerald-700'
                                        }`}
                                      >
                                        {doc.integrityStatus}
                                      </span>
                                    </div>
                                    <p className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                                      SHA-256: {doc.sha256Hash}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDeed(enrichedDoc, 'preview')}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-medium text-slate-800 whitespace-nowrap"
                                    >
                                      <Eye className="w-3 h-3" aria-hidden="true" />
                                      <span>Inspect Deed</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDeed(enrichedDoc, 'download')}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-medium text-slate-800 whitespace-nowrap"
                                    >
                                      <Download className="w-3 h-3" aria-hidden="true" />
                                      <span>Download</span>
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </section>

                {canDecideSelected && (
                  <section className="bg-white border border-slate-200 rounded-lg p-5">
                    <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
                      <span>
                        {isPendingCheckLandsDeed
                          ? 'Verify Land Deed & Publish to Check Lands'
                          : 'Record Verification Decision'}
                      </span>
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {isPendingCheckLandsDeed
                        ? 'Approving validates GIS boundaries, confirms Oracle & deed integrity, mints the ERC-721 title, and makes this parcel visible on Check Lands.'
                        : 'Approvals are blocked automatically if the Oracle flags an unresolved ownership conflict or tampered document.'}
                    </p>

                    <form onSubmit={handleRecordDecision} className="mt-4 space-y-4">
                      <div>
                        <label
                          htmlFor="oracle-decision"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Verification Decision
                        </label>
                        <select
                          id="oracle-decision"
                          value={decision}
                          onChange={(e) => setDecision(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                        >
                          <option value="APPROVED">
                            {isPendingCheckLandsDeed
                              ? 'Approve Land Deed & Publish to Check Lands'
                              : 'Approve Claim (Advance to VERIFIED)'}
                          </option>
                          <option value="FLAGGED_CONFLICT">
                            Flag Ownership Conflict (Hold from Check Lands)
                          </option>
                          <option value="REJECTED">
                            Reject Verification Claim (Keep Hidden)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="oracle-remarks"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Administrator Verification Remarks
                        </label>
                        <textarea
                          id="oracle-remarks"
                          rows={3}
                          required
                          minLength={5}
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                          placeholder="Document findings from land deed inspection, SHA-256 check, or conflict review..."
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submittingDecision}
                        className="px-4 py-2 text-sm font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md"
                      >
                        {submittingDecision
                          ? 'Processing Verification...'
                          : isPendingCheckLandsDeed && decision === 'APPROVED'
                          ? 'Verify Deed & Publish to Check Lands'
                          : 'Record Verification Decision'}
                      </button>
                    </form>
                  </section>
                )}

                <section className="bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-600" aria-hidden="true" />
                    <span>Verification Activity History ({history.length})</span>
                  </h3>

                  {history.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      No verification decisions have been recorded for this application yet.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-100 text-xs">
                      {history.map((entry) => (
                        <li key={entry.id} className="py-3 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {entry.decision} · {entry.officer_name}
                            </span>
                            <span className="font-mono text-slate-500 tabular-nums">
                              Score {entry.oracle_match_score}/100 ·{' '}
                              {new Date(entry.verified_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-slate-600">{entry.remarks}</p>
                          {entry.matched_source_reference && (
                            <p className="font-mono text-slate-500">
                              Matched: {entry.matched_source_reference} ({entry.matched_record_source})
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-3.5 rounded-md bg-slate-100 border border-slate-200 text-xs text-slate-700">
            {disclaimer ||
              'Sample academic prototype institutional & community archive records only — not connected to live government registries.'}
          </div>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                    <th className="py-2.5 px-4 font-medium">Reference</th>
                    <th className="py-2.5 px-4 font-medium">Source Institution</th>
                    <th className="py-2.5 px-4 font-medium">Registered Owner</th>
                    <th className="py-2.5 px-4 font-medium">Parcel Code</th>
                    <th className="py-2.5 px-4 font-medium">Claim Status</th>
                    <th className="py-2.5 px-4 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {sampleRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        {rec.source_reference}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{rec.record_source}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{rec.registered_owner_name}</p>
                        <p className="font-mono text-slate-500">{rec.owner_national_id}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {rec.parcel_code || '—'}
                      </td>
                      <td
                        className={`py-3 px-4 font-mono font-semibold ${
                          rec.claim_status === 'DISPUTED' ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {rec.claim_status}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs">{rec.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {canAddSampleRecord && (
            <section className="bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Add Sample Archive Record (Administrator)
              </h2>
              <form onSubmit={handleAddSampleRecord} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="rec-source" className="block text-xs font-medium text-slate-700 mb-1">
                    Record Source
                  </label>
                  <input
                    id="rec-source"
                    type="text"
                    required
                    value={recordForm.recordSource}
                    onChange={(e) => setRecordForm((p) => ({ ...p, recordSource: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="rec-ref" className="block text-xs font-medium text-slate-700 mb-1">
                    Source Reference
                  </label>
                  <input
                    id="rec-ref"
                    type="text"
                    required
                    placeholder="e.g. INST-2026-004"
                    value={recordForm.sourceReference}
                    onChange={(e) => setRecordForm((p) => ({ ...p, sourceReference: e.target.value }))}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="rec-parcel" className="block text-xs font-medium text-slate-700 mb-1">
                    Parcel Code (Optional)
                  </label>
                  <input
                    id="rec-parcel"
                    type="text"
                    placeholder="e.g. ANG-PARCEL-1004"
                    value={recordForm.parcelCode}
                    onChange={(e) => setRecordForm((p) => ({ ...p, parcelCode: e.target.value }))}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="rec-owner" className="block text-xs font-medium text-slate-700 mb-1">
                    Registered Owner Name
                  </label>
                  <input
                    id="rec-owner"
                    type="text"
                    required
                    value={recordForm.registeredOwnerName}
                    onChange={(e) =>
                      setRecordForm((p) => ({ ...p, registeredOwnerName: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="rec-nid" className="block text-xs font-medium text-slate-700 mb-1">
                    Owner National ID
                  </label>
                  <input
                    id="rec-nid"
                    type="text"
                    required
                    value={recordForm.ownerNationalId}
                    onChange={(e) =>
                      setRecordForm((p) => ({ ...p, ownerNationalId: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="rec-status" className="block text-xs font-medium text-slate-700 mb-1">
                    Claim Status
                  </label>
                  <select
                    id="rec-status"
                    value={recordForm.claimStatus}
                    onChange={(e) => setRecordForm((p) => ({ ...p, claimStatus: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="ACTIVE_RECORD">ACTIVE_RECORD</option>
                    <option value="DISPUTED">DISPUTED</option>
                    <option value="HISTORICAL">HISTORICAL</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="rec-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Archive Notes
                  </label>
                  <input
                    id="rec-notes"
                    type="text"
                    value={recordForm.notes}
                    onChange={(e) => setRecordForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Context for oracle matching..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={savingRecord}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md"
                  >
                    {savingRecord ? 'Saving Record...' : 'Add Sample Archive Record'}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {deedPreview.doc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect deed ${deedPreview.doc.fileName}`}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-slate-900 truncate">
                  {deedPreview.doc.fileName}
                </h2>
                <p className="font-mono text-[11px] text-slate-500 truncate">
                  {deedPreview.doc.documentType} · SHA-256: {deedPreview.doc.sha256Hash}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDeedPreview}
                aria-label="Close deed preview"
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 bg-slate-50">
              {deedPreview.loading ? (
                <p className="text-xs text-slate-500 py-8 text-center">Loading uploaded deed document...</p>
              ) : deedPreview.error ? (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                  {deedPreview.error}
                </p>
              ) : deedPreview.textContent ? (
                <pre className="p-4 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-800 whitespace-pre-wrap break-words">
                  {deedPreview.textContent}
                </pre>
              ) : deedPreview.mimeType.startsWith('image/') && deedPreview.url ? (
                <img
                  src={deedPreview.url}
                  alt={deedPreview.doc.fileName}
                  className="max-h-[60vh] mx-auto rounded-md border border-slate-200 bg-white"
                />
              ) : deedPreview.url ? (
                <iframe
                  title={deedPreview.doc.fileName}
                  src={deedPreview.url}
                  className="w-full h-[60vh] rounded-md border border-slate-200 bg-white"
                />
              ) : null}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center justify-end gap-2">
              {deedPreview.url && (
                <a
                  href={deedPreview.url}
                  download={deedPreview.doc.fileName}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#1F2421] text-white hover:bg-black text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download File</span>
                </a>
              )}
              <button
                type="button"
                onClick={closeDeedPreview}
                className="px-3.5 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
