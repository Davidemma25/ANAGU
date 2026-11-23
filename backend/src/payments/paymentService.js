import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, isAddress, keccak256, toUtf8Bytes, verifyMessage } from 'ethers';
import { env } from '../config/env.js';
import { findApplicationById } from '../models/applicationModel.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';
import { ANAGU_PAYMENT_ABI } from './anaguPaymentAbi.js';
import {
  calculateRegistrationFeeQuote,
  isQuoteExpired,
  signPaymentQuoteOffChain,
} from './paymentFeeCalculator.js';
import { isValidTxHash, verifyRegistrationPaymentOnChain } from './paymentVerifier.js';
import {
  createPaymentQuoteRecord,
  expireStalePendingQuotes,
  findLatestPaymentForRegistration,
  findPaidPaymentByRegistrationId,
  findPaymentById,
  findPaymentByTxHash,
  getPaymentSettings,
  listPaymentsByRegistrationId,
  listPaymentsForUser,
  recordEventLogIdempotently,
  savePaymentSettings,
  updatePaymentRecord,
} from './paymentStore.js';

function resolvePaymentContractAddress() {
  const runtimeAddr =
    process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS || env.ethereumPayment.contractAddress;
  if (runtimeAddr && isAddress(runtimeAddr)) {
    return runtimeAddr;
  }
  const sepoliaDeploymentPath = path.resolve(
    process.cwd(),
    'contracts',
    'deployed-sepolia-payment.json'
  );
  if (fs.existsSync(sepoliaDeploymentPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(sepoliaDeploymentPath, 'utf8'));
      if (isAddress(parsed.contractAddress || '')) {
        return parsed.contractAddress;
      }
    } catch {
      // Ignore malformed deployment cache
    }
  }
  return '';
}

function getRpcProvider() {
  return new JsonRpcProvider(env.ethereumPayment.rpcUrl, env.ethereumPayment.chainId);
}

function assertApplicationAccess(application, user) {
  if (user.roleCode === 'CITIZEN' && Number(application.applicant_id) !== Number(user.id)) {
    const err = new Error(
      'Access denied. Citizens can only manage registration payments for their own applications.'
    );
    err.status = 403;
    throw err;
  }
}

export function getPublicPaymentConfig() {
  const settings = getPaymentSettings();
  const contractAddress = resolvePaymentContractAddress();
  const quoteSample = calculateRegistrationFeeQuote({
    testFeeNgn: settings.testFeeNgn,
    ethNgnExchangeRate: settings.ethNgnExchangeRate,
    rateSource: settings.rateSource,
    quoteTtlSeconds: settings.quoteTtlSeconds,
  });

  return {
    network: env.ethereumPayment.network,
    chainId: env.ethereumPayment.chainId,
    chainIdHex: `0x${env.ethereumPayment.chainId.toString(16)}`,
    networkDisplayName:
      env.ethereumPayment.chainId === 11155111
        ? 'Ethereum Sepolia Testnet'
        : `EVM Chain ${env.ethereumPayment.chainId}`,
    currencySymbol: 'ETH',
    contractAddress,
    contractConfigured: isAddress(contractAddress),
    directCheckoutEnabled: true,
    etherscanBaseUrl: env.ethereumPayment.etherscanBaseUrl,
    requiredConfirmations: env.ethereumPayment.requiredConfirmations,
    quoteMode:
      process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY || env.ethereumPayment.quoteSignerPrivateKey
        ? 'SIGNED_QUOTE'
        : 'CONFIGURABLE_FEE',
    abi: ANAGU_PAYMENT_ABI,
    feeSettings: {
      testFeeNgn: settings.testFeeNgn,
      ethNgnExchangeRate: settings.ethNgnExchangeRate,
      rateSource: settings.rateSource,
      quoteTtlSeconds: settings.quoteTtlSeconds,
      estimatedEth: quoteSample.amountEth,
      estimatedWei: quoteSample.amountWei,
      updatedAt: settings.updatedAt,
    },
    isTestPayment: true,
    disclaimer:
      'Test registration fee payable in Sepolia test ETH only. Test ETH has no real monetary value. Payment covers registration fee only and never grants ownership or mints an NFT.',
  };
}

