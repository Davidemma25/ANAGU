import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Interface } from 'ethers';
import {
  TITLE_CONTRACT_EVENTS_ABI,
  classifyOnChainMode,
  isValidEvmTxHash,
  resolveDeployedContractAddress,
  resolveExplorerBaseUrl,
  resolvePolygonRpcUrl,
  verifyTitleContractTxReceipt,
} from './onchainTxVerifier.js';

const SAMPLE_CONTRACT = '0x1234567890123456789012345678901234567890';
const SAMPLE_SELLER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SAMPLE_BUYER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const SAMPLE_TX_HASH = `0x${'a'.repeat(64)}`;
const titleIface = new Interface(TITLE_CONTRACT_EVENTS_ABI);

function makeEncodedLog(eventName, args) {
  const fragment = titleIface.getEvent(eventName);
  const encoded = titleIface.encodeEventLog(fragment, args);
  return {
    address: SAMPLE_CONTRACT,
    topics: encoded.topics,
    data: encoded.data,
  };
}

test('onchainTxVerifier resolves RPC priority, contract address fallback, explorer URLs, and modes', () => {
  assert.equal(isValidEvmTxHash(SAMPLE_TX_HASH), true);
  assert.equal(isValidEvmTxHash('0xblocked-transfer-123'), false);
  assert.equal(isValidEvmTxHash('0x1234'), false);

  assert.equal(
    resolvePolygonRpcUrl({
      POLYGON_AMOY_RPC_URL: 'https://amoy.example/rpc',
      POLYGON_RPC_URL: 'https://polygon.example/rpc',
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545',
    }),
    'https://amoy.example/rpc'
  );
  assert.equal(
    resolvePolygonRpcUrl({
      POLYGON_RPC_URL: 'https://polygon.example/rpc',
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545',
    }),
    'https://polygon.example/rpc'
  );
  assert.equal(
    resolvePolygonRpcUrl({}, 'http://fallback.local:8545'),
    'http://fallback.local:8545'
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-deploy-meta-'));
  try {
    const metaPath = path.join(tmpDir, 'deployed-amoy-title.json');
    fs.writeFileSync(metaPath, JSON.stringify({ contractAddress: SAMPLE_CONTRACT }));
    assert.equal(
      resolveDeployedContractAddress({ envAddress: '', deploymentFilePath: metaPath }),
      SAMPLE_CONTRACT
    );
    assert.equal(
      resolveDeployedContractAddress({
        envAddress: SAMPLE_BUYER,
        deploymentFilePath: metaPath,
      }),
      SAMPLE_BUYER
    );
    assert.equal(
      resolveDeployedContractAddress({
        envAddress: 'invalid-addr',
        deploymentFilePath: path.join(tmpDir, 'missing.json'),
      }),
      ''
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.equal(resolveExplorerBaseUrl(80002), 'https://amoy.polygonscan.com');
  assert.equal(resolveExplorerBaseUrl(137), 'https://polygonscan.com');
  assert.equal(resolveExplorerBaseUrl(11155111), 'https://sepolia.etherscan.io');
  assert.equal(resolveExplorerBaseUrl(31337), '');

  assert.deepEqual(classifyOnChainMode({ isInProcess: true, chainId: 31337 }), {
    onChainMode: 'LOCAL_HARDHAT',
    isRealOnChain: false,
    explorerBaseUrl: '',
  });
  assert.deepEqual(classifyOnChainMode({ isServerlessFallback: true, chainId: 31337 }), {
    onChainMode: 'SIMULATED_FALLBACK',
    isRealOnChain: false,
    explorerBaseUrl: '',
  });
  assert.deepEqual(classifyOnChainMode({ isInProcess: false, chainId: 80002 }), {
    onChainMode: 'REAL_TESTNET',
    isRealOnChain: true,
    explorerBaseUrl: 'https://amoy.polygonscan.com',
  });
});

test('verifyTitleContractTxReceipt validates ParcelListed, EscrowFunded, and ListingCancelled logs strictly', async () => {
  const validListedProvider = {
    async getTransactionReceipt(hash) {
      assert.equal(hash, SAMPLE_TX_HASH);
      return {
        status: 1,
        to: SAMPLE_CONTRACT,
        logs: [makeEncodedLog('ParcelListed', [7n, SAMPLE_SELLER, 2500000000000000000n])],
      };
    },
  };

  const listed = await verifyTitleContractTxReceipt({
    provider: validListedProvider,
    txHash: SAMPLE_TX_HASH,
    expectedContractAddress: SAMPLE_CONTRACT,
    expectedEventName: 'ParcelListed',
    expectedTokenId: '7',
    expectedPriceWei: 2500000000000000000n,
    expectedActorAddress: SAMPLE_SELLER,
  });
  assert.equal(listed.eventArgs.tokenId, '7');
  assert.equal(listed.eventArgs.seller.toLowerCase(), SAMPLE_SELLER.toLowerCase());
  assert.equal(listed.eventArgs.priceWei, '2500000000000000000');

  const fundedProvider = {
    async getTransactionReceipt() {
      return {
        status: 1,
        to: SAMPLE_CONTRACT,
        logs: [makeEncodedLog('EscrowFunded', [7n, SAMPLE_BUYER, 2500000000000000000n])],
      };
    },
  };
  const funded = await verifyTitleContractTxReceipt({
    provider: fundedProvider,
    txHash: SAMPLE_TX_HASH,
    expectedContractAddress: SAMPLE_CONTRACT,
    expectedEventName: 'EscrowFunded',
    expectedTokenId: '7',
    expectedPriceWei: 2500000000000000000n,
    expectedActorAddress: SAMPLE_BUYER,
  });
  assert.equal(funded.eventArgs.buyer.toLowerCase(), SAMPLE_BUYER.toLowerCase());

  const cancelledProvider = {
    async getTransactionReceipt() {
      return {
        status: 1,
        to: SAMPLE_CONTRACT,
        logs: [makeEncodedLog('ListingCancelled', [7n, SAMPLE_SELLER])],
      };
    },
  };
  const cancelled = await verifyTitleContractTxReceipt({
    provider: cancelledProvider,
    txHash: SAMPLE_TX_HASH,
    expectedContractAddress: SAMPLE_CONTRACT,
    expectedEventName: 'ListingCancelled',
    expectedTokenId: '7',
  });
  assert.equal(cancelled.eventArgs.cancelledBy.toLowerCase(), SAMPLE_SELLER.toLowerCase());
});

test('verifyTitleContractTxReceipt requires the listing seller and buyer for seller-confirmed settlement', async () => {
  const provider = {
    async getTransactionReceipt() {
      return {
        status: 1,
        to: SAMPLE_CONTRACT,
        logs: [
          makeEncodedLog('SaleSettled', [
            7n,
            SAMPLE_SELLER,
            SAMPLE_BUYER,
            2500000000000000000n,
          ]),
        ],
      };
    },
  };
  const verified = await verifyTitleContractTxReceipt({
    provider,
    txHash: SAMPLE_TX_HASH,
    expectedContractAddress: SAMPLE_CONTRACT,
    expectedEventName: 'SaleSettled',
    expectedTokenId: '7',
    expectedActorAddress: SAMPLE_SELLER,
    expectedCounterpartyAddress: SAMPLE_BUYER,
  });
  assert.equal(verified.eventArgs.seller.toLowerCase(), SAMPLE_SELLER.toLowerCase());
  assert.equal(verified.eventArgs.buyer.toLowerCase(), SAMPLE_BUYER.toLowerCase());
  assert.equal(verified.eventArgs.priceWei, '2500000000000000000');

  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider,
        txHash: SAMPLE_TX_HASH,
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'SaleSettled',
        expectedTokenId: '7',
        expectedActorAddress: SAMPLE_BUYER,
        expectedCounterpartyAddress: SAMPLE_BUYER,
      }),
    /seller wallet does not match/i
  );
  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider,
        txHash: SAMPLE_TX_HASH,
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'SaleSettled',
        expectedTokenId: '7',
        expectedActorAddress: SAMPLE_SELLER,
        expectedCounterpartyAddress: SAMPLE_SELLER,
      }),
    /buyer wallet does not match/i
  );
});

