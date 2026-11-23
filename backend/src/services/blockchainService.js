import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { loadLocalStore } from '../config/db.js';
import { getSupabaseClient, isSupabaseActive } from '../config/supabase.js';
import {
  classifyOnChainMode,
  resolveDeployedContractAddress,
  resolvePolygonRpcUrl,
  verifyContractTxReceipt,
  verifyTitleContractTxReceipt,
} from './onchainTxVerifier.js';

const require = createRequire(import.meta.url);

// Well-known Hardhat test mnemonic for deterministic local academic prototype wallets (#0-#9)
const HARDHAT_DEV_MNEMONIC = 'test test test test test test test test test test test junk';

const PROTOTYPE_KEYS_BY_ADDRESS = (() => {
  const map = new Map();
  for (let i = 0; i < 10; i++) {
    const wallet = ethers.HDNodeWallet.fromPhrase(
      HARDHAT_DEV_MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${i}`
    );
    map.set(wallet.address.toLowerCase(), wallet.privateKey);
  }
  return map;
})();

let cachedContext = null;
let initPromise = null;

export function resetBlockchainContextForTests() {
  cachedContext = null;
  initPromise = null;
}

const FALLBACK_REGISTRY_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const FALLBACK_TITLE_ABI = [
  'function totalTitlesIssued() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getTitle(uint256 tokenId) view returns (tuple(uint256 tokenId, string parcelCode, string applicationRef, string metadataUri, uint256 issuedAt, address issuedBy, uint8 status, uint8 revocationGround, string revocationReason, uint256 revokedAt, address revokedBy))',
  'function getListing(uint256 tokenId) view returns (tuple(uint256 tokenId, address seller, uint256 priceWei, address buyer, uint256 escrowFundedWei, bool isListed, bool escrowFunded))',
  'function getTransferHistory(uint256 tokenId) view returns (tuple(address from, address to, uint256 priceWei, uint256 timestamp, string transferType)[])',
  'function issueTitle(address to, string parcelCode, string applicationRef, string metadataUri) returns (uint256)',
  'function listParcelForSale(uint256 tokenId, uint256 priceWei)',
  'function buyListedParcel(uint256 tokenId) payable',
  'function settleApprovedSale(uint256 tokenId)',
  'function cancelListing(uint256 tokenId)',
  'function revokeTitle(uint256 tokenId, uint8 ground, string reason)',
  'event TitleIssued(uint256 indexed tokenId, address indexed owner, string parcelCode, string applicationRef, string metadataUri, address indexed issuedBy)',
  'event TitleRevoked(uint256 indexed tokenId, uint8 indexed ground, string reason, address indexed revokedBy, uint256 revokedAt)',
  'event ParcelListed(uint256 indexed tokenId, address indexed seller, uint256 priceWei)',
  'event ListingCancelled(uint256 indexed tokenId, address indexed cancelledBy)',
  'event EscrowFunded(uint256 indexed tokenId, address indexed buyer, uint256 amountWei)',
  'event SaleSettled(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 priceWei)',
];

function isStrictOnChainEnabled() {
  return process.env.ONCHAIN_STRICT_MODE === 'true' || env.blockchain.strictOnChainMode;
}

export function loadContractArtifact() {
  const artifactPath = path.resolve(
    process.cwd(),
    'contracts',
    'artifacts',
    'contracts',
    'AnaguLandTitle.sol',
    'AnaguLandTitle.json'
  );
  if (fs.existsSync(artifactPath)) {
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  }

  const amoyDeploymentPath = path.resolve(
    process.cwd(),
    'contracts',
    'deployed-amoy-title.json'
  );
  if (fs.existsSync(amoyDeploymentPath)) {
    try {
      const deployed = JSON.parse(fs.readFileSync(amoyDeploymentPath, 'utf8'));
      if (Array.isArray(deployed?.abi) && deployed.abi.length > 0) {
        return { abi: deployed.abi, bytecode: '0x' };
      }
    } catch {
      // Fall through to fallback ABI or error
    }
  }

  if (process.env.VERCEL || isStrictOnChainEnabled()) {
    return { abi: FALLBACK_TITLE_ABI, bytecode: '0x' };
  }

  throw new Error(
    'Compiled AnaguLandTitle artifact not found. Run: npx hardhat --config contracts/hardhat.config.cjs compile'
  );
}

async function createEvmProvider() {
  const strictMode = isStrictOnChainEnabled();
  const explicitRpcUrl = resolvePolygonRpcUrl(process.env, '');
  const rpcUrl = explicitRpcUrl || (strictMode ? '' : 'http://127.0.0.1:8545');
  const isLocalhostUrl = /127\.0\.0\.1|localhost/i.test(rpcUrl);

  if (rpcUrl && !(process.env.VERCEL && isLocalhostUrl)) {
    const timeoutMs = isLocalhostUrl ? 1500 : 5000;
    try {
      const jsonProvider = new ethers.JsonRpcProvider(rpcUrl);
      const net = await Promise.race([
        jsonProvider.getNetwork(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`RPC timeout (${timeoutMs}ms)`)), timeoutMs)
        ),
      ]);
      const numericChainId = Number(net.chainId);
      return {
        provider: jsonProvider,
        chainId: numericChainId,
        networkName:
          numericChainId === 80002
            ? 'Polygon Amoy Testnet'
            : numericChainId === 137
            ? 'Polygon Mainnet'
            : numericChainId === 31337
            ? 'Local JSON-RPC EVM'
            : `External EVM RPC (${numericChainId})`,
        isInProcess: numericChainId === 31337,
        isServerlessFallback: false,
      };
    } catch (rpcErr) {
      if (strictMode || (explicitRpcUrl && !isLocalhostUrl)) {
        const err = new Error(
          `Unable to reach external EVM RPC (${rpcErr?.message || 'connection failed'}). Verify POLYGON_AMOY_RPC_URL.`
        );
        err.status = 503;
        throw err;
      }
      // Fall through to in-process Hardhat EVM or serverless adapter
    }
  }

  if (strictMode) {
    const err = new Error(
      'ONCHAIN_STRICT_MODE=true requires a reachable POLYGON_AMOY_RPC_URL (or POLYGON_RPC_URL) and deployed ANAGU_CONTRACT_ADDRESS.'
    );
    err.status = 503;
    throw err;
  }

  if (!process.env.VERCEL) {
    try {
      // Dynamic module specifiers prevent serverless file tracers from bundling 240MB+ of Hardhat/Solc
      const hardhatMod = ['hardhat'].join('');
      const constructionMod = ['hardhat', 'internal', 'core', 'providers', 'construction'].join('/');
      if (!process.env.HARDHAT_CONFIG) {
        process.env.HARDHAT_CONFIG = path.resolve(process.cwd(), 'contracts', 'hardhat.config.cjs');
      }
      const hre = require(hardhatMod);
      const { createProvider } = require(constructionMod);
      const hardhatProvider = await createProvider(hre.config, 'hardhat', hre.artifacts);

      const browserProvider = new ethers.BrowserProvider(hardhatProvider, 31337, {
        cacheTimeout: -1,
        pollingInterval: 25,
      });
      return {
        provider: browserProvider,
        chainId: 31337,
        networkName: 'Hardhat In-Process EVM (Polygon Dev)',
        isInProcess: true,
        isServerlessFallback: false,
      };
    } catch (err) {
      console.warn('Hardhat in-process EVM unavailable, using serverless adapter:', err.message);
    }
  }

  return {
    provider: null,
    chainId: 31337,
    networkName: 'ANAGU Serverless EVM Ledger (Preview)',
    isInProcess: false,
    isServerlessFallback: true,
  };
}

function getSignerForAddress(address, provider, fallbackWallet) {
  if (!address) return fallbackWallet;
  const key = PROTOTYPE_KEYS_BY_ADDRESS.get(String(address).toLowerCase());
  if (key) {
    return new ethers.Wallet(key, provider);
  }
  return fallbackWallet;
}

export async function resolveSigningWalletAddress(preferredWallet = '') {
  const ctx = await getBlockchainContext();
  if (ethers.isAddress(preferredWallet)) {
    return ethers.getAddress(preferredWallet);
  }
  if (ctx.isInProcess || ctx.isServerlessFallback) {
    const signer = getSignerForAddress(preferredWallet, ctx.provider, ctx.citizenWallet);
    return signer?.address || ctx.citizenWallet.address;
  }
  return ctx.registrarWallet?.address || '';
}

export async function hasServerSignerForAddress(address = '') {
  const ctx = await getBlockchainContext();
  if (ctx.isInProcess || ctx.isServerlessFallback) {
    return true;
  }
  if (!ethers.isAddress(address || '')) return false;
  const normalized = address.toLowerCase();
  if (ctx.registrarWallet && ctx.registrarWallet.address.toLowerCase() === normalized) return true;
  if (ctx.governorWallet && ctx.governorWallet.address.toLowerCase() === normalized) return true;
  return false;
}

async function loadChainSyncSnapshot() {
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [titlesRes, usersRes, appsRes, parcelsRes, revRes, listingsRes] = await Promise.all([
      sb.from('land_titles').select('*'),
      sb.from('users').select('id, wallet_address'),
      sb.from('land_applications').select('id, reference_code'),
      sb.from('land_parcels').select('id, parcel_code'),
      sb.from('revocation_records').select('title_id, ground, reason'),
      sb.from('land_listings').select('*'),
    ]);
    return {
      land_titles: titlesRes.data || [],
      users: usersRes.data || [],
      land_applications: appsRes.data || [],
      land_parcels: parcelsRes.data || [],
      revocation_records: revRes.data || [],
      land_listings: listingsRes.data || [],
    };
  }
  const store = loadLocalStore();
  return store.tables;
}

async function syncExistingStoreToFreshChain(ctx) {
  if (env.pg.enabled) return;
  const tables = await loadChainSyncSnapshot();
  const titles = [...(tables.land_titles || [])].sort(
    (a, b) => Number(a.token_id) - Number(b.token_id)
  );
  if (titles.length === 0) return;

  const usersById = new Map((tables.users || []).map((u) => [u.id, u]));
  const appsById = new Map((tables.land_applications || []).map((a) => [a.id, a]));
  const parcelsById = new Map((tables.land_parcels || []).map((p) => [p.id, p]));
  const revocationsByTitle = new Map((tables.revocation_records || []).map((r) => [r.title_id, r]));

  for (const title of titles) {
    const owner = usersById.get(title.owner_id);
    const app = appsById.get(title.application_id);
    const parcel = parcelsById.get(title.parcel_id);
    const ownerWallet = owner?.wallet_address || ctx.citizenWallet.address;
    const tx = await ctx.contract
      .connect(ctx.registrarWallet)
      .issueTitle(
        ownerWallet,
        parcel?.parcel_code || `ANG-PARCEL-${title.parcel_id}`,
        app?.reference_code || `ANG-APP-${title.application_id}`,
        title.metadata_uri || `anagu://titles/${title.title_number}`
      );
    await tx.wait();

    if (title.title_status === 'REVOKED') {
      const rev = revocationsByTitle.get(title.id);
      const groundCode = rev?.ground === 'BreachOfStatutoryCondition' ? 2 : 1;
      const rtx = await ctx.contract
        .connect(ctx.governorWallet)
        .revokeTitle(
          Number(title.token_id),
          groundCode,
          rev?.reason || 'Restored statutory revocation state'
        );
      await rtx.wait();
    }
  }

  for (const listing of tables.land_listings || []) {
    if (!['LISTED', 'ESCROW_FUNDED'].includes(listing.listing_status)) continue;
    const title = titles.find((t) => t.id === listing.title_id);
    if (!title || title.title_status === 'REVOKED') continue;
    const sellerSigner = getSignerForAddress(listing.seller_wallet, ctx.provider, ctx.citizenWallet);
    const ltx = await ctx.contract
      .connect(sellerSigner)
      .listParcelForSale(Number(title.token_id), BigInt(listing.price_wei));
    await ltx.wait();

    if (listing.listing_status === 'ESCROW_FUNDED' && listing.buyer_wallet) {
      const buyerSigner = getSignerForAddress(listing.buyer_wallet, ctx.provider, ctx.surveyorWallet);
      const btx = await ctx.contract
        .connect(buyerSigner)
        .buyListedParcel(Number(title.token_id), { value: BigInt(listing.price_wei) });
      await btx.wait();
    }
  }
}

function resolveValidPrivateKey(candidate, fallbackKey = '') {
  if (!candidate) return fallbackKey;
  const trimmed = String(candidate).trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  }
  return fallbackKey;
}

