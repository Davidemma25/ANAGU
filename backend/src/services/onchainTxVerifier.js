import fs from 'node:fs';
import path from 'node:path';
import { Interface, isAddress } from 'ethers';

const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

export const TITLE_CONTRACT_EVENTS_ABI = [
  'event TitleIssued(uint256 indexed tokenId, address indexed owner, string parcelCode, string applicationRef, string metadataUri, address indexed issuedBy)',
  'event TitleRevoked(uint256 indexed tokenId, uint8 indexed ground, string reason, address indexed revokedBy, uint256 revokedAt)',
  'event ParcelListed(uint256 indexed tokenId, address indexed seller, uint256 priceWei)',
  'event ListingCancelled(uint256 indexed tokenId, address indexed cancelledBy)',
  'event EscrowFunded(uint256 indexed tokenId, address indexed buyer, uint256 amountWei)',
  'event SaleSettled(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 priceWei)',
  'event EscrowRefunded(uint256 indexed tokenId, address indexed buyer, uint256 amountWei)',
];

const defaultTitleInterface = new Interface(TITLE_CONTRACT_EVENTS_ABI);

export function isValidEvmTxHash(txHash) {
  return Boolean(txHash && TX_HASH_REGEX.test(String(txHash).trim()));
}

export async function verifyContractTxReceipt({
  provider,
  txHash,
  expectedContractAddress,
  expectedEventName,
  contractInterface,
  expectedTokenId = null,
  expectedActorAddress = '',
  expectedCounterpartyAddress = '',
  expectedAmountWei = null,
  actorArgName = 'buyer',
  counterpartyArgName = 'buyer',
  amountArgName = 'amount',
}) {
  const cleanHash = String(txHash || '').trim();
  if (!isValidEvmTxHash(cleanHash)) {
    const err = new Error('Submitted transaction hash is not a valid 66-character 0x hash.');
    err.status = 400;
    throw err;
  }
  if (!isAddress(expectedContractAddress || '')) {
    const err = new Error('ANAGU escrow contract address is not configured.');
    err.status = 500;
    throw err;
  }

  const receipt = await provider.getTransactionReceipt(cleanHash);
  if (!receipt) {
    const err = new Error(
      'Transaction has not been confirmed on-chain yet. Wait and retry.'
    );
    err.status = 409;
    throw err;
  }
  if (receipt.status !== 1) {
    const err = new Error('Submitted smart contract transaction reverted on-chain.');
    err.status = 400;
    throw err;
  }
  if (String(receipt.to || '').toLowerCase() !== expectedContractAddress.toLowerCase()) {
    const err = new Error(
      'Submitted transaction target address does not match the ANAGU escrow contract.'
    );
    err.status = 400;
    throw err;
  }

  let matchedParsed = null;
  for (const log of receipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== expectedContractAddress.toLowerCase()) continue;
    try {
      const parsed = contractInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === expectedEventName) {
        matchedParsed = parsed;
        break;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }
  if (!matchedParsed) {
    const err = new Error(
      `Confirmed transaction did not emit ${expectedEventName} on the ANAGU escrow contract.`
    );
    err.status = 400;
    throw err;
  }

  if (expectedTokenId != null &&
      BigInt(matchedParsed.args.tokenId).toString() !== String(expectedTokenId)) {
    const err = new Error('Escrow transaction token ID does not match the listing.');
    err.status = 400;
    throw err;
  }
  if (expectedAmountWei != null) {
    const eventAmount = expectedEventName === 'EscrowSettled'
      ? BigInt(matchedParsed.args.sellerAmount) + BigInt(matchedParsed.args.treasuryAmount)
      : BigInt(matchedParsed.args[amountArgName]);
    if (eventAmount !== BigInt(expectedAmountWei)) {
      const err = new Error('Escrow transaction amount does not match the listing price.');
      err.status = 400;
      throw err;
    }
  }
  if (expectedActorAddress &&
      isAddress(expectedActorAddress) &&
      matchedParsed.args[actorArgName]?.toLowerCase() !== expectedActorAddress.toLowerCase()) {
    const err = new Error('Escrow transaction wallet does not match the submitted wallet.');
    err.status = 400;
    throw err;
  }
  if (expectedCounterpartyAddress &&
      isAddress(expectedCounterpartyAddress) &&
      matchedParsed.args[counterpartyArgName]?.toLowerCase() !== expectedCounterpartyAddress.toLowerCase()) {
    const err = new Error('Escrow transaction counterparty does not match the listing.');
    err.status = 400;
    throw err;
  }
  return { receipt, eventArgs: matchedParsed.args };
}

