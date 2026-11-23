const eip6963Providers = new Map();
let eip6963Listening = false;

export function isValidEip1193Provider(provider) {
  return Boolean(provider && typeof provider.request === 'function');
}

export function isTrustWalletProvider(provider) {
  return Boolean(
    provider &&
      (provider.isTrust ||
        provider.isTrustWallet ||
        provider.walletName === 'Trust Wallet' ||
        provider.providerInfo?.rdns === 'com.trustwallet.app')
  );
}

export function isMetaMaskProvider(provider) {
  return Boolean(provider && provider.isMetaMask && !isTrustWalletProvider(provider));
}

export function normalizeWalletType(walletType) {
  const lower = String(walletType || '').trim().toLowerCase();
  if (lower === 'trust' || lower === 'trustwallet' || lower === 'trust_wallet') {
    return 'trustwallet';
  }
  if (lower === 'metamask' || lower === 'meta_mask') {
    return 'metamask';
  }
  return 'auto';
}

export function classifyAnnouncedProvider(detail) {
  if (!detail || !isValidEip1193Provider(detail.provider)) return null;
  const rdns = String(detail.info?.rdns || '').toLowerCase();
  const name = String(detail.info?.name || '').toLowerCase();

  if (rdns.includes('trustwallet') || name.includes('trust wallet') || isTrustWalletProvider(detail.provider)) {
    return { walletType: 'trustwallet', walletName: 'Trust Wallet', provider: detail.provider, rdns };
  }
  if (rdns === 'io.metamask' || rdns === 'io.metamask.flask' || name === 'metamask' || isMetaMaskProvider(detail.provider)) {
    return { walletType: 'metamask', walletName: 'MetaMask', provider: detail.provider, rdns };
  }
  return {
    walletType: 'injected',
    walletName: detail.info?.name || 'Browser Wallet',
    provider: detail.provider,
    rdns,
  };
}