function assertRegistrarWallet(ctx) {
  if (!ctx.registrarWallet) {
    const err = new Error(
      'REGISTRAR_PRIVATE_KEY is required on the server to mint titles, settle escrow sales, or execute Registrar actions on-chain.'
    );
    err.status = 503;
    throw err;
  }
}

function assertGovernorWallet(ctx) {
  if (!ctx.governorWallet) {
    const err = new Error(
      'GOVERNOR_PRIVATE_KEY (or REGISTRAR_PRIVATE_KEY) is required on the server to revoke titles on-chain.'
    );
    err.status = 503;
    throw err;
  }
}

export async function getBlockchainContext() {
  if (cachedContext) return cachedContext;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const artifact = loadContractArtifact();
    const { provider, chainId, networkName, isInProcess, isServerlessFallback } =
      await createEvmProvider();

    const modeMeta = classifyOnChainMode({
      isInProcess,
      isServerlessFallback,
      chainId,
      envSource: process.env,
    });
    const isExternalChain = modeMeta.isRealOnChain;

    const registrarKey = resolveValidPrivateKey(
      isExternalChain
        ? process.env.REGISTRAR_PRIVATE_KEY || process.env.REGISTRY_PRIVATE_KEY
        : '',
      isExternalChain
        ? ''
        : PROTOTYPE_KEYS_BY_ADDRESS.get('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')
    );
    const governorKey = resolveValidPrivateKey(
      isExternalChain ? process.env.GOVERNOR_PRIVATE_KEY : '',
      isExternalChain
        ? registrarKey
        : PROTOTYPE_KEYS_BY_ADDRESS.get('0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc')
    );

    const registrarWallet = registrarKey ? new ethers.Wallet(registrarKey, provider) : null;
    const governorWallet = governorKey ? new ethers.Wallet(governorKey, provider) : null;
    const citizenWallet = isExternalChain
      ? null
      : new ethers.Wallet(
          PROTOTYPE_KEYS_BY_ADDRESS.get('0x70997970c51812dc3a010c7d01b50e0d17dc79c8'),
          provider
        );
    const surveyorWallet = isExternalChain
      ? null
      : new ethers.Wallet(
          PROTOTYPE_KEYS_BY_ADDRESS.get('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'),
          provider
        );

    let contractAddress = resolveDeployedContractAddress({
      envAddress: process.env.ANAGU_CONTRACT_ADDRESS || '',
      deploymentFilePath: isExternalChain
        ? path.resolve(process.cwd(), 'contracts', 'deployed-amoy-title.json')
        : '',
    });

    if (isServerlessFallback) {
      contractAddress = ethers.isAddress(contractAddress)
        ? contractAddress
        : FALLBACK_REGISTRY_CONTRACT_ADDRESS;
      const ctx = {
        provider: null,
        chainId,
        networkName,
        isInProcess: false,
        isServerlessFallback: true,
        ...modeMeta,
        contractAddress,
        abi: artifact.abi,
        contract: null,
        registrarWallet,
        governorWallet,
        citizenWallet,
        surveyorWallet,
      };
      cachedContext = ctx;
      return ctx;
    }

    if (!ethers.isAddress(contractAddress)) {
      contractAddress = '';
    } else {
      const code = await provider.getCode(contractAddress);
      if (!code || code === '0x') {
        if (isExternalChain) {
          const err = new Error(
            `No AnaguLandTitle contract bytecode found at ${contractAddress} on ${networkName} (Chain ${chainId}). Deploy with "npm run deploy:amoy:title" and update ANAGU_CONTRACT_ADDRESS.`
          );
          err.status = 503;
          throw err;
        }
        contractAddress = '';
      }
    }

    let contract;
    if (!contractAddress) {
      if (isExternalChain || isStrictOnChainEnabled()) {
        const err = new Error(
          `ANAGU_CONTRACT_ADDRESS is not configured for ${networkName} (Chain ${chainId}). Deploy AnaguLandTitle ("npm run deploy:amoy:title") and set ANAGU_CONTRACT_ADDRESS in .env.`
        );
        err.status = 503;
        throw err;
      }
      if (!registrarWallet || !artifact.bytecode || artifact.bytecode === '0x') {
        const err = new Error('AnaguLandTitle contract bytecode is missing for local deployment.');
        err.status = 500;
        throw err;
      }
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, registrarWallet);
      contract = await factory.deploy(
        registrarWallet.address,
        registrarWallet.address,
        governorWallet.address
      );
      await contract.waitForDeployment();
      contractAddress = await contract.getAddress();
    } else {
      contract = new ethers.Contract(contractAddress, artifact.abi, registrarWallet || provider);
    }

    const ctx = {
      provider,
      chainId,
      networkName,
      isInProcess,
      isServerlessFallback: false,
      ...modeMeta,
      contractAddress,
      abi: artifact.abi,
      contract,
      registrarWallet,
      governorWallet,
      citizenWallet,
      surveyorWallet,
    };

    if (isInProcess) {
      await syncExistingStoreToFreshChain(ctx);
    }

    cachedContext = ctx;
    return ctx;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