test('verifyTitleContractTxReceipt rejects bad hashes, reverts, wrong targets, and mismatched events', async () => {
  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider: { async getTransactionReceipt() { return null; } },
        txHash: 'not-a-hash',
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'ParcelListed',
        expectedTokenId: '7',
      }),
    /not a valid 66-character 0x hash/i
  );

  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider: {
          async getTransactionReceipt() {
            return { status: 0, to: SAMPLE_CONTRACT, logs: [] };
          },
        },
        txHash: SAMPLE_TX_HASH,
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'ParcelListed',
        expectedTokenId: '7',
      }),
    /reverted on-chain/i
  );

  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider: {
          async getTransactionReceipt() {
            return { status: 1, to: SAMPLE_BUYER, logs: [] };
          },
        },
        txHash: SAMPLE_TX_HASH,
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'ParcelListed',
        expectedTokenId: '7',
      }),
    /does not match the official AnaguLandTitle contract/i
  );

  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider: {
          async getTransactionReceipt() {
            return {
              status: 1,
              to: SAMPLE_CONTRACT,
              logs: [makeEncodedLog('EscrowFunded', [99n, SAMPLE_BUYER, 100n])],
            };
          },
        },
        txHash: SAMPLE_TX_HASH,
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'EscrowFunded',
        expectedTokenId: '7',
        expectedPriceWei: 100n,
        expectedActorAddress: SAMPLE_BUYER,
      }),
    /token ID mismatch/i
  );

  await assert.rejects(
    () =>
      verifyTitleContractTxReceipt({
        provider: {
          async getTransactionReceipt() {
            return {
              status: 1,
              to: SAMPLE_CONTRACT,
              logs: [makeEncodedLog('EscrowFunded', [7n, SAMPLE_BUYER, 50n])],
            };
          },
        },
        txHash: SAMPLE_TX_HASH,
        expectedContractAddress: SAMPLE_CONTRACT,
        expectedEventName: 'EscrowFunded',
        expectedTokenId: '7',
        expectedPriceWei: 100n,
        expectedActorAddress: SAMPLE_BUYER,
      }),
    /less than the required listing price/i
  );
});
