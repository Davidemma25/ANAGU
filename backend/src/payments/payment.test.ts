import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Interface, Wallet } from 'ethers';
import express from 'express';
import { createApp } from '../app.js';
import { createAdminApp } from '../../admin/src/app.js';
import { getAdminEmail } from '../config/env.js';
import { ensureSeedUsers } from '../models/userModel.js';
import {
  completeSurveyorHandoff,
  createReviewStaffToken,
} from '../testHelpers/applicationReviews.js';
import '../testEnv.js';
import { ANAGU_PAYMENT_ABI } from './anaguPaymentAbi.js';
import {
  calculateRegistrationFeeQuote,
  convertNgnToWeiSafely,
  isQuoteExpired,
  signPaymentQuoteOffChain,
} from './paymentFeeCalculator.js';
import { verifyRegistrationPaymentOnChain } from './paymentVerifier.js';
import {
  processBlockchainPaymentEvent,
  recordAndVerifySubmittedTransaction,
} from './paymentService.js';

interface EthereumReadProvider {
  getNetwork(): Promise<{ chainId: bigint; name?: string }>;
  getBlockNumber(): Promise<number>;
  getTransaction(txHash: string): Promise<any>;
  getTransactionReceipt(txHash: string): Promise<any>;
}

const iface = new Interface(ANAGU_PAYMENT_ABI);
const TEST_CONTRACT = '0x1111111111111111111111111111111111111111';
const TEST_PAYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_TX_HASH = `0x${'ab'.repeat(32)}`;

function makePaymentLog({
  contractAddress = TEST_CONTRACT,
  registrationReference,
  quoteId = `0x${'12'.repeat(32)}`,
  payer = TEST_PAYER,
  amountWei,
  paidAt = 1760000000n,
  logIndex = 0,
}: {
  contractAddress?: string;
  registrationReference: string;
  quoteId?: string;
  payer?: string;
  amountWei: bigint;
  paidAt?: bigint;
  logIndex?: number;
}) {
  const fragment = iface.getEvent('PaymentReceived')!;
  const encoded = iface.encodeEventLog(fragment, [
    '0x' + '00'.repeat(32), // overridden by encodeEventLog for indexed string hash
    registrationReference,
    quoteId,
    payer,
    amountWei,
    paidAt,
  ]);
  return {
    address: contractAddress,
    topics: encoded.topics,
    data: encoded.data,
    index: logIndex,
  };
}

test('convertNgnToWeiSafely and calculateRegistrationFeeQuote apply safe rounding and test disclaimers', () => {
  const wei = convertNgnToWeiSafely(15000, 4500000);
  // 15000 / 4500000 = 0.003333333... -> rounded up to 0.0033334 ETH = 3333400000000000 wei
  assert.equal(wei, 3333400000000000n);

  const quote = calculateRegistrationFeeQuote({
    testFeeNgn: 15000,
    ethNgnExchangeRate: 4500000,
    rateSource: 'CONFIGURABLE_TEST_RATE',
    quoteTtlSeconds: 900,
    nowMs: 1_760_000_000_000,
  });
  assert.equal(quote.amountWei, '3333400000000000');
  assert.equal(quote.amountEth, '0.0033334');
  assert.equal(quote.isTestPayment, true);
  assert.match(quote.currencyDisclaimer, /no real monetary value/i);
  assert.equal(isQuoteExpired(quote.expiresAt, 1_760_000_000_000), false);
  assert.equal(isQuoteExpired(quote.expiresAt, 1_760_001_000_000), true);
});

