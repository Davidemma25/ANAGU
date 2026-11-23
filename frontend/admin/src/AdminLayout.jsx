import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Award,
  Bell,
  FlaskConical,
  Gavel,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAdminAuth } from './context/AdminAuthContext.jsx';
import { adminApi } from './services/adminApi.js';
import { shortenAddress } from './services/walletService.js';
import { ADMIN_PAGE_TITLES, getAdminNavigation } from './adminConfig';

const ICON_MAP = {
  dashboard: LayoutDashboard,
  users: Users,
  gis: Map,
  oracle: ShieldCheck,
  titles: Award,
  revocations: Gavel,
  audit: ScrollText,
  evaluation: FlaskConical,
  notifications: Bell,
  wallet: Wallet,
};

export default function AdminLayout({ children }) {
  const { user, walletInfo, logout } = useAdminAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    async function refreshUnread() {
      try {
        const { data } = await adminApi.get('/notifications');
        if (active) {
          setUnreadCount(Number(data?.stats?.unreadCount || 0));
        }
      } catch {
        // non-blocking sidebar badge
      }
    }
    refreshUnread();
    const handler = () => refreshUnread();
    window.addEventListener('anagu:notifications-updated', handler);
    return () => {
      active = false;
      window.removeEventListener('anagu:notifications-updated', handler);
    };
  }, [location.pathname]);

  const navItems = getAdminNavigation(user?.roleCode);
  const currentTitle = ADMIN_PAGE_TITLES[location.pathname] || 'Admin Console';
  const linkedWallet = walletInfo?.address || user?.walletAddress;

  const handleSignOut = () => {
    logout();
    navigate('/admin/login');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex bg-slate-50 text-slate-900">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[55] bg-slate-950/45 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed lg:sticky inset-y-0 lg:top-16 left-0 z-[60] lg:z-auto w-64 lg:h-[calc(100vh-4rem)] bg-[#1F2421] text-slate-100 flex flex-col border-r border-[#2D312E] transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#2D312E] shrink-0">
          <Link
            to="/admin"
            className="flex items-center gap-2 font-display text-sm font-bold tracking-wide uppercase text-[#FDE878] whitespace-nowrap"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Admin Console</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded text-slate-300 hover:text-white"
            aria-label="Close admin navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Admin console navigation" className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = ICON_MAP[item.iconKey] || LayoutDashboard;
            const showBadge = item.iconKey === 'notifications' && unreadCount > 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[#FDE878] text-[#1F2421] font-semibold'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {showBadge && (
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          isActive ? 'text-[#1F2421]' : 'text-[#FDE878]'
                        }`}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-[#2D312E] space-y-2.5 shrink-0">
          <div className="text-xs">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#FDE878]">
              SOLE ADMINISTRATOR
            </p>
            <p className="font-medium text-white truncate mt-0.5">{user?.fullName}</p>
            <p className="text-slate-400 truncate mt-0.5">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-white bg-[#2D312E] hover:bg-black border border-white/10 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out of Admin</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-12 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200"
              aria-label="Open admin console menu"
            >
              <Menu className="w-4 h-4" />
              <span className="md:hidden">Console</span>
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
              <span className="hidden sm:inline font-mono uppercase tracking-wider text-[#1F2421] font-semibold whitespace-nowrap">
                Admin Console
              </span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-medium text-[#1F2421] truncate">{currentTitle}</span>
            </div>
          </div>

          <Link
            to="/admin/profile"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#E5CF5D] bg-[#FEF7D1] hover:bg-[#FDE878] text-xs font-medium text-[#1F2421] whitespace-nowrap shrink-0 transition-colors"
          >
            <Wallet className="w-3.5 h-3.5 text-[#1F2421]" aria-hidden="true" />
            <span className="font-mono tabular-nums">
              {linkedWallet ? shortenAddress(linkedWallet) : 'Admin Wallet'}
            </span>
          </Link>
        </div>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">{children}</main>

        <footer className="border-t border-slate-200 bg-white px-4 sm:px-6 py-3">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-500">
            <span>ANAGU Single-Administrator Land Administration Console</span>
            <span>Dedicated Admin Backend &amp; Frontend · Sole-Admin Lock Active</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
