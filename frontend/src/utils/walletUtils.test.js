import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAnnouncedProvider,
  collectEventTargetProviders,
  detectAvailableWallets,
  detectMetaMask,
  detectTrustWallet,
  formatShortWalletAddress,
  getWalletProviderLabel,
  requestMetaMaskAccounts,
  requestWalletAccounts,
  resolveEvmNetworkName,
  selectWalletProvider,
} from './walletUtils.js';

test('detectMetaMask accurately detects window.ethereum and handles missing wallet', () => {
  const missing = detectMetaMask({});
  assert.equal(missing.available, false);
  assert.equal(missing.isMetaMask, false);
  assert.match(missing.error, /MetaMask not detected/i);

  const metamaskWindow = {
    ethereum: {
      isMetaMask: true,
      request: async () => ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8'],
    },
  };
  const detected = detectMetaMask(metamaskWindow);
  assert.equal(detected.available, true);
  assert.equal(detected.isMetaMask, true);
  assert.equal(detected.walletName, 'MetaMask');
  assert.equal(detected.error, '');
});

test('detectTrustWallet detects window.trustwallet, isTrust flags, and multi-provider arrays', () => {
  const missing = detectTrustWallet({});
  assert.equal(missing.available, false);
  assert.equal(missing.isTrustWallet, false);
  assert.match(missing.error, /Trust Wallet not detected/i);

  const dedicatedTrustProvider = {
    isTrust: true,
    request: async () => ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'],
  };
  const fromTrustGlobal = detectTrustWallet({ trustwallet: dedicatedTrustProvider });
  assert.equal(fromTrustGlobal.available, true);
  assert.equal(fromTrustGlobal.isTrustWallet, true);
  assert.equal(fromTrustGlobal.walletType, 'trustwallet');
  assert.equal(fromTrustGlobal.walletName, 'Trust Wallet');
  assert.equal(fromTrustGlobal.provider, dedicatedTrustProvider);

  // Trust Wallet sometimes sets both isMetaMask: true and isTrust: true; must NOT masquerade as MetaMask
  const trustMasquerading = {
    isMetaMask: true,
    isTrustWallet: true,
    request: async () => ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'],
  };
  const onlyTrustEth = { ethereum: trustMasquerading };
  assert.equal(detectTrustWallet(onlyTrustEth).available, true);
  assert.equal(detectMetaMask(onlyTrustEth).available, false);
});

test('selectWalletProvider and detectAvailableWallets resolve MetaMask and Trust Wallet independently', () => {
  const mmProvider = { isMetaMask: true, request: async () => ['0x1111111111111111111111111111111111111111'] };
  const twProvider = { isTrust: true, request: async () => ['0x2222222222222222222222222222222222222222'] };

  const dualWindow = {
    ethereum: {
      isMetaMask: true,
      providers: [mmProvider, twProvider],
      request: mmProvider.request,
    },
    trustwallet: twProvider,
  };

  const summary = detectAvailableWallets(dualWindow);
  assert.equal(summary.anyAvailable, true);
  assert.equal(summary.metamask.available, true);
  assert.equal(summary.trustwallet.available, true);
  assert.equal(summary.metamask.provider, mmProvider);
  assert.equal(summary.trustwallet.provider, twProvider);

  const selectedTrust = selectWalletProvider('trustwallet', dualWindow);
  assert.equal(selectedTrust.available, true);
  assert.equal(selectedTrust.walletType, 'trustwallet');
  assert.equal(selectedTrust.walletName, 'Trust Wallet');
  assert.equal(selectedTrust.isTrustWallet, true);
  assert.equal(selectedTrust.provider, twProvider);

  const selectedMetaMask = selectWalletProvider('metamask', dualWindow);
  assert.equal(selectedMetaMask.available, true);
  assert.equal(selectedMetaMask.walletType, 'metamask');
  assert.equal(selectedMetaMask.walletName, 'MetaMask');
  assert.equal(selectedMetaMask.isMetaMask, true);
  assert.equal(selectedMetaMask.provider, mmProvider);

  const noneAvailable = selectWalletProvider('auto', {});
  assert.equal(noneAvailable.available, false);
  assert.match(noneAvailable.error, /MetaMask or Trust Wallet/i);
});

test('classifyAnnouncedProvider maps EIP-6963 rdns for Trust Wallet and MetaMask', () => {
  const tw = classifyAnnouncedProvider({
    info: { rdns: 'com.trustwallet.app', name: 'Trust Wallet' },
    provider: { request: async () => [] },
  });
  assert.equal(tw?.walletType, 'trustwallet');
  assert.equal(tw?.walletName, 'Trust Wallet');

  const mm = classifyAnnouncedProvider({
    info: { rdns: 'io.metamask', name: 'MetaMask' },
    provider: { request: async () => [] },
  });
  assert.equal(mm?.walletType, 'metamask');
  assert.equal(mm?.walletName, 'MetaMask');
});

test('requestMetaMaskAccounts and requestWalletAccounts handle accounts and rejections cleanly', async () => {
  let calledMethod = null;
  const address = await requestMetaMaskAccounts({
    isMetaMask: true,
    request: async ({ method }) => {
      calledMethod = method;
      return ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8'];
    },
  });
  assert.equal(calledMethod, 'eth_requestAccounts');
  assert.equal(address, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');

  const twAddress = await requestWalletAccounts(
    {
      isTrust: true,
      request: async () => ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'],
    },
    'Trust Wallet'
  );
  assert.equal(twAddress, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');

  await assert.rejects(
    () =>
      requestWalletAccounts(
        {
          request: async () => {
            const err = new Error('User rejected');
            err.code = 4001;
            throw err;
          },
        },
        'Trust Wallet'
      ),
    /Trust Wallet connection request was rejected/i
  );

  await assert.rejects(() => requestMetaMaskAccounts(null), /MetaMask not detected/i);
});

test('getWalletProviderLabel and collectEventTargetProviders identify active wallet labels and unique listeners', () => {
  assert.equal(getWalletProviderLabel({ isTrustWallet: true }), 'Trust Wallet');
  assert.equal(getWalletProviderLabel({ walletType: 'trustwallet' }), 'Trust Wallet');
  assert.equal(getWalletProviderLabel({ isMetaMask: true }), 'MetaMask');
  assert.equal(getWalletProviderLabel({ walletType: 'injected' }), 'Browser Wallet');

  const shared = { on: () => {}, request: async () => [] };
  const other = { on: () => {}, request: async () => [] };
  const targets = collectEventTargetProviders({
    ethereum: shared,
    trustwallet: other,
    trustWallet: other,
  });
  assert.deepEqual(targets, [shared, other]);
});

test('formatShortWalletAddress and resolveEvmNetworkName format addresses and chains cleanly', () => {
  assert.equal(
    formatShortWalletAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8'),
    '0x7099...79C8'
  );
  assert.equal(formatShortWalletAddress(''), 'Not linked');
  assert.equal(resolveEvmNetworkName(1), 'Ethereum Mainnet');
  assert.equal(resolveEvmNetworkName(80002), 'Polygon Amoy Testnet');
  assert.equal(resolveEvmNetworkName(31337), 'Hardhat Local EVM');
});
