export type UiPaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'EXPIRED';

export function buildEtherscanTxUrl(
  txHash: string | null | undefined,
  baseUrl = 'https://sepolia.etherscan.io'
): string | null {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) {
    return null;
  }
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/tx/${txHash.trim()}`;
}

export function formatNgnAmount(amount: number | string | null | undefined): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 'NGN 0.00';
  return `NGN ${num.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getPaymentStatusMeta(status: string | null | undefined): {
  label: string;
  toneClass: string;
  description: string;
} {
  switch (status) {
    case 'PAID':
      return {
        label: 'PAID',
        toneClass: 'text-emerald-800',
        description:
          'Confirmed on Ethereum Sepolia. Eligible for Administrator GIS Validation (does not auto-approve ownership or issue NFT).',
      };
    case 'PROCESSING':
      return {
        label: 'PROCESSING',
        toneClass: 'text-amber-800',
        description:
          'Transaction broadcast to Ethereum Sepolia; awaiting independent backend receipt verification.',
      };
    case 'FAILED':
      return {
        label: 'FAILED',
        toneClass: 'text-red-700',
        description: 'Transaction failed or verification rejected. Generate a fresh quote to retry.',
      };
    case 'EXPIRED':
      return {
        label: 'EXPIRED',
        toneClass: 'text-slate-600',
        description: 'This ETH/NGN payment quote expired. Generate a fresh quote to continue.',
      };
    default:
      return {
        label: 'PENDING',
        toneClass: 'text-[#1F2421]',
        description: 'Awaiting native ETH wallet payment (MetaMask or Trust Wallet) on Ethereum Sepolia Testnet.',
      };
  }
}

export function classifyWalletPaymentError(err: any): string {
  if (!err) return 'Payment transaction failed.';
  const code = err?.code ?? err?.info?.error?.code;
  const msg = String(err?.shortMessage || err?.reason || err?.message || '').toLowerCase();

  if (code === 4001 || code === 'ACTION_REJECTED' || msg.includes('user rejected') || msg.includes('user denied')) {
    return 'Transaction was rejected in your wallet. No ETH was spent.';
  }
  if (code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds') || msg.includes('insufficient sepolia')) {
    return 'Insufficient Sepolia test ETH balance to cover the registration fee and gas.';
  }
  if (msg.includes('duplicateregistrationpayment')) {
    return 'This land registration reference has already been paid on-chain.';
  }
  if (msg.includes('quoteexpired')) {
    return 'This payment quote expired on-chain. Refresh the quote and retry.';
  }
  if (msg.includes('network') || msg.includes('chain') || code === 'NETWORK_ERROR') {
    return 'Network error communicating with Ethereum Sepolia. Check your wallet network connection and retry.';
  }
  const apiError = err?.response?.data?.error;
  if (typeof apiError === 'string' && apiError.trim()) {
    return apiError.trim();
  }
  if (apiError && typeof apiError === 'object' && typeof apiError.message === 'string') {
    return apiError.message;
  }
  if (typeof err?.shortMessage === 'string' && err.shortMessage.trim()) {
    return err.shortMessage;
  }
  if (typeof err?.message === 'string' && err.message.trim()) {
    return err.message;
  }
  return 'Unable to complete Ethereum payment.';
}