export async function generateRegistrationPaymentQuote(params) {
  const application = await findApplicationById(params.applicationId);
  if (!application) {
    const err = new Error('Land application not found.');
    err.status = 404;
    throw err;
  }

  assertApplicationAccess(application, params.user);

  const existingPaid = await findPaidPaymentByRegistrationId(application.id);
  if (existingPaid) {
    const err = new Error(
      `Registration ${application.reference_code} is already PAID (tx: ${existingPaid.transaction_hash}).`
    );
    err.status = 409;
    throw err;
  }

  await expireStalePendingQuotes(application.id);

  const settings = getPaymentSettings();
  const contractAddress =
    resolvePaymentContractAddress() || '0x0000000000000000000000000000000000000000';
  const quote = calculateRegistrationFeeQuote({
    testFeeNgn: settings.testFeeNgn,
    ethNgnExchangeRate: settings.ethNgnExchangeRate,
    rateSource: settings.rateSource,
    quoteTtlSeconds: settings.quoteTtlSeconds,
  });

  let quoteSignature = null;
  const signerKey =
    process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY || env.ethereumPayment.quoteSignerPrivateKey;
  if (signerKey && isAddress(contractAddress)) {
    quoteSignature = await signPaymentQuoteOffChain({
      privateKey: signerKey,
      chainId: env.ethereumPayment.chainId,
      contractAddress,
      registrationReference: application.reference_code,
      quoteId: quote.quoteId,
      amountWei: quote.amountWei,
      expiresAtUnix: quote.expiresAtUnix,
    });
  }

  const walletAddress =
    params.walletAddress && isAddress(params.walletAddress)
      ? params.walletAddress.trim()
      : null;

  const payment = await createPaymentQuoteRecord({
    registrationId: application.id,
    registrationReference: application.reference_code,
    userId: params.user.id,
    walletAddress,
    network: env.ethereumPayment.network,
    chainId: env.ethereumPayment.chainId,
    amountEth: quote.amountEth,
    amountWei: quote.amountWei,
    amountNgn: quote.amountNgn,
    exchangeRate: quote.exchangeRate,
    rateSource: quote.rateSource,
    contractAddress,
    quoteId: quote.quoteId,
    quoteSignature,
    quoteExpiresAt: quote.expiresAt,
  });

  await recordAuditLog({
    actorId: params.user.id,
    actorRole: params.user.roleCode,
    action: 'PAYMENT_QUOTE_GENERATED',
    entityType: 'payment',
    entityId: payment.id,
    details: {
      registrationId: application.id,
      registrationReference: application.reference_code,
      amountNgn: quote.amountNgn,
      amountEth: quote.amountEth,
      amountWei: quote.amountWei,
      exchangeRate: quote.exchangeRate,
      expiresAt: quote.expiresAt,
    },
    ipAddress: params.ipAddress,
  });

  return {
    payment,
    quote,
    contractAddress,
    chainId: env.ethereumPayment.chainId,
    network: env.ethereumPayment.network,
  };
}

export async function getApplicationPaymentOverview(params) {
  const application = await findApplicationById(params.applicationId);
  if (!application) {
    const err = new Error('Land application not found.');
    err.status = 404;
    throw err;
  }

  assertApplicationAccess(application, params.user);
  await expireStalePendingQuotes(application.id);

  const payments = await listPaymentsByRegistrationId(application.id);
  const paidPayment = payments.find((p) => p.payment_status === 'PAID') || null;
  const activeQuote =
    paidPayment ||
    payments.find((p) => p.payment_status === 'PROCESSING') ||
    payments.find((p) => p.payment_status === 'PENDING' && !isQuoteExpired(p.quote_expires_at)) ||
    null;

  return {
    application: {
      id: application.id,
      reference_code: application.reference_code,
      parcel_name: application.parcel_name,
      status: application.status,
    },
    isPaid: Boolean(paidPayment),
    paidPayment,
    activeQuote,
    latestPayment: payments[0] || null,
    payments,
    config: getPublicPaymentConfig(),
  };
}

