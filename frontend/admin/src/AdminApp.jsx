import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Menu, ShieldCheck, X } from 'lucide-react';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext.jsx';
import { ADMIN_NAV_ITEMS, isAdminRole } from './adminConfig';
import { shortenAddress } from './services/walletService.js';
import AdminLayout from './AdminLayout.jsx';
import AdminRouteGuard from './AdminRouteGuard.jsx';
import AdminLoginPage from './pages/AdminLoginPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import AdminUserManagementPage from './pages/AdminUserManagementPage.jsx';
import AdminGisValidationPage from './pages/AdminGisValidationPage.jsx';
import AdminVerificationPage from './pages/AdminVerificationPage.jsx';
import AdminTitleIssuancePage from './pages/AdminTitleIssuancePage.jsx';
import AdminRevocationPage from './pages/AdminRevocationPage.jsx';
import AdminAuditLogsPage from './pages/AdminAuditLogsPage.jsx';
import AdminEvaluationPage from './pages/AdminEvaluationPage.jsx';
import AdminNotificationsPage from './pages/AdminNotificationsPage.jsx';
import AdminProfileWalletPage from './pages/AdminProfileWalletPage.jsx';

function AdminStickyHeader() {
  const { user, walletInfo } = useAdminAuth();
  const isAdmin = isAdminRole(user?.roleCode);
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const linkedWallet = walletInfo?.address || user?.walletAddress;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const adminNavLinks = isAdmin
    ? ADMIN_NAV_ITEMS.filter((item) =>
        ['/admin', '/admin/users', '/admin/gis-validation', '/admin/verification', '/admin/titles'].includes(item.to)
      )
    : [];

  return (
    <header className="sticky top-0 z-50 border-b bg-[#FDE878]/95 backdrop-blur-xs text-[#1F2421] border-[#E5CF5D]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <Link
            to={isAdmin ? '/admin' : '/admin/login'}
            className="inline-flex items-center gap-2 shrink-0 whitespace-nowrap hover:opacity-85 transition-opacity"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="shrink-0"
            >
              <path
                d="M12 2L20 6.5V17.5L12 22L4 17.5V6.5L12 2Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M12 7V17M7.5 9.5L12 12L16.5 9.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-editorial text-lg sm:text-xl font-bold tracking-tight">ANAGU</span>
          </Link>

          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1F2421] text-[#FDE878] font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
            <ShieldCheck className="w-3 h-3" aria-hidden="true" />
            <span>Admin Console</span>
          </span>
        </div>

        {isAdmin && (
          <nav
            aria-label="Admin console header navigation"
            className="hidden md:flex items-center gap-5 text-xs sm:text-sm font-medium"
          >
            {adminNavLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `whitespace-nowrap transition-opacity ${
                    isActive
                      ? 'underline underline-offset-4 font-semibold text-[#1F2421]'
                      : 'text-[#1F2421]/80 hover:text-[#1F2421]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isAdmin ? (
            <Link
              to="/admin/profile"
              className="hidden sm:inline-flex px-3.5 py-2 text-xs font-mono font-medium rounded-xs border border-[#1F2421] bg-[#1F2421] text-[#FDE878] hover:bg-black whitespace-nowrap transition-colors"
            >
              {linkedWallet ? shortenAddress(linkedWallet) : 'ADMIN'}
            </Link>
          ) : (
            <Link
              to="/"
              className="hidden sm:inline-flex px-3 py-1.5 text-xs font-medium rounded-xs border border-[#1F2421] text-[#1F2421] hover:bg-[#1F2421]/5 whitespace-nowrap transition-colors"
            >
              Public Land Portal
            </Link>
          )}

          {!isAdmin && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-controls="admin-mobile-menu-bar"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xs border border-[#1F2421]/40 bg-[#1F2421]/5 text-[#1F2421] hover:bg-[#1F2421]/10 whitespace-nowrap transition-colors"
            >
              {mobileMenuOpen ? (
                <X className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>Menu</span>
            </button>
          )}
        </div>
      </div>

      {mobileMenuOpen && !isAdmin && (
        <nav
          id="admin-mobile-menu-bar"
          aria-label="Admin mobile navigation menu"
          className="md:hidden px-4 py-3 border-t border-[#E5CF5D] bg-[#FDE878] text-[#1F2421] space-y-1.5 shadow-sm"
        >
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-center px-3 py-2 text-xs font-semibold border border-[#1F2421] text-[#1F2421] rounded-xs"
          >
            Public Land Portal
          </Link>
        </nav>
      )}
    </header>
  );
}

function ProtectedAdminView({ children }) {
  return (
    <AdminRouteGuard>
      <AdminLayout>{children}</AdminLayout>
    </AdminRouteGuard>
  );
}

export function AdminPortalContent() {
  return (
    <AdminAuthProvider>
      <AdminStickyHeader />
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route
          path=""
          element={
            <ProtectedAdminView>
              <AdminDashboardPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedAdminView>
              <AdminUserManagementPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="gis-validation"
          element={
            <ProtectedAdminView>
              <AdminGisValidationPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="verification"
          element={
            <ProtectedAdminView>
              <AdminVerificationPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="titles"
          element={
            <ProtectedAdminView>
              <AdminTitleIssuancePage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="revocations"
          element={
            <ProtectedAdminView>
              <AdminRevocationPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="audit-logs"
          element={
            <ProtectedAdminView>
              <AdminAuditLogsPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="evaluation"
          element={
            <ProtectedAdminView>
              <AdminEvaluationPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="notifications"
          element={
            <ProtectedAdminView>
              <AdminNotificationsPage />
            </ProtectedAdminView>
          }
        />
        <Route
          path="profile"
          element={
            <ProtectedAdminView>
              <AdminProfileWalletPage />
            </ProtectedAdminView>
          }
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}

export default function AdminApp() {
  return (
    <BrowserRouter basename="/admin">
      <AdminPortalContent />
    </BrowserRouter>
  );
}
