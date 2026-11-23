import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';
import OsmParcelPicker from '../components/OsmParcelPicker.jsx';
import GeographicLocationSelector from '../components/GeographicLocationSelector.jsx';
import { computeAreaFromPointsSqm, parseRingToLatLngPoints } from '../utils/osmMap.js';
import { APPLICATION_STATUS_LABELS as WORKFLOW_STATUS_LABELS } from '../../../backend/src/services/applicationWorkflow.js';

const APPLICATION_STATUS_LABELS = {
  ...WORKFLOW_STATUS_LABELS,
  SURVEYOR_REVIEW: 'In progress',
  AWAITING_GIS_REVIEW: 'In progress',
  GIS_REJECTED: 'Changes requested',
  CORRECTION_REQUIRED: 'Changes requested',
  GIS_VALIDATED: 'Location checked',
  VERIFICATION_REJECTED: 'Changes requested',
  VERIFIED: 'Verified',
  AWAITING_LEGAL_REVIEW: 'In progress',
  REJECTED: 'Not approved',
};

const STATUS_FILTERS = [
  { value: 'SUBMITTED', label: 'Submitted', statuses: ['SUBMITTED'] },
  {
    value: 'IN_PROGRESS',
    label: 'In progress',
    statuses: ['SURVEYOR_REVIEW', 'AWAITING_GIS_REVIEW', 'AWAITING_LEGAL_REVIEW'],
  },
  { value: 'LOCATION_CHECKED', label: 'Location checked', statuses: ['GIS_VALIDATED'] },
  { value: 'VERIFIED', label: 'Verified', statuses: ['VERIFIED'] },
  { value: 'APPROVED', label: 'Approved', statuses: ['APPROVED'] },
  { value: 'TITLE_ISSUED', label: 'Title issued', statuses: ['TITLE_ISSUED'] },
  {
    value: 'CHANGES_REQUESTED',
    label: 'Changes requested',
    statuses: ['GIS_REJECTED', 'CORRECTION_REQUIRED', 'VERIFICATION_REJECTED'],
  },
  { value: 'NOT_APPROVED', label: 'Not approved', statuses: ['REJECTED'] },
  { value: 'REVOKED', label: 'Revoked', statuses: ['REVOKED'] },
];