function loadEscrowDeploymentState(isRealOnChain = false) {
  const deploymentPath = isRealOnChain
    ? path.resolve(process.cwd(), 'contracts', 'deployed-amoy-escrow.json')
    : path.resolve(process.cwd(), 'contracts', 'deployed-local-escrow.json');
  let escrowMetadata = null;
  if (fs.existsSync(deploymentPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      if (parsed?.contractAddress) escrowMetadata = parsed;
    } catch {
      escrowMetadata = null;
    }
  }
  const escrowAddress = isRealOnChain
    ? process.env.ANAGU_ESCROW_ADDRESS || escrowMetadata?.contractAddress || ''
    : escrowMetadata?.contractAddress || '';
  const tokenAddress = isRealOnChain
    ? process.env.ANAGU_TOKEN_ADDRESS || escrowMetadata?.anaguTokenAddress || ''
    : escrowMetadata?.anaguTokenAddress || '';
  const escrowArtifactPath = path.resolve(
    process.cwd(),
    'contracts',
    'artifacts',
    'contracts',
    'AnaguEscrow.sol',
    'AnaguEscrow.json'
  );
  const escrowAbi =
    escrowMetadata?.abi ||
    (fs.existsSync(escrowArtifactPath)
      ? JSON.parse(fs.readFileSync(escrowArtifactPath, 'utf8')).abi
      : []);
  return { escrowAddress, tokenAddress, escrowAbi };
}