export function resolvePolygonRpcUrl(envSource = process.env, fallbackRpcUrl = '') {
  const candidates = [
    envSource?.POLYGON_AMOY_RPC_URL,
    envSource?.POLYGON_RPC_URL,
    envSource?.BLOCKCHAIN_RPC_URL,
    fallbackRpcUrl,
  ];
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export function resolveDeployedContractAddress({
  envAddress = '',
  deploymentFilePath = path.resolve(process.cwd(), 'contracts', 'deployed-amoy-title.json'),
} = {}) {
  const explicit = String(envAddress || '').trim();
  if (explicit && isAddress(explicit)) {
    return explicit;
  }
  if (deploymentFilePath && fs.existsSync(deploymentFilePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(deploymentFilePath, 'utf8'));
      const fileAddr = String(parsed?.contractAddress || '').trim();
      if (fileAddr && isAddress(fileAddr)) {
        return fileAddr;
      }
    } catch {
      // Ignore malformed deployment metadata file
    }
  }
  return '';
}

export function resolveExplorerBaseUrl(chainId, envSource = process.env) {
  const id = Number(chainId);
  if (id === 80002) {
    return String(envSource?.POLYGON_AMOY_EXPLORER_URL || 'https://amoy.polygonscan.com').replace(
      /\/+$/,
      ''
    );
  }
  if (id === 137) {
    return 'https://polygonscan.com';
  }
  if (id === 11155111) {
    return String(envSource?.SEPOLIA_ETHERSCAN_URL || 'https://sepolia.etherscan.io').replace(
      /\/+$/,
      ''
    );
  }
  return '';
}

export function classifyOnChainMode({
  isInProcess = false,
  isServerlessFallback = false,
  chainId = 31337,
  envSource = process.env,
} = {}) {
  if (isServerlessFallback) {
    return {
      onChainMode: 'SIMULATED_FALLBACK',
      isRealOnChain: false,
      explorerBaseUrl: '',
    };
  }
  if (isInProcess || Number(chainId) === 31337) {
    return {
      onChainMode: 'LOCAL_HARDHAT',
      isRealOnChain: false,
      explorerBaseUrl: '',
    };
  }
  return {
    onChainMode: 'REAL_TESTNET',
    isRealOnChain: true,
    explorerBaseUrl: resolveExplorerBaseUrl(chainId, envSource),
  };
}

/**
 * Verifies a client-submitted transaction against the deployed AnaguLandTitle contract:
 * - valid 66-char hash
 * - receipt confirmed with status === 1
 * - receipt.to matches the deployed contract address
 * - emits the expected contract event (`ParcelListed`, `EscrowFunded`, `ListingCancelled`)
 *   matching tokenId (and priceWei / actor address when applicable).
 */