export default function ApplicationsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const focusLocation = useMemo(() => {
    const rawLat = searchParams.get('lat');
    const rawLng = searchParams.get('lng');
    if (rawLat === null || rawLng === null) return null;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    return { lat, lng };
  }, [searchParams]);

  const requestedNewTab = searchParams.get('tab') === 'new';

  const [activeTab, setActiveTab] = useState(requestedNewTab ? 'new' : 'list');
  const [applications, setApplications] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [boundaryHistory, setBoundaryHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [statusHistory, setStatusHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const [form, setForm] = useState({
    parcelName: '',
    locationDescription: focusLocation
      ? `GPS origin ${focusLocation.lat.toFixed(5)}, ${focusLocation.lng.toFixed(5)}`
      : '',
    region: '',
    declaredAreaSqm: '',
    ownershipType: 'FREEHOLD',
    claimantName: user?.fullName?.replace(/\s*\(Sample.*?\)/i, '') || '',
    claimantNationalId: user?.nationalId || '',
    coordinatesText: '[]',
    stateId: '',
    lgaId: '',
    communityId: '',
    boundarySource: null,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (requestedNewTab) {
      setActiveTab('new');
    }
  }, [requestedNewTab]);

  const [docType, setDocType] = useState('DEED_OF_CONVEYANCE');
  const [docFile, setDocFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const loadApplications = async () => {
    try {
      const appsRes = await api.get('/applications');
      setApplications(appsRes.data.applications || []);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Unable to load land applications.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, []);

  const loadDetail = async (appId) => {
    try {
      const { data } = await api.get(`/applications/${appId}`);
      setSelectedApp(data.application);
      setDocuments(data.documents || []);
      setStatusHistory(data.statusHistory || []);
      setHistoryLoading(true);
      try {
        const historyResponse = await api.get(`/gis/applications/${appId}/boundary-history`);
        setBoundaryHistory(historyResponse.data.versions || []);
      } catch (historyError) {
        setBoundaryHistory([]);
        setFeedback({
          type: 'error',
          text: historyError.response?.data?.error || 'Failed to load boundary history.',
        });
      } finally {
        setHistoryLoading(false);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to load application details.',
      });
    }
  };

  const handleBoundaryTextChange = (coordinatesText, boundarySource = 'MANUAL_GPS') => {
    const points = parseRingToLatLngPoints(coordinatesText);
    const areaSqm = points && points.length >= 3 ? computeAreaFromPointsSqm(points) : 0;
    setForm((prev) => ({
      ...prev,
      coordinatesText,
      boundarySource,
      declaredAreaSqm: areaSqm > 0 ? String(areaSqm) : '',
    }));
  };

  const handleSubmitApplication = async (e) => {
    e.preventDefault();
    setFeedback({ type: '', text: '' });

    let parsedCoords;
    try {
      parsedCoords = JSON.parse(form.coordinatesText);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Coordinates must be valid JSON (array of [longitude, latitude] pairs or GeoJSON Polygon).',
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/applications', {
        parcelName: form.parcelName,
        locationDescription: form.locationDescription,
        region: form.region,
        declaredAreaSqm: Number(form.declaredAreaSqm),
        ownershipType: form.ownershipType,
        claimantName: form.claimantName,
        claimantNationalId: form.claimantNationalId,
        coordinates: parsedCoords,
        stateId: form.stateId || null,
        lgaId: form.lgaId || null,
        communityId: form.communityId || null,
        boundarySource: form.boundarySource,
      });

      setFeedback({
        type: 'success',
        text: `Application ${data.application.reference_code} submitted. Upload supporting documents below.`,
      });
      await loadApplications();
      await loadDetail(data.application.id);
      setActiveTab('list');
      setForm((prev) => ({ ...prev, parcelName: '', locationDescription: '', region: '' }));
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to submit application.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadDocument = async (e) => {
    e.preventDefault();
    if (!selectedApp || !docFile) return;

    setFeedback({ type: '', text: '' });
    setUploading(true);
    try {
      const payload = new FormData();
      payload.append('documentType', docType);
      payload.append('document', docFile);

      const { data } = await api.post(`/applications/${selectedApp.id}/documents`, payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setFeedback({
        type: 'success',
        text: `Uploaded ${data.document.file_name} (SHA-256 verified).`,
      });
      setDocFile(null);
      await loadDetail(selectedApp.id);
      await loadApplications();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to upload supporting document.',
      });
    } finally {
      setUploading(false);
    }
  };

  const filteredApps = applications.filter((app) => {
    const selectedFilter = STATUS_FILTERS.find((filter) => filter.value === statusFilter);
    if (selectedFilter && !selectedFilter.statuses.includes(app.status)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      app.reference_code.toLowerCase().includes(q) ||
      app.parcel_name.toLowerCase().includes(q) ||
      app.claimant_name.toLowerCase().includes(q) ||
      app.region.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Land Applications &amp; Registration
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Submit parcel claims with boundary coordinates, attach SHA-256 hashed evidence, and track verification status.
          </p>
        </div>

        <div className="flex flex-wrap sm:inline-flex items-center gap-1 p-1 bg-[#FDE878]/50 border border-[#E5CF5D] rounded-lg self-start max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`px-3 sm:px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'list'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            Track Applications
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            className={`px-3 sm:px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'new'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            New Application
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

      {activeTab === 'new' ? (
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Submit Land Registration Application
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Polygon coordinates must use WGS84 [longitude, latitude] pairs with matching start and end vertices.
          </p>

          <form onSubmit={handleSubmitApplication} className="mt-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="app-parcel-name" className="block text-sm font-medium text-slate-700 mb-1">
                  Parcel Title / Plot Name
                </label>
                <input
                  id="app-parcel-name"
                  type="text"
                  required
                  value={form.parcelName}
                  onChange={(e) => setForm((p) => ({ ...p, parcelName: e.target.value }))}
                  placeholder="e.g. Plot A Residential Zone 1"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="app-region" className="block text-sm font-medium text-slate-700 mb-1">
                  Region / Municipality
                </label>
                <input
                  id="app-region"
                  type="text"
                  required
                  value={form.region}
                  onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))}
                  placeholder="e.g. Zone 1 District"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div>
              <label htmlFor="app-location" className="block text-sm font-medium text-slate-700 mb-1">
                Location Description &amp; Landmarks
              </label>
              <input
                id="app-location"
                type="text"
                required
                value={form.locationDescription}
                onChange={(e) => setForm((p) => ({ ...p, locationDescription: e.target.value }))}
                placeholder="Street, survey beacon, and adjacent landmarks"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>

            <GeographicLocationSelector
              value={form}
              onChange={(location) => setForm((prev) => ({ ...prev, ...location }))}
            />

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label htmlFor="app-area" className="block text-sm font-medium text-slate-700 mb-1">
                  Declared Area (m²)
                </label>
                <input
                  id="app-area"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={form.declaredAreaSqm}
                  onChange={(e) => setForm((p) => ({ ...p, declaredAreaSqm: e.target.value }))}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                />
                {Number(form.declaredAreaSqm) > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {(Number(form.declaredAreaSqm) / 10000).toFixed(2)} ha ·{' '}
                    {(Number(form.declaredAreaSqm) / 4046.8564224).toFixed(2)} acres
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="app-ownership" className="block text-sm font-medium text-slate-700 mb-1">
                  Ownership Type
                </label>
                <select
                  id="app-ownership"
                  value={form.ownershipType}
                  onChange={(e) => setForm((p) => ({ ...p, ownershipType: e.target.value }))}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="FREEHOLD">Freehold</option>
                  <option value="CUSTOMARY">Customary</option>
                  <option value="LEASEHOLD">Leasehold</option>
                  <option value="FAMILY_TRUST">Family Trust</option>
                </select>
              </div>
              <div>
                <label htmlFor="app-claimant" className="block text-sm font-medium text-slate-700 mb-1">
                  Claimant Legal Name
                </label>
                <input
                  id="app-claimant"
                  type="text"
                  required
                  value={form.claimantName}
                  onChange={(e) => setForm((p) => ({ ...p, claimantName: e.target.value }))}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="app-claimant-id" className="block text-sm font-medium text-slate-700 mb-1">
                  Claimant National ID
                </label>
                <input
                  id="app-claimant-id"
                  type="text"
                  required
                  value={form.claimantNationalId}
                  onChange={(e) => setForm((p) => ({ ...p, claimantNationalId: e.target.value }))}
                  className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="block text-sm font-medium text-slate-700">
                    Interactive OpenStreetMap Parcel Boundary Picker
                  </span>
                  <p className="text-xs text-slate-500">
                    Search any place or click points directly on OpenStreetMap to draw your parcel corners, drag numbered markers to refine, or edit the JSON ring below.
                  </p>
                </div>
              </div>

              <OsmParcelPicker
                coordinatesText={form.coordinatesText}
                focusLocation={focusLocation}
                onChangeCoordinates={handleBoundaryTextChange}
                onSyncAreaSqm={(nextArea) =>
                  setForm((p) => ({ ...p, declaredAreaSqm: nextArea }))
                }
              />

              <div>
                <label htmlFor="app-coords" className="block text-xs font-medium text-slate-600 mb-1">
                  Boundary Coordinates (JSON [lng, lat] Ring)
                </label>
                <textarea
                  id="app-coords"
                  rows={5}
                  required
                  value={form.coordinatesText}
                  onChange={(e) => handleBoundaryTextChange(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-60 rounded-md transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Application'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Applications Table */}
          <section className="lg:col-span-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 justify-between">
              <input
                type="search"
                aria-label="Search applications"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search reference, parcel, or claimant..."
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md"
              />
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="ALL">All Statuses</option>
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                    <th className="py-2.5 px-4 font-medium">Reference &amp; Parcel</th>
                    <th className="py-2.5 px-4 font-medium">Claimant</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Docs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="py-6 px-4 text-center text-slate-500">
                        Loading applications...
                      </td>
                    </tr>
                  ) : filteredApps.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 px-4 text-center text-slate-500">
                        <p>No land applications found.</p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('new')}
                          className="mt-3 px-4 py-2 text-xs font-medium text-white bg-[#1F2421] hover:bg-black rounded-md transition-colors"
                        >
                          Submit First Land Application
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredApps.map((app) => (
                      <tr
                        key={app.id}
                        className={`hover:bg-slate-50/80 ${
                          selectedApp?.id === app.id ? 'bg-slate-100/70' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => loadDetail(app.id)}
                            className="text-left hover:underline"
                          >
                            <p className="font-mono text-xs font-medium text-slate-900 tabular-nums">
                              {app.reference_code}
                            </p>
                            <p className="text-sm font-medium text-slate-800">{app.parcel_name}</p>
                          </button>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <p className="font-medium text-slate-800">{app.claimant_name}</p>
                          <p>{app.region}</p>
                        </td>
                        <td className="py-3 px-4 text-xs font-medium text-slate-700">
                          <p>{APPLICATION_STATUS_LABELS[app.status] || app.status}</p>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-600">
                          {app.document_count ?? 0}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detail & Supporting Documents Panel */}
          <aside className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5">
            {!selectedApp ? (
              <div className="py-8 text-center text-sm text-slate-500">
                Select an application from the table to inspect boundary coordinates and upload supporting documents.
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="font-mono text-xs text-slate-500 tabular-nums">
                    {selectedApp.reference_code} · {APPLICATION_STATUS_LABELS[selectedApp.status] || selectedApp.status}
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold text-slate-900">
                    {selectedApp.parcel_name}
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">{selectedApp.location_description}</p>
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-3 border-t border-slate-100">
                  <div>
                    <dt className="text-slate-500">Claimant</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">{selectedApp.claimant_name}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">National ID</dt>
                    <dd className="font-mono text-slate-900 mt-0.5">{selectedApp.claimant_national_id}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Ownership Type</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">{selectedApp.ownership_type}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Declared Area</dt>
                    <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                      {selectedApp.declared_area_sqm} m²
                    </dd>
                  </div>
                </dl>

                <section className="pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">Application status history</h3>
                  {statusHistory.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No status changes recorded yet.</p>
                  ) : (
                    <ol className="mt-2 space-y-2">
                      {statusHistory.map((entry) => (
                        <li
                          key={entry.id}
                          className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs"
                        >
                          <p className="font-medium text-slate-800">
                            {entry.from_status
                              ? `${APPLICATION_STATUS_LABELS[entry.from_status] || entry.from_status} → `
                              : ''}
                            {APPLICATION_STATUS_LABELS[entry.to_status] || entry.to_status}
                          </p>
                          <p className="mt-0.5 text-slate-600">{entry.reason}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                            {entry.actor_name || 'ANAGU record'} · {new Date(entry.created_at).toLocaleString()}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section className="pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">Boundary history</h3>
                  {historyLoading ? (
                    <p className="mt-2 text-xs text-slate-500">Loading boundary versions...</p>
                  ) : boundaryHistory.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No boundary versions recorded.</p>
                  ) : (
                    <ol className="mt-2 space-y-2">
                      {boundaryHistory.map((version) => (
                        <li
                          key={version.id}
                          className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs"
                        >
                          <p className="font-medium text-slate-800">
                            Version {version.version_number}
                            {version.boundary_source ? ` · ${version.boundary_source}` : ''}
                          </p>
                          <p className="mt-0.5 text-slate-600">{version.change_reason}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                            {new Date(version.created_at).toLocaleString()}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                {/* Supporting Documents List */}
                <div className="pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-600" aria-hidden="true" />
                    <span>Supporting Documents ({documents.length})</span>
                  </h3>

                  <ul className="mt-3 space-y-2">
                    {documents.length === 0 ? (
                      <li className="text-xs text-slate-500">No supporting documents uploaded yet.</li>
                    ) : (
                      documents.map((doc) => (
                        <li
                          key={doc.id}
                          className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-xs"
                        >
                          <p className="font-medium text-slate-900 truncate">{doc.file_name}</p>
                          <p className="text-slate-500 mt-0.5">{doc.document_type}</p>
                          <p className="font-mono text-[11px] text-slate-500 truncate mt-1">
                            SHA-256: {doc.sha256_hash}
                          </p>
                        </li>
                      ))
                    )}
                  </ul>

                  <form onSubmit={handleUploadDocument} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                      <p className="text-xs font-semibold text-slate-800">Upload Evidence Document</p>
                      <div>
                        <label htmlFor="doc-type" className="block text-xs text-slate-600 mb-1">
                          Document Type
                        </label>
                        <select
                          id="doc-type"
                          value={docType}
                          onChange={(e) => setDocType(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                        >
                          <option value="DEED_OF_CONVEYANCE">Deed of Conveyance</option>
                          <option value="SURVEY_PLAN">Survey Plan</option>
                          <option value="COMMUNITY_LETTER">Community Endorsement Letter</option>
                          <option value="TAX_RECEIPT">Land Tax Receipt</option>
                          <option value="ID_DOCUMENT">National ID Copy</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="doc-file" className="block text-xs text-slate-600 mb-1">
                          File (PDF, PNG, JPEG, TXT, JSON — max 5 MB)
                        </label>
                        <input
                          id="doc-file"
                          type="file"
                          required
                          accept=".pdf,.png,.jpg,.jpeg,.txt,.json"
                          onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                          className="w-full text-xs text-slate-600"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={uploading || !docFile}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{uploading ? 'Hashing & Uploading...' : 'Upload Document'}</span>
                      </button>
                  </form>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
