import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, Award, CheckCircle2, ExternalLink, ShieldAlert } from 'lucide-react';
import { adminApi, extractErrorMessage } from '../services/adminApi.js';
import { shortenAddress } from '../services/walletService.js';
import {
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  formatUsdPrice,
  resolveListingPriceUsd,
} from '../utils/marketplaceUtils.js';

export default function AdminTitleIssuancePage() {
  const [activeTab, setActiveTab] = useState('issuance');
  const [issuanceQueue, setIssuanceQueue] = useState([]);
  const [titles, setTitles] = useState([]);
  const [escrowListings, setEscrowListings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [contractInfo, setContractInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [blockProof, setBlockProof] = useState(null);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const loadAdminTitleData = useCallback(async () => {
    try {
      const [titlesRes, marketRes, contractRes] = await Promise.all([
        adminApi.get('/titles'),
        adminApi.get('/marketplace/listings'),
        adminApi.get('/titles/contract'),
      ]);
      setIssuanceQueue(titlesRes.data.issuanceQueue || []);
      setTitles(titlesRes.data.titles || []);
      setTransactions(titlesRes.data.transactions || []);
      const allListings = marketRes.data.listings || [];
      setEscrowListings(allListings.filter((l) => l.listing_status === 'ESCROW_FUNDED'));
      setContractInfo(contractRes.data || null);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Failed to load title issuance queues.'),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminTitleData();
  }, [loadAdminTitleData]);

  const handleMintTitle = async (applicationId) => {
    setFeedback({ type: '', text: '' });
    setBusyId(`mint-${applicationId}`);
    try {
      const { data } = await adminApi.post(`/titles/mint/${applicationId}`, {});
      setFeedback({ type: 'success', text: data.message });
      await loadAdminTitleData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Failed to mint ERC-721 NFT land title.'),
      });
    } finally {
      setBusyId('');
    }
  };

  const handleSettleSale = async (listingId) => {
    setFeedback({ type: '', text: '' });
    setBusyId(`settle-${listingId}`);
    try {
      const { data } = await adminApi.post(`/marketplace/listings/${listingId}/settle`, {});
      setFeedback({ type: 'success', text: data.message });
      await loadAdminTitleData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Failed to settle marketplace escrow sale.'),
      });
    } finally {
      setBusyId('');
    }
  };

  const handleTestTransferBlock = async (titleId) => {
    setFeedback({ type: '', text: '' });
    setBlockProof(null);
    setBusyId(`block-${titleId}`);
    try {
      const { data } = await adminApi.post(`/titles/${titleId}/test-transfer-block`, {});
      setBlockProof(data);
      setFeedback({ type: 'success', text: data.message });
      await loadAdminTitleData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Failed to verify direct transfer block.'),
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
            Title Issuance &amp; Escrow Settlement
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Mint ERC-721 digital land titles for VERIFIED claims and settle escrow-funded marketplace transfers.
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#FDE878]/50 border border-[#E5CF5D] rounded-lg self-start max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('issuance')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'issuance'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            Mint Queue ({issuanceQueue.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('escrow')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'escrow'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            Escrow Settlement ({escrowListings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('titles')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === 'titles'
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-[#1F2421]/80 hover:text-[#1F2421]'
            }`}
          >
            Issued Titles ({titles.length})
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
      </div>

      {contractInfo && (
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded font-semibold ${
                contractInfo.isRealOnChain
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              {contractInfo.isRealOnChain ? 'Real On-Chain' : 'Prototype Ledger'}
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
          </div>
          <span className="font-mono text-slate-500">Sole Administrator Signing Authority</span>
        </div>
      )}

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

      {activeTab === 'issuance' && (
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1F2421] flex items-center gap-2">
                <Award className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
                <span>Title Issuance Queue (VERIFIED Claims)</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Applications appear here only after passing Sepolia registration payment, GIS spatial validation, and Oracle verification.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {issuanceQueue.length} ready
            </span>
          </div>

          {loading ? (
            <p className="py-6 text-center text-xs text-slate-500">Loading issuance queue...</p>
          ) : issuanceQueue.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No verified applications awaiting NFT title issuance.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-medium">Reference &amp; Parcel</th>
                    <th className="py-2.5 px-3 font-medium">Applicant &amp; Wallet</th>
                    <th className="py-2.5 px-3 font-medium text-right">Area (m²)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Oracle Score</th>
                    <th className="py-2.5 px-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {issuanceQueue.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 px-3">
                        <p className="font-mono font-medium text-slate-900">
                          {item.reference_code} · {item.parcel_code}
                        </p>
                        <p className="text-slate-600">{item.parcel_name}</p>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-medium text-slate-900">{item.applicant_name}</p>
                        <p className="font-mono text-slate-500">
                          {item.applicant_wallet ? shortenAddress(item.applicant_wallet) : 'Missing wallet'}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {item.area_sqm}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {item.oracle_score ?? '—'}/100
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          disabled={busyId === `mint-${item.id}`}
                          onClick={() => handleMintTitle(item.id)}
                          className="px-3.5 py-1.5 font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap"
                        >
                          {busyId === `mint-${item.id}` ? 'Minting NFT...' : 'Mint NFT Title'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'escrow' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#1F2421]">
              Escrow-Funded Marketplace Transfers Ready for Settlement
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {escrowListings.length} pending
            </span>
          </div>

          {escrowListings.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">
              No escrow-funded marketplace purchases awaiting Administrator settlement.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {escrowListings.map((listing) => (
                <div
                  key={listing.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1 text-xs">
                    <p className="font-mono font-semibold text-slate-900">
                      {listing.title_number} · Token #{listing.token_id} · {listing.parcel_code}
                    </p>
                    <p className="text-sm font-semibold text-slate-900">{listing.parcel_name}</p>
                    <p className="text-slate-600">
                      Seller: {listing.seller_name} → Buyer: {listing.buyer_name || 'Verified Buyer'} ·{' '}
                      <span className="font-mono font-bold text-[#1F2421]">
                        {formatUsdPrice(resolveListingPriceUsd(listing))} ({listing.price_pol} POL)
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === `settle-${listing.id}`}
                    onClick={() => handleSettleSale(listing.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#FDE878] hover:bg-[#f7de59] border border-[#1F2421]/25 text-[#1F2421] rounded-md whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {busyId === `settle-${listing.id}` ? 'Settling Escrow...' : 'Settle Sale'}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'titles' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Issued ERC-721 Digital Land Titles Registry
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {titles.length} title(s)
            </span>
          </div>

          {titles.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">
              No NFT land titles have been minted yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {titles.map((t) => {
                const isRevoked = t.title_status === 'REVOKED';
                return (
                  <div
                    key={t.id}
                    className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
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
                        Current Holder: <span className="font-medium text-slate-900">{t.owner_name}</span>{' '}
                        (<span className="font-mono">{shortenAddress(t.owner_wallet)}</span>)
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === `block-${t.id}`}
                      onClick={() => handleTestTransferBlock(t.id)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                    >
                      {busyId === `block-${t.id}` ? 'Testing...' : 'Verify Direct Transfer Block'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === 'ledger' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-slate-600" aria-hidden="true" />
              <span>Blockchain Transaction Ledger</span>
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
    </div>
  );
}
