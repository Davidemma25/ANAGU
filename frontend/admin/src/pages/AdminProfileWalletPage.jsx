import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';
import {
  getAvailableWallets,
  getWalletProviderLabel,
  isValidPolygonAddress,
  switchPolygonNetwork,
} from '../services/walletService.js';
import { WalletBrandIcon } from '../components/WalletBrandIcon.jsx';

export default function AdminProfileWalletPage() {
  const { user, walletInfo, connectWallet, updateProfile } = useAdminAuth();

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [walletAddress, setWalletAddress] = useState(user?.walletAddress || '');
  const [saving, setSaving] = useState(false);
  const [walletBusy, setWalletBusy] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const availableWallets = getAvailableWallets();

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setFeedback({ type: '', text: '' });

    if (walletAddress.trim() && !isValidPolygonAddress(walletAddress)) {
      setFeedback({
        type: 'error',
        text: 'Enter a valid EVM / Polygon wallet address starting with 0x (42 characters).',
      });
      return;
    }

    setSaving(true);
    try {
      await updateProfile({ fullName, phone, walletAddress: walletAddress.trim() });
      setFeedback({ type: 'success', text: 'Administrator profile and wallet address saved.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to update profile.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnectWalletProvider = async (walletType = 'auto') => {
    setFeedback({ type: '', text: '' });
    setWalletBusy(walletType);
    try {
      const info = await connectWallet(walletType);
      setWalletAddress(info.address);
      setFeedback({
        type: 'success',
        text: `Connected ${getWalletProviderLabel(info)} (${info.address}) on ${info.networkName} (${info.balancePol} POL).`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setWalletBusy('');
    }
  };

  const handleSwitchNetwork = async (targetKey) => {
    setFeedback({ type: '', text: '' });
    setWalletBusy('network');
    try {
      const preferred = walletInfo?.walletType || 'auto';
      await switchPolygonNetwork(targetKey, preferred);
      const info = await connectWallet(preferred);
      setFeedback({
        type: 'success',
        text: `Switched ${getWalletProviderLabel(info)} network to ${info.networkName}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setWalletBusy('');
    }
  };

  const detectedSummary = [
    availableWallets.metamask.available ? 'MetaMask' : null,
    availableWallets.trustwallet.available ? 'Trust Wallet' : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Administrator Profile &amp; Signing Wallet
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage your administrator details and link your EVM signing address for registry operations.
        </p>
      </div>

      {feedback.text && (
        <div
          role="alert"
          className={`p-3.5 rounded-md border text-sm ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Account Information
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {user?.roleName} · {user?.email} · {user?.nationalId}
          </p>

          <form onSubmit={handleSaveProfile} className="mt-5 space-y-4">
            <div>
              <label htmlFor="prof-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
              />
            </div>

            <div>
              <label htmlFor="prof-phone" className="block text-sm font-medium text-slate-700 mb-1.5">
                Phone Number
              </label>
              <input
                id="prof-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
              />
            </div>

            <div>
              <label htmlFor="prof-wallet" className="block text-sm font-medium text-slate-700 mb-1.5">
                Linked Polygon Wallet Address
              </label>
              <input
                id="prof-wallet"
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-[#1F2421] hover:bg-black disabled:opacity-60 rounded-md transition-colors"
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#1F2421]" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Web3 Wallet Connection
              </h2>
            </div>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              Connect <strong>MetaMask</strong>, <strong>Trust Wallet</strong>, or any EIP-1193
              wallet to sign regulated Polygon Amoy Testnet (Chain ID 80002) or Local Hardhat EVM
              (Chain ID 31337) parcel transactions.
            </p>

            <div className="mt-5 p-4 rounded-md bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Detected Wallets</span>
                <span className="font-medium text-slate-900">
                  {detectedSummary.length > 0
                    ? detectedSummary.join(' · ')
                    : availableWallets.anyAvailable
                    ? 'Injected EIP-1193'
                    : 'Not detected in browser'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Connected Wallet</span>
                <span className="font-medium text-slate-900">
                  {walletInfo ? getWalletProviderLabel(walletInfo) : 'Not connected'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Active Network</span>
                <span className="font-medium text-slate-900">
                  {walletInfo ? `${walletInfo.networkName} (${walletInfo.chainId})` : 'Not connected'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">POL Balance</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {walletInfo ? `${walletInfo.balancePol} POL` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={Boolean(walletBusy)}
                onClick={() => handleConnectWalletProvider('metamask')}
                className="flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#E5CF5D] disabled:opacity-60 rounded-md transition-colors"
              >
                <WalletBrandIcon walletType="metamask" className="w-4 h-4 shrink-0" />
                <span>{walletBusy === 'metamask' ? 'Connecting...' : 'Connect MetaMask'}</span>
              </button>

              <button
                type="button"
                disabled={Boolean(walletBusy)}
                onClick={() => handleConnectWalletProvider('trustwallet')}
                className="flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-60 rounded-md transition-colors"
              >
                <WalletBrandIcon walletType="trustwallet" className="w-4 h-4 shrink-0" />
                <span>
                  {walletBusy === 'trustwallet' ? 'Connecting...' : 'Connect Trust Wallet'}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={Boolean(walletBusy)}
                onClick={() => handleSwitchNetwork('amoy')}
                className="py-2 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors"
              >
                Switch to Polygon Amoy
              </button>
              <button
                type="button"
                disabled={Boolean(walletBusy)}
                onClick={() => handleSwitchNetwork('hardhat')}
                className="py-2 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors"
              >
                Switch to Local Hardhat
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
