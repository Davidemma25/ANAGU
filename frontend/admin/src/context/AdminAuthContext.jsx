import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  adminApi,
  getStoredAdminToken,
  setStoredAdminRefreshToken,
  setStoredAdminToken,
} from '../services/adminApi.js';
import {
  clearActiveWalletSession,
  collectEventTargetProviders,
  connectBrowserWallet,
  getConnectedWalletSnapshot,
} from '../services/walletService.js';

const AdminAuthContext = createContext(null);

const ADMIN_WALLET_SESSION_FLAG = 'anagu_admin_wallet_session_active';

export function AdminAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [walletInfo, setWalletInfo] = useState(null);

  const hydrateAdmin = useCallback(async () => {
    const token = getStoredAdminToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await adminApi.get('/auth/me');
      setUser(data.user);
    } catch {
      setStoredAdminToken('');
      setStoredAdminRefreshToken('');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncPassiveWallet = useCallback(async () => {
    const snapshot = await getConnectedWalletSnapshot();
    setWalletInfo(snapshot);
  }, []);

  useEffect(() => {
    hydrateAdmin();

    let shouldSyncWallet = false;
    try {
      shouldSyncWallet = window.sessionStorage?.getItem(ADMIN_WALLET_SESSION_FLAG) === '1';
    } catch {
      shouldSyncWallet = false;
    }
    if (shouldSyncWallet) {
      syncPassiveWallet();
    }

    const handleUnauthorized = () => {
      setStoredAdminToken('');
      setStoredAdminRefreshToken('');
      setUser(null);
      clearActiveWalletSession();
      try {
        window.sessionStorage?.removeItem(ADMIN_WALLET_SESSION_FLAG);
      } catch {
        // ignore storage errors
      }
      setWalletInfo(null);
    };
    window.addEventListener('anagu:admin-unauthorized', handleUnauthorized);

    const handleWalletChange = () => {
      syncPassiveWallet();
    };
    const walletProviders = collectEventTargetProviders(window);
    for (const provider of walletProviders) {
      provider.on('accountsChanged', handleWalletChange);
      provider.on('chainChanged', handleWalletChange);
    }

    return () => {
      window.removeEventListener('anagu:admin-unauthorized', handleUnauthorized);
      for (const provider of walletProviders) {
        if (typeof provider.removeListener === 'function') {
          provider.removeListener('accountsChanged', handleWalletChange);
          provider.removeListener('chainChanged', handleWalletChange);
        } else if (typeof provider.off === 'function') {
          provider.off('accountsChanged', handleWalletChange);
          provider.off('chainChanged', handleWalletChange);
        }
      }
    };
  }, [hydrateAdmin, syncPassiveWallet]);

  const getAdminStatus = useCallback(async () => {
    const { data } = await adminApi.get('/auth/status');
    return data;
  }, []);

  const adminSetup = useCallback(async ({ email, password, fullName }) => {
    const { data } = await adminApi.post('/auth/setup', { email, password, fullName });
    if (data.token) {
      setStoredAdminToken(data.token);
      setStoredAdminRefreshToken(data.refreshToken);
      setUser(data.user);
    }
    return data;
  }, []);

  const adminLogin = useCallback(async (email, password) => {
    const { data } = await adminApi.post('/auth/login', { email, password });
    setStoredAdminToken(data.token);
    setStoredAdminRefreshToken(data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    const token = getStoredAdminToken();
    if (token) {
      adminApi
        .post('/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } })
        .catch((error) => console.error('Unable to revoke administrator session:', error?.message || error));
    }
    setStoredAdminToken('');
    setStoredAdminRefreshToken('');
    setUser(null);
    clearActiveWalletSession();
    try {
      window.sessionStorage?.removeItem(ADMIN_WALLET_SESSION_FLAG);
    } catch {
      // ignore storage errors
    }
    setWalletInfo(null);
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const { data } = await adminApi.patch('/auth/profile', payload);
    setUser(data.user);
    return data.user;
  }, []);

  const connectWallet = useCallback(
    async (walletType = 'auto') => {
      const info = await connectBrowserWallet(walletType);
      setWalletInfo(info);
      try {
        window.sessionStorage?.setItem(ADMIN_WALLET_SESSION_FLAG, '1');
      } catch {
        // ignore storage errors
      }
      if (user && info.address && user.walletAddress !== info.address) {
        await updateProfile({ walletAddress: info.address });
      }
      return info;
    },
    [user, updateProfile]
  );

  const disconnectWallet = useCallback(() => {
    clearActiveWalletSession();
    try {
      window.sessionStorage?.removeItem(ADMIN_WALLET_SESSION_FLAG);
    } catch {
      // ignore storage errors
    }
    setWalletInfo(null);
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        loading,
        walletInfo,
        getAdminStatus,
        adminSetup,
        adminLogin,
        logout,
        updateProfile,
        connectWallet,
        disconnectWallet,
        refreshUser: hydrateAdmin,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider');
  }
  return ctx;
}