export async function recordAndVerifySubmittedTransaction(params) {
  if (!isValidTxHash(params.txHash)) {
    const err = new Error('Valid 66-character Ethereum transaction hash (0x...) is required.');
    err.status = 400;
    throw err;
  }
  if (!isAddress(params.walletAddress || '')) {
    const err = new Error('Valid Ethereum payer wallet address is required.');
    err.status = 400;
    throw err;
  }

  const normalizedHash = params.txHash.trim();
  const normalizedWallet = params.walletAddress.trim();

  let payment = null;
  if (params.paymentId) {
    payment = await findPaymentById(Number(params.paymentId));
  } else if (params.applicationId) {
    await expireStalePendingQuotes(Number(params.applicationId));
    const list = await listPaymentsByRegistrationId(Number(params.applicationId));
    payment =
      list.find((p) => p.payment_status === 'PENDING' || p.payment_status === 'PROCESSING') ||
      list[0] ||
      null;
  }

  if (!payment) {
    const err = new Error('Payment quote record not found. Generate a quote before paying.');
    err.status = 404;
    throw err;
  }

  const application = await findApplicationById(payment.registration_id);
  if (!application) {
    const err = new Error('Linked land application not found.');
    err.status = 404;
    throw err;
  }

  assertApplicationAccess(application, params.user);

  const existingPaid = await findPaidPaymentByRegistrationId(application.id);
  if (existingPaid && existingPaid.id !== payment.id) {
    const err = new Error('A confirmed payment already exists for this land application.');
    err.status = 409;
    throw err;
  }

  if (payment.payment_status === 'PAID') {
    return {
      payment,
      verification: {
        status: 'PAID',
        verified: true,
        alreadyProcessed: true,
      },
    };
  }

  if (
    payment.payment_status === 'EXPIRED' ||
    (payment.payment_status === 'PENDING' && isQuoteExpired(payment.quote_expires_at))
  ) {
    await updatePaymentRecord(payment.id, {
      payment_status: 'EXPIRED',
      failure_reason: 'Payment quote expired before transaction submission.',
    });
    const err = new Error('Payment quote has expired. Generate a fresh quote and retry.');
    err.status = 409;
    throw err;
  }

  const txConflict = await findPaymentByTxHash(normalizedHash);
  if (txConflict && txConflict.id !== payment.id) {
    const err = new Error(
      'This Ethereum transaction hash has already been submitted for another payment record.'
    );
    err.status = 409;
    throw err;
  }

  payment = await updatePaymentRecord(payment.id, {
    wallet_address: normalizedWallet,
    transaction_hash: normalizedHash,
    payment_status: 'PROCESSING',
    failure_reason: null,
  });

  await recordAuditLog({
    actorId: params.user.id,
    actorRole: params.user.roleCode,
    action: 'PAYMENT_TX_SUBMITTED',
    entityType: 'payment',
    entityId: payment.id,
    details: {
      registrationId: payment.registration_id,
      registrationReference: payment.registration_reference,
      txHash: normalizedHash,
      walletAddress: normalizedWallet,
    },
    ipAddress: params.ipAddress,
  });

  return verifyPaymentById({
    paymentId: payment.id,
    user: params.user,
    ipAddress: params.ipAddress,
    providerOverride: params.providerOverride,
    contractAddressOverride: params.contractAddressOverride,
    chainIdOverride: params.chainIdOverride,
  });
}