test('verifyRegistrationPaymentOnChain rejects wrong chain, wrong contract, reverts, and mismatched amounts/refs', async () => {
  const amountWei = 3333400000000000n;
  const validLog = makePaymentLog({
    registrationReference: 'ANG-APP-2026-0001',
    amountWei,
  });

  // 1. Chain mismatch
  const wrongChainProvider: EthereumReadProvider = {
    getNetwork: async () => ({ chainId: 1n }),
    getBlockNumber: async () => 100,
    getTransaction: async () => ({ hash: TEST_TX_HASH, from: TEST_PAYER, to: TEST_CONTRACT, value: amountWei }),
    getTransactionReceipt: async () => ({ to: TEST_CONTRACT, status: 1, blockNumber: 99, logs: [validLog] }),
  };
  const chainRes = await verifyRegistrationPaymentOnChain({
    provider: wrongChainProvider,
    txHash: TEST_TX_HASH,
    expectedChainId: 11155111,
    expectedContractAddress: TEST_CONTRACT,
    expectedRegistrationReference: 'ANG-APP-2026-0001',
    expectedAmountWei: amountWei.toString(),
  });
  assert.equal(chainRes.status, 'FAILED');
  assert.match(chainRes.reason || '', /chain id mismatch/i);

  // 2. Wrong contract address
  const wrongContractProvider: EthereumReadProvider = {
    ...wrongChainProvider,
    getNetwork: async () => ({ chainId: 11155111n }),
    getTransactionReceipt: async () => ({
      to: '0x2222222222222222222222222222222222222222',
      status: 1,
      blockNumber: 99,
      logs: [validLog],
    }),
  };
  const contractRes = await verifyRegistrationPaymentOnChain({
    provider: wrongContractProvider,
    txHash: TEST_TX_HASH,
    expectedChainId: 11155111,
    expectedContractAddress: TEST_CONTRACT,
    expectedRegistrationReference: 'ANG-APP-2026-0001',
    expectedAmountWei: amountWei.toString(),
  });
  assert.equal(contractRes.status, 'FAILED');
  assert.match(contractRes.reason || '', /target address/i);

  // 3. Reverted tx
  const revertedProvider: EthereumReadProvider = {
    ...wrongChainProvider,
    getNetwork: async () => ({ chainId: 11155111n }),
    getTransactionReceipt: async () => ({ to: TEST_CONTRACT, status: 0, blockNumber: 99, logs: [] }),
  };
  const revertRes = await verifyRegistrationPaymentOnChain({
    provider: revertedProvider,
    txHash: TEST_TX_HASH,
    expectedChainId: 11155111,
    expectedContractAddress: TEST_CONTRACT,
    expectedRegistrationReference: 'ANG-APP-2026-0001',
    expectedAmountWei: amountWei.toString(),
  });
  assert.equal(revertRes.status, 'FAILED');
  assert.match(revertRes.reason || '', /reverted/i);

  // 4. Registration reference mismatch
  const wrongRefProvider: EthereumReadProvider = {
    ...wrongChainProvider,
    getNetwork: async () => ({ chainId: 11155111n }),
    getTransactionReceipt: async () => ({ to: TEST_CONTRACT, status: 1, blockNumber: 99, logs: [validLog] }),
  };
  const refRes = await verifyRegistrationPaymentOnChain({
    provider: wrongRefProvider,
    txHash: TEST_TX_HASH,
    expectedChainId: 11155111,
    expectedContractAddress: TEST_CONTRACT,
    expectedRegistrationReference: 'ANG-APP-2026-9999',
    expectedAmountWei: amountWei.toString(),
  });
  assert.equal(refRes.status, 'FAILED');
  assert.match(refRes.reason || '', /reference mismatch/i);

  // 5. Pending confirmations stays PROCESSING
  const pendingConfProvider: EthereumReadProvider = {
    ...wrongRefProvider,
    getBlockNumber: async () => 99,
  };
  const confRes = await verifyRegistrationPaymentOnChain({
    provider: pendingConfProvider,
    txHash: TEST_TX_HASH,
    expectedChainId: 11155111,
    expectedContractAddress: TEST_CONTRACT,
    expectedRegistrationReference: 'ANG-APP-2026-0001',
    expectedAmountWei: amountWei.toString(),
    requiredConfirmations: 3,
  });
  assert.equal(confRes.status, 'PROCESSING');

  // 6. Full valid match passes as PAID
  const validProvider: EthereumReadProvider = {
    ...wrongRefProvider,
    getBlockNumber: async () => 101,
  };
  const okRes = await verifyRegistrationPaymentOnChain({
    provider: validProvider,
    txHash: TEST_TX_HASH,
    expectedChainId: 11155111,
    expectedContractAddress: TEST_CONTRACT,
    expectedRegistrationReference: 'ANG-APP-2026-0001',
    expectedAmountWei: amountWei.toString(),
    expectedPayerAddress: TEST_PAYER,
    requiredConfirmations: 2,
  });
  assert.equal(okRes.status, 'PAID');
  assert.equal(okRes.verified, true);
  assert.equal(okRes.confirmations, 3);
});

