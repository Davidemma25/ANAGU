import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEtherscanTxUrl,
  classifyWalletPaymentError,
  formatNgnAmount,
  getPaymentStatusMeta,
} from './paymentFormatting.ts';
import { extractErrorMessage } from '../services/api.js';

test('buildEtherscanTxUrl builds valid Sepolia Etherscan links and rejects malformed hashes', () => {
  const validHash = `0x${'a1'.repeat(32)}`;
  assert.equal(
    buildEtherscanTxUrl(validHash),
    `https://sepolia.etherscan.io/tx/${validHash}`
  );
  assert.equal(buildEtherscanTxUrl('0x1234'), null);
  assert.equal(buildEtherscanTxUrl(null), null);
});

test('formatNgnAmount and getPaymentStatusMeta handle all payment statuses cleanly', () => {
  assert.match(formatNgnAmount(15000), /NGN 15,000\.00/);
  for (const status of ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED']) {
    const meta = getPaymentStatusMeta(status);
    assert.equal(meta.label, status);
    assert.ok(meta.description.length > 10);
  }
});

test('classifyWalletPaymentError gives human-readable guidance for MetaMask rejections and insufficient ETH', () => {
  assert.match(
    classifyWalletPaymentError({ code: 4001, message: 'User rejected request' }),
    /rejected in your wallet/i
  );
  assert.match(
    classifyWalletPaymentError({ code: 'INSUFFICIENT_FUNDS', message: 'insufficient funds' }),
    /Insufficient Sepolia test ETH/i
  );
  assert.match(
    classifyWalletPaymentError({ message: 'execution reverted: DuplicateRegistrationPayment' }),
    /already been paid/i
  );
  assert.equal(
    classifyWalletPaymentError({
      response: { data: { error: { code: '404', message: 'The page could not be found.' } } },
    }),
    'The page could not be found.'
  );
});

test('extractErrorMessage converts Vercel-style { code, message } error objects into strings', () => {
  assert.equal(
    extractErrorMessage({
      response: { status: 404, data: { error: { code: '404', message: 'The page could not be found.' } } },
    }),
    'The page could not be found.'
  );
  assert.equal(
    extractErrorMessage({
      response: { status: 500, data: { error: { code: 'FUNCTION_INVOCATION_FAILED' } } },
    }),
    'Server error (FUNCTION_INVOCATION_FAILED).'
  );
  assert.equal(
    extractErrorMessage({ response: { data: { error: 'Direct string error' } } }),
    'Direct string error'
  );
});