export function initEip6963Discovery(targetWindow = typeof window !== 'undefined' ? window : undefined) {
  if (!targetWindow || typeof targetWindow.addEventListener !== 'function' || eip6963Listening) {
    return;
  }
  eip6963Listening = true;
  targetWindow.addEventListener('eip6963:announceProvider', (event) => {
    const classified = classifyAnnouncedProvider(event?.detail);
    if (classified) {
      const key = classified.rdns || `${classified.walletType}-${eip6963Providers.size}`;
      eip6963Providers.set(key, classified);
    }
  });
  try {
    targetWindow.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch {
    // Ignore in environments where CustomEvent/Event dispatch is restricted
  }
}

export function getAnnouncedWalletProviders() {
  return Array.from(eip6963Providers.values());
}

export function detectTrustWallet(
  targetWindow = typeof window !== 'undefined' ? window : undefined,
  announcedProviders = getAnnouncedWalletProviders()
) {
  const missingError =
    'Trust Wallet not detected. Install the Trust Wallet browser extension or open this page inside Trust Wallet.';

  const announced = Array.isArray(announcedProviders)
    ? announcedProviders.find((entry) => entry?.walletType === 'trustwallet' && isValidEip1193Provider(entry.provider))
    : null;
  if (announced) {
    return {
      available: true,
      isTrustWallet: true,
      walletType: 'trustwallet',
      walletName: 'Trust Wallet',
      provider: announced.provider,
      error: '',
    };
  }

  const dedicatedCandidates = [
    targetWindow?.trustwallet?.ethereum,
    targetWindow?.trustwallet,
    targetWindow?.trustWallet?.ethereum,
    targetWindow?.trustWallet,
  ];
  for (const candidate of dedicatedCandidates) {
    if (isValidEip1193Provider(candidate)) {
      return {
        available: true,
        isTrustWallet: true,
        walletType: 'trustwallet',
        walletName: 'Trust Wallet',
        provider: candidate,
        error: '',
      };
    }
  }

  const eth = targetWindow?.ethereum;
  if (eth && Array.isArray(eth.providers)) {
    const trustInArray = eth.providers.find(
      (p) => isValidEip1193Provider(p) && isTrustWalletProvider(p)
    );
    if (trustInArray) {
      return {
        available: true,
        isTrustWallet: true,
        walletType: 'trustwallet',
        walletName: 'Trust Wallet',
        provider: trustInArray,
        error: '',
      };
    }
  }

  if (isValidEip1193Provider(eth) && isTrustWalletProvider(eth)) {
    return {
      available: true,
      isTrustWallet: true,
      walletType: 'trustwallet',
      walletName: 'Trust Wallet',
      provider: eth,
      error: '',
    };
  }

  return {
    available: false,
    isTrustWallet: false,
    walletType: 'trustwallet',
    walletName: 'Trust Wallet',
    provider: null,
    error: missingError,
  };
}

export function detectMetaMask(
  targetWindow = typeof window !== 'undefined' ? window : undefined,
  announcedProviders = getAnnouncedWalletProviders()
) {
  const missingError =
    'MetaMask not detected. Please install the MetaMask browser extension to connect your wallet.';

  const announced = Array.isArray(announcedProviders)
    ? announcedProviders.find((entry) => entry?.walletType === 'metamask' && isValidEip1193Provider(entry.provider))
    : null;
  if (announced) {
    return {
      available: true,
      isMetaMask: true,
      walletType: 'metamask',
      walletName: 'MetaMask',
      provider: announced.provider,
      error: '',
    };
  }

  const eth = targetWindow?.ethereum;
  if (eth && Array.isArray(eth.providers)) {
    const mmInArray = eth.providers.find(
      (p) => isValidEip1193Provider(p) && isMetaMaskProvider(p)
    );
    if (mmInArray) {
      return {
        available: true,
        isMetaMask: true,
        walletType: 'metamask',
        walletName: 'MetaMask',
        provider: mmInArray,
        error: '',
      };
    }
  }

  if (isValidEip1193Provider(eth) && !isTrustWalletProvider(eth)) {
    const hasExplicitMetaMask = Boolean(eth.isMetaMask);
    if (hasExplicitMetaMask || !Array.isArray(eth.providers)) {
      return {
        available: true,
        isMetaMask: hasExplicitMetaMask,
        walletType: hasExplicitMetaMask ? 'metamask' : 'injected',
        walletName: hasExplicitMetaMask ? 'MetaMask' : 'Browser Wallet',
        provider: eth,
        error: '',
      };
    }
  }

  return {
    available: false,
    isMetaMask: false,
    walletType: 'metamask',
    walletName: 'MetaMask',
    provider: null,
    error: missingError,
  };
}

export function detectAvailableWallets(
  targetWindow = typeof window !== 'undefined' ? window : undefined,
  announcedProviders = getAnnouncedWalletProviders()
) {
  const metamask = detectMetaMask(targetWindow, announcedProviders);
  const trustwallet = detectTrustWallet(targetWindow, announcedProviders);

  const genericProvider =
    !metamask.available &&
    !trustwallet.available &&
    isValidEip1193Provider(targetWindow?.ethereum)
      ? targetWindow.ethereum
      : null;

  const anyAvailable = Boolean(metamask.available || trustwallet.available || genericProvider);
  const defaultWallet = metamask.available
    ? metamask
    : trustwallet.available
    ? trustwallet
    : genericProvider
    ? {
        available: true,
        isMetaMask: false,
        isTrustWallet: false,
        walletType: 'injected',
        walletName: 'Browser Wallet',
        provider: genericProvider,
        error: '',
      }
    : null;

  return {
    metamask,
    trustwallet,
    anyAvailable,
    defaultProvider: defaultWallet?.provider || null,
    defaultWalletType: defaultWallet?.walletType || null,
    defaultWalletName: defaultWallet?.walletName || null,
    error: anyAvailable
      ? ''
      : 'No Web3 wallet detected. Please install MetaMask or Trust Wallet to connect your wallet.',
  };
}

export function selectWalletProvider(
  preferredWalletType = 'auto',
  targetWindow = typeof window !== 'undefined' ? window : undefined,
  announcedProviders = getAnnouncedWalletProviders()
) {
  const normalized = normalizeWalletType(preferredWalletType);
  const available = detectAvailableWallets(targetWindow, announcedProviders);

  if (normalized === 'metamask') {
    return {
      ...available.metamask,
      isTrustWallet: false,
    };
  }

  if (normalized === 'trustwallet') {
    return {
      ...available.trustwallet,
      isMetaMask: false,
    };
  }

  if (!available.anyAvailable || !available.defaultProvider) {
    return {
      available: false,
      isMetaMask: false,
      isTrustWallet: false,
      walletType: null,
      walletName: 'Wallet',
      provider: null,
      error: available.error,
    };
  }

  return {
    available: true,
    isMetaMask: available.defaultWalletType === 'metamask' && Boolean(available.metamask.isMetaMask),
    isTrustWallet: available.defaultWalletType === 'trustwallet',
    walletType: available.defaultWalletType,
    walletName: available.defaultWalletName,
    provider: available.defaultProvider,
    error: '',
  };
}

export async function requestWalletAccounts(provider, walletName = 'Wallet') {
  if (!isValidEip1193Provider(provider)) {
    throw new Error(
      `${walletName} not detected. Install MetaMask or Trust Wallet to connect your wallet.`
    );
  }

  let accounts;
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' });
  } catch (err) {
    if (err?.code === 4001) {
      throw new Error(`${walletName} connection request was rejected by the user.`);
    }
    throw new Error(err?.message || `Failed to request wallet connection from ${walletName}.`);
  }

  if (!Array.isArray(accounts) || accounts.length === 0 || !accounts[0]) {
    throw new Error(`No wallet account was returned by ${walletName}.`);
  }

  return String(accounts[0]).trim();
}

