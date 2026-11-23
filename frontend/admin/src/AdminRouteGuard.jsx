import { Navigate, useLocation } from 'react-router-dom';
import { useAdminAuth } from './context/AdminAuthContext.jsx';
import { isAdminRole } from './adminConfig';

export default function AdminRouteGuard({ children }) {
  const { user, loading, logout } = useAdminAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
        Verifying administrator session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (!isAdminRole(user.roleCode)) {
    return (
      <div className="max-w-xl mx-auto mt-12 px-4">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-red-700 font-semibold">
            Administrator Access Only
          </p>
          <h2 className="mt-1 font-display text-lg font-bold text-[#1F2421]">
            Admin Console Restricted
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            This console is restricted exclusively to the designated platform administrator. Public
            accounts cannot access registry administration, GIS validation, NFT issuance, or registry
            configuration controls.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-[#1F2421] rounded-md hover:bg-black transition-colors"
            >
              Sign Out &amp; Switch Account
            </button>
            <a
              href="/"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-[#1F2421] border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
            >
              Return to Public Land Portal
            </a>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
