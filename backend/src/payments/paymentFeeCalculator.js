import crypto from 'node:crypto';
import { Wallet, formatEther, getBytes, keccak256, solidityPackedKeccak256 } from 'ethers';

const WEI_ROUNDING_GRANULARITY = 100_000_000_000n; // 1e11 wei (0.0000001 ETH safe ceiling step)
const WEI_PER_ETH = 1_000_000_000_000_000_000n;

/**
 * Computes native ETH wei from a configurable Nigerian Naira (NGN) test fee
 * using integer BigInt arithmetic with safe round-up rules to avoid float drift.
 */
export function convertNgnToWeiSafely(amountNgn, ethNgnExchangeRate) {
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    throw new Error('Configurable registration test fee (NGN) must be a positive number.');
  }
  if (!Number.isFinite(ethNgnExchangeRate) || ethNgnExchangeRate <= 0) {
    throw new Error('ETH/NGN exchange rate must be a positive number.');
  }

  // Scale both NGN and rate to kobo / 1e-4 precision for exact integer division
  const scaledNgn = BigInt(Math.round(amountNgn * 10_000));
  const scaledRate = BigInt(Math.round(ethNgnExchangeRate * 10_000));

  if (scaledRate <= 0n) {
    throw new Error('ETH/NGN exchange rate is too small.');
  }

  const rawWei = (scaledNgn * WEI_PER_ETH + scaledRate - 1n) / scaledRate;
  const roundedWei =
    ((rawWei + WEI_ROUNDING_GRANULARITY - 1n) / WEI_ROUNDING_GRANULARITY) *
    WEI_ROUNDING_GRANULARITY;

  return roundedWei > 0n ? roundedWei : WEI_ROUNDING_GRANULARITY;
}

export function calculateRegistrationFeeQuote(input) {
  const nowMs = input.nowMs ?? Date.now();
  const ttlSeconds = Math.max(60, Math.floor(input.quoteTtlSeconds || 900));
  const amountWeiBigInt = convertNgnToWeiSafely(input.testFeeNgn, input.ethNgnExchangeRate);
  const amountEth = formatEther(amountWeiBigInt);

  const createdAt = new Date(nowMs).toISOString();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const expiresAtUnix = Math.floor(expiresAtMs / 1000);

  const quoteId = input.quoteId || `0x${crypto.randomBytes(32).toString('hex')}`;

  return {
    amountNgn: Number(input.testFeeNgn.toFixed(2)),
    exchangeRate: Number(input.ethNgnExchangeRate.toFixed(4)),
    rateSource: input.rateSource || 'CONFIGURABLE_TEST_RATE',
    amountWei: amountWeiBigInt.toString(),
    amountEth,
    quoteId,
    createdAt,
    expiresAt,
    expiresAtUnix,
    isTestPayment: true,
    currencyDisclaimer:
      'Test registration fee payable in Sepolia test ETH only. Test ETH has no real monetary value.',
  };
}

export function isQuoteExpired(expiresAtIso, nowMs = Date.now()) {
  if (!expiresAtIso) return false;
  const expiresMs = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(expiresMs)) return true;
  return nowMs > expiresMs;
}

export async function signPaymentQuoteOffChain(params) {
  const wallet = new Wallet(params.privateKey);
  const regRefHash = keccak256(Buffer.from(params.registrationReference, 'utf8'));
  const packed = solidityPackedKeccak256(
    ['uint256', 'address', 'bytes32', 'bytes32', 'uint256', 'uint64'],
    [
      params.chainId,
      params.contractAddress,
      regRefHash,
      params.quoteId,
      BigInt(params.amountWei),
      params.expiresAtUnix,
    ]
  );
  return wallet.signMessage(getBytes(packed));
}
