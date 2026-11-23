import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, LogOut, Wallet, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  getAvailableWallets,
  getWalletProviderLabel,
  isValidPolygonAddress,
  shortenAddress,
} from '../services/walletService.js';
import { WalletBrandIcon } from './WalletBrandIcon.jsx';

export default function ConnectWalletButton({ className = '' }) {
  const {
    walletInfo,
    manualWalletAddress,
    connectWallet,
    connectManualWallet,
    disconnectWallet,
  } = useAuth();
  const [connectingWallet, setConnectingWallet] = useState('');
  const [manualInput, setManualInput] = useState(manualWalletAddress || '');
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef(null);

  const address = walletInfo?.address || manualWalletAddress || '';
  const isManualOnly = !walletInfo?.address && Boolean(manualWalletAddress);
  const connectedLabel = isManualOnly ? '0x Wallet' : getWalletProviderLabel(walletInfo);
  const available = menuOpen && !address ? getAvailableWallets() : null;

  useEffect(() => {
    setManualInput(manualWalletAddress || '');
  }, [manualWalletAddress]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setMenuOpen(false);
        setError('');
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setError('');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleToggleMenu = () => {
    setError('');
    setMenuOpen((prev) => !prev);
  };

  const handleSelectWallet = async (walletType) => {
    setError('');
    setConnectingWallet(walletType);
    try {
      await connectWallet(walletType);
      setMenuOpen(false);
    } catch (err) {
      setError(
        err?.message ||
          `${
            walletType === 'trustwallet' ? 'Trust Wallet' : 'MetaMask'
          } not detected. Install the extension or enter a 0x wallet address below.`
      );
    } finally {
      setConnectingWallet('');
    }
  };

  const handleManualConnect = (e) => {
    e.preventDefault();
    setError('');
    const trimmed = manualInput.trim();
    if (!isValidPolygonAddress(trimmed)) {
      setError('Enter a valid 42-character EVM 0x wallet address.');
      return;
    }
    connectManualWallet?.(trimmed);
    setMenuOpen(false);
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const handleDisconnect = () => {
    disconnectWallet();
    setManualInput('');
    setMenuOpen(false);
    setError('');
  };

  const wrapperDisplayClass = className && /\bhidden\b/.test(className) ? '' : 'inline-flex';

  return (
    <div ref={wrapperRef} className={`relative ${wrapperDisplayClass} items-center ${className}`}>
      <button
        type="button"
        onClick={handleToggleMenu}
        disabled={Boolean(connectingWallet)}
        aria-expanded={menuOpen}
        aria-label={address ? `Connected ${connectedLabel} wallet ${address}` : 'Connect Wallet'}
        title={address ? `${connectedLabel}: ${address}` : 'Connect MetaMask, Trust Wallet, or 0x address'}
        data-testid="header-connect-wallet-btn"
        className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-medium rounded-xs border whitespace-nowrap transition-colors disabled:opacity-60 ${
          className && /\bw-full\b/.test(className) ? 'w-full' : ''
        } ${
          address
            ? 'border-emerald-700/30 bg-white text-[#1F2421] hover:bg-emerald-50 font-mono'
            : 'border-[#1F2421] bg-white/60 text-[#1F2421] hover:bg-white'
        }`}
      >
        {address ? (
          <>
            <span
              aria-hidden="true"
              className="w-2 h-2 rounded-full bg-emerald-600 shrink-0"
            />
            {isManualOnly ? (
              <Wallet className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
            ) : (
              <WalletBrandIcon
                walletType={walletInfo?.walletType || (walletInfo?.isTrustWallet ? 'trustwallet' : walletInfo?.isMetaMask ? 'metamask' : 'auto')}
                className="w-3.5 h-3.5 shrink-0"
              />
            )}
            <span data-testid="connected-wallet-address">{shortenAddress(address)}</span>
          </>
        ) : (
          <>
            <Wallet className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{connectingWallet ? 'Connecting...' : 'Connect Wallet'}</span>
            <ChevronDown className="w-3 h-3 opacity-70 shrink-0" aria-hidden="true" />
          </>
        )}
      </button>

      {!address && menuOpen && (
        <div
          role="dialog"
          aria-label="Choose a Web3 wallet"
          data-testid="wallet-selector-popover"
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-72 sm:w-76 max-w-[calc(100vw-2rem)] rounded-md border border-[#1F2421]/20 bg-white p-3.5 shadow-xl z-50 text-xs text-[#1F2421] space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#1F2421]">Connect Payment Wallet</span>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setError('');
              }}
              aria-label="Close wallet selector"
              className="p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              data-testid="wallet-option-metamask"
              disabled={Boolean(connectingWallet)}
              onClick={() => handleSelectWallet('metamask')}
              className="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-md border border-slate-200 hover:border-[#1F2421] hover:bg-[#FEF9DB]/60 text-left transition-colors disabled:opacity-60"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <WalletBrandIcon walletType="metamask" className="w-5 h-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-semibold text-[#1F2421]">
                    {connectingWallet === 'metamask' ? 'Connecting MetaMask...' : 'MetaMask'}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    Browser extension
                  </span>
                </span>
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                  available?.metamask?.available
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {available?.metamask?.available ? 'Detected' : 'Connect'}
              </span>
            </button>

            <button
              type="button"
              data-testid="wallet-option-trustwallet"
              disabled={Boolean(connectingWallet)}
              onClick={() => handleSelectWallet('trustwallet')}
              className="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-md border border-slate-200 hover:border-[#1F2421] hover:bg-[#FEF9DB]/60 text-left transition-colors disabled:opacity-60"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <WalletBrandIcon walletType="trustwallet" className="w-5 h-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-semibold text-[#1F2421]">
                    {connectingWallet === 'trustwallet'
                      ? 'Connecting Trust Wallet...'
                      : 'Trust Wallet'}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    Extension &amp; mobile dApp
                  </span>
                </span>
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                  available?.trustwallet?.available
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {available?.trustwallet?.available ? 'Detected' : 'Connect'}
              </span>
            </button>
          </div>

          <form onSubmit={handleManualConnect} className="pt-2 border-t border-slate-200 space-y-2">
            <label htmlFor="header-manual-wallet-input" className="block text-[11px] font-medium text-slate-600">
              Or paste EVM 0x Wallet Address
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="header-manual-wallet-input"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="0x90F7..."
                className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-[11px] font-semibold bg-[#1F2421] text-white hover:bg-black rounded whitespace-nowrap"
              >
                Use 0x
              </button>
            </div>
          </form>

          {error && (
            <div
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-800 leading-relaxed"
            >
              {error}
            </div>
          )}
        </div>
      )}

      {address && menuOpen && (
        <div
          role="dialog"
          aria-label="Connected wallet details"
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-[#1F2421]/15 bg-white p-3.5 shadow-lg z-50 text-xs text-[#1F2421] space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>{connectedLabel} Connected</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              {walletInfo?.networkName || 'EVM Wallet'}
            </span>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] break-all select-all text-slate-800">
            {address}
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              onClick={handleCopyAddress}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" aria-hidden="true" />
                  <span>Copy Address</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-medium transition-colors"
            >
              <LogOut className="w-3 h-3" aria-hidden="true" />
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
