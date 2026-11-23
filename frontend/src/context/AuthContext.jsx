import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  api,
  getStoredToken,
  setStoredRefreshToken,
  setStoredToken,
} from '../services/api.js';
import {
  clearActiveWalletSession,
  collectEventTargetProviders,
  connectBrowserWallet,
  getConnectedWalletSnapshot,
  setActiveTokenAddress,
} from '../services/walletService.js';

const AuthContext = createContext(null);

const WALLET_SESSION_FLAG = 'anagu_wallet_session_active';
const MANUAL_WALLET_KEY = 'anagu_manual_wallet_address';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [walletInfo, setWalletInfo] = useState(null);
  const [manualWalletAddress, setManualWalletState] = useState(() => {
    try {
      return window.sessionStorage?.getItem(MANUAL_WALLET_KEY) || '';
    } catch {
      return '';
    }
  });

  const hydrateUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      setStoredToken('');
      setStoredRefreshToken('');
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
    hydrateUser();

    // Fetch contract info once so the wallet service can read ANAGU token balances
    api.get('/titles/contract').then(({ data }) => {
      if (data?.tokenAddress) setActiveTokenAddress(data.tokenAddress);
    }).catch(() => { /* non-critical */ });

    let shouldSyncWallet = false;
    try {
      shouldSyncWallet = window.sessionStorage?.getItem(WALLET_SESSION_FLAG) === '1';
    } catch {
      shouldSyncWallet = false;
    }
    if (shouldSyncWallet) {
      syncPassiveWallet();
    }

    const handleUnauthorized = () => {
      setStoredToken('');
      setUser(null);
      clearActiveWalletSession();
      try {
        window.sessionStorage?.removeItem(WALLET_SESSION_FLAG);
        window.sessionStorage?.removeItem(MANUAL_WALLET_KEY);
      } catch {
        // ignore storage errors
      }
      setWalletInfo(null);
      setManualWalletState('');
    };
    window.addEventListener('anagu:unauthorized', handleUnauthorized);

    const handleWalletChange = () => {
      syncPassiveWallet();
    };
    const walletProviders = collectEventTargetProviders(window);
    for (const provider of walletProviders) {
      provider.on('accountsChanged', handleWalletChange);
      provider.on('chainChanged', handleWalletChange);
    }

    return () => {
      window.removeEventListener('anagu:unauthorized', handleUnauthorized);
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
  }, [hydrateUser, syncPassiveWallet]);

  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    if (data.token) {
      setStoredToken(data.token);
      setStoredRefreshToken(data.refreshToken);
      setUser(data.user);
    }
    return data;
  };

  const login = async (payload) => {
    const { data } = await api.post('/auth/login', payload);
    setStoredToken(data.token);
    setStoredRefreshToken(data.refreshToken);
    setUser(data.user);
    return data.user;
  };

  const completeEmailAuth = async (token, refreshToken) => {
    setStoredToken(token);
    setStoredRefreshToken(refreshToken);
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      return data.user;
    } catch (error) {
      setStoredToken('');
      setStoredRefreshToken('');
      throw error;
    }
  };

  const requestPasswordReset = async (email) => {
    const { data } = await api.post('/auth/password-reset/request', { email });
    return data;
  };

  const confirmPasswordReset = async (payload) => {
    const { data } = await api.post('/auth/password-reset/confirm', payload);
    setStoredToken('');
    setStoredRefreshToken('');
    setUser(null);
    return data;
  };

  const logout = async () => {
    const token = getStoredToken();
    const logoutRequest = token
      ? api.post('/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } })
      : Promise.resolve();
    setStoredToken('');
    setStoredRefreshToken('');
    setUser(null);
    clearActiveWalletSession();
    try {
      window.sessionStorage?.removeItem(WALLET_SESSION_FLAG);
      window.sessionStorage?.removeItem(MANUAL_WALLET_KEY);
    } catch {
      // ignore storage errors
    }
    setWalletInfo(null);
    setManualWalletState('');
    try {
      await logoutRequest;
    } catch (error) {
      console.error('Unable to revoke ANAGU session:', error?.message || error);
    }
  };

  const updateProfile = async (payload) => {
    const { data } = await api.patch('/auth/profile', payload);
    setUser(data.user);
    return data.user;
  };

  const connectWallet = async (walletType = 'auto') => {
    const info = await connectBrowserWallet(walletType);
    setWalletInfo(info);
    setManualWalletState('');
    try {
      window.sessionStorage?.setItem(WALLET_SESSION_FLAG, '1');
      window.sessionStorage?.removeItem(MANUAL_WALLET_KEY);
    } catch {
      // ignore storage errors
    }
    if (user && info.address && user.walletAddress !== info.address) {
      await updateProfile({ walletAddress: info.address });
    }
    return info;
  };

  const connectManualWallet = (address) => {
    const trimmed = String(address || '').trim();
    setManualWalletState(trimmed);
    try {
      if (trimmed) {
        window.sessionStorage?.setItem(MANUAL_WALLET_KEY, trimmed);
      } else {
        window.sessionStorage?.removeItem(MANUAL_WALLET_KEY);
      }
    } catch {
      // ignore storage errors
    }
    return trimmed;
  };

  const disconnectWallet = () => {
    clearActiveWalletSession();
    try {
      window.sessionStorage?.removeItem(WALLET_SESSION_FLAG);
      window.sessionStorage?.removeItem(MANUAL_WALLET_KEY);
    } catch {
      // ignore storage errors
    }
    setWalletInfo(null);
    setManualWalletState('');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        walletInfo,
        manualWalletAddress,
        register,
        login,
        completeEmailAuth,
        requestPasswordReset,
        confirmPasswordReset,
        logout,
        updateProfile,
        connectWallet,
        connectManualWallet,
        disconnectWallet,
        refreshUser: hydrateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
