import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { api } from '../services/api.js';
import {
  collectEventTargetProviders,
  connectBrowserWallet,
  getConnectedWalletSnapshot,
  getWalletProviderLabel,
  hasInjectedWallet,
  isValidPolygonAddress,
  payRegistrationFeeEth,
  shortenAddress,
  signDirectCheckoutMessage,
  switchToSepoliaNetwork,
} from '../services/walletService.js';
import { WalletBrandIcon } from './WalletBrandIcon.jsx';
import {
  buildEtherscanTxUrl,
  classifyWalletPaymentError,
  formatNgnAmount,
  getPaymentStatusMeta,
} from '../utils/paymentFormatting.ts';

import { useAuth } from '../context/AuthContext.jsx';

export default function RegistrationPaymentPanel({ application, authToken = '', onPaymentVerified }) {
  const { walletInfo: sharedWalletInfo, manualWalletAddress, connectManualWallet } = useAuth();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState(sharedWalletInfo || null);
  const [manualInput, setManualInput] = useState(manualWalletAddress || '');
  const [walletConnecting, setWalletConnecting] = useState('');
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [generatingQuote, setGeneratingQuote] = useState(false);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  const requestConfig = authToken
    ? { headers: { Authorization: `Bearer ${authToken}` } }
    : undefined;

  useEffect(() => {
    if (sharedWalletInfo?.address && !wallet?.address) {
      setWallet(sharedWalletInfo);
    }
  }, [sharedWalletInfo, wallet?.address]);

  useEffect(() => {
    if (manualWalletAddress && !manualInput.trim()) {
      setManualInput(manualWalletAddress);
    }
  }, [manualWalletAddress, manualInput]);

  const loadOverview = useCallback(async () => {
    if (!application?.id) return;
    setLoading(true);
    try {
      const { data } = await api.get(
        `/payments/applications/${application.id}`,
        authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined
      );
      setOverview(data);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.error || 'Unable to load registration fee payment details.',
      });
    } finally {
      setLoading(false);
    }
  }, [application?.id, authToken]);

  const syncWallet = useCallback(async (preferredWallet = 'auto') => {
    const snap = await getConnectedWalletSnapshot(preferredWallet);
    if (snap) setWallet(snap);
  }, []);

  const walletTypeRef = useRef('auto');
  walletTypeRef.current = wallet?.walletType || 'auto';

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const providers = collectEventTargetProviders(window);
    if (!providers.length) return undefined;
    const handleAccountsOrChain = () => {
      syncWallet(walletTypeRef.current);
    };
    for (const provider of providers) {
      provider.on('accountsChanged', handleAccountsOrChain);
      provider.on('chainChanged', handleAccountsOrChain);
    }
    return () => {
      for (const provider of providers) {
        if (typeof provider.removeListener === 'function') {
          provider.removeListener('accountsChanged', handleAccountsOrChain);
          provider.removeListener('chainChanged', handleAccountsOrChain);
        } else if (typeof provider.off === 'function') {
          provider.off('accountsChanged', handleAccountsOrChain);
          provider.off('chainChanged', handleAccountsOrChain);
        }
      }
    };
  }, [syncWallet]);

  const handleConnectWallet = async (walletType = 'auto') => {
    setStatusMessage({ type: '', text: '' });
    setWalletConnecting(walletType);
    try {
      const info = await connectBrowserWallet(walletType);
      setWallet(info);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: classifyWalletPaymentError(err),
      });
    } finally {
      setWalletConnecting('');
    }
  };

  const handleApplyManualAddress = (e) => {
    e.preventDefault();
    setStatusMessage({ type: '', text: '' });
    const trimmed = manualInput.trim();
    if (!isValidPolygonAddress(trimmed)) {
      setStatusMessage({
        type: 'error',
        text: 'Enter a valid 42-character EVM 0x wallet address before checking out.',
      });
      return;
    }
    connectManualWallet?.(trimmed);
    setStatusMessage({
      type: 'success',
      text: `Wallet ${shortenAddress(trimmed)} linked. Click Pay to complete registration checkout.`,
    });
  };

  const handleSwitchSepolia = async () => {
    setStatusMessage({ type: '', text: '' });
    setSwitchingNetwork(true);
    try {
      const preferred = wallet?.walletType || 'auto';
      await switchToSepoliaNetwork(preferred);
      await syncWallet(preferred);
      setStatusMessage({
        type: 'success',
        text: `Switched ${getWalletProviderLabel(wallet)} network to Ethereum Sepolia Testnet.`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: classifyWalletPaymentError(err),
      });
    } finally {
      setSwitchingNetwork(false);
    }
  };

  const handleGenerateQuote = async () => {
    setStatusMessage({ type: '', text: '' });
    setGeneratingQuote(true);
    try {
      await api.post(
        '/payments/quotes',
        {
          applicationId: application.id,
          walletAddress:
            wallet?.address ||
            (isValidPolygonAddress(manualInput) ? manualInput.trim() : '') ||
            manualWalletAddress ||
            null,
        },
        requestConfig
      );
      await loadOverview();
      if (typeof onPaymentVerified === 'function') {
        await onPaymentVerified();
      }
      setStatusMessage({
        type: 'success',
        text: 'Generated a fresh Ethereum Sepolia test registration fee quote.',
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.error || 'Failed to generate registration payment quote.',
      });
    } finally {
      setGeneratingQuote(false);
    }
  };

  const handlePayWithEth = async () => {
    const activeQuote = overview?.activeQuote;
    const config = overview?.config;
    if (!config) return;

    setStatusMessage({ type: '', text: '' });
    setPaying(true);

    try {
      // Contract-free direct wallet checkout when no AnaguPayment contract is deployed
      if (!config.contractConfigured) {
        let resolvedWalletAddress =
          wallet?.address ||
          (isValidPolygonAddress(manualInput) ? manualInput.trim() : '') ||
          manualWalletAddress ||
          '';
        let signature = '';
        let signerMessage = '';

        if (wallet?.address || (!resolvedWalletAddress && hasInjectedWallet())) {
          const activeBrowserWallet = wallet || (await connectBrowserWallet());
          setWallet(activeBrowserWallet);
          resolvedWalletAddress = activeBrowserWallet.address;
          const feeLabel = activeQuote?.amount_eth ?? config?.feeSettings?.estimatedEth ?? '0.0033334';
          const signed = await signDirectCheckoutMessage({
            preferredWallet: activeBrowserWallet.walletType || 'auto',
            message: `ANAGU Land Registry Checkout\nReference: ${application.reference_code}\nFee: ${feeLabel} ETH\nWallet: ${resolvedWalletAddress}`,
          });
          if (signed) {
            resolvedWalletAddress = signed.walletAddress;
            signature = signed.signature;
            signerMessage = signed.signerMessage;
          }
        }

        if (!isValidPolygonAddress(resolvedWalletAddress)) {
          document.getElementById('payment-panel-wallet-input')?.focus();
          throw new Error(
            'Connect MetaMask, Trust Wallet, or enter a 0x wallet address above before checking out.'
          );
        }

        if (!manualWalletAddress && !wallet?.address) {
          connectManualWallet?.(resolvedWalletAddress);
        }

        const { data: checkoutRes } = await api.post(
          '/payments/direct-checkout',
          {
            paymentId: activeQuote?.id,
            applicationId: application.id,
            walletAddress: resolvedWalletAddress,
            signature,
            signerMessage,
          },
          requestConfig
        );

        await loadOverview();
        if (checkoutRes?.payment?.payment_status === 'PAID') {
          setStatusMessage({
            type: 'success',
            text:
              checkoutRes.message ||
              'Registration fee paid & verified via wallet checkout. Parcel is eligible for GIS & Admin verification.',
          });
          if (typeof onPaymentVerified === 'function') {
            await onPaymentVerified();
          }
        }
        return;
      }

      if (!activeQuote) {
        throw new Error('Generate a registration fee quote before paying.');
      }

      const activeWallet = wallet || (await connectBrowserWallet());
      setWallet(activeWallet);
      const walletLabel = getWalletProviderLabel(activeWallet);

      if (Number(activeWallet.chainId) !== Number(config.chainId)) {
        throw new Error(
          `${walletLabel} is connected to ${activeWallet.networkName} (Chain ${activeWallet.chainId}). Switch to ${config.networkDisplayName} before paying.`
        );
      }

      const expiresAtUnix = activeQuote.quote_expires_at
        ? Math.floor(new Date(activeQuote.quote_expires_at).getTime() / 1000)
        : 0;

      let broadcastSaved = false;
      const result = await payRegistrationFeeEth({
        contractAddress: config.contractAddress,
        abi: config.abi,
        expectedChainId: config.chainId,
        registrationReference: application.reference_code,
        preferredWallet: activeWallet.walletType || 'auto',
        quoteId: activeQuote.quote_id,
        amountWei: activeQuote.amount_wei,
        expiresAtUnix,
        quoteSignature: activeQuote.quote_signature,
        onTxBroadcast: async ({ txHash, walletAddress }) => {
          broadcastSaved = true;
          await api.post(
            '/payments/submit-tx',
            {
              paymentId: activeQuote.id,
              applicationId: application.id,
              txHash,
              walletAddress,
            },
            requestConfig
          );
          await loadOverview();
          if (typeof onPaymentVerified === 'function') {
            await onPaymentVerified();
          }
        },
      });

      const verifyRes = broadcastSaved
        ? await api.post(
            '/payments/verify',
            {
              paymentId: activeQuote.id,
              txHash: result.txHash,
            },
            requestConfig
          )
        : await api.post(
            '/payments/submit-tx',
            {
              paymentId: activeQuote.id,
              applicationId: application.id,
              txHash: result.txHash,
              walletAddress: result.walletAddress,
            },
            requestConfig
          );

      await loadOverview();
      const verifiedStatus = verifyRes.data?.payment?.payment_status;
      if (verifiedStatus === 'PAID') {
        setStatusMessage({
          type: 'success',
          text: 'Registration fee confirmed on Ethereum Sepolia. Application is eligible for GIS validation.',
        });
        if (typeof onPaymentVerified === 'function') {
          onPaymentVerified();
        }
      } else {
        setStatusMessage({
          type: 'info',
          text:
            verifyRes.data?.message ||
            'Transaction submitted and awaiting independent Sepolia confirmation.',
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: classifyWalletPaymentError(err),
      });
    } finally {
      setPaying(false);
    }
  };

  const handleManualVerify = async (paymentRecord) => {
    if (!paymentRecord?.id) return;
    setStatusMessage({ type: '', text: '' });
    setVerifying(true);
    try {
      const { data } = await api.post(
        '/payments/verify',
        {
          paymentId: paymentRecord.id,
          txHash: paymentRecord.transaction_hash,
        },
        requestConfig
      );
      await loadOverview();
      if (data.payment?.payment_status === 'PAID') {
        setStatusMessage({
          type: 'success',
          text: 'Sepolia transaction independently verified as PAID.',
        });
        if (typeof onPaymentVerified === 'function') {
          onPaymentVerified();
        }
      } else {
        setStatusMessage({
          type: data.payment?.payment_status === 'FAILED' ? 'error' : 'info',
          text: data.verification?.reason || `Current status: ${data.payment?.payment_status}`,
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.error || 'Failed to verify payment status.',
      });
    } finally {
      setVerifying(false);
    }
  };

  if (!application) return null;

  const config = overview?.config;
  const activeQuote = overview?.activeQuote;
  const latestPayment = overview?.latestPayment;
  const displayRecord = activeQuote || latestPayment;
  const paymentStatus = overview?.isPaid
    ? 'PAID'
    : displayRecord?.payment_status || 'PENDING';
  const statusMeta = getPaymentStatusMeta(paymentStatus);
  const expectedChainId = config?.chainId || 11155111;
  const contractRequired = Boolean(config?.contractConfigured);
  const isWrongNetwork = Boolean(
    contractRequired && wallet && Number(wallet.chainId) !== Number(expectedChainId)
  );
  const etherscanUrl = buildEtherscanTxUrl(
    displayRecord?.transaction_hash,
    config?.etherscanBaseUrl
  );
  const feeNgn = displayRecord?.amount_ngn ?? config?.feeSettings?.testFeeNgn ?? 15000;
  const feeEth = displayRecord?.amount_eth ?? config?.feeSettings?.estimatedEth ?? '0.0033334';
  const exchangeRate =
    displayRecord?.exchange_rate ?? config?.feeSettings?.ethNgnExchangeRate ?? 4500000;
  const rateSource =
    displayRecord?.rate_source ?? config?.feeSettings?.rateSource ?? 'CONFIGURABLE_TEST_RATE';
  const effectiveManualWallet = isValidPolygonAddress(manualInput)
    ? manualInput.trim()
    : manualWalletAddress || '';
  const hasAnyWallet = Boolean(wallet?.address || effectiveManualWallet);

  return (
    <section
      aria-label="Registration fee payment"
      className="pt-5 border-t border-slate-200 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1F2421]">
            Ethereum Registration Fee Payment
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Test registration fee only — payment never grants land ownership or mints an NFT title.
          </p>
        </div>
        <span className={`font-mono text-xs font-semibold shrink-0 ${statusMeta.toneClass}`}>
          {statusMeta.label}
        </span>
      </div>

      {loading ? (
        <div className="py-4 text-xs text-slate-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          <span>Calculating registration fee and loading payment status...</span>
        </div>
      ) : (
        <>
          {/* Wallet & Network Bar */}
          <div className="p-3 rounded-md bg-[#FDE878]/25 border border-[#E5CF5D] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs">
                <p className="font-medium text-[#1F2421]">
                  {wallet
                    ? `${getWalletProviderLabel(wallet)}: ${shortenAddress(wallet.address)}`
                    : effectiveManualWallet
                    ? `Connected Payment Wallet: ${shortenAddress(effectiveManualWallet)}`
                    : 'Connect Wallet to Complete Fee Checkout'}
                </p>
                <p className="text-[11px] text-slate-700 font-mono tabular-nums mt-0.5">
                  {wallet
                    ? `${wallet.networkName} (Chain ${wallet.chainId}) · ${wallet.balanceEth} ETH`
                    : `Target Network: ${config?.networkDisplayName || 'Ethereum Sepolia'} (${expectedChainId})`}
                </p>
              </div>

              {!wallet ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleConnectWallet('metamask')}
                    disabled={Boolean(walletConnecting)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1F2421] text-[#FDE878] hover:bg-black rounded-md whitespace-nowrap transition-colors disabled:opacity-60"
                  >
                    <WalletBrandIcon walletType="metamask" className="w-3.5 h-3.5" />
                    <span>{walletConnecting === 'metamask' ? 'Connecting...' : 'MetaMask'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConnectWallet('trustwallet')}
                    disabled={Boolean(walletConnecting)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-[#1F2421] border border-[#1F2421]/25 hover:bg-slate-50 rounded-md whitespace-nowrap transition-colors disabled:opacity-60"
                  >
                    <WalletBrandIcon walletType="trustwallet" className="w-3.5 h-3.5" />
                    <span>
                      {walletConnecting === 'trustwallet' ? 'Connecting...' : 'Trust Wallet'}
                    </span>
                  </button>
                </div>
              ) : isWrongNetwork ? (
                <button
                  type="button"
                  onClick={handleSwitchSepolia}
                  disabled={switchingNetwork}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1F2421] text-[#FDE878] hover:bg-black rounded-md whitespace-nowrap transition-colors disabled:opacity-60"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{switchingNetwork ? 'Switching...' : 'Switch to Sepolia'}</span>
                </button>
              ) : null}
            </div>

            {!wallet && !contractRequired && paymentStatus !== 'PAID' && (
              <form
                onSubmit={handleApplyManualAddress}
                className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-[#E5CF5D]"
              >
                <input
                  id="payment-panel-wallet-input"
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Or enter 0x EVM wallet address (e.g. 0x7099...)"
                  aria-label="EVM wallet address for registration fee checkout"
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-[#1F2421]/25 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421]"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 border border-[#1F2421]/25 text-[#1F2421] rounded-md whitespace-nowrap"
                >
                  Use Wallet Address
                </button>
              </form>
            )}

            {isWrongNetwork && (
              <div
                role="alert"
                className="flex items-start gap-2 pt-2 border-t border-[#E5CF5D] text-xs text-red-800"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Wrong network detected. Switch {getWalletProviderLabel(wallet)} to Ethereum Sepolia
                  Testnet (Chain ID {expectedChainId}) before submitting native ETH.
                </span>
              </div>
            )}
          </div>

          {/* Fee Quote Summary */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-3 rounded-md bg-slate-50 border border-slate-200">
            <div>
              <dt className="text-slate-500">Registration Reference</dt>
              <dd className="font-mono font-semibold text-[#1F2421] mt-0.5 tabular-nums">
                {application.reference_code}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Test Fee (NGN)</dt>
              <dd className="font-mono font-semibold text-[#1F2421] mt-0.5 tabular-nums">
                {formatNgnAmount(feeNgn)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Payable in Test ETH</dt>
              <dd className="font-mono font-semibold text-[#1F2421] mt-0.5 tabular-nums">
                {feeEth} ETH
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Configured Rate ({rateSource})</dt>
              <dd className="font-mono text-slate-700 mt-0.5 tabular-nums">
                1 ETH = {Number(exchangeRate).toLocaleString('en-NG')} NGN
              </dd>
            </div>
            <div className="sm:col-span-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <span>Test registration checkout — test ETH has no real monetary value.</span>
              {displayRecord?.quote_expires_at && paymentStatus === 'PENDING' && (
                <span className="font-mono tabular-nums shrink-0">
                  Expires {new Date(displayRecord.quote_expires_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          </dl>

          {statusMessage.text && (
            <div
              role="status"
              className={`p-3 rounded-md border text-xs flex items-start gap-2 ${
                statusMessage.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : statusMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-[#FDE878]/30 border-[#E5CF5D] text-[#1F2421]'
              }`}
            >
              {statusMessage.type === 'error' ? (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              ) : statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <Clock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Action Controls */}
          <div className="space-y-2">
            {paymentStatus === 'PAID' ? (
              <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  <span>Registration Fee Paid &amp; Verified</span>
                </div>
                <p className="text-emerald-800">{statusMeta.description}</p>
                {displayRecord?.transaction_hash && (
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="truncate max-w-full sm:max-w-[230px]">
                      Tx: {displayRecord.transaction_hash}
                    </span>
                    {etherscanUrl && (
                      <a
                        href={etherscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline font-medium text-emerald-900 hover:text-emerald-700"
                      >
                        <span>View on Etherscan</span>
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {((activeQuote && paymentStatus === 'PENDING') || !contractRequired) && (
                  <button
                    type="button"
                    data-testid="registration-checkout-pay-btn"
                    onClick={handlePayWithEth}
                    disabled={
                      paying ||
                      isWrongNetwork ||
                      (contractRequired && !hasAnyWallet && !hasInjectedWallet())
                    }
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-[#1F2421] text-[#FDE878] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                  >
                    {paying ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        <span>Completing Wallet Checkout...</span>
                      </>
                    ) : (
                      <span>
                        Pay {feeEth} ETH with{' '}
                        {wallet
                          ? getWalletProviderLabel(wallet)
                          : effectiveManualWallet
                          ? shortenAddress(effectiveManualWallet)
                          : 'Wallet'}
                      </span>
                    )}
                  </button>
                )}

                {(!activeQuote ||
                  paymentStatus === 'FAILED' ||
                  paymentStatus === 'EXPIRED') && (
                  <button
                    type="button"
                    onClick={handleGenerateQuote}
                    disabled={generatingQuote}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-white text-[#1F2421] border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${generatingQuote ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {generatingQuote ? 'Calculating Quote...' : 'Generate Registration Fee Quote'}
                    </span>
                  </button>
                )}

                {paymentStatus === 'PROCESSING' && displayRecord && (
                  <button
                    type="button"
                    onClick={() => handleManualVerify(displayRecord)}
                    disabled={verifying}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-[#FDE878] text-[#1F2421] border border-[#E5CF5D] hover:bg-[#f7dc56] disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>{verifying ? 'Verifying on Sepolia...' : 'Verify Transaction Status'}</span>
                  </button>
                )}
              </div>
            )}

            {displayRecord?.transaction_hash && paymentStatus !== 'PAID' && (
              <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-slate-700 truncate max-w-full sm:max-w-[240px]">
                  Tx: {displayRecord.transaction_hash}
                </span>
                {etherscanUrl && (
                  <a
                    href={etherscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[#1F2421] underline"
                  >
                    <span>View on Etherscan</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Application Payment History */}
          <div className="pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-800 mb-2">
              Payment History ({overview?.payments?.length || 0})
            </p>
            {!overview?.payments?.length ? (
              <p className="text-xs text-slate-500">No payment quotes recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {overview.payments.map((p) => {
                  const txLink = buildEtherscanTxUrl(p.transaction_hash, config?.etherscanBaseUrl);
                  return (
                    <li
                      key={p.id}
                      className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-semibold text-[#1F2421]">
                          {p.payment_status}
                        </span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {p.amount_eth} ETH ({formatNgnAmount(p.amount_ngn)})
                        </span>
                        {p.failure_reason && (
                          <p className="text-red-700 mt-0.5">{p.failure_reason}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-slate-500">
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                        {txLink && (
                          <a
                            href={txLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[#1F2421] underline"
                          >
                            <span>Etherscan</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