export async function getActiveEscrowConfig() {
  const ctx = await getBlockchainContext();
  const { escrowAddress, tokenAddress } = loadEscrowDeploymentState(ctx.isRealOnChain);
  return {
    isRealOnChain: ctx.isRealOnChain,
    escrowAddress: ethers.isAddress(escrowAddress) ? escrowAddress : '',
    tokenAddress: ethers.isAddress(tokenAddress) ? tokenAddress : '',
  };
}

export async function getContractInfo() {
  const ctx = await getBlockchainContext();
  const { escrowAddress, tokenAddress, escrowAbi } = loadEscrowDeploymentState(ctx.isRealOnChain);
  if (ctx.isServerlessFallback) {
    let totalTitlesIssued = 0;
    if (isSupabaseActive()) {
      const sb = getSupabaseClient();
      const { count } = await sb
        .from('land_titles')
        .select('id', { count: 'exact', head: true });
      totalTitlesIssued = count || 0;
    } else {
      const store = loadLocalStore();
      totalTitlesIssued = (store.tables.land_titles || []).length;
    }
    return {
      contractAddress: ctx.contractAddress,
      chainId: ctx.chainId,
      networkName: ctx.networkName,
      onChainMode: ctx.onChainMode,
      isRealOnChain: ctx.isRealOnChain,
      explorerBaseUrl: ctx.explorerBaseUrl,
      registrarAddress: ctx.registrarWallet?.address || '',
      governorAddress: ctx.governorWallet?.address || '',
      totalTitlesIssued,
      escrowAddress,
      tokenAddress,
      escrowAbi,
      tokenAbi: [
        'function balanceOf(address account) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function transfer(address to, uint256 amount) returns (bool)',
      ],
      abi: ctx.abi,
    };
  }
  const totalTitlesIssued = Number(await ctx.contract.totalTitlesIssued());
  return {
    contractAddress: ctx.contractAddress,
    escrowAddress,
    tokenAddress,
    escrowAbi,
    tokenAbi: [
      'function balanceOf(address account) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ],
    chainId: ctx.chainId,
    networkName: ctx.networkName,
    onChainMode: ctx.onChainMode,
    isRealOnChain: ctx.isRealOnChain,
    explorerBaseUrl: ctx.explorerBaseUrl,
    registrarAddress: ctx.registrarWallet?.address || '',
    governorAddress: ctx.governorWallet?.address || '',
    totalTitlesIssued,
    abi: ctx.abi,
  };
}

export async function mintTitleOnChain({ toWallet, parcelCode, applicationRef, metadataUri }) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();

  if (ctx.isServerlessFallback) {
    let existingCount = 0;
    if (isSupabaseActive()) {
      const sb = getSupabaseClient();
      const { count } = await sb
        .from('land_titles')
        .select('id', { count: 'exact', head: true });
      existingCount = count || 0;
    } else {
      const store = loadLocalStore();
      existingCount = (store.tables.land_titles || []).length;
    }
    const nextTokenId = String(existingCount + 1);
    return {
      txHash: `0x${cryptoRandomHex(32)}`,
      blockNumber: 100 + Number(nextTokenId),
      gasUsed: '142500',
      latencyMs: Math.round(performance.now() - startedAt),
      tokenId: nextTokenId,
      contractAddress: ctx.contractAddress,
      fromAddress: ctx.registrarWallet?.address || '',
      toAddress: toWallet,
    };
  }

  assertRegistrarWallet(ctx);
  const tx = await ctx.contract
    .connect(ctx.registrarWallet)
    .issueTitle(toWallet, parcelCode, applicationRef, metadataUri);
  const receipt = await tx.wait();
  const latencyMs = Math.round(performance.now() - startedAt);

  let tokenId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = ctx.contract.interface.parseLog(log);
      if (parsed?.name === 'TitleIssued') {
        tokenId = parsed.args.tokenId.toString();
        break;
      }
    } catch {
      // skip non-matching logs
    }
  }

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    latencyMs,
    tokenId: tokenId || String(await ctx.contract.totalTitlesIssued()),
    contractAddress: ctx.contractAddress,
    fromAddress: ctx.registrarWallet.address,
    toAddress: toWallet,
  };
}

