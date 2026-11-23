import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, ArrowRightLeft, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, extractErrorMessage } from '../services/api.js';
import BuyerVerificationModal from '../components/BuyerVerificationModal.jsx';
import MarketplaceTabPanel from '../components/MarketplaceTabPanel.jsx';
import {
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  anaguToWei,
  convertPolToUsd,
  convertUsdToAnagu,
  convertUsdToPol,
  resolveListingPriceAnagu,
  resolveMarketplaceSigningState,
} from '../utils/marketplaceUtils.js';
import {
  classifyPolygonTxError,
  getWalletProviderLabel,
  hasInjectedWallet,
  shortenAddress,
  signBuyEscrowTx,
  signCancelListingTx,
  signAnaguEscrowBuyTx,
  signAnaguEscrowCancelTx,
  signAnaguEscrowListTx,
  signListParcelTx,
  signSaleSettlementTx,
  switchPolygonNetwork,
} from '../services/walletService.js';

export default function TitlesMarketplacePage({ defaultTab = 'titles' }) {
  const {
    user,
    walletInfo,
    manualWalletAddress,
    connectWallet,
    connectManualWallet,
    disconnectWallet,
  } = useAuth();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState(defaultTab);
  const [titles, setTitles] = useState([]);
  const [listings, setListings] = useState([]);
  const [eligibility, setEligibility] = useState({
    readyToList: [],
    unverifiedParcels: [],
    activeListings: [],
    summary: { readyCount: 0, unverifiedCount: 0, activeCount: 0 },
  });
  const [transactions, setTransactions] = useState([]);
  const [contractInfo, setContractInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [feedback, setFeedback] = useState(() =>
    location.state?.registeredMessage
      ? { type: 'success', text: location.state.registeredMessage }
      : { type: '', text: '' }
  );
  const [listPriceByTitle, setListPriceByTitle] = useState({});
  const [blockProof, setBlockProof] = useState(null);
  const [verifiedReportsByListing, setVerifiedReportsByListing] = useState(() =>
    location.state?.newListingId && location.state?.verificationReport
      ? { [location.state.newListingId]: location.state.verificationReport }
      : {}
  );
  const [verifyModalState, setVerifyModalState] = useState({
    listing: null,
    report: null,
    loading: false,
    error: '',
  });

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (location.state?.registeredMessage) {
      setFeedback({ type: 'success', text: location.state.registeredMessage });
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (location.state?.newListingId && location.state?.verificationReport) {
      setVerifiedReportsByListing((prev) => ({
        ...prev,
        [location.state.newListingId]: location.state.verificationReport,
      }));
    }
  }, [location.state]);

  const loadAll = useCallback(async () => {
    try {
      if (!user) {
        const [marketRes, contractRes] = await Promise.allSettled([
          api.get('/marketplace/listings'),
          api.get('/titles/contract'),
        ]);
        if (marketRes.status === 'fulfilled') {
          setListings(marketRes.value.data.listings || []);
        }
        if (contractRes.status === 'fulfilled') {
          setContractInfo(contractRes.value.data);
        }
        setTitles([]);
        setTransactions([]);
        setEligibility({
          readyToList: [],
          unverifiedParcels: [],
          activeListings: [],
          summary: { readyCount: 0, unverifiedCount: 0, activeCount: 0 },
        });
        return;
      }

      const [titlesRes, marketRes, eligRes, contractRes] = await Promise.allSettled([
        api.get('/titles'),
        api.get('/marketplace/listings'),
        api.get('/marketplace/eligibility'),
        api.get('/titles/contract'),
      ]);

      if (titlesRes.status === 'fulfilled') {
        setTitles(titlesRes.value.data.titles || []);
        setTransactions(titlesRes.value.data.transactions || []);
      }
      if (marketRes.status === 'fulfilled') {
        setListings(marketRes.value.data.listings || []);
      }
      if (eligRes.status === 'fulfilled') {
        setEligibility(
          eligRes.value.data || {
            readyToList: [],
            unverifiedParcels: [],
            activeListings: [],
            summary: { readyCount: 0, unverifiedCount: 0, activeCount: 0 },
          }
        );
      }
      if (contractRes.status === 'fulfilled') {
        setContractInfo(contractRes.value.data);
      }

      const firstError = [titlesRes, marketRes, eligRes, contractRes].find(
        (r) => r.status === 'rejected'
      );
      if (firstError) {
        setFeedback({
          type: 'error',
          text: extractErrorMessage(
            firstError.reason,
            'Failed to load part of the blockchain title or marketplace state.'
          ),
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(
          err,
          'Failed to load blockchain title and marketplace state.'
        ),
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const signingState = resolveMarketplaceSigningState({
    contractInfo,
    walletInfo,
    hasInjected: hasInjectedWallet(),
  });

  const handleSwitchTargetNetwork = async () => {
    setFeedback({ type: '', text: '' });
    try {
      const targetKey = Number(contractInfo?.chainId) === 80002 ? 'amoy' : 'hardhat';
      await switchPolygonNetwork(targetKey, walletInfo?.walletType || 'auto');
      await connectWallet(walletInfo?.walletType || 'auto');
      setFeedback({
        type: 'success',
        text: `Switched wallet to ${contractInfo?.networkName || 'Polygon Amoy Testnet'}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: classifyPolygonTxError(err, 'Failed to switch wallet network.'),
      });
    }
  };

  const handleTestTransferBlock = async (titleId) => {
    setFeedback({ type: '', text: '' });
    setBlockProof(null);
    setBusyId(`block-${titleId}`);
    try {
      const { data } = await api.post(`/titles/${titleId}/test-transfer-block`, {});
      setBlockProof(data);
      setFeedback({ type: 'success', text: data.message });
      await loadAll();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to verify direct transfer block.',
      });
    } finally {
      setBusyId('');
    }
  };

  const publishVerifiedListing = async ({
    titleId = null,
    applicationId = null,
    tokenId = null,
    ownerWallet = '',
    priceUsd,
    pricePol,
    headline = '',
    description = '',
  }) => {
    setFeedback({ type: '', text: '' });
    setBusyId(`list-${titleId || `app-${applicationId}`}`);
    try {
      let txHash = null;
      let sellerWallet = walletInfo?.address || user?.walletAddress || ownerWallet;
      const numericUsd = priceUsd != null ? Number(priceUsd) : null;
      const resolvedPol =
        pricePol != null ? Number(pricePol) : convertUsdToPol(numericUsd);

      if (titleId && tokenId && (signingState.useBrowserWallet || signingState.requiresWalletSignature)) {
        const activeWallet = walletInfo?.address ? walletInfo : await connectWallet('auto');
        const resolvedAnagu = convertUsdToAnagu(
          numericUsd != null ? numericUsd : convertPolToUsd(resolvedPol)
        );
        const signed = contractInfo?.escrowAddress
          ? await signAnaguEscrowListTx({
              escrowAddress: contractInfo.escrowAddress,
              escrowAbi: contractInfo.escrowAbi,
              tokenId,
              priceAnagu: resolvedAnagu,
              expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
              expectedChainId: contractInfo?.chainId,
              preferredWallet: activeWallet?.walletType || 'auto',
            })
          : await signListParcelTx({
              contractAddress: contractInfo.contractAddress,
              abi: contractInfo.abi,
              tokenId,
              pricePol: resolvedPol,
              expectedChainId: contractInfo?.chainId,
              preferredWallet: activeWallet?.walletType || 'auto',
            });
        txHash = signed.txHash;
        sellerWallet = signed.sellerWallet;
      }

      const { data } = await api.post('/marketplace/listings', {
        ...(titleId ? { titleId } : {}),
        ...(applicationId ? { applicationId } : {}),
        ...(numericUsd != null ? { priceUsd: numericUsd } : { pricePol: resolvedPol }),
        headline,
        description,
        sellerWallet,
        txHash,
      });
      setFeedback({ type: 'success', text: data.message });
      setActiveTab('marketplace');
      await loadAll();
      return true;
    } catch (err) {
      setFeedback({
        type: 'error',
        text: classifyPolygonTxError(err, 'Failed to list parcel on Polygon marketplace.'),
      });
      return false;
    } finally {
      setBusyId('');
    }
  };

  const handleListForSale = async (title) => {
    const priceUsd = listPriceByTitle[title.id] || '2500';
    await publishVerifiedListing({
      titleId: title.id,
      tokenId: title.token_id,
      ownerWallet: title.owner_wallet,
      priceUsd,
    });
  };

  const handleVerifyBeforeBuying = async (listing) => {
    setFeedback({ type: '', text: '' });
    setBusyId(`verify-${listing.id}`);
    setVerifyModalState({
      listing,
      report: verifiedReportsByListing[listing.id] || null,
      loading: true,
      error: '',
    });

    try {
      const { data } = await api.post(`/marketplace/listings/${listing.id}/verify`, {});
      const report = data.verificationReport;
      const updatedListing = data.listing || listing;
      setVerifiedReportsByListing((prev) => ({
        ...prev,
        [listing.id]: report,
      }));
      setVerifyModalState({
        listing: updatedListing,
        report,
        loading: false,
        error: '',
      });
      await loadAll();
    } catch (err) {
      setVerifyModalState({
        listing,
        report: null,
        loading: false,
        error:
          err.response?.data?.error ||
          err.message ||
          'Failed to run pre-purchase land verification.',
      });
    } finally {
      setBusyId('');
    }
  };

  const handleConnectWalletFromMarketplace = async (walletType = 'auto') => {
    setFeedback({ type: '', text: '' });
    try {
      const info = await connectWallet(walletType);
      const label = getWalletProviderLabel(info);
      setFeedback({
        type: 'success',
        text: `Connected ${label} wallet ${shortenAddress(info.address)} (${info.networkName}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err?.message ||
          'MetaMask or Trust Wallet extension not detected. Click "Verify Land Before Buying" on any parcel to connect a wallet address for checkout.',
      });
    }
  };

  const handleBuyEscrow = async (listing, passedReport = null, overrideWallet = '') => {
    const activeReport = passedReport || verifiedReportsByListing[listing.id] || null;
    if (!activeReport || !activeReport.verifiedSafeToBuy) {
      await handleVerifyBeforeBuying(listing);
      return;
    }

    setFeedback({ type: '', text: '' });
    setBusyId(`buy-${listing.id}`);
    try {
      let txHash = null;
      let buyerWallet =
        overrideWallet || walletInfo?.address || manualWalletAddress || user?.walletAddress || '';

      const isRealChain = Boolean(
        signingState.requiresWalletSignature || activeReport?.details?.isRealOnChain
      );

      if (signingState.useBrowserWallet || isRealChain) {
        const activeWallet = walletInfo?.address ? walletInfo : await connectWallet('auto');
        const targetContractAddress =
          contractInfo?.contractAddress || activeReport?.details?.contractAddress;
        const targetChainId = contractInfo?.chainId || activeReport?.details?.chainId;
        const signed = contractInfo?.escrowAddress
          ? await signAnaguEscrowBuyTx({
              tokenAddress: contractInfo.tokenAddress,
              escrowAddress: contractInfo.escrowAddress,
              tokenAbi: contractInfo.tokenAbi,
              escrowAbi: contractInfo.escrowAbi,
              tokenId: listing.token_id,
              // ANAGU escrow requires ANAGU-denominated wei, not POL wei
              priceWei: anaguToWei(resolveListingPriceAnagu(listing)),
              expectedChainId: targetChainId,
              preferredWallet: activeWallet?.walletType || 'auto',
            })
          : await signBuyEscrowTx({
              contractAddress: targetContractAddress,
              abi: contractInfo?.abi,
              tokenId: listing.token_id,
              priceWei: listing.price_wei,
              expectedChainId: targetChainId,
              preferredWallet: activeWallet?.walletType || 'auto',
            });
        txHash = signed.txHash;
        buyerWallet = signed.buyerWallet;
      }

      const { data } = await api.post(`/marketplace/listings/${listing.id}/buy`, {
        buyerWallet,
        txHash,
        requireVerificationConfirmation: true,
        verificationCode: activeReport.verificationCode,
      });
      setVerifyModalState({ listing: null, report: null, loading: false, error: '' });
      setFeedback({ type: 'success', text: data.message });
      await loadAll();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: classifyPolygonTxError(err, 'Failed to fund Polygon escrow.'),
      });
    } finally {
      setBusyId('');
    }
  };

  const handleActivateOnChain = async (listing) => {
    if (!listing?.id || !listing?.token_id) return;
    setFeedback({ type: '', text: '' });
    setBusyId(`activate-${listing.id}`);
    try {
      const activeWallet = walletInfo?.address ? walletInfo : await connectWallet('auto');
      const signed = contractInfo?.escrowAddress
        ? await signAnaguEscrowListTx({
            escrowAddress: contractInfo.escrowAddress,
            escrowAbi: contractInfo.escrowAbi,
            tokenId: listing.token_id,
            priceAnagu: resolveListingPriceAnagu(listing),
            expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
            expectedChainId: contractInfo?.chainId,
            preferredWallet: activeWallet?.walletType || 'auto',
          })
        : await signListParcelTx({
            contractAddress: contractInfo?.contractAddress || listing.contract_address,
            abi: contractInfo?.abi,
            tokenId: listing.token_id,
            pricePol: listing.price_pol,
            expectedChainId: contractInfo?.chainId,
            preferredWallet: activeWallet?.walletType || 'auto',
          });
      const { data } = await api.post(`/marketplace/listings/${listing.id}/activate`, {
        txHash: signed.txHash,
        sellerWallet: signed.sellerWallet,
      });
      setFeedback({ type: 'success', text: data.message });
      await handleVerifyBeforeBuying(data.listing || listing);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: classifyPolygonTxError(err, 'Failed to activate parcel listing on-chain.'),
      });
    } finally {
      setBusyId('');
    }
  };

  const handleCancelListing = async (listing) => {
    setFeedback({ type: '', text: '' });
    setBusyId(`cancel-${listing.id}`);
    try {
      let txHash = null;
      const shouldSignCancel =
        listing.title_id &&
        listing.token_id &&
        (signingState.useBrowserWallet || signingState.requiresWalletSignature);

      if (shouldSignCancel) {
        const activeWallet = walletInfo?.address ? walletInfo : await connectWallet('auto');
        const signed = contractInfo?.escrowAddress
          ? await signAnaguEscrowCancelTx({
              escrowAddress: contractInfo.escrowAddress,
              escrowAbi: contractInfo.escrowAbi,
              tokenId: listing.token_id,
              expectedChainId: contractInfo?.chainId,
              preferredWallet: activeWallet?.walletType || 'auto',
            })
          : await signCancelListingTx({
              contractAddress: contractInfo.contractAddress,
              abi: contractInfo.abi,
              tokenId: listing.token_id,
              expectedChainId: contractInfo?.chainId,
              preferredWallet: activeWallet?.walletType || 'auto',
            });
        txHash = signed.txHash;
      }
      const { data } = await api.post(`/marketplace/listings/${listing.id}/cancel`, { txHash });
      setFeedback({ type: 'success', text: data.message });
      await loadAll();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: classifyPolygonTxError(err, 'Failed to cancel listing.'),
      });
    } finally {
      setBusyId('');
    }
  };

  const handleSettleSale = async (listingId) => {
    const listing = listings.find((item) => item.id === listingId);
    if (!listing?.token_id) return;
    setFeedback({ type: '', text: '' });
    setBusyId(`settle-${listing.id}`);
    try {
      const activeWallet = walletInfo?.address ? walletInfo : await connectWallet('auto');
      const signed = await signSaleSettlementTx({
        contractAddress: contractInfo?.contractAddress || listing.contract_address,
        abi: contractInfo?.abi,
        escrowAddress: contractInfo?.escrowAddress || '',
        tokenId: listing.token_id,
        expectedChainId: contractInfo?.chainId,
        preferredWallet: activeWallet?.walletType || 'auto',
      });
      const { data } = await api.post(`/marketplace/listings/${listing.id}/settle`, {
        txHash: signed.txHash,
      });
      setFeedback({ type: 'success', text: data.message });
      await loadAll();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: classifyPolygonTxError(err, 'Failed to confirm the sale.'),
      });
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2421]">
            {activeTab === 'marketplace'
              ? 'Buy & Sell Land'
              : 'NFT Land Titles & Polygon Marketplace'}
          </h1>
          <p className="mt-1 text-sm text-[#2D312E]">
            {activeTab === 'marketplace'
              ? 'Land prices are listed in US Dollars ($). Verify GIS boundaries, Community Oracle clearance, and ERC-721 title ownership, then connect MetaMask or Trust Wallet to pay.'
              : 'Non-bypassable ERC-721 title issuance, anti-transfer registry guard, and wallet-based USD & POL escrow buying & selling.'}
          </p>
        </div>

        {user && (
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#FDE878]/50 border border-[#E5CF5D] rounded-lg self-start shrink-0 max-w-full">
            <button
              type="button"
              onClick={() => setActiveTab('titles')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === 'titles'
                  ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                  : 'text-[#1F2421]/80 hover:text-[#1F2421]'
              }`}
            >
              My Titles ({titles.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('marketplace')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === 'marketplace'
                  ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                  : 'text-[#1F2421]/80 hover:text-[#1F2421]'
              }`}
            >
              Buy &amp; Sell Land ({listings.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === 'ledger'
                  ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                  : 'text-[#1F2421]/80 hover:text-[#1F2421]'
              }`}
            >
              Chain Ledger ({transactions.length})
            </button>
          </div>
        )}
      </div>

      {/* Smart Contract Connection Bar */}
      {contractInfo && (
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded font-semibold ${
                signingState.isRealOnChain
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              {signingState.isRealOnChain ? 'Real On-Chain' : 'Prototype Ledger'}
            </span>
            <span className="font-semibold text-slate-900">AnaguLandTitle (ERC-721)</span>
            <span aria-hidden="true">·</span>
            {buildExplorerAddressUrl(contractInfo.contractAddress, contractInfo.explorerBaseUrl) ? (
              <a
                href={buildExplorerAddressUrl(
                  contractInfo.contractAddress,
                  contractInfo.explorerBaseUrl
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-slate-800 underline hover:text-black"
              >
                <span>{shortenAddress(contractInfo.contractAddress)}</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            ) : (
              <span className="font-mono text-slate-700">
                {shortenAddress(contractInfo.contractAddress)}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {contractInfo.networkName} (Chain {contractInfo.chainId})
            </span>
            {contractInfo.escrowAddress && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-900">Escrow</span>
                {buildExplorerAddressUrl(contractInfo.escrowAddress, contractInfo.explorerBaseUrl) ? (
                  <a
                    href={buildExplorerAddressUrl(
                      contractInfo.escrowAddress,
                      contractInfo.explorerBaseUrl
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-slate-800 underline hover:text-black"
                  >
                    <span>{shortenAddress(contractInfo.escrowAddress)}</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-mono text-slate-700">
                    {shortenAddress(contractInfo.escrowAddress)}
                  </span>
                )}
              </>
            )}
            {contractInfo.tokenAddress && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-900">ANAGU</span>
                {buildExplorerAddressUrl(contractInfo.tokenAddress, contractInfo.explorerBaseUrl) ? (
                  <a
                    href={buildExplorerAddressUrl(
                      contractInfo.tokenAddress,
                      contractInfo.explorerBaseUrl
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-slate-800 underline hover:text-black"
                  >
                    <span>{shortenAddress(contractInfo.tokenAddress)}</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-mono text-slate-700">
                    {shortenAddress(contractInfo.tokenAddress)}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {signingState.needsNetworkSwitch && (
              <button
                type="button"
                onClick={handleSwitchTargetNetwork}
                className="px-2.5 py-1 rounded bg-[#1F2421] text-[#FDE878] hover:bg-black font-semibold transition-colors"
              >
                Switch Wallet to Chain {contractInfo.chainId}
              </button>
            )}
            <span className="font-mono text-slate-500 tabular-nums">
              Signing mode:{' '}
              {signingState.useBrowserWallet
                ? `${getWalletProviderLabel(walletInfo)} BrowserProvider`
                : signingState.isRealOnChain
                ? 'MetaMask / Trust Wallet Required'
                : 'Prototype Hardhat Wallet'}
            </span>
          </div>
        </div>
      )}

      {feedback.text && (
        <div
          role="alert"
          className={`p-3.5 rounded-md border text-sm flex flex-wrap items-center justify-between gap-2 ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>
            {typeof feedback.text === 'string'
              ? feedback.text
              : extractErrorMessage(feedback.text)}
          </span>
          {location.state?.fromAdminVerification && feedback.type === 'success' && (
            <Link
              to="/admin"
              className="text-xs font-semibold underline hover:opacity-80 whitespace-nowrap"
            >
              Back to Admin Console
            </Link>
          )}
        </div>
      )}

      {blockProof && (
        <section className="p-4 rounded-lg bg-[#1F2421] text-slate-100 border border-[#2D312E] text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-[#FDE878]">
            <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            <span>On-Chain Transfer Guard Enforced</span>
          </div>
          <p className="font-mono text-slate-300">Revert Reason: {blockProof.reason}</p>
          <p className="font-mono text-slate-400 tabular-nums">
            Blocked direct transfer from {shortenAddress(blockProof.fromAddress)} to{' '}
            {shortenAddress(blockProof.toAddress)} ({blockProof.latencyMs} ms)
          </p>
        </section>
      )}

      {activeTab === 'titles' && (
        <div className="space-y-6">
          {/* Issued NFT Titles Registry */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Issued ERC-721 Digital Land Titles
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {titles.length} title(s)
              </span>
            </div>

            {loading ? (
              <p className="p-6 text-center text-xs text-slate-500">Loading digital land titles...</p>
            ) : titles.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">
                No NFT land titles have been minted yet. Titles appear here once approved by officials.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {titles.map((t) => {
                  const isOwner = t.owner_id === user?.id;
                  const isRevoked = t.title_status === 'REVOKED';
                  const hasOpenListing = listings.some(
                    (l) => l.title_id === t.id && ['LISTED', 'ESCROW_FUNDED'].includes(l.listing_status)
                  );
                  return (
                    <div key={t.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-slate-900">
                            {t.title_number}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600 tabular-nums">
                            Token #{t.token_id}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600">{t.parcel_code}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-mono font-semibold ${
                              isRevoked ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {t.title_status}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          {t.parcel_name} ({t.region}) —{' '}
                          <span className="font-mono tabular-nums">{t.area_sqm} m²</span>
                        </p>
                        <p className="text-xs text-slate-600">
                          Current Owner: <span className="font-medium text-slate-900">{t.owner_name}</span>{' '}
                          (<span className="font-mono">{shortenAddress(t.owner_wallet)}</span>)
                        </p>
                        {isRevoked && t.revocation_reason && (
                          <p className="text-xs text-red-700">
                            Revoked ({t.revocation_ground}): {t.revocation_reason}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        {isOwner && !isRevoked && !hasOpenListing && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              step="any"
                              aria-label={`Listing price in USD for ${t.title_number}`}
                              value={listPriceByTitle[t.id] ?? '2500'}
                              onChange={(e) =>
                                setListPriceByTitle((prev) => ({ ...prev, [t.id]: e.target.value }))
                              }
                              className="w-24 px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
                            />
                            <button
                              type="button"
                              disabled={busyId === `list-${t.id}`}
                              onClick={() => handleListForSale(t)}
                              className="px-3 py-1.5 text-xs font-semibold text-[#1F2421] bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/20 disabled:opacity-50 rounded-md whitespace-nowrap transition-colors"
                            >
                              {busyId === `list-${t.id}` ? 'Listing...' : 'List for Sale ($)'}
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={busyId === `block-${t.id}`}
                          onClick={() => handleTestTransferBlock(t.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md whitespace-nowrap"
                        >
                          {busyId === `block-${t.id}` ? 'Testing...' : 'Verify Direct Transfer Block'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'marketplace' && (
        <MarketplaceTabPanel
          user={user}
          isRegistrar={false}
          listings={listings}
          eligibility={eligibility}
          loading={loading}
          busyId={busyId}
          connectedWallet={walletInfo?.address || manualWalletAddress || user?.walletAddress || ''}
          walletInfo={walletInfo}
          onConnectWallet={handleConnectWalletFromMarketplace}
          onSetManualWallet={connectManualWallet}
          verifiedReportsByListing={verifiedReportsByListing}
          onVerifyBeforeBuy={handleVerifyBeforeBuying}
          onPublishListing={publishVerifiedListing}
          onBuyEscrow={handleBuyEscrow}
          onSettleSale={handleSettleSale}
          onCancelListing={handleCancelListing}
          onValidationError={(text) => setFeedback({ type: 'error', text })}
        />
      )}

      {activeTab === 'ledger' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-slate-600" aria-hidden="true" />
              <span>Polygon / Hardhat Blockchain Transaction Ledger</span>
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {transactions.length} tx(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-4 font-medium">Type</th>
                  <th className="py-2.5 px-4 font-medium">Tx Hash</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Gas</th>
                  <th className="py-2.5 px-4 font-medium text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center font-sans text-slate-500">
                      No on-chain transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const explorerTxUrl = buildExplorerTxUrl(
                      tx.tx_hash,
                      contractInfo?.explorerBaseUrl
                    );
                    return (
                      <tr key={tx.id}>
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{tx.tx_type}</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {explorerTxUrl ? (
                            <a
                              href={explorerTxUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 underline hover:text-slate-900"
                            >
                              <span>{shortenAddress(tx.tx_hash)}</span>
                              <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                          ) : (
                            shortenAddress(tx.tx_hash)
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-semibold ${
                            tx.status === 'CONFIRMED' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {tx.status}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600">{tx.gas_used || '—'}</td>
                        <td className="py-2.5 px-4 text-right text-slate-600">
                          {tx.latency_ms != null ? `${tx.latency_ms} ms` : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <BuyerVerificationModal
        listing={verifyModalState.listing}
        report={verifyModalState.report}
        loading={verifyModalState.loading}
        error={verifyModalState.error}
        currentUserId={user?.id}
        currentUserWallet={user?.walletAddress || ''}
        walletInfo={walletInfo}
        manualWalletAddress={manualWalletAddress}
        onConnectWallet={connectWallet}
        onSetManualWallet={connectManualWallet}
        onDisconnectWallet={disconnectWallet}
        onSwitchNetwork={handleSwitchTargetNetwork}
        onActivateOnChain={handleActivateOnChain}
        busyId={busyId}
        onReverify={handleVerifyBeforeBuying}
        onConfirmBuy={handleBuyEscrow}
        onClose={() =>
          setVerifyModalState({ listing: null, report: null, loading: false, error: '' })
        }
      />
    </div>
  );
}