export async function requestMetaMaskAccounts(ethereumProvider) {
  if (!isValidEip1193Provider(ethereumProvider)) {
    throw new Error(
      'MetaMask not detected. Please install the MetaMask browser extension to connect your wallet.'
    );
  }
  return requestWalletAccounts(ethereumProvider, 'MetaMask');
}

export function getWalletProviderLabel(walletInfo) {
  if (!walletInfo) return 'Wallet';
  if (walletInfo.walletType === 'trustwallet' || walletInfo.isTrustWallet) {
    return 'Trust Wallet';
  }
  if (walletInfo.walletType === 'metamask' || walletInfo.isMetaMask) {
    return 'MetaMask';
  }
  return walletInfo.walletName || 'Browser Wallet';
}

export function collectEventTargetProviders(
  targetWindow = typeof window !== 'undefined' ? window : undefined,
  announcedProviders = getAnnouncedWalletProviders()
) {
  const candidates = [];
  if (targetWindow?.ethereum) {
    candidates.push(targetWindow.ethereum);
    if (Array.isArray(targetWindow.ethereum.providers)) {
      candidates.push(...targetWindow.ethereum.providers);
    }
  }
  if (targetWindow?.trustwallet?.ethereum) candidates.push(targetWindow.trustwallet.ethereum);
  if (targetWindow?.trustwallet) candidates.push(targetWindow.trustwallet);
  if (targetWindow?.trustWallet?.ethereum) candidates.push(targetWindow.trustWallet.ethereum);
  if (targetWindow?.trustWallet) candidates.push(targetWindow.trustWallet);
  if (Array.isArray(announcedProviders)) {
    for (const item of announcedProviders) {
      if (item?.provider) candidates.push(item.provider);
    }
  }

  const seen = new Set();
  return candidates.filter((provider) => {
    if (!provider || typeof provider.on !== 'function' || seen.has(provider)) {
      return false;
    }
    seen.add(provider);
    return true;
  });
}

export function formatShortWalletAddress(address) {
  if (!address || typeof address !== 'string' || address.length < 10) {
    return address || 'Not linked';
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function resolveEvmNetworkName(chainId, fallbackName = '') {
  const num = Number(chainId);
  if (num === 11155111) return 'Ethereum Sepolia Testnet';
  if (num === 1) return 'Ethereum Mainnet';
  if (num === 137) return 'Polygon Mainnet';
  if (num === 80002) return 'Polygon Amoy Testnet';
  if (num === 31337) return 'Hardhat Local EVM';
  return fallbackName || (Number.isFinite(num) && num > 0 ? `Chain ${num}` : 'EVM Network');
}