export async function verifyDirectTransferBlockedOnChain({ tokenId, fromWallet, toWallet }) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();

  if (ctx.isServerlessFallback) {
    return {
      blocked: true,
      reason: `TransferBlockedByRegistryRule(${tokenId})`,
      latencyMs: Math.round(performance.now() - startedAt),
      fromAddress: fromWallet || ctx.citizenWallet?.address || '',
      toAddress: toWallet,
      syntheticTxHash: `0xblocked${cryptoRandomHex(28)}`,
    };
  }

  let callerAddress = fromWallet;
  let staticRunner;
  if (ctx.isRealOnChain) {
    if (!ethers.isAddress(callerAddress || '')) {
      callerAddress = await ctx.contract.ownerOf(BigInt(tokenId));
    }
    staticRunner = new ethers.VoidSigner(callerAddress, ctx.provider);
  } else {
    const ownerSigner = getSignerForAddress(fromWallet, ctx.provider, ctx.citizenWallet);
    callerAddress = ownerSigner.address;
    staticRunner = ownerSigner;
  }

  try {
    await ctx.contract
      .connect(staticRunner)
      .transferFrom.staticCall(callerAddress, toWallet, BigInt(tokenId));
    throw new Error('Unexpected: direct transfer did not revert.');
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    let reason = err.shortMessage || err.reason || err.message || 'TransferBlockedByRegistryRule';
    try {
      if (err.data) {
        const decoded = ctx.contract.interface.parseError(err.data);
        if (decoded) {
          reason = `${decoded.name}(${decoded.args.map((a) => a.toString()).join(', ')})`;
        }
      }
    } catch {
      // keep raw message
    }

    return {
      blocked: true,
      reason,
      latencyMs,
      fromAddress: callerAddress,
      toAddress: toWallet,
      syntheticTxHash: `0xblocked${cryptoRandomHex(28)}`,
    };
  }
}

function cryptoRandomHex(bytesLen) {
  return ethers.hexlify(ethers.randomBytes(bytesLen)).slice(2);
}

export async function listParcelOnChain({
  sellerWallet,
  tokenId,
  pricePol,
  priceAnagu = null,
  txHash = null,
}) {
  const ctx = await getBlockchainContext();
  const priceWei = ethers.parseEther(String(pricePol));
  const { escrowAddress, escrowAbi } = loadEscrowDeploymentState(ctx.isRealOnChain);
  const useEscrow = ethers.isAddress(escrowAddress);
  const escrowPriceWei =
    useEscrow && priceAnagu != null && Number(priceAnagu) > 0
      ? ethers.parseEther(String(priceAnagu))
      : priceWei;
  const startedAt = performance.now();

  if (ctx.isServerlessFallback) {
    return {
      txHash: txHash || `0x${cryptoRandomHex(32)}`,
      blockNumber: 120,
      gasUsed: '89200',
      latencyMs: Math.round(performance.now() - startedAt),
      priceWei: priceWei.toString(),
      sellerWallet: sellerWallet || ctx.citizenWallet?.address || '',
    };
  }

  if (txHash) {
    if (useEscrow) {
      const escrowIface = new ethers.Interface([
        'event ParcelListed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiresAt)',
      ]);
      const verified = await verifyContractTxReceipt({
        provider: ctx.provider,
        txHash,
        expectedContractAddress: escrowAddress,
        expectedEventName: 'ParcelListed',
        contractInterface: escrowIface,
        expectedTokenId: tokenId,
        expectedActorAddress: sellerWallet,
        expectedAmountWei: escrowPriceWei,
        amountArgName: 'price',
        actorArgName: 'seller',
      });
      return {
        txHash: verified.receipt.hash,
        blockNumber: verified.receipt.blockNumber,
        gasUsed: verified.receipt.gasUsed.toString(),
        latencyMs: Math.round(performance.now() - startedAt),
        priceWei: priceWei.toString(),
        escrowPriceWei: verified.eventArgs.price.toString(),
        sellerWallet: verified.eventArgs.seller || sellerWallet,
      };
    }
    const verified = await verifyTitleContractTxReceipt({
      provider: ctx.provider,
      txHash,
      expectedContractAddress: ctx.contractAddress,
      expectedEventName: 'ParcelListed',
      expectedTokenId: tokenId,
      expectedPriceWei: priceWei,
      expectedActorAddress: sellerWallet,
      titleInterface: ctx.contract.interface,
    });
    return {
      txHash: verified.receipt.hash,
      blockNumber: verified.receipt.blockNumber,
      gasUsed: verified.receipt.gasUsed.toString(),
      latencyMs: Math.round(performance.now() - startedAt),
      priceWei: verified.eventArgs.priceWei,
      sellerWallet: verified.eventArgs.seller || sellerWallet,
    };
  }

  if (ctx.isRealOnChain) {
    const canServerSign =
      ctx.registrarWallet &&
      ethers.isAddress(sellerWallet || '') &&
      ctx.registrarWallet.address.toLowerCase() === sellerWallet.toLowerCase();

    if (!canServerSign) {
      const err = new Error(
        `Real on-chain listing requires a MetaMask or Trust Wallet signature from title owner ${sellerWallet} on ${ctx.networkName} (Chain ${ctx.chainId}).`
      );
      err.status = 409;
      err.code = 'WALLET_SIGNATURE_REQUIRED';
      throw err;
    }

    if (useEscrow) {
      const escrowContract = new ethers.Contract(escrowAddress, escrowAbi, ctx.registrarWallet);
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
      const tx = await escrowContract.listParcel(BigInt(tokenId), escrowPriceWei, expiresAt);
      const receipt = await tx.wait();
      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        latencyMs: Math.round(performance.now() - startedAt),
        priceWei: priceWei.toString(),
        escrowPriceWei: escrowPriceWei.toString(),
        sellerWallet: ctx.registrarWallet.address,
      };
    }

    const tx = await ctx.contract
      .connect(ctx.registrarWallet)
      .listParcelForSale(BigInt(tokenId), priceWei);
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      latencyMs: Math.round(performance.now() - startedAt),
      priceWei: priceWei.toString(),
      sellerWallet: ctx.registrarWallet.address,
    };
  }

  const sellerSigner = getSignerForAddress(sellerWallet, ctx.provider, ctx.citizenWallet);
  const tx = await ctx.contract.connect(sellerSigner).listParcelForSale(BigInt(tokenId), priceWei);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    latencyMs: Math.round(performance.now() - startedAt),
    priceWei: priceWei.toString(),
    sellerWallet: sellerSigner.address,
  };
}

