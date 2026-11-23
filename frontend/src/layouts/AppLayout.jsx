import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Wallet, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { shortenAddress } from '../services/walletService.js';

const PAGE_TITLES = {
  '/dashboard': 'Dashboard Overview',
  '/register': 'Register Land to Sell',
  '/sell-land': 'Register Land to Sell',
  '/applications': 'Land Applications',
  '/gis-map': 'GIS Parcel Map',
  '/titles': 'My Land Titles',
  '/marketplace': 'Buy & Sell Verified Land',
  '/notifications': 'Notifications',
  '/profile': 'Profile & Polygon Wallet',
};

const WORKSPACE_NAV_LINKS = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/applications', label: 'Applications' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/profile', label: 'Profile & Wallet' },
];

export default function AppLayout({ children }) {
  const { user, walletInfo, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const currentTitle = PAGE_TITLES[location.pathname] || 'Workspace';
  const linkedWallet = walletInfo?.address || user?.walletAddress;
  const handleExitSession = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col bg-slate-50 text-slate-900">
      {/* Slim Workspace Sub-bar (breadcrumb + wallet indicator + exit session) */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
            <span className="hidden sm:inline whitespace-nowrap">Workspace</span>
            <span className="hidden sm:inline" aria-hidden="true">/</span>
            <span className="font-medium text-[#1F2421] truncate">{currentTitle}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/profile"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#E5CF5D] bg-[#FEF7D1] hover:bg-[#FDE878] text-xs font-medium text-[#1F2421] whitespace-nowrap shrink-0 transition-colors"
            >
              <Wallet className="w-3.5 h-3.5 text-[#1F2421]" aria-hidden="true" />
              <span className="font-mono tabular-nums">
                {linkedWallet ? shortenAddress(linkedWallet) : 'Link Polygon Wallet'}
              </span>
            </Link>
            <button
              type="button"
              onClick={handleExitSession}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 whitespace-nowrap transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Exit Session</span>
            </button>
          </div>
        </div>

        {/* Workspace Navigation Strip */}
        <nav
          aria-label="Workspace navigation"
          className="max-w-7xl mx-auto px-4 sm:px-6 border-t border-slate-100 flex items-center gap-1 overflow-x-auto py-1.5"
        >
          {WORKSPACE_NAV_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={Boolean(item.end)}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? 'bg-[#1F2421] text-[#FDE878]'
                    : 'text-slate-600 hover:text-[#1F2421] hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">{children}</main>

      <footer className="border-t border-slate-200 bg-white px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-500">
          <span>ANAGU Land Administration &amp; Polygon Title Prototype</span>
          <span>Academic prototype only — sample records, not a legal government registry</span>
        </div>
      </footer>
    </div>
  );
}