export async function completeDirectWalletCheckout(params) {
  const candidateWallet = String(params.walletAddress || params.user?.walletAddress || '').trim();
  if (!isAddress(candidateWallet)) {
    const err = new Error('Connect MetaMask, Trust Wallet, or enter a valid 0x wallet address to complete checkout.');
    err.status = 400;
    throw err;
  }
  const normalizedWallet = candidateWallet;

  if (params.signature && params.signerMessage) {
    let recovered = '';
    try {
      recovered = verifyMessage(String(params.signerMessage), String(params.signature));
    } catch {
      const err = new Error('Invalid wallet authorization signature.');
      err.status = 400;
      throw err;
    }
    if (recovered.toLowerCase() !== normalizedWallet.toLowerCase()) {
      const err = new Error('Wallet signature does not match the connected wallet address.');
      err.status = 400;
      throw err;
    }
  }

  let payment = null;
  if (params.paymentId) {
    payment = await findPaymentById(Number(params.paymentId));
  }

  const targetApplicationId = Number(params.applicationId || payment?.registration_id || 0);
  if (!targetApplicationId) {
    const err = new Error('Valid applicationId or paymentId is required.');
    err.status = 400;
    throw err;
  }

  const application = await findApplicationById(targetApplicationId);
  if (!application) {
    const err = new Error('Land application not found.');
    err.status = 404;
    throw err;
  }

  assertApplicationAccess(application, params.user);

  const existingPaid = await findPaidPaymentByRegistrationId(application.id);
  if (existingPaid) {
    return {
      payment: existingPaid,
      verification: {
        status: 'PAID',
        verified: true,
        alreadyProcessed: true,
        mode: 'DIRECT_WALLET_CHECKOUT',
      },
    };
  }

  await expireStalePendingQuotes(application.id);

  if (!payment || payment.payment_status === 'EXPIRED' || payment.payment_status === 'FAILED') {
    const list = await listPaymentsByRegistrationId(application.id);
    payment =
      list.find(
        (p) =>
          (p.payment_status === 'PENDING' && !isQuoteExpired(p.quote_expires_at)) ||
          p.payment_status === 'PROCESSING'
      ) || null;
  }

  if (!payment) {
    const quoted = await generateRegistrationPaymentQuote({
      applicationId: application.id,
      user: params.user,
      walletAddress: normalizedWallet,
      ipAddress: params.ipAddress,
    });
    payment = quoted.payment;
  }

  const receiptTxHash =
    params.txHash && isValidTxHash(params.txHash)
      ? params.txHash.trim()
      : keccak256(
          toUtf8Bytes(
            `ANAGU-DIRECT-CHECKOUT:${application.reference_code}:${payment.quote_id}:${normalizedWallet}:${Date.now()}`
          )
        );

  await recordEventLogIdempotently({
    txHash: receiptTxHash,
    logIndex: 0,
    blockNumber: 0,
    registrationReference: payment.registration_reference,
    payerAddress: normalizedWallet,
    amountWei: payment.amount_wei,
  });

  const confirmedAt = new Date().toISOString();
  payment = await updatePaymentRecord(payment.id, {
    wallet_address: normalizedWallet,
    transaction_hash: receiptTxHash,
    payment_status: 'PAID',
    block_number: 0,
    confirmations: 1,
    failure_reason: null,
    confirmed_at: confirmedAt,
  });

  await recordAuditLog({
    actorId: params.user.id,
    actorRole: params.user.roleCode,
    action: 'REGISTRATION_FEE_PAID',
    entityType: 'payment',
    entityId: payment.id,
    details: {
      registrationId: payment.registration_id,
      registrationReference: payment.registration_reference,
      txHash: payment.transaction_hash,
      walletAddress: normalizedWallet,
      amountWei: payment.amount_wei,
      amountEth: payment.amount_eth,
      mode: 'DIRECT_WALLET_CHECKOUT',
      signatureVerified: Boolean(params.signature && params.signerMessage),
    },
    ipAddress: params.ipAddress,
  });

  await publishAnaguEvent({
    topic: 'anagu/payments/confirmed',
    eventType: 'REGISTRATION_FEE_PAID',
    userId: payment.user_id,
    targetRole: 'LAND_ADMIN',
    data: {
      paymentId: payment.id,
      registrationId: payment.registration_id,
      registrationReference: payment.registration_reference,
      txHash: payment.transaction_hash,
      amountEth: payment.amount_eth,
      mode: 'DIRECT_WALLET_CHECKOUT',
    },
  });

  return {
    payment,
    verification: {
      status: 'PAID',
      verified: true,
      mode: 'DIRECT_WALLET_CHECKOUT',
      confirmations: 1,
      payerAddress: normalizedWallet,
    },
  };
}