export async function fundEscrowOnChain({ buyerWallet, tokenId, priceWei, txHash = null }) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();
  const { escrowAddress } = loadEscrowDeploymentState(ctx.isRealOnChain);

  if (ctx.isServerlessFallback) {
    return {
      txHash: txHash || `0x${cryptoRandomHex(32)}`,
      blockNumber: 121,
      gasUsed: '104300',
      latencyMs: Math.round(performance.now() - startedAt),
      buyerWallet: buyerWallet || ctx.surveyorWallet?.address || '',
    };
  }

  if (txHash) {
    if (ethers.isAddress(escrowAddress)) {
      const escrowIface = new ethers.Interface([
        'event EscrowFunded(uint256 indexed tokenId, address indexed buyer, uint256 amount)',
      ]);
      const verified = await verifyContractTxReceipt({
        provider: ctx.provider,
        txHash,
        expectedContractAddress: escrowAddress,
        expectedEventName: 'EscrowFunded',
        contractInterface: escrowIface,
        expectedTokenId: tokenId,
        expectedActorAddress: buyerWallet,
        expectedAmountWei: priceWei,
      });
      return {
        txHash: verified.receipt.hash,
        blockNumber: verified.receipt.blockNumber,
        gasUsed: verified.receipt.gasUsed.toString(),
        latencyMs: Math.round(performance.now() - startedAt),
        buyerWallet: verified.eventArgs.buyer || buyerWallet,
      };
    }
    const verified = await verifyTitleContractTxReceipt({
      provider: ctx.provider,
      txHash,
      expectedContractAddress: ctx.contractAddress,
      expectedEventName: 'EscrowFunded',
      expectedTokenId: tokenId,
      expectedPriceWei: priceWei,
      expectedActorAddress: buyerWallet,
      titleInterface: ctx.contract.interface,
    });
    return {
      txHash: verified.receipt.hash,
      blockNumber: verified.receipt.blockNumber,
      gasUsed: verified.receipt.gasUsed.toString(),
      latencyMs: Math.round(performance.now() - startedAt),
      buyerWallet: verified.eventArgs.buyer || buyerWallet,
    };
  }

  if (ctx.isRealOnChain) {
    const err = new Error(
      `Real on-chain escrow purchase requires a MetaMask or Trust Wallet signature on ${ctx.networkName} (Chain ${ctx.chainId}). Connect your wallet and approve the transaction.`
    );
    err.status = 409;
    err.code = 'WALLET_SIGNATURE_REQUIRED';
    throw err;
  }

  const buyerSigner = getSignerForAddress(buyerWallet, ctx.provider, ctx.surveyorWallet);
  const tx = await ctx.contract
    .connect(buyerSigner)
    .buyListedParcel(BigInt(tokenId), { value: BigInt(priceWei) });
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    latencyMs: Math.round(performance.now() - startedAt),
    buyerWallet: buyerSigner.address,
  };
}

export async function settleSaleOnChain({ tokenId, sellerWallet, buyerWallet, priceWei = null, txHash }) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();
  const { escrowAddress } = loadEscrowDeploymentState(ctx.isRealOnChain);

  if (ctx.isServerlessFallback) {
    const err = new Error('Cannot verify seller settlement because no blockchain RPC is available.');
    err.status = 503;
    throw err;
  }

  if (!txHash) {
    const err = new Error('Seller wallet confirmation is required to settle this sale.');
    err.status = 400;
    err.code = 'WALLET_SIGNATURE_REQUIRED';
    throw err;
  }
  if (!ethers.isAddress(sellerWallet || '') || !ethers.isAddress(buyerWallet || '')) {
    const err = new Error('Valid seller and buyer wallets are required to confirm this sale.');
    err.status = 400;
    throw err;
  }

  if (ethers.isAddress(escrowAddress)) {
    const escrowInterface = new ethers.Interface([
      'event EscrowSettled(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 sellerAmount, uint256 treasuryAmount)',
    ]);
    const verified = await verifyContractTxReceipt({
      provider: ctx.provider,
      txHash,
      expectedContractAddress: escrowAddress,
      expectedEventName: 'EscrowSettled',
      contractInterface: escrowInterface,
      expectedTokenId: tokenId,
      expectedActorAddress: sellerWallet,
      expectedAmountWei: priceWei,
      actorArgName: 'seller',
      expectedCounterpartyAddress: buyerWallet,
      counterpartyArgName: 'buyer',
    });
    return {
      txHash: verified.receipt.hash,
      blockNumber: verified.receipt.blockNumber,
      gasUsed: verified.receipt.gasUsed.toString(),
      latencyMs: Math.round(performance.now() - startedAt),
      fromAddress: sellerWallet,
    };
  }

  const verified = await verifyTitleContractTxReceipt({
    provider: ctx.provider,
    txHash,
    expectedContractAddress: ctx.contractAddress,
    expectedEventName: 'SaleSettled',
    expectedTokenId: tokenId,
    expectedActorAddress: sellerWallet,
    expectedCounterpartyAddress: buyerWallet,
    expectedPriceWei: priceWei,
    titleInterface: ctx.contract.interface,
  });

  return {
    txHash: verified.receipt.hash,
    blockNumber: verified.receipt.blockNumber,
    gasUsed: verified.receipt.gasUsed.toString(),
    latencyMs: Math.round(performance.now() - startedAt),
    fromAddress: sellerWallet,
  };
}

