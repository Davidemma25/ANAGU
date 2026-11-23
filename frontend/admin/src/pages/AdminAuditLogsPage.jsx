import { useEffect, useState } from 'react';
import { adminApi } from '../services/adminApi.js';

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await adminApi.get('/audit-logs?limit=150');
        if (active) setLogs(data.logs);
      } catch (err) {
        if (active) setError(err.response?.data?.error || 'Failed to load audit logs.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const filtered = logs.filter((entry) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      entry.action.toLowerCase().includes(q) ||
      (entry.actor_name || '').toLowerCase().includes(q) ||
      (entry.actor_role || '').toLowerCase().includes(q) ||
      (entry.entity_type || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Audit &amp; Activity History
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Chronological, append-only record of authentication, access control, parcel verification, and title actions.
          </p>
        </div>
        <input
          type="search"
          aria-label="Filter audit logs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter action, actor, or role..."
          className="w-full sm:w-64 px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
        />
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <th className="py-2.5 px-4 font-medium">Timestamp</th>
                <th className="py-2.5 px-4 font-medium">Actor</th>
                <th className="py-2.5 px-4 font-medium">Action</th>
                <th className="py-2.5 px-4 font-medium">Target</th>
                <th className="py-2.5 px-4 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-slate-500">
                    Loading audit log entries...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-slate-500">
                    No audit entries recorded yet.
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="text-xs font-medium text-slate-900">{entry.actor_name}</p>
                      <p className="text-xs text-slate-500">{entry.actor_role}</p>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-800">{entry.action}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {entry.entity_type} #{entry.entity_id}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 max-w-xs truncate">
                      {JSON.stringify(entry.details)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