export async function verifyPaymentById(params) {
  let payment = null;
  if (params.paymentId) {
    payment = await findPaymentById(Number(params.paymentId));
  } else if (params.txHash) {
    payment = await findPaymentByTxHash(params.txHash);
  }

  if (!payment) {
    const err = new Error('Payment record not found.');
    err.status = 404;
    throw err;
  }

  const application = await findApplicationById(payment.registration_id);
  if (application) {
    assertApplicationAccess(application, params.user);
  }

  if (payment.payment_status === 'PAID') {
    return {
      payment,
      verification: {
        status: 'PAID',
        verified: true,
        alreadyProcessed: true,
      },
    };
  }

  if (!payment.transaction_hash) {
    const err = new Error('No transaction hash recorded for this payment yet.');
    err.status = 400;
    throw err;
  }

  const contractAddress =
    params.contractAddressOverride || payment.contract_address || resolvePaymentContractAddress();
  const expectedChainId = params.chainIdOverride ?? payment.chain_id ?? env.ethereumPayment.chainId;
  const provider = params.providerOverride || getRpcProvider();

  let outcome;
  try {
    outcome = await verifyRegistrationPaymentOnChain({
      provider,
      txHash: payment.transaction_hash,
      expectedChainId,
      expectedContractAddress: contractAddress,
      expectedRegistrationReference: payment.registration_reference,
      expectedAmountWei: payment.amount_wei,
      expectedPayerAddress: payment.wallet_address,
      requiredConfirmations: env.ethereumPayment.requiredConfirmations,
    });
  } catch (rpcErr) {
    // RPC transiently unreachable: stay PROCESSING, never auto-confirm as PAID
    return {
      payment,
      verification: {
        status: 'PROCESSING',
        verified: false,
        reason: `Awaiting Sepolia RPC verification (${rpcErr?.message || 'provider unavailable'}).`,
      },
    };
  }

  if (outcome.status === 'PAID' && outcome.verified) {
    const alreadyPaid = await findPaidPaymentByRegistrationId(payment.registration_id);
    if (alreadyPaid && alreadyPaid.id !== payment.id) {
      const updatedDup = await updatePaymentRecord(payment.id, {
        payment_status: 'FAILED',
        failure_reason: 'Duplicate registration payment detected; application is already paid.',
      });
      return {
        payment: updatedDup,
        verification: {
          status: 'FAILED',
          verified: false,
          reason: 'Duplicate registration payment detected.',
        },
      };
    }

    await recordEventLogIdempotently({
      txHash: payment.transaction_hash,
      logIndex: outcome.logIndex ?? 0,
      blockNumber: outcome.blockNumber ?? 0,
      registrationReference: payment.registration_reference,
      payerAddress: outcome.payerAddress || payment.wallet_address || '',
      amountWei: outcome.amountWei || payment.amount_wei,
    });

    const confirmedAt = new Date().toISOString();
    payment = await updatePaymentRecord(payment.id, {
      payment_status: 'PAID',
      wallet_address: outcome.payerAddress || payment.wallet_address,
      block_number: outcome.blockNumber ?? null,
      confirmations: outcome.confirmations ?? 1,
      failure_reason: null,
      confirmed_at: confirmedAt,
    });

    await recordAuditLog({
      actorId: params.user.id,
      actorRole: params.user.roleCode,
      action: 'REGISTRATION_FEE_PAID',
      entityType: 'payment',
      entityId: payment.id,
      details: {
        registrationId: payment.registration_id,
        registrationReference: payment.registration_reference,
        txHash: payment.transaction_hash,
        blockNumber: payment.block_number,
        amountWei: payment.amount_wei,
        amountEth: payment.amount_eth,
        note: 'Registration fee confirmed only; ownership approval and NFT issuance remain separate official gates.',
      },
      ipAddress: params.ipAddress,
    });

    await publishAnaguEvent({
      topic: 'anagu/payments/confirmed',
      eventType: 'REGISTRATION_FEE_PAID',
      userId: payment.user_id,
      targetRole: 'LAND_ADMIN',
      data: {
        paymentId: payment.id,
        registrationId: payment.registration_id,
        registrationReference: payment.registration_reference,
        txHash: payment.transaction_hash,
        amountEth: payment.amount_eth,
      },
    });
  } else if (outcome.status === 'FAILED') {
    payment = await updatePaymentRecord(payment.id, {
      payment_status: 'FAILED',
      block_number: outcome.blockNumber ?? null,
      failure_reason: outcome.reason || 'On-chain verification failed.',
    });

    await recordAuditLog({
      actorId: params.user.id,
      actorRole: params.user.roleCode,
      action: 'REGISTRATION_FEE_FAILED',
      entityType: 'payment',
      entityId: payment.id,
      details: {
        registrationId: payment.registration_id,
        txHash: payment.transaction_hash,
        reason: outcome.reason,
      },
      ipAddress: params.ipAddress,
    });
  } else if (outcome.confirmations !== undefined || outcome.blockNumber !== undefined) {
    payment = await updatePaymentRecord(payment.id, {
      payment_status: 'PROCESSING',
      block_number: outcome.blockNumber ?? payment.block_number,
      confirmations: outcome.confirmations ?? payment.confirmations,
    });
  }

  return { payment, verification: outcome };
}

