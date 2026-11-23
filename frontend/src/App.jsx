import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { shortenAddress } from './services/walletService.js';
import ConnectWalletButton from './components/ConnectWalletButton.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { OpenStreetMapBase, DEFAULT_OSM_CENTER } from './components/DefaultOsmMap.tsx';
import LandingPage from './pages/LandingPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import GisMapPage from './pages/GisMapPage.jsx';
import TitlesMarketplacePage from './pages/TitlesMarketplacePage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import ProfileWalletPage from './pages/ProfileWalletPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import AuthCallbackPage from './pages/AuthCallbackPage.jsx';
import { AdminPortalContent } from '../admin/src/AdminApp.jsx';

function StickyNavHeader() {
  const { user, walletInfo, loading } = useAuth();
  const isAuthenticated = Boolean(user);
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const linkedWallet = walletInfo?.address || user?.walletAddress;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-50 border-b bg-[#FDE878]/95 backdrop-blur-xs text-[#1F2421] border-[#E5CF5D] transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <Link
            to="/"
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
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {loading ? (
            <span className="h-8 w-28 rounded bg-[#1F2421]/10" aria-label="Loading account" />
          ) : (
            <>
              {/* Always visible: Connect Wallet */}
              <ConnectWalletButton />

              {/* Register Land to Sell — visible to everyone */}
              <Link
                to="/register"
                className="hidden sm:inline-flex px-3 py-1.5 sm:py-2 text-xs font-medium rounded-xs border border-[#1F2421] text-[#1F2421] hover:bg-[#1F2421]/5 whitespace-nowrap transition-colors"
              >
                Register Land to Sell
              </Link>

              {/* Check Lands (marketplace) — always dark CTA */}
              <Link
                to="/marketplace"
                className="hidden sm:inline-flex px-3 sm:px-3.5 py-1.5 sm:py-2 text-xs font-semibold rounded-xs border border-[#1F2421] bg-[#1F2421] text-white hover:bg-black whitespace-nowrap transition-colors"
              >
                {isAuthenticated ? 'Dashboard' : 'Check Lands'}
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu-bar"
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
        </div>
      </div>

      {mobileMenuOpen && (
        <nav
          id="mobile-menu-bar"
          aria-label="Mobile navigation menu"
          className="md:hidden px-4 py-3 border-t border-[#E5CF5D] bg-[#FDE878] text-[#1F2421] space-y-1.5 shadow-sm"
        >
          {loading ? (
            <div className="h-9 w-full rounded bg-[#1F2421]/10" aria-label="Loading account" />
          ) : (
            <div className="pt-1 space-y-2">
              <div className="flex items-center gap-2">
                <Link
                  to="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 text-center px-3 py-2 text-xs font-semibold border border-[#1F2421] text-[#1F2421] rounded-xs hover:bg-[#1F2421]/5 transition-colors"
                >
                  Register Land to Sell
                </Link>
                <Link
                  to="/marketplace"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 text-center px-3 py-2 text-xs font-semibold bg-[#1F2421] text-[#FDE878] rounded-xs hover:bg-black transition-colors"
                >
                  {isAuthenticated ? 'Dashboard' : 'Check Lands'}
                </Link>
              </div>
              <ConnectWalletButton className="w-full" />
              {isAuthenticated && (
                <Link
                  to="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block text-center px-3 py-2 text-xs font-mono font-semibold border border-[#1F2421] text-[#1F2421] rounded-xs hover:bg-[#1F2421]/5 transition-colors truncate"
                >
                  {linkedWallet ? `Wallet: ${shortenAddress(linkedWallet)}` : 'Profile & Wallet'}
                </Link>
              )}
            </div>
          )}
        </nav>
      )}
    </header>
  );
}

function ProtectedUserView({ children }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading account...
      </div>
    );
  }
  return user ? <Navigate to="/dashboard" replace /> : children;
}

function PublicRegisterLandView() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading land registration...
      </div>
    );
  }
  if (user) {
    return (
      <AppLayout>
        <RegisterPage />
      </AppLayout>
    );
  }
  return <RegisterPage />;
}

function PublicMarketplaceView() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading verified land marketplace...
      </div>
    );
  }
  if (user) {
    return (
      <AppLayout>
        <TitlesMarketplacePage defaultTab="marketplace" />
      </AppLayout>
    );
  }
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <TitlesMarketplacePage defaultTab="marketplace" />
      </main>
    </div>
  );
}

function LandingOsmPreviewAndFooter() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  if (location.pathname !== '/') return null;

  return (
    <>
      <section id="osm-preview" className="py-16 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
                OpenStreetMap Base Layer
              </p>
              <h2 className="mt-2 font-editorial text-3xl font-semibold text-[#1F2421]">
                Live cadastral reference map ({DEFAULT_OSM_CENTER[0].toFixed(3)},{' '}
                {DEFAULT_OSM_CENTER[1].toFixed(3)}).
              </h2>
            </div>
            <Link
              to="/gis-map"
              className="inline-flex items-center px-4 py-2.5 text-xs font-medium bg-[#1F2421] text-white rounded-xs hover:bg-black transition-colors whitespace-nowrap shrink-0"
            >
              Open Map Explorer
            </Link>
          </div>
          <OpenStreetMapBase center={DEFAULT_OSM_CENTER} zoom={15} onNavigate={navigate} />
        </div>
      </section>

      <footer className="bg-[#1F2421] text-slate-300 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div>
            <p className="font-editorial text-base font-semibold text-white">ANAGU Land Registry</p>
            <p className="mt-1 text-slate-400">
              Academic prototype only — sample records, not a legal government registry.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {user ? (
              <>
                <Link to="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
                <Link to="/applications?tab=new" className="hover:text-white transition-colors">New application</Link>
              </>
            ) : (
              <>
                <Link to="/marketplace" className="hover:text-white transition-colors">Buy Land</Link>
                <Link to="/register" className="hover:text-white transition-colors">Register land to sell</Link>
              </>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

function UnifiedAppContent() {
  return (
    <AuthProvider>
      <StickyNavHeader />
      <Routes>
        {/* Public entry and account access */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><SignupPage /></GuestOnly>} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/register" element={<PublicRegisterLandView />} />
        <Route path="/sell-land" element={<PublicRegisterLandView />} />
        <Route path="/marketplace" element={<PublicMarketplaceView />} />

        {/* Public User (Citizen / Landowner) Portal */}
        <Route
          path="/dashboard"
          element={
            <ProtectedUserView>
              <DashboardPage />
            </ProtectedUserView>
          }
        />
        <Route
          path="/applications"
          element={
            <ProtectedUserView>
              <ApplicationsPage />
            </ProtectedUserView>
          }
        />
        <Route
          path="/gis-map"
          element={
            <ProtectedUserView>
              <GisMapPage />
            </ProtectedUserView>
          }
        />
        <Route
          path="/titles"
          element={
            <ProtectedUserView>
              <TitlesMarketplacePage defaultTab="titles" />
            </ProtectedUserView>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedUserView>
              <NotificationsPage />
            </ProtectedUserView>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedUserView>
              <ProfileWalletPage portal="user" />
            </ProtectedUserView>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LandingOsmPreviewAndFooter />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Admin portal — completely isolated from public auth */}
        <Route path="/admin/*" element={<AdminPortalContent />} />

        {/* Public site */}
        <Route path="/*" element={<UnifiedAppContent />} />
      </Routes>
    </BrowserRouter>
  );
}
