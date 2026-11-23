import { useEffect, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { adminApi } from '../services/adminApi.js';
import { shortenAddress } from '../services/walletService.js';

export default function AdminUserManagementPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = async () => {
    try {
      const { data } = await adminApi.get('/users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load registered accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleToggleUserStatus = async (userId, currentIsActive) => {
    setError('');
    try {
      await adminApi.patch(`/users/${userId}`, { isActive: !currentIsActive });
      await loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update citizen access.');
    }
  };

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.fullName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.roleName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Registered Citizen Accounts
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Monitor public landowner accounts and control active access. Additional admin or official accounts are disabled.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#FEF7D1] border border-[#E5CF5D] text-xs font-medium text-[#1F2421] self-start">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Single Designated Admin Enforced</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Registered Accounts ({filtered.length})
          </h2>
          <input
            type="search"
            aria-label="Filter registered accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or role..."
            className="w-full sm:w-64 px-3 py-1.5 text-sm border border-slate-300 rounded-md"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <th className="py-2.5 px-4 font-medium">Account</th>
                <th className="py-2.5 px-4 font-medium">Account Type</th>
                <th className="py-2.5 px-4 font-medium">Wallet</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium text-right">Access Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-slate-500">
                    Loading user accounts...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-slate-500">
                    No registered accounts found yet.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const isSoleAdmin = u.roleCode === 'LAND_ADMIN';
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{u.fullName}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded font-mono font-semibold whitespace-nowrap ${
                            isSoleAdmin
                              ? 'bg-[#1F2421] text-[#FDE878]'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {isSoleAdmin ? 'Sole Administrator' : 'Citizen / Landowner'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                        {shortenAddress(u.walletAddress)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <span className={u.isActive ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isSoleAdmin ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-500 bg-slate-100 rounded border border-slate-200">
                            <Lock className="w-3 h-3" aria-hidden="true" />
                            <span>Protected</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleUserStatus(u.id, u.isActive)}
                            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-100 transition-colors"
                          >
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
