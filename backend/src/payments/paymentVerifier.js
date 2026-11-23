import { Interface, isAddress } from 'ethers';
import { ANAGU_PAYMENT_ABI } from './anaguPaymentAbi.js';

const paymentInterface = new Interface(ANAGU_PAYMENT_ABI);
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

export function isValidTxHash(txHash) {
  return Boolean(txHash && TX_HASH_REGEX.test(txHash.trim()));
}

/**
 * Independently verifies an Ethereum registration fee transaction directly
 * against an Ethereum provider without trusting client-supplied claims.
 */
export async function verifyRegistrationPaymentOnChain(params) {
  const txHash = params.txHash.trim();
  if (!isValidTxHash(txHash)) {
    return {
      status: 'FAILED',
      verified: false,
      reason: 'Invalid Ethereum transaction hash format.',
    };
  }

  if (!isAddress(params.expectedContractAddress)) {
    return {
      status: 'FAILED',
      verified: false,
      reason: 'AnaguPayment contract address is not configured or invalid on the server.',
    };
  }

  const normalizedContract = params.expectedContractAddress.toLowerCase();
  const network = await params.provider.getNetwork();
  const actualChainId = Number(network.chainId);

  if (actualChainId !== Number(params.expectedChainId)) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      reason: `Network chain ID mismatch: expected ${params.expectedChainId}, RPC returned ${actualChainId}.`,
    };
  }

  const [tx, receipt] = await Promise.all([
    params.provider.getTransaction(txHash),
    params.provider.getTransactionReceipt(txHash),
  ]);

  if (!tx || !receipt) {
    return {
      status: 'PROCESSING',
      verified: false,
      chainId: actualChainId,
      reason: 'Transaction is still pending inclusion on Ethereum Sepolia.',
    };
  }

  const targetAddress = (receipt.to || tx.to || '').toLowerCase();
  if (targetAddress !== normalizedContract) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: 'Transaction target address does not match the official AnaguPayment contract.',
    };
  }

  if (receipt.status !== 1) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: 'Ethereum transaction reverted on-chain (receipt status = 0).',
    };
  }

  let matchedEvent = null;

  for (let i = 0; i < receipt.logs.length; i += 1) {
    const log = receipt.logs[i];
    if ((log.address || '').toLowerCase() !== normalizedContract) continue;
    try {
      const parsed = paymentInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed && parsed.name === 'PaymentReceived') {
        matchedEvent = {
          registrationReference: String(parsed.args.registrationReference),
          quoteId: String(parsed.args.quoteId),
          payer: String(parsed.args.payer),
          amountWei: BigInt(parsed.args.amountWei),
          logIndex: Number(log.index ?? log.logIndex ?? i),
        };
        break;
      }
    } catch {
      // Ignore unrelated logs
    }
  }

  if (!matchedEvent) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: 'Transaction did not emit a valid PaymentReceived event from AnaguPayment.',
    };
  }

  if (matchedEvent.registrationReference !== params.expectedRegistrationReference) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: `Payment registration reference mismatch (expected ${params.expectedRegistrationReference}, got ${matchedEvent.registrationReference}).`,
    };
  }

  if (matchedEvent.payer.toLowerCase() !== tx.from.toLowerCase()) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: 'Event payer address does not match transaction sender.',
    };
  }

  if (
    params.expectedPayerAddress &&
    isAddress(params.expectedPayerAddress) &&
    matchedEvent.payer.toLowerCase() !== params.expectedPayerAddress.toLowerCase()
  ) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: `Payer wallet mismatch: expected ${params.expectedPayerAddress}, found ${matchedEvent.payer}.`,
    };
  }

  const requiredWei = BigInt(params.expectedAmountWei);
  if (matchedEvent.amountWei < requiredWei) {
    return {
      status: 'FAILED',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      reason: `Paid ETH amount (${matchedEvent.amountWei} wei) is less than required (${requiredWei} wei).`,
    };
  }

  const currentBlock = await params.provider.getBlockNumber();
  const confirmations =
    currentBlock >= receipt.blockNumber ? currentBlock - receipt.blockNumber + 1 : 0;
  const minConfirmations = Math.max(1, params.requiredConfirmations ?? 1);

  if (confirmations < minConfirmations) {
    return {
      status: 'PROCESSING',
      verified: false,
      chainId: actualChainId,
      blockNumber: receipt.blockNumber,
      confirmations,
      payerAddress: matchedEvent.payer,
      amountWei: matchedEvent.amountWei.toString(),
      registrationReference: matchedEvent.registrationReference,
      quoteId: matchedEvent.quoteId,
      logIndex: matchedEvent.logIndex,
      reason: `Waiting for confirmations (${confirmations}/${minConfirmations}).`,
    };
  }

  return {
    status: 'PAID',
    verified: true,
    chainId: actualChainId,
    blockNumber: receipt.blockNumber,
    confirmations,
    payerAddress: matchedEvent.payer,
    amountWei: matchedEvent.amountWei.toString(),
    registrationReference: matchedEvent.registrationReference,
    quoteId: matchedEvent.quoteId,
    logIndex: matchedEvent.logIndex,
  };
}