export async function cancelListingOnChain({ callerWallet, tokenId, txHash = null }) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();
  const { escrowAddress, escrowAbi } = loadEscrowDeploymentState(ctx.isRealOnChain);

  if (ctx.isServerlessFallback) {
    return {
      txHash: txHash || `0x${cryptoRandomHex(32)}`,
      blockNumber: 123,
      gasUsed: '64200',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  if (txHash) {
    if (ethers.isAddress(escrowAddress)) {
      const escrowIface = new ethers.Interface([
        'event EscrowCancelled(uint256 indexed tokenId, address indexed caller)',
      ]);
      const verified = await verifyContractTxReceipt({
        provider: ctx.provider,
        txHash,
        expectedContractAddress: escrowAddress,
        expectedEventName: 'EscrowCancelled',
        contractInterface: escrowIface,
        expectedTokenId: tokenId,
        expectedActorAddress: callerWallet,
        actorArgName: 'caller',
      });
      return {
        txHash: verified.receipt.hash,
        blockNumber: verified.receipt.blockNumber,
        gasUsed: verified.receipt.gasUsed.toString(),
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
    const verified = await verifyTitleContractTxReceipt({
      provider: ctx.provider,
      txHash,
      expectedContractAddress: ctx.contractAddress,
      expectedEventName: 'ListingCancelled',
      expectedTokenId: tokenId,
      expectedActorAddress: callerWallet,
      titleInterface: ctx.contract.interface,
    });
    return {
      txHash: verified.receipt.hash,
      blockNumber: verified.receipt.blockNumber,
      gasUsed: verified.receipt.gasUsed.toString(),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  if (ctx.isRealOnChain) {
    // Allow Registrar admin to cancel on-chain using REGISTRAR_PRIVATE_KEY (contract permits seller OR REGISTRAR_ROLE)
    if (ctx.registrarWallet) {
      if (ethers.isAddress(escrowAddress)) {
        const escrowContract = new ethers.Contract(escrowAddress, escrowAbi, ctx.registrarWallet);
        const tx = await escrowContract.cancelListing(BigInt(tokenId));
        const receipt = await tx.wait();
        return {
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          latencyMs: Math.round(performance.now() - startedAt),
        };
      }
      const tx = await ctx.contract.connect(ctx.registrarWallet).cancelListing(BigInt(tokenId));
      const receipt = await tx.wait();
      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
    const err = new Error(
      `Real on-chain listing cancellation requires a MetaMask or Trust Wallet signature on ${ctx.networkName} (Chain ${ctx.chainId}).`
    );
    err.status = 409;
    err.code = 'WALLET_SIGNATURE_REQUIRED';
    throw err;
  }

  const callerSigner = getSignerForAddress(callerWallet, ctx.provider, ctx.registrarWallet);
  const tx = await ctx.contract.connect(callerSigner).cancelListing(BigInt(tokenId));
  const receipt = await tx.wait();
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

export async function revokeTitleOnChain({ tokenId, ground, reason }) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();
  const groundEnum = ground === 'BreachOfStatutoryCondition' ? 2 : 1;

  if (ctx.isServerlessFallback) {
    return {
      txHash: `0x${cryptoRandomHex(32)}`,
      blockNumber: 124,
      gasUsed: '95100',
      latencyMs: Math.round(performance.now() - startedAt),
      fromAddress: ctx.governorWallet?.address || '',
    };
  }

  assertGovernorWallet(ctx);
  const tx = await ctx.contract
    .connect(ctx.governorWallet)
    .revokeTitle(BigInt(tokenId), groundEnum, reason);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    latencyMs: Math.round(performance.now() - startedAt),
    fromAddress: ctx.governorWallet.address,
  };
}

export async function verifyListingOnChain({
  tokenId,
  expectedSellerWallet = '',
  expectedPriceWei = '',
}) {
  const ctx = await getBlockchainContext();
  const startedAt = performance.now();
  const numericTokenId = BigInt(tokenId);

  if (ctx.isServerlessFallback) {
    let title = null;
    let owner = null;
    let listing = null;
    let transferHistoryCount = 0;

    if (isSupabaseActive()) {
      const sb = getSupabaseClient();
      const { data: titleRow } = await sb
        .from('land_titles')
        .select('*')
        .eq('token_id', String(tokenId))
        .maybeSingle();
      title = titleRow || null;
      if (title) {
        const [ownerRes, listingRes, txRes] = await Promise.all([
          sb.from('users').select('id, wallet_address').eq('id', title.owner_id).maybeSingle(),
          sb
            .from('land_listings')
            .select('*')
            .eq('title_id', title.id)
            .in('listing_status', ['LISTED', 'ESCROW_FUNDED'])
            .maybeSingle(),
          sb
            .from('blockchain_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('title_id', title.id),
        ]);
        owner = ownerRes.data || null;
        listing = listingRes.data || null;
        transferHistoryCount = txRes.count || 0;
      }
    } else {
      const store = loadLocalStore();
      title = (store.tables.land_titles || []).find(
        (t) => String(t.token_id) === String(tokenId)
      );
      if (title) {
        owner = (store.tables.users || []).find((u) => u.id === title.owner_id);
        listing = (store.tables.land_listings || []).find(
          (l) => l.title_id === title.id && ['LISTED', 'ESCROW_FUNDED'].includes(l.listing_status)
        );
        transferHistoryCount = (store.tables.blockchain_transactions || []).filter(
          (tx) => tx.title_id === title.id
        ).length;
      }
    }

    if (!title) {
      return {
        ok: false,
        contractAddress: ctx.contractAddress,
        chainId: ctx.chainId,
        networkName: ctx.networkName,
        onChainMode: ctx.onChainMode,
        isRealOnChain: ctx.isRealOnChain,
        explorerBaseUrl: ctx.explorerBaseUrl,
        tokenId: String(tokenId),
        error: 'Title token not found in registry ledger.',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }

    const onChainOwner = owner?.wallet_address || expectedSellerWallet || ctx.citizenWallet?.address || '';
    const isRevoked = title.title_status === 'REVOKED';
    const isListed = Boolean(listing);
    const escrowFunded = listing?.listing_status === 'ESCROW_FUNDED';
    const onChainSeller = listing?.seller_wallet || onChainOwner;
    const onChainPriceWei = listing?.price_wei ? String(listing.price_wei) : '0';
    const ownerMatchesSeller = expectedSellerWallet
      ? onChainOwner.toLowerCase() === String(expectedSellerWallet).toLowerCase()
      : true;
    const listingSellerMatchesOwner =
      !isListed || onChainSeller.toLowerCase() === onChainOwner.toLowerCase();
    const priceMatches = expectedPriceWei ? onChainPriceWei === String(expectedPriceWei) : true;
    const ok =
      !isRevoked &&
      isListed &&
      !escrowFunded &&
      ownerMatchesSeller &&
      listingSellerMatchesOwner &&
      priceMatches;

    return {
      ok,
      contractAddress: ctx.contractAddress,
      chainId: ctx.chainId,
      networkName: ctx.networkName,
      onChainMode: ctx.onChainMode,
      isRealOnChain: ctx.isRealOnChain,
      explorerBaseUrl: ctx.explorerBaseUrl,
      tokenId: String(tokenId),
      onChainOwner,
      onChainSeller,
      ownerMatchesSeller,
      isRevoked,
      isListed,
      escrowFunded,
      onChainPriceWei,
      priceMatches,
      transferHistoryCount,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    const { escrowAddress, escrowAbi } = loadEscrowDeploymentState(ctx.isRealOnChain);
    const hasEscrow = ethers.isAddress(escrowAddress) && Array.isArray(escrowAbi) && escrowAbi.length > 0;
    const escrowContract = hasEscrow
      ? new ethers.Contract(escrowAddress, escrowAbi, ctx.provider)
      : null;

    const [onChainOwner, titleRecord, listingRecord, history, escrowRecord] = await Promise.all([
      ctx.contract.ownerOf(numericTokenId),
      ctx.contract.getTitle(numericTokenId),
      ctx.contract.getListing(numericTokenId),
      ctx.contract.getTransferHistory(numericTokenId),
      escrowContract ? escrowContract.getEscrow(numericTokenId).catch(() => null) : Promise.resolve(null),
    ]);

    const isRevoked = Number(titleRecord.status) !== 0;
    const escrowStatus = escrowRecord ? Number(escrowRecord.status) : 0;
    const useEscrowState = escrowStatus === 1 || escrowStatus === 2;
    const isListed = useEscrowState ? true : Boolean(listingRecord.isListed);
    const escrowFunded = useEscrowState
      ? escrowStatus === 2
      : Boolean(listingRecord.escrowFunded);
    const onChainPriceWei = useEscrowState
      ? escrowRecord.price?.toString() || '0'
      : listingRecord.priceWei
      ? listingRecord.priceWei.toString()
      : '0';
    const onChainSeller = useEscrowState
      ? escrowRecord.seller || ''
      : listingRecord.seller || '';

    const ownerMatchesSeller = expectedSellerWallet
      ? onChainOwner.toLowerCase() === String(expectedSellerWallet).toLowerCase()
      : true;
    const listingSellerMatchesOwner =
      !isListed || onChainSeller.toLowerCase() === onChainOwner.toLowerCase();
    const priceMatches = expectedPriceWei
      ? onChainPriceWei === String(expectedPriceWei)
      : true;

    const ok =
      !isRevoked &&
      isListed &&
      !escrowFunded &&
      ownerMatchesSeller &&
      listingSellerMatchesOwner &&
      priceMatches;

    return {
      ok,
      contractAddress: ctx.contractAddress,
      chainId: ctx.chainId,
      networkName: ctx.networkName,
      onChainMode: ctx.onChainMode,
      isRealOnChain: ctx.isRealOnChain,
      explorerBaseUrl: ctx.explorerBaseUrl,
      tokenId: String(tokenId),
      onChainOwner,
      onChainSeller,
      ownerMatchesSeller,
      isRevoked,
      isListed,
      escrowFunded,
      onChainPriceWei,
      priceMatches,
      transferHistoryCount: Array.isArray(history) ? history.length : 0,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ok: false,
      contractAddress: ctx.contractAddress,
      chainId: ctx.chainId,
      networkName: ctx.networkName,
      onChainMode: ctx.onChainMode,
      isRealOnChain: ctx.isRealOnChain,
      explorerBaseUrl: ctx.explorerBaseUrl,
      tokenId: String(tokenId),
      error: error.shortMessage || error.reason || error.message || 'On-chain verification failed.',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
