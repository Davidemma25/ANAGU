import { BrowserProvider, Contract, formatEther, getAddress, isAddress, parseEther } from 'ethers';
import {
  collectEventTargetProviders,
  detectAvailableWallets,
  formatShortWalletAddress,
  getWalletProviderLabel,
  initEip6963Discovery,
  isValidEip1193Provider,
  normalizeWalletType,
  requestWalletAccounts,
  resolveEvmNetworkName,
  selectWalletProvider,
} from '../utils/walletUtils.js';

if (typeof window !== 'undefined') {
  initEip6963Discovery(window);
}

let activeWalletSession = null;
let activeTokenAddress = ''; // set by AuthContext after contractInfo loads

export function setActiveTokenAddress(tokenAddress) {
  activeTokenAddress = isAddress(tokenAddress || '') ? tokenAddress : '';
}

export const POLYGON_NETWORKS = {
  amoy: {
    chainIdDecimal: 80002,
    chainIdHex: '0x13882',
    chainName: 'Polygon Amoy Testnet',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://rpc-amoy.polygon.technology'],
    blockExplorerUrls: ['https://amoy.polygonscan.com'],
  },
  hardhat: {
    chainIdDecimal: 31337,
    chainIdHex: '0x7a69',
    chainName: 'Hardhat Local EVM (Polygon Fork)',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['http://127.0.0.1:8545'],
    blockExplorerUrls: [],
  },
};

