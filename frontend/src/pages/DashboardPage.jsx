import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';

const STATUS_LABELS = {
  SUBMITTED: 'Submitted',
  SURVEYOR_REVIEW: 'In progress',
  AWAITING_GIS_REVIEW: 'In progress',
  GIS_REJECTED: 'Changes requested',
  CORRECTION_REQUIRED: 'Changes requested',
  GIS_VALIDATED: 'Location checked',
  VERIFICATION_REJECTED: 'Changes requested',
  VERIFIED: 'Verified',
  AWAITING_LEGAL_REVIEW: 'In progress',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  TITLE_ISSUED: 'Title issued',
  REVOKED: 'Revoked',
};

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status.replaceAll('_', ' ').toLowerCase();
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [summaryResult, applicationsResult] = await Promise.all([
          api.get('/dashboard/summary'),
          api.get('/applications'),
        ]);
        if (active) {
          setSummary(summaryResult.data);
          setApplications(applicationsResult.data.applications || []);
        }
      } catch (err) {
        if (active) {
          setError(err.response?.data?.error || 'Unable to load your dashboard.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const recentApplications = [...applications]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 4);
  const metrics = summary?.metrics;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Your account</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
              Welcome, {user?.fullName}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Track your land applications and find available land in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/applications?tab=new"
              className="px-4 py-2 text-sm font-medium text-white bg-[#1F2421] hover:bg-black rounded-md transition-colors"
            >
              Start an application
            </Link>
            <Link
              to="/marketplace"
              className="px-4 py-2 text-sm font-medium text-[#1F2421] bg-[#FDE878] border border-[#E5CF5D] hover:bg-[#f7de59] rounded-md transition-colors"
            >
              Browse land
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-4 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <section aria-labelledby="account-summary-heading">
        <h2 id="account-summary-heading" className="text-sm font-semibold text-slate-700 mb-3">
          Your account at a glance
        </h2>
        <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Applications</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {loading ? '—' : metrics?.totalApplications ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Active titles</p>
            <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {loading ? '—' : metrics?.activeTitles ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">Available listings</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {loading ? '—' : metrics?.openMarketplaceListings ?? 0}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">Recent applications</h2>
            <p className="mt-0.5 text-xs text-slate-500">Updates for applications submitted from your account.</p>
          </div>
          <Link to="/applications" className="text-sm font-medium text-slate-800 underline whitespace-nowrap">
            View all
          </Link>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Loading your applications...</p>
        ) : recentApplications.length === 0 ? (
          <div className="p-5">
            <p className="text-sm text-slate-600">You have not submitted a land application yet.</p>
            <Link to="/applications?tab=new" className="inline-block mt-2 text-sm font-medium underline">
              Start your first application
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentApplications.map((application) => (
              <li
                key={application.id}
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{application.parcel_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {application.reference_code} · {application.region}
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-600">
                  {getStatusLabel(application.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Application status is for tracking only. A submission does not by itself establish legal ownership.
      </p>
    </div>
  );
}
