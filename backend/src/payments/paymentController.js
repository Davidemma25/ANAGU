import {
  completeDirectWalletCheckout,
  generateRegistrationPaymentQuote,
  getApplicationPaymentOverview,
  getPaymentHistory,
  getPaymentStatusById,
  getPublicPaymentConfig,
  processBlockchainPaymentEvent,
  recordAndVerifySubmittedTransaction,
  syncContractPaymentEvents,
  updateAdminFeeSettings,
  verifyPaymentById,
} from './paymentService.js';

function handleError(res, error, fallbackMessage) {
  const status = error?.status || 500;
  if (status >= 500) {
    console.error(`${fallbackMessage}:`, error);
  }
  return res.status(status).json({
    error: error?.message || fallbackMessage,
  });
}

export function getPaymentConfig(_req, res) {
  try {
    return res.json(getPublicPaymentConfig());
  } catch (error) {
    return handleError(res, error, 'Failed to load Ethereum payment configuration.');
  }
}

export async function createPaymentQuote(req, res) {
  try {
    const applicationId = Number(req.body?.applicationId);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({ error: 'Valid applicationId is required.' });
    }
    const result = await generateRegistrationPaymentQuote({
      applicationId,
      user: req.user,
      walletAddress: req.body?.walletAddress || null,
      ipAddress: req.ip,
    });
    return res.status(201).json({
      message: 'Registration fee quote calculated in Sepolia test ETH.',
      ...result,
    });
  } catch (error) {
    return handleError(res, error, 'Failed to generate registration fee quote.');
  }
}

export async function getApplicationPaymentDetails(req, res) {
  try {
    const applicationId = Number(req.params.applicationId);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({ error: 'Invalid applicationId parameter.' });
    }
    const overview = await getApplicationPaymentOverview({
      applicationId,
      user: req.user,
    });
    return res.json(overview);
  } catch (error) {
    return handleError(res, error, 'Failed to retrieve registration payment details.');
  }
}

export async function submitTransactionHash(req, res) {
  try {
    const { paymentId, applicationId, txHash, walletAddress } = req.body || {};
    const result = await recordAndVerifySubmittedTransaction({
      paymentId: paymentId ? Number(paymentId) : undefined,
      applicationId: applicationId ? Number(applicationId) : undefined,
      txHash: String(txHash || ''),
      walletAddress: String(walletAddress || ''),
      user: req.user,
      ipAddress: req.ip,
    });
    return res.json({
      message:
        result.payment?.payment_status === 'PAID'
          ? 'Ethereum Sepolia registration payment verified and confirmed.'
          : result.payment?.payment_status === 'FAILED'
          ? result.verification?.reason || 'Ethereum transaction verification failed.'
          : 'Transaction recorded as PROCESSING and queued for independent blockchain verification.',
      ...result,
    });
  } catch (error) {
    return handleError(res, error, 'Failed to submit Ethereum payment transaction.');
  }
}

export async function directWalletCheckout(req, res) {
  try {
    const { paymentId, applicationId, walletAddress, signature, signerMessage, txHash } =
      req.body || {};
    const result = await completeDirectWalletCheckout({
      paymentId: paymentId ? Number(paymentId) : undefined,
      applicationId: applicationId ? Number(applicationId) : undefined,
      walletAddress: String(walletAddress || ''),
      signature: signature ? String(signature) : '',
      signerMessage: signerMessage ? String(signerMessage) : '',
      txHash: txHash ? String(txHash) : '',
      user: req.user,
      ipAddress: req.ip,
    });
    return res.json({
      message: 'Registration fee checkout completed and verified via connected wallet.',
      ...result,
    });
  } catch (error) {
    return handleError(res, error, 'Failed to complete direct wallet checkout.');
  }
}

export async function verifyPaymentTransaction(req, res) {
  try {
    const { paymentId, txHash } = req.body || {};
    if (!paymentId && !txHash) {
      return res.status(400).json({ error: 'Provide either paymentId or txHash to verify.' });
    }
    const result = await verifyPaymentById({
      paymentId: paymentId ? Number(paymentId) : undefined,
      txHash: txHash ? String(txHash) : undefined,
      user: req.user,
      ipAddress: req.ip,
    });
    return res.json(result);
  } catch (error) {
    return handleError(res, error, 'Failed to verify Ethereum payment.');
  }
}

export async function checkPaymentStatus(req, res) {
  try {
    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ error: 'Invalid paymentId parameter.' });
    }
    const payment = await getPaymentStatusById({
      paymentId,
      user: req.user,
    });
    return res.json({ payment });
  } catch (error) {
    return handleError(res, error, 'Failed to check payment status.');
  }
}

export async function listPaymentHistory(req, res) {
  try {
    const payments = await getPaymentHistory(req.user);
    return res.json({ payments });
  } catch (error) {
    return handleError(res, error, 'Failed to load payment history.');
  }
}

export async function handleBlockchainPaymentEvents(req, res) {
  try {
    if (req.body?.txHash && req.body?.registrationReference) {
      const outcome = await processBlockchainPaymentEvent({
        txHash: String(req.body.txHash),
        logIndex: Number(req.body.logIndex ?? 0),
        blockNumber: Number(req.body.blockNumber ?? 0),
        registrationReference: String(req.body.registrationReference),
        payerAddress: String(req.body.payerAddress || ''),
        amountWei: String(req.body.amountWei || '0'),
      });
      return res.json(outcome);
    }

    const fromBlock = req.body?.fromBlock !== undefined ? Number(req.body.fromBlock) : undefined;
    const summary = await syncContractPaymentEvents({ fromBlock });
    return res.json(summary);
  } catch (error) {
    return handleError(res, error, 'Failed to process blockchain payment events.');
  }
}

export async function updateFeeConfig(req, res) {
  try {
    const { testFeeNgn, ethNgnExchangeRate, rateSource, quoteTtlSeconds } = req.body || {};
    const updated = await updateAdminFeeSettings(
      {
        testFeeNgn: testFeeNgn !== undefined ? Number(testFeeNgn) : undefined,
        ethNgnExchangeRate: ethNgnExchangeRate !== undefined ? Number(ethNgnExchangeRate) : undefined,
        rateSource: rateSource !== undefined ? String(rateSource) : undefined,
        quoteTtlSeconds: quoteTtlSeconds !== undefined ? Number(quoteTtlSeconds) : undefined,
      },
      req.user,
      req.ip
    );
    return res.json({ message: 'Registration test fee configuration updated.', feeSettings: updated });
  } catch (error) {
    return handleError(res, error, 'Failed to update registration fee settings.');
  }
}