export const ETHEREUM_SEPOLIA_NETWORK = {
  chainIdDecimal: 11155111,
  chainIdHex: '0xaa36a7',
  chainName: 'Ethereum Sepolia Testnet',
  nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

export function getAvailableWallets() {
  if (typeof window !== 'undefined') {
    initEip6963Discovery(window);
  }
  return detectAvailableWallets();
}

export function hasInjectedWallet() {
  return getAvailableWallets().anyAvailable;
}

export function isValidPolygonAddress(address) {
  return Boolean(address && isAddress(address.trim()));
}

export function shortenAddress(address) {
  return formatShortWalletAddress(address);
}

export function clearActiveWalletSession() {
  activeWalletSession = null;
}

export { collectEventTargetProviders, getWalletProviderLabel };

/**
 * Reads the ANAGU ERC-20 token balance for a wallet address.
 * Returns { balanceAnagu, balanceAnaguRaw } or null if the token is unreachable.
 */
export async function readAnaguTokenBalance(tokenAddress, walletAddress) {
  if (!isAddress(tokenAddress || '') || !isAddress(walletAddress || '')) return null;

  const session = activeWalletSession;
  if (!session?.provider) return null;

  try {
    const provider = new BrowserProvider(session.provider);
    const tokenContract = new Contract(
      tokenAddress,
      ['function balanceOf(address account) view returns (uint256)'],
      provider
    );
    const rawBal = await tokenContract.balanceOf(walletAddress);
    return {
      balanceAnagu: Number(formatEther(rawBal)).toFixed(4),
      balanceAnaguRaw: rawBal.toString(),
    };
  } catch {
    return null;
  }
}

function resolveSigningSession(preferredWallet = 'auto') {
  const normalized = normalizeWalletType(preferredWallet);
  if (
    activeWalletSession &&
    isValidEip1193Provider(activeWalletSession.provider) &&
    (normalized === 'auto' || activeWalletSession.walletType === normalized)
  ) {
    return {
      available: true,
      ...activeWalletSession,
      error: '',
    };
  }

  return selectWalletProvider(normalized);
}

async function readProviderState(detection, rawAddress, tokenAddress = '') {
  const address = isAddress(rawAddress) ? getAddress(rawAddress) : rawAddress;

  let chainId = 1;
  let networkName = 'EVM Network';
  let balanceWei = 0n;

  try {
    const hexChainId = await detection.provider.request({ method: 'eth_chainId' });
    if (hexChainId) {
      chainId = parseInt(String(hexChainId), 16) || 1;
      networkName = resolveEvmNetworkName(chainId);
    }
  } catch {
    // Fallback to ethers provider network below
  }

  let provider;
  try {
    provider = new BrowserProvider(detection.provider);
    const network = await provider.getNetwork();
    chainId = Number(network.chainId) || chainId;
    networkName = resolveEvmNetworkName(chainId, network.name);
    balanceWei = await provider.getBalance(address);
  } catch {
    // Keep address & chainId if provider does not implement eth_getBalance
  }

  // Read ANAGU ERC-20 balance if a token address is known
  let balanceAnagu = '0.0000';
  let balanceAnaguRaw = '0';
  if (isAddress(tokenAddress || '') && provider) {
    try {
      const tokenContract = new Contract(
        tokenAddress,
        ['function balanceOf(address account) view returns (uint256)'],
        provider
      );
      const rawBal = await tokenContract.balanceOf(address);
      balanceAnaguRaw = rawBal.toString();
      balanceAnagu = Number(formatEther(rawBal)).toFixed(4);
    } catch {
      // Token contract unreachable — leave at 0
    }
  }

  const walletType = detection.walletType || (detection.isTrustWallet ? 'trustwallet' : detection.isMetaMask ? 'metamask' : 'injected');
  const walletName = detection.walletName || getWalletProviderLabel({
    walletType,
    isMetaMask: detection.isMetaMask,
    isTrustWallet: detection.isTrustWallet,
  });

  return {
    address,
    chainId,
    networkName,
    walletType,
    walletName,
    isMetaMask: Boolean(detection.isMetaMask),
    isTrustWallet: Boolean(detection.isTrustWallet),
    balancePol: Number(formatEther(balanceWei)).toFixed(4),
    balanceEth: Number(formatEther(balanceWei)).toFixed(6),
    balanceWei: balanceWei.toString(),
    balanceAnagu,
    balanceAnaguRaw,
  };
}

export async function connectBrowserWallet(preferredWallet = 'auto') {
  if (typeof window !== 'undefined') {
    initEip6963Discovery(window);
  }
  const detection = selectWalletProvider(preferredWallet);
  if (!detection.available || !detection.provider) {
    throw new Error(detection.error);
  }

  const rawAddress = await requestWalletAccounts(detection.provider, detection.walletName);
  activeWalletSession = {
    provider: detection.provider,
    walletType: detection.walletType,
    walletName: detection.walletName,
    isMetaMask: Boolean(detection.isMetaMask),
    isTrustWallet: Boolean(detection.isTrustWallet),
  };

  return readProviderState(detection, rawAddress, activeTokenAddress);
}

export async function getConnectedWalletSnapshot(preferredWallet = 'auto') {
  const normalized = normalizeWalletType(preferredWallet);

  const candidates = [];
  if (
    activeWalletSession &&
    isValidEip1193Provider(activeWalletSession.provider) &&
    (normalized === 'auto' || activeWalletSession.walletType === normalized)
  ) {
    candidates.push({ available: true, ...activeWalletSession });
  } else if (normalized !== 'auto') {
    const selected = selectWalletProvider(normalized);
    if (selected.available) candidates.push(selected);
  } else {
    const all = getAvailableWallets();
    if (all.metamask.available) candidates.push({ ...all.metamask, isTrustWallet: false });
    if (all.trustwallet.available) candidates.push({ ...all.trustwallet, isMetaMask: false });
    if (!all.metamask.available && !all.trustwallet.available && all.defaultProvider) {
      candidates.push({
        available: true,
        provider: all.defaultProvider,
        walletType: all.defaultWalletType,
        walletName: all.defaultWalletName,
        isMetaMask: false,
        isTrustWallet: false,
      });
    }
  }

  for (const detection of candidates) {
    try {
      const accounts = await detection.provider.request({ method: 'eth_accounts' });
      if (Array.isArray(accounts) && accounts.length > 0 && accounts[0]) {
        const rawAddress = String(accounts[0]).trim();
        return await readProviderState(detection, rawAddress, activeTokenAddress);
      }
    } catch {
      // Try next detected wallet provider
    }
  }

  return null;
}

export async function switchToSepoliaNetwork(preferredWallet = 'auto') {
  const session = resolveSigningSession(preferredWallet);
  if (!session.available || !session.provider) {
    throw new Error('MetaMask or Trust Wallet is required to switch to Ethereum Sepolia Testnet.');
  }

  try {
    await session.provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ETHEREUM_SEPOLIA_NETWORK.chainIdHex }],
    });
  } catch (err) {
    if (err?.code === 4902) {
      await session.provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: ETHEREUM_SEPOLIA_NETWORK.chainIdHex,
            chainName: ETHEREUM_SEPOLIA_NETWORK.chainName,
            nativeCurrency: ETHEREUM_SEPOLIA_NETWORK.nativeCurrency,
            rpcUrls: ETHEREUM_SEPOLIA_NETWORK.rpcUrls,
            blockExplorerUrls: ETHEREUM_SEPOLIA_NETWORK.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function payRegistrationFeeEth({
  contractAddress,
  abi,
  expectedChainId = 11155111,
  registrationReference,
  quoteId,
  amountWei,
  expiresAtUnix,
  quoteSignature,
  onTxBroadcast,
  preferredWallet = 'auto',
}) {
  const session = resolveSigningSession(preferredWallet);
  if (!session.available || !session.provider) {
    throw new Error('MetaMask or Trust Wallet is required to pay the registration fee in ETH.');
  }
  if (!isAddress(contractAddress || '')) {
    throw new Error('AnaguPayment smart contract address is not configured.');
  }

  const walletLabel = session.walletName || 'Wallet';
  const provider = new BrowserProvider(session.provider);
  await provider.send('eth_requestAccounts', []);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== Number(expectedChainId)) {
    throw new Error(
      `Wrong Ethereum network (${Number(network.chainId)}). Switch ${walletLabel} to Ethereum Sepolia (${expectedChainId}).`
    );
  }

  const signer = await provider.getSigner();
  const payerAddress = await signer.getAddress();
  const requiredValue = BigInt(amountWei);
  const balanceWei = await provider.getBalance(payerAddress);
  if (balanceWei < requiredValue) {
    throw new Error(
      `Insufficient Sepolia test ETH balance. Need ${formatEther(requiredValue)} ETH plus gas, wallet has ${formatEther(balanceWei)} ETH.`
    );
  }

  const contract = new Contract(contractAddress, abi, signer);
  const tx = quoteSignature
    ? await contract.payWithQuote(
        registrationReference,
        quoteId,
        requiredValue,
        BigInt(expiresAtUnix),
        quoteSignature,
        { value: requiredValue }
      )
    : await contract.payRegistrationFee(registrationReference, { value: requiredValue });

  if (typeof onTxBroadcast === 'function') {
    await onTxBroadcast({ txHash: tx.hash, walletAddress: payerAddress });
  }

  const receipt = await tx.wait();
  return {
    txHash: receipt?.hash || tx.hash,
    walletAddress: payerAddress,
    blockNumber: receipt?.blockNumber || null,
  };
}

export async function signDirectCheckoutMessage({
  preferredWallet = 'auto',
  message,
}) {
  const session = resolveSigningSession(preferredWallet);
  if (!session.available || !session.provider) {
    return null;
  }

  const provider = new BrowserProvider(session.provider);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  const walletAddress = await signer.getAddress();
  const signature = await signer.signMessage(String(message || 'ANAGU Registration Fee Checkout'));
  return {
    walletAddress,
    signature,
    signerMessage: String(message || 'ANAGU Registration Fee Checkout'),
  };
}

export async function switchPolygonNetwork(targetKey = 'amoy', preferredWallet = 'auto') {
  const session = resolveSigningSession(preferredWallet);
  if (!session.available || !session.provider) {
    throw new Error('MetaMask or Trust Wallet (EIP-1193) is required to switch networks.');
  }

  const target = POLYGON_NETWORKS[targetKey];
  if (!target) {
    throw new Error(`Unsupported network target: ${targetKey}`);
  }

  try {
    await session.provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: target.chainIdHex }],
    });
  } catch (err) {
    if (err?.code === 4902) {
      await session.provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: target.chainIdHex,
            chainName: target.chainName,
            nativeCurrency: target.nativeCurrency,
            rpcUrls: target.rpcUrls,
            ...(target.blockExplorerUrls.length
              ? { blockExplorerUrls: target.blockExplorerUrls }
              : {}),
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export function classifyPolygonTxError(err, fallback = 'On-chain transaction failed.') {
  if (!err) return fallback;
  const code = err?.code ?? err?.info?.error?.code;
  const msg = String(err?.shortMessage || err?.reason || err?.message || '').toLowerCase();

  if (
    code === 4001 ||
    code === 'ACTION_REJECTED' ||
    msg.includes('user rejected') ||
    msg.includes('user denied')
  ) {
    return 'Transaction was rejected in your wallet. No funds were spent.';
  }
  if (
    code === 'INSUFFICIENT_FUNDS' ||
    msg.includes('insufficient funds') ||
    msg.includes('insufficient pol')
  ) {
    return 'Insufficient POL balance in your connected wallet to cover the transaction and gas fees.';
  }
  const apiError = err?.response?.data?.error;
  if (typeof apiError === 'string' && apiError.trim()) {
    return apiError.trim();
  }
  if (typeof err?.shortMessage === 'string' && err.shortMessage.trim()) {
    return err.shortMessage.trim();
  }
  if (typeof err?.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }
  return fallback;
}

async function ensureWalletReadyForContract({
  preferredWallet = 'auto',
  expectedChainId = null,
}) {
  const session = resolveSigningSession(preferredWallet);
  if (!session.available || !session.provider) {
    throw new Error('Connect MetaMask or Trust Wallet to sign this on-chain transaction.');
  }

  let provider = new BrowserProvider(session.provider);
  await provider.send('eth_requestAccounts', []);

  if (expectedChainId != null) {
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== Number(expectedChainId)) {
      if (Number(expectedChainId) === 80002) {
        await switchPolygonNetwork('amoy', preferredWallet);
      } else if (Number(expectedChainId) === 31337) {
        await switchPolygonNetwork('hardhat', preferredWallet);
      } else {
        throw new Error(
          `Wrong network (${Number(net.chainId)}). Switch your wallet to Chain ${expectedChainId}.`
        );
      }
      provider = new BrowserProvider(session.provider);
    }
  }

  const signer = await provider.getSigner();
  return { provider, signer };
}

export async function signListParcelTx({
  contractAddress,
  abi,
  tokenId,
  pricePol,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { signer } = await ensureWalletReadyForContract({ preferredWallet, expectedChainId });
  const contract = new Contract(contractAddress, abi, signer);
  const tx = await contract.listParcelForSale(BigInt(tokenId), parseEther(String(pricePol)));
  const receipt = await tx.wait();
  return { txHash: receipt.hash, sellerWallet: await signer.getAddress() };
}

export async function signBuyEscrowTx({
  contractAddress,
  abi,
  tokenId,
  priceWei,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { provider, signer } = await ensureWalletReadyForContract({
    preferredWallet,
    expectedChainId,
  });
  const buyerAddress = await signer.getAddress();
  const valueWei = BigInt(priceWei);
  const balanceWei = await provider.getBalance(buyerAddress);
  if (balanceWei < valueWei) {
    throw new Error(
      `Insufficient POL balance. Need ${formatEther(valueWei)} POL plus gas, wallet has ${Number(
        formatEther(balanceWei)
      ).toFixed(4)} POL.`
    );
  }
  const contract = new Contract(contractAddress, abi, signer);
  const tx = await contract.buyListedParcel(BigInt(tokenId), { value: valueWei });
  const receipt = await tx.wait();
  return { txHash: receipt.hash, buyerWallet: buyerAddress };
}

export async function signCancelListingTx({
  contractAddress,
  abi,
  tokenId,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { signer } = await ensureWalletReadyForContract({ preferredWallet, expectedChainId });
  const contract = new Contract(contractAddress, abi, signer);
  const tx = await contract.cancelListing(BigInt(tokenId));
  const receipt = await tx.wait();
  return { txHash: receipt.hash, callerWallet: await signer.getAddress() };
}

export async function signAnaguEscrowListTx({
  escrowAddress,
  escrowAbi,
  tokenId,
  priceAnagu,
  expiresAt,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { signer } = await ensureWalletReadyForContract({ preferredWallet, expectedChainId });
  const escrow = new Contract(escrowAddress, escrowAbi, signer);
  const tx = await escrow.listParcel(
    BigInt(tokenId),
    parseEther(String(priceAnagu)),
    BigInt(expiresAt)
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, sellerWallet: await signer.getAddress() };
}

export async function signAnaguEscrowBuyTx({
  tokenAddress,
  escrowAddress,
  tokenAbi,
  escrowAbi,
  tokenId,
  priceWei,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { provider, signer } = await ensureWalletReadyForContract({
    preferredWallet,
    expectedChainId,
  });
  const buyerAddress = await signer.getAddress();
  const token = new Contract(tokenAddress, tokenAbi, signer);
  const balanceWei = await token.balanceOf(buyerAddress);
  if (balanceWei < BigInt(priceWei)) {
    throw new Error('Insufficient ANAGU balance for the listing price.');
  }

  const allowance = await token.allowance(buyerAddress, escrowAddress);
  if (allowance < BigInt(priceWei)) {
    const approval = await token.approve(escrowAddress, BigInt(priceWei));
    await approval.wait();
  }

  const escrow = new Contract(escrowAddress, escrowAbi, signer);
  const tx = await escrow.fundEscrow(BigInt(tokenId));
  const receipt = await tx.wait();
  return { txHash: receipt.hash, buyerWallet: buyerAddress };
}

export async function signAnaguEscrowCancelTx({
  escrowAddress,
  escrowAbi,
  tokenId,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { signer } = await ensureWalletReadyForContract({ preferredWallet, expectedChainId });
  const escrow = new Contract(escrowAddress, escrowAbi, signer);
  const tx = await escrow.cancelListing(BigInt(tokenId));
  const receipt = await tx.wait();
  return { txHash: receipt.hash, callerWallet: await signer.getAddress() };
}

export async function signSaleSettlementTx({
  contractAddress,
  abi,
  escrowAddress = '',
  tokenId,
  expectedChainId = null,
  preferredWallet = 'auto',
}) {
  const { signer } = await ensureWalletReadyForContract({ preferredWallet, expectedChainId });
  const address = escrowAddress || contractAddress;
  const contractAbi = escrowAddress ? ['function settleSale(uint256 tokenId)'] : abi;
  const contract = new Contract(address, contractAbi, signer);
  const settle = escrowAddress ? contract.settleSale : contract.settleApprovedSale;
  const tx = await settle(BigInt(tokenId));
  const receipt = await tx.wait();
  return { txHash: receipt.hash, sellerWallet: await signer.getAddress() };
}