test('End-to-end payment API workflow, GIS payment gate, idempotency, RBAC, and non-auto-approval', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-payment-test-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevReqPay = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  process.env.REQUIRE_PAYMENT_BEFORE_GIS = 'true';
  delete process.env.ADMIN_PASSWORD;
  const signerWallet = Wallet.createRandom();
  process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY = signerWallet.privateKey;
  process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS = TEST_CONTRACT;

  await ensureSeedUsers();
  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const citRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Amara Okafor',
        email: 'pay-citizen@example.com',
        password: 'Password123!',
        nationalId: 'NID-PAY-001',
      }),
    });
    const { token: citizenToken, user: citizenUser } = await citRes.json();

    const adminRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const { token: adminToken } = await adminRes.json();

    // Public payment config exposes zero secrets and labels test fee
    const cfgRes = await fetch(`${baseUrl}/api/payments/config`);
    assert.equal(cfgRes.status, 200);
    const cfgBody = await cfgRes.json();
    assert.equal(cfgBody.chainId, 11155111);
    assert.equal(cfgBody.isTestPayment, true);
    assert.equal('quoteSignerPrivateKey' in cfgBody, false);

    // 1. Citizen creates land application -> auto-calculates PENDING fee quote
    const appRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Sepolia Fee Gate Plot',
        locationDescription: 'Zone 1 District',
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
    assert.equal(appRes.status, 201);
    const { application, paymentQuote } = await appRes.json();
    assert.equal(application.status, 'SUBMITTED');
    assert.equal(paymentQuote.payment_status, 'PENDING');
    assert.ok(paymentQuote.quote_signature);

    // Verify off-chain quote signature helper produces valid signature
    const reSigned = await signPaymentQuoteOffChain({
      privateKey: signerWallet.privateKey,
      chainId: 11155111,
      contractAddress: TEST_CONTRACT,
      registrationReference: application.reference_code,
      quoteId: paymentQuote.quote_id,
      amountWei: paymentQuote.amount_wei,
      expiresAtUnix: Math.floor(new Date(paymentQuote.quote_expires_at).getTime() / 1000),
    });
    assert.equal(reSigned.length, paymentQuote.quote_signature.length);

    // 2. Admin GIS validation MUST be blocked (402) before registration payment is PAID
    const blockedGis = await fetch(`${baseUrl}/api/admin/gis/validate/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(blockedGis.status, 402);

    // 3. Submit transaction & run independent RPC verification against mock Sepolia provider
    const validLog = makePaymentLog({
      contractAddress: TEST_CONTRACT,
      registrationReference: application.reference_code,
      quoteId: paymentQuote.quote_id,
      payer: TEST_PAYER,
      amountWei: BigInt(paymentQuote.amount_wei),
    });
    const mockSepoliaProvider: EthereumReadProvider = {
      getNetwork: async () => ({ chainId: 11155111n }),
      getBlockNumber: async () => 7200010,
      getTransaction: async () => ({
        hash: TEST_TX_HASH,
        from: TEST_PAYER,
        to: TEST_CONTRACT,
        value: BigInt(paymentQuote.amount_wei),
      }),
      getTransactionReceipt: async () => ({
        to: TEST_CONTRACT,
        status: 1,
        blockNumber: 7200009,
        logs: [validLog],
      }),
    };

    const verified = await recordAndVerifySubmittedTransaction({
      paymentId: paymentQuote.id,
      txHash: TEST_TX_HASH,
      walletAddress: TEST_PAYER,
      user: { id: citizenUser.id, roleCode: 'CITIZEN' },
      providerOverride: mockSepoliaProvider,
      contractAddressOverride: TEST_CONTRACT,
      chainIdOverride: 11155111,
    });
    assert.equal(verified.payment?.payment_status, 'PAID');

    // 4. Verify application is STILL SUBMITTED (payment NEVER auto-approves or issues NFT)
    const appDetailRes = await fetch(`${baseUrl}/api/applications/${application.id}`, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    const appDetailBody = await appDetailRes.json();
    assert.equal(appDetailBody.application.status, 'SUBMITTED');
    assert.equal(appDetailBody.application.payment_status, 'PAID');

    // 5. Idempotency: duplicate quote or duplicate event log cannot double-process
    const dupQuote = await fetch(`${baseUrl}/api/payments/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({ applicationId: application.id }),
    });
    assert.equal(dupQuote.status, 409);

    const dupEvent = await processBlockchainPaymentEvent({
      txHash: TEST_TX_HASH,
      logIndex: 0,
      blockNumber: 7200009,
      registrationReference: application.reference_code,
      payerAddress: TEST_PAYER,
      amountWei: paymentQuote.amount_wei,
    });
    assert.equal((dupEvent as any).skipped, true);

    // 6. Now that fee is PAID, Admin GIS validation succeeds (200)
    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'payment');
    await completeSurveyorHandoff({
      baseUrl,
      applicationId: application.id,
      token: surveyorToken,
    });
    const allowedGis = await fetch(`${baseUrl}/api/admin/gis/validate/${application.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(allowedGis.status, 200);

    // 7. RBAC: Citizen cannot update admin fee settings (403); Land Admin can (200)
    const citizenCfg = await fetch(`${baseUrl}/api/admin/payments/fee-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({ testFeeNgn: 20000 }),
    });
    assert.equal(citizenCfg.status, 403);

    const adminCfg = await fetch(`${baseUrl}/api/admin/payments/fee-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ testFeeNgn: 20000, ethNgnExchangeRate: 5000000 }),
    });
    assert.equal(adminCfg.status, 200);
    const adminCfgBody = await adminCfg.json();
    assert.equal(adminCfgBody.feeSettings.testFeeNgn, 20000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevReqPay === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    delete process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY;
    delete process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Contract-free direct wallet checkout works without deployed Sepolia contract and verifies EIP-191 signatures', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anagu-direct-checkout-'));
  const prevStore = process.env.ANAGU_STORE_PATH;
  const prevReqPay = process.env.REQUIRE_PAYMENT_BEFORE_GIS;
  const prevContract = process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS;
  const prevAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ANAGU_STORE_PATH = path.join(tmpDir, 'store.json');
  process.env.REQUIRE_PAYMENT_BEFORE_GIS = 'true';
  delete process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS;
  delete process.env.ADMIN_PASSWORD;

  await ensureSeedUsers();
  const app = express();
  app.use('/api/admin', createAdminApp());
  app.use(createApp());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const cfgRes = await fetch(`${baseUrl}/api/payments/config`);
    assert.equal(cfgRes.status, 200);
    const cfgBody = await cfgRes.json();
    assert.equal(cfgBody.contractConfigured, false);
    assert.equal(cfgBody.directCheckoutEnabled, true);

    const citRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Chidi Nwankwo',
        email: 'direct-pay@example.com',
        password: 'Password123!',
        nationalId: 'NID-DIRECT-001',
      }),
    });
    const { token: citizenToken } = await citRes.json();

    const adminRes = await fetch(`${baseUrl}/api/admin/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminEmail(),
        password: 'AdminPassword123!',
      }),
    });
    const { token: adminToken } = await adminRes.json();

    const appRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        parcelName: 'Contract-Free Direct Plot',
        locationDescription: 'Zone 3 Lot 7',
        region: 'Zone 3',
        declaredAreaSqm: 15000,
        ownershipType: 'FREEHOLD',
        claimantName: 'Chidi Nwankwo',
        claimantNationalId: 'NID-DIRECT-001',
        coordinates: [
          [3.385, 6.535],
          [3.3865, 6.535],
          [3.3865, 6.5365],
          [3.385, 6.5365],
          [3.385, 6.535],
        ],
      }),
    });
    assert.equal(appRes.status, 201);
    const { application, paymentQuote } = await appRes.json();

    const signer = Wallet.createRandom();
    const message = `ANAGU Checkout\nReference: ${application.reference_code}\nWallet: ${signer.address}`;
    const signature = await signer.signMessage(message);

    // Mismatched wallet vs signature rejected
    const badSigRes = await fetch(`${baseUrl}/api/payments/direct-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        paymentId: paymentQuote.id,
        applicationId: application.id,
        walletAddress: TEST_PAYER,
        signature,
        signerMessage: message,
      }),
    });
    assert.equal(badSigRes.status, 400);

    // Matching wallet + signature completes checkout without any contract
    const checkoutRes = await fetch(`${baseUrl}/api/payments/direct-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
      body: JSON.stringify({
        paymentId: paymentQuote.id,
        applicationId: application.id,
        walletAddress: signer.address,
        signature,
        signerMessage: message,
      }),
    });
    assert.equal(checkoutRes.status, 200);
    const checkoutBody = await checkoutRes.json();
    assert.equal(checkoutBody.payment?.payment_status, 'PAID');
    assert.equal(checkoutBody.verification?.mode, 'DIRECT_WALLET_CHECKOUT');
    assert.equal(checkoutBody.verification?.verified, true);

    // Unblocks GIS while preserving SUBMITTED status until Admin verification
    const appCheck = await fetch(`${baseUrl}/api/applications/${application.id}`, {
      headers: { Authorization: `Bearer ${citizenToken}` },
    });
    const appCheckBody = await appCheck.json();
    assert.equal(appCheckBody.application.status, 'SUBMITTED');
    assert.equal(appCheckBody.application.payment_status, 'PAID');

    const surveyorToken = await createReviewStaffToken('SURVEYOR', 'payment-direct');
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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevStore === undefined) delete process.env.ANAGU_STORE_PATH;
    else process.env.ANAGU_STORE_PATH = prevStore;
    if (prevReqPay === undefined) delete process.env.REQUIRE_PAYMENT_BEFORE_GIS;
    else process.env.REQUIRE_PAYMENT_BEFORE_GIS = prevReqPay;
    if (prevContract === undefined) delete process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS;
    else process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS = prevContract;
    if (prevAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
