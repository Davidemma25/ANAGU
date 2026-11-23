import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createApp } from './app.js';
import { createAdminApp } from '../admin/src/app.js';
import { ensureSeedUsers } from './models/userModel.js';
import { resetBlockchainContextForTests } from './services/blockchainService.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
  submitApplicationReviewAction,
} from './testHelpers/applicationReviews.js';

import './testEnv.js';
import { getAdminEmail } from './config/env.js';

test('Phase 8 NFT Minting, Direct Transfer Blocking, and Polygon Escrow Buy/Sell Settlement', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-chain-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevReqPay = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  process.env.REQUIRE_PAYMENT_BEFORE_GIS = 'false';
  delete process.env.ADMIN_PASSWORD;
  resetBlockchainContextForTests();

  await ensureSeedUsers();
  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const registerCitizen = async (fullName, email, nationalId, walletAddress) => {
      const r = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password: 'Password123!',
          nationalId,
          walletAddress,
        }),
      });
      return r.json();
    };

    const { token: citizenToken } = await registerCitizen(
      'Amara Okafor',
      'seller@example.com',
      'NID-CHAIN-001',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    );
    const { token: buyerToken, user: buyerUser } = await registerCitizen(
      'Tunde Adeyemi',
      'buyer@example.com',
      'NID-CHAIN-002',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
    );

    const adminRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const { token: adminToken } = await adminRes.json();

    // 1. Submit + GIS validate + Community verify
    const appRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Plot A Marketplace Parcel',
        locationDescription: 'Zone 1 Block A',
        region: 'Zone 1',
        declaredAreaSqm: 27700,
        ownershipType: 'FREEHOLD',
        claimantName: 'Amara Okafor',
        claimantNationalId: 'NID-1001-AMA',
        coordinates: [
          [3.375, 6.52],
          [3.3765, 6.52],
          [3.3765, 6.5215],
          [3.375, 6.5215],
          [3.375, 6.52],
        ],
      }),
    });
    const { application } = await appRes.json();

    // Admin cannot bypass GIS + Oracle to mint early
    const earlyMint = await fetch(`${baseUrl}/api/admin/titles/mint/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(earlyMint.status, 409);

    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'blockchain');
    await completeSurveyorHandoff({
      baseUrl,
      applicationId: application.id,
      token: surveyorToken,
    });
    const gisRes = await fetch(`${baseUrl}/api/admin/gis/validate/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(gisRes.status, 200);

    const verRes = await fetch(`${baseUrl}/api/admin/verification/decide/${application.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        remarks: 'Verified against INST-2024-001.',
      }),
    });
    assert.equal(verRes.status, 201);

    const registrarToken = await createReviewStaffToken('REGISTRAR', 'blockchain');
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: application.id,
      token: registrarToken,
      action: 'START_LEGAL_REVIEW',
      reason: 'Ownership verification completed; legal review started.',
    });
    await submitApplicationReviewAction({
      baseUrl,
      applicationId: application.id,
      token: registrarToken,
      action: 'APPROVE_APPLICATION',
      reason: 'Legal documents reviewed and approval recorded.',
    });

    // 2. Citizen cannot mint NFT (403); Sole Admin mints ERC-721 NFT Title
    const citMint = await fetch(`${baseUrl}/api/admin/titles/mint/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal(citMint.status, 403);

    const mintRes = await fetch(`${baseUrl}/api/admin/titles/mint/${application.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(mintRes.status, 201);
    const mintBody = await mintRes.json();
    assert.equal(mintBody.title.token_id, '1');
    assert.equal(mintBody.title.title_status, 'ACTIVE');
    assert.ok(mintBody.transaction.tx_hash.startsWith('0x'));

    // 3. Direct owner-to-owner transfer is blocked on-chain
    const blockRes = await fetch(`${baseUrl}/api/titles/${mintBody.title.id}/test-transfer-block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({ toWallet: buyerUser.walletAddress }),
    });
    assert.equal(blockRes.status, 200);
    const blockBody = await blockRes.json();
    assert.equal(blockBody.blocked, true);
    assert.match(blockBody.reason, /TransferBlockedByRegistryRule/i);

    // 4. Citizen lists title for 2.5 POL -> Buyer funds escrow -> Sole Admin settles sale
    const listRes = await fetch(`${baseUrl}/api/marketplace/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({ titleId: mintBody.title.id, pricePol: 2.5 }),
    });
    assert.equal(listRes.status, 201);
    const { listing } = await listRes.json();
    assert.equal(listing.listing_status, 'LISTED');

    const buyRes = await fetch(`${baseUrl}/api/marketplace/listings/${listing.id}/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(buyRes.status, 200);
    const buyBody = await buyRes.json();
    assert.equal(buyBody.listing.listing_status, 'ESCROW_FUNDED');

    // Citizen cannot settle sale (403); Sole Admin settles sale (200)
    const citSettle = await fetch(`${baseUrl}/api/admin/marketplace/listings/${listing.id}/settle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    assert.equal(citSettle.status, 403);

    const settleRes = await fetch(`${baseUrl}/api/admin/marketplace/listings/${listing.id}/settle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(settleRes.status, 200);
    const settleBody = await settleRes.json();
    assert.equal(settleBody.listing.listing_status, 'COMPLETED');

    // Verify ownership transferred to buyer in title ledger
    const titlesRes = await fetch(`${baseUrl}/api/admin/titles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { titles } = await titlesRes.json();
    assert.equal(titles[0].owner_id, buyerUser.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetBlockchainContextForTests();
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevReqPay === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hasServerSignerForAddress, ONCHAIN_STRICT_MODE, and real Polygon Amoy RPC enforce wallet-signature boundaries', async () => {
  const { hasServerSignerForAddress, getContractInfo, listParcelOnChain } = await import(
    './services/blockchainService.js'
  );
  const prevStrict = process.env.ONCHAIN_STRICT_MODE;
  const prevRpc = process.env.POLYGON_AMOY_RPC_URL;
  const prevFallbackRpc = process.env.POLYGON_RPC_URL;
  const prevBlockchainRpc = process.env.BLOCKCHAIN_RPC_URL;
  const prevContract = process.env.ANAGU_CONTRACT_ADDRESS;
  const prevRegistrarKey = process.env.REGISTRAR_PRIVATE_KEY;

  // Mock JSON-RPC server simulating Polygon Amoy (chainId 80002 = 0x13882) with deployed bytecode
  const mockRpcServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const handleCall = (item) => {
        if (item.method === 'eth_chainId') return { jsonrpc: '2.0', id: item.id, result: '0x13882' };
        if (item.method === 'net_version') return { jsonrpc: '2.0', id: item.id, result: '80002' };
        if (item.method === 'eth_getCode') return { jsonrpc: '2.0', id: item.id, result: '0x6080604052' };
        if (item.method === 'eth_call') {
          return {
            jsonrpc: '2.0',
            id: item.id,
            result: '0x0000000000000000000000000000000000000000000000000000000000000003',
          };
        }
        return { jsonrpc: '2.0', id: item.id, result: '0x0' };
      };
      const response = Array.isArray(payload) ? payload.map(handleCall) : handleCall(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });

  await new Promise((resolve) => mockRpcServer.listen(0, '127.0.0.1', resolve));
  const { port: rpcPort } = mockRpcServer.address();

  try {
    // 1. Local prototype mode
    resetBlockchainContextForTests();
    delete process.env.ONCHAIN_STRICT_MODE;
    delete process.env.POLYGON_AMOY_RPC_URL;
    delete process.env.POLYGON_RPC_URL;
    delete process.env.BLOCKCHAIN_RPC_URL;

    const localInfo = await getContractInfo();
    assert.equal(localInfo.isRealOnChain, false);
    assert.equal(localInfo.onChainMode, 'LOCAL_HARDHAT');
    assert.equal(await hasServerSignerForAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8'), true);

    // 2. Strict mode without RPC fails loudly (re-clear in case hardhat.config.cjs ran dotenv)
    resetBlockchainContextForTests();
    delete process.env.POLYGON_AMOY_RPC_URL;
    delete process.env.POLYGON_RPC_URL;
    delete process.env.BLOCKCHAIN_RPC_URL;
    process.env.ONCHAIN_STRICT_MODE = 'true';
    await assert.rejects(() => getContractInfo(), /ONCHAIN_STRICT_MODE=true requires/i);

    // 3. External Polygon Amoy RPC mode with deployed contract + registrar key
    resetBlockchainContextForTests();
    process.env.POLYGON_AMOY_RPC_URL = `http://127.0.0.1:${rpcPort}`;
    process.env.ANAGU_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
    process.env.REGISTRAR_PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    const amoyInfo = await getContractInfo();
    assert.equal(amoyInfo.chainId, 80002);
    assert.equal(amoyInfo.isRealOnChain, true);
    assert.equal(amoyInfo.onChainMode, 'REAL_TESTNET');
    assert.equal(amoyInfo.explorerBaseUrl, 'https://amoy.polygonscan.com');
    assert.equal(amoyInfo.totalTitlesIssued, 3);

    // Registrar wallet is signed by server, unrelated citizen wallet requires MetaMask signature
    assert.equal(await hasServerSignerForAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'), true);
    assert.equal(await hasServerSignerForAddress('0x000000000000000000000000000000000000dead'), false);

    await assert.rejects(
      () =>
        listParcelOnChain({
          sellerWallet: '0x000000000000000000000000000000000000dead',
          tokenId: '1',
          pricePol: 2.5,
        }),
      (err) => err.status === 409 && err.code === 'WALLET_SIGNATURE_REQUIRED'
    );
  } finally {
    await new Promise((resolve) => mockRpcServer.close(resolve));
    if (prevStrict === undefined) delete process.env.ONCHAIN_STRICT_MODE;
    else process.env.ONCHAIN_STRICT_MODE = prevStrict;
    if (prevRpc === undefined) delete process.env.POLYGON_AMOY_RPC_URL;
    else process.env.POLYGON_AMOY_RPC_URL = prevRpc;
    if (prevFallbackRpc === undefined) delete process.env.POLYGON_RPC_URL;
    else process.env.POLYGON_RPC_URL = prevFallbackRpc;
    if (prevBlockchainRpc === undefined) delete process.env.BLOCKCHAIN_RPC_URL;
    else process.env.BLOCKCHAIN_RPC_URL = prevBlockchainRpc;
    if (prevContract === undefined) delete process.env.ANAGU_CONTRACT_ADDRESS;
    else process.env.ANAGU_CONTRACT_ADDRESS = prevContract;
    if (prevRegistrarKey === undefined) delete process.env.REGISTRAR_PRIVATE_KEY;
    else process.env.REGISTRAR_PRIVATE_KEY = prevRegistrarKey;
    resetBlockchainContextForTests();
  }
});

test('AnaguEscrow verifyListingOnChain and listParcelOnChain use escrow state and priceAnagu in REAL_TESTNET mode', async () => {
  const { ethers } = await import('ethers');
  const {
    getActiveEscrowConfig,
    listParcelOnChain,
    verifyListingOnChain,
  } = await import('./services/blockchainService.js');

  const TITLE_ADDR = '0x0eb2c04c0Da4AfFd48d4ec68256AD745ca4c6710';
  const ESCROW_ADDR = '0xFF2794e6FF4aB950dE2F6Aea4a241F0c6274184e';
  const TOKEN_ADDR = '0x3af5904E22d4584057faCfeFaC07D1FE175E2009';
  const SELLER = '0x5C0Ff939DbFC9074AE315d7f168b2c5B45234Ca6';
  const BUYER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
  const PRICE_ANAGU_WEI = ethers.parseEther('4500');
  const TX_HASH = '0x' + 'ab'.repeat(32);

  const titleIface = new ethers.Interface([
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function getTitle(uint256 tokenId) view returns (tuple(uint256 tokenId, string parcelCode, string applicationRef, string metadataUri, uint256 issuedAt, address issuedBy, uint8 status, uint8 revocationGround, string revocationReason, uint256 revokedAt, address revokedBy))',
    'function getListing(uint256 tokenId) view returns (tuple(uint256 tokenId, address seller, uint256 priceWei, address buyer, uint256 escrowFundedWei, bool isListed, bool escrowFunded))',
    'function getTransferHistory(uint256 tokenId) view returns (tuple(address from, address to, uint256 priceWei, uint256 timestamp, string transferType)[])',
  ]);
  const escrowIface = new ethers.Interface([
    'function getEscrow(uint256 tokenId) view returns (tuple(uint256 tokenId, address seller, address buyer, uint256 price, uint64 expiresAt, uint8 status))',
    'event ParcelListed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiresAt)',
  ]);

  let currentEscrowStatus = 1; // 1 = Listed, 2 = Funded
  const mockRpcServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const handleCall = (item) => {
        if (item.method === 'eth_chainId') return { jsonrpc: '2.0', id: item.id, result: '0x13882' };
        if (item.method === 'net_version') return { jsonrpc: '2.0', id: item.id, result: '80002' };
        if (item.method === 'eth_getCode') return { jsonrpc: '2.0', id: item.id, result: '0x6080604052' };
        if (item.method === 'eth_getTransactionReceipt') {
          const eventLog = escrowIface.encodeEventLog(escrowIface.getEvent('ParcelListed'), [
            1n,
            SELLER,
            PRICE_ANAGU_WEI,
            1800000000n,
          ]);
          return {
            jsonrpc: '2.0',
            id: item.id,
            result: {
              transactionHash: TX_HASH,
              transactionIndex: '0x0',
              blockHash: '0x' + 'cd'.repeat(32),
              blockNumber: '0x32f1e0',
              from: SELLER,
              to: ESCROW_ADDR,
              cumulativeGasUsed: '0x5208',
              gasUsed: '0x15f90',
              logs: [
                {
                  transactionIndex: '0x0',
                  blockNumber: '0x32f1e0',
                  transactionHash: TX_HASH,
                  address: ESCROW_ADDR,
                  topics: eventLog.topics,
                  data: eventLog.data,
                  logIndex: '0x0',
                  blockHash: '0x' + 'cd'.repeat(32),
                },
              ],
              logsBloom: '0x' + '00'.repeat(256),
              status: '0x1',
            },
          };
        }
        if (item.method === 'eth_call') {
          const { to, data } = item.params[0] || {};
          if (String(to || '').toLowerCase() === ESCROW_ADDR.toLowerCase()) {
            const encoded = escrowIface.encodeFunctionResult('getEscrow', [
              [
                1n,
                SELLER,
                currentEscrowStatus === 2 ? BUYER : ethers.ZeroAddress,
                PRICE_ANAGU_WEI,
                1800000000n,
                currentEscrowStatus,
              ],
            ]);
            return { jsonrpc: '2.0', id: item.id, result: encoded };
          }
          const selector = String(data || '').slice(0, 10).toLowerCase();
          if (selector === titleIface.getFunction('ownerOf').selector) {
            return { jsonrpc: '2.0', id: item.id, result: titleIface.encodeFunctionResult('ownerOf', [SELLER]) };
          }
          if (selector === titleIface.getFunction('getTitle').selector) {
            return {
              jsonrpc: '2.0',
              id: item.id,
              result: titleIface.encodeFunctionResult('getTitle', [
                [1n, 'ANG-PARCEL-1', 'ANG-APP-1', 'ipfs://1', 1700000000n, SELLER, 0, 0, '', 0n, ethers.ZeroAddress],
              ]),
            };
          }
          if (selector === titleIface.getFunction('getListing').selector) {
            return {
              jsonrpc: '2.0',
              id: item.id,
              result: titleIface.encodeFunctionResult('getListing', [
                [1n, ethers.ZeroAddress, 0n, ethers.ZeroAddress, 0n, false, false],
              ]),
            };
          }
          if (selector === titleIface.getFunction('getTransferHistory').selector) {
            return {
              jsonrpc: '2.0',
              id: item.id,
              result: titleIface.encodeFunctionResult('getTransferHistory', [[]]),
            };
          }
        }
        return { jsonrpc: '2.0', id: item.id, result: '0x0' };
      };
      const response = Array.isArray(payload) ? payload.map(handleCall) : handleCall(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });

  await new Promise((resolve) => mockRpcServer.listen(0, '127.0.0.1', resolve));
  const { port: rpcPort } = mockRpcServer.address();

  const savedEnv = {
    ONCHAIN_STRICT_MODE: process.env.ONCHAIN_STRICT_MODE,
    POLYGON_AMOY_RPC_URL: process.env.POLYGON_AMOY_RPC_URL,
    ANAGU_CONTRACT_ADDRESS: process.env.ANAGU_CONTRACT_ADDRESS,
    ANAGU_ESCROW_ADDRESS: process.env.ANAGU_ESCROW_ADDRESS,
    ANAGU_TOKEN_ADDRESS: process.env.ANAGU_TOKEN_ADDRESS,
    REGISTRAR_PRIVATE_KEY: process.env.REGISTRAR_PRIVATE_KEY,
  };

  try {
    resetBlockchainContextForTests();
    delete process.env.ONCHAIN_STRICT_MODE;
    process.env.POLYGON_AMOY_RPC_URL = `http://127.0.0.1:${rpcPort}`;
    process.env.ANAGU_CONTRACT_ADDRESS = TITLE_ADDR;
    process.env.ANAGU_ESCROW_ADDRESS = ESCROW_ADDR;
    process.env.ANAGU_TOKEN_ADDRESS = TOKEN_ADDR;
    process.env.REGISTRAR_PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    const cfg = await getActiveEscrowConfig();
    assert.equal(cfg.isRealOnChain, true);
    assert.equal(cfg.escrowAddress, ESCROW_ADDR);
    assert.equal(cfg.tokenAddress, TOKEN_ADDR);

    const listedCheck = await verifyListingOnChain({
      tokenId: '1',
      expectedSellerWallet: SELLER,
      expectedPriceWei: PRICE_ANAGU_WEI.toString(),
    });
    assert.equal(listedCheck.ok, true);
    assert.equal(listedCheck.isListed, true);
    assert.equal(listedCheck.escrowFunded, false);
    assert.equal(listedCheck.priceMatches, true);

    currentEscrowStatus = 2;
    const fundedCheck = await verifyListingOnChain({
      tokenId: '1',
      expectedSellerWallet: SELLER,
      expectedPriceWei: PRICE_ANAGU_WEI.toString(),
    });
    assert.equal(fundedCheck.ok, false);
    assert.equal(fundedCheck.escrowFunded, true);

    const verifiedList = await listParcelOnChain({
      sellerWallet: SELLER,
      tokenId: '1',
      pricePol: 4.5,
      priceAnagu: 4500,
      txHash: TX_HASH,
    });
    assert.equal(verifiedList.escrowPriceWei, PRICE_ANAGU_WEI.toString());
    assert.equal(verifiedList.sellerWallet.toLowerCase(), SELLER.toLowerCase());

    await assert.rejects(
      () =>
        listParcelOnChain({
          sellerWallet: SELLER,
          tokenId: '1',
          pricePol: 4.5,
          priceAnagu: 9999,
          txHash: TX_HASH,
        }),
      (err) => err.status === 400 && /amount does not match/i.test(err.message)
    );
  } finally {
    await new Promise((resolve) => mockRpcServer.close(resolve));
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetBlockchainContextForTests();
  }
});