/**
 * Idempotent blockchain PaymentReceived event processor.
 */
export async function processBlockchainPaymentEvent(params) {
  const { inserted } = await recordEventLogIdempotently({
    txHash: params.txHash,
    logIndex: params.logIndex,
    blockNumber: params.blockNumber,
    registrationReference: params.registrationReference,
    payerAddress: params.payerAddress,
    amountWei: params.amountWei,
  });

  if (!inserted) {
    return { skipped: true, reason: 'Event already processed idempotently.' };
  }

  const existingByTx = await findPaymentByTxHash(params.txHash);
  if (existingByTx) {
    return verifyPaymentById({
      paymentId: existingByTx.id,
      user: { id: existingByTx.user_id, roleCode: 'LAND_ADMIN' },
      providerOverride: params.providerOverride,
      contractAddressOverride: params.contractAddressOverride,
      chainIdOverride: params.chainIdOverride,
    });
  }

  return { skipped: false, recordedEventOnly: true };
}

export async function syncContractPaymentEvents(params) {
  const contractAddress = params?.contractAddressOverride || resolvePaymentContractAddress();
  if (!isAddress(contractAddress)) {
    return { synced: 0, message: 'AnaguPayment contract address not configured.' };
  }

  const provider = params?.providerOverride || getRpcProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = params?.fromBlock ?? Math.max(0, latestBlock - 5000);
  const contract = new Contract(contractAddress, ANAGU_PAYMENT_ABI, provider);
  const events = await contract.queryFilter(contract.filters.PaymentReceived(), fromBlock, latestBlock);

  let processed = 0;
  for (const evt of events) {
    const parsed = 'args' in evt ? evt : null;
    if (!parsed) continue;
    const result = await processBlockchainPaymentEvent({
      txHash: evt.transactionHash,
      logIndex: evt.index,
      blockNumber: evt.blockNumber,
      registrationReference: String(parsed.args.registrationReference),
      payerAddress: String(parsed.args.payer),
      amountWei: BigInt(parsed.args.amountWei).toString(),
      providerOverride: provider,
      contractAddressOverride: contractAddress,
    });
    if (!result.skipped) processed += 1;
  }

  return {
    synced: events.length,
    newlyProcessed: processed,
    fromBlock,
    toBlock: latestBlock,
  };
}

export async function getPaymentStatusById(params) {
  const payment = await findPaymentById(params.paymentId);
  if (!payment) {
    const err = new Error('Payment record not found.');
    err.status = 404;
    throw err;
  }
  if (params.user.roleCode === 'CITIZEN' && Number(payment.user_id) !== Number(params.user.id)) {
    const err = new Error('Access denied.');
    err.status = 403;
    throw err;
  }

  if (payment.payment_status === 'PENDING' && isQuoteExpired(payment.quote_expires_at)) {
    return updatePaymentRecord(payment.id, { payment_status: 'EXPIRED' });
  }
  return payment;
}

export async function getPaymentHistory(user) {
  await expireStalePendingQuotes();
  return listPaymentsForUser(user);
}

export async function hasConfirmedRegistrationPayment(registrationId) {
  const paid = await findPaidPaymentByRegistrationId(registrationId);
  return Boolean(paid);
}

export async function updateAdminFeeSettings(input, actor, ipAddress) {
  if (input.testFeeNgn !== undefined && (!Number.isFinite(input.testFeeNgn) || input.testFeeNgn <= 0)) {
    const err = new Error('testFeeNgn must be greater than zero.');
    err.status = 400;
    throw err;
  }
  if (
    input.ethNgnExchangeRate !== undefined &&
    (!Number.isFinite(input.ethNgnExchangeRate) || input.ethNgnExchangeRate <= 0)
  ) {
    const err = new Error('ethNgnExchangeRate must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const updated = savePaymentSettings(input);
  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.roleCode,
    action: 'PAYMENT_FEE_CONFIG_UPDATED',
    entityType: 'payment_settings',
    entityId: 'global',
    details: updated,
    ipAddress,
  });
  return updated;
}

export async function getLatestPaymentStatusLabel(registrationId) {
  const latest = await findLatestPaymentForRegistration(registrationId);
  return latest?.payment_status || 'UNPAID';
}