export async function verifyTitleContractTxReceipt({
  provider,
  txHash,
  expectedContractAddress,
  expectedEventName,
  expectedTokenId,
  expectedPriceWei = null,
  expectedActorAddress = '',
  expectedCounterpartyAddress = '',
  titleInterface = defaultTitleInterface,
}) {
  const cleanHash = String(txHash || '').trim();
  if (!isValidEvmTxHash(cleanHash)) {
    const err = new Error('Submitted transaction hash is not a valid 66-character 0x hash.');
    err.status = 400;
    throw err;
  }

  if (!isAddress(expectedContractAddress || '')) {
    const err = new Error('AnaguLandTitle contract address is not configured.');
    err.status = 500;
    throw err;
  }

  let receipt = await provider.getTransactionReceipt(cleanHash);
  if (!receipt && typeof provider.waitForTransaction === 'function') {
    try {
      receipt = await provider.waitForTransaction(cleanHash, 1, 8000);
    } catch {
      receipt = null;
    }
  }

  if (!receipt) {
    const err = new Error(
      'Transaction has not been confirmed on-chain yet. Wait a few seconds and retry.'
    );
    err.status = 409;
    throw err;
  }

  if (receipt.status !== 1) {
    const err = new Error('Submitted smart contract transaction reverted on-chain.');
    err.status = 400;
    throw err;
  }

  const normalizedContract = expectedContractAddress.toLowerCase();
  const receiptTo = String(receipt.to || '').toLowerCase();
  if (receiptTo !== normalizedContract) {
    const err = new Error(
      'Submitted transaction target address does not match the official AnaguLandTitle contract.'
    );
    err.status = 400;
    throw err;
  }

  let matchedParsed = null;
  for (const log of receipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== normalizedContract) continue;
    try {
      const parsed = titleInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed && parsed.name === expectedEventName) {
        matchedParsed = parsed;
        break;
      }
    } catch {
      // Ignore unrelated logs
    }
  }

  if (!matchedParsed) {
    const err = new Error(
      `Confirmed transaction did not emit the required ${expectedEventName} event on AnaguLandTitle.`
    );
    err.status = 400;
    throw err;
  }

  if (expectedTokenId !== undefined && expectedTokenId !== null) {
    const eventTokenId = BigInt(matchedParsed.args.tokenId).toString();
    if (eventTokenId !== String(expectedTokenId)) {
      const err = new Error(
        `Transaction token ID mismatch (expected Token #${expectedTokenId}, got #${eventTokenId}).`
      );
      err.status = 400;
      throw err;
    }
  }

  if (expectedEventName === 'ParcelListed') {
    const eventSeller = String(matchedParsed.args.seller || '');
    const eventPriceWei = BigInt(matchedParsed.args.priceWei);
    if (
      expectedActorAddress &&
      isAddress(expectedActorAddress) &&
      eventSeller.toLowerCase() !== expectedActorAddress.toLowerCase()
    ) {
      const err = new Error('Listed seller wallet does not match the on-chain ParcelListed event.');
      err.status = 400;
      throw err;
    }
    if (expectedPriceWei != null && eventPriceWei !== BigInt(expectedPriceWei)) {
      const err = new Error('On-chain ParcelListed price does not match the submitted price.');
      err.status = 400;
      throw err;
    }
    return {
      receipt,
      eventArgs: {
        tokenId: matchedParsed.args.tokenId.toString(),
        seller: eventSeller,
        priceWei: eventPriceWei.toString(),
      },
    };
  }

  if (expectedEventName === 'EscrowFunded') {
    const eventBuyer = String(matchedParsed.args.buyer || '');
    const eventAmountWei = BigInt(matchedParsed.args.amountWei);
    if (
      expectedActorAddress &&
      isAddress(expectedActorAddress) &&
      eventBuyer.toLowerCase() !== expectedActorAddress.toLowerCase()
    ) {
      const err = new Error('Buyer wallet does not match the on-chain EscrowFunded payer.');
      err.status = 400;
      throw err;
    }
    if (expectedPriceWei != null && eventAmountWei < BigInt(expectedPriceWei)) {
      const err = new Error('Escrow payment amount is less than the required listing price.');
      err.status = 400;
      throw err;
    }
    return {
      receipt,
      eventArgs: {
        tokenId: matchedParsed.args.tokenId.toString(),
        buyer: eventBuyer,
        amountWei: eventAmountWei.toString(),
      },
    };
  }

  if (expectedEventName === 'ListingCancelled') {
    const cancelledBy = String(matchedParsed.args.cancelledBy || '');
    return {
      receipt,
      eventArgs: {
        tokenId: matchedParsed.args.tokenId.toString(),
        cancelledBy,
      },
    };
  }

  if (expectedEventName === 'SaleSettled') {
    const seller = String(matchedParsed.args.seller || '');
    const buyer = String(matchedParsed.args.buyer || '');
    const priceWei = BigInt(matchedParsed.args.priceWei);
    if (
      expectedActorAddress &&
      isAddress(expectedActorAddress) &&
      seller.toLowerCase() !== expectedActorAddress.toLowerCase()
    ) {
      const err = new Error('Sale seller wallet does not match the listing seller.');
      err.status = 400;
      throw err;
    }
    if (
      expectedCounterpartyAddress &&
      isAddress(expectedCounterpartyAddress) &&
      buyer.toLowerCase() !== expectedCounterpartyAddress.toLowerCase()
    ) {
      const err = new Error('Sale buyer wallet does not match the listing buyer.');
      err.status = 400;
      throw err;
    }
    if (expectedPriceWei != null && priceWei !== BigInt(expectedPriceWei)) {
      const err = new Error('On-chain sale price does not match the listing price.');
      err.status = 400;
      throw err;
    }
    return {
      receipt,
      eventArgs: {
        tokenId: matchedParsed.args.tokenId.toString(),
        seller,
        buyer,
        priceWei: priceWei.toString(),
      },
    };
  }

  return {
    receipt,
    eventArgs: {
      tokenId: matchedParsed.args.tokenId?.toString?.() || '',
    },
  };
}
