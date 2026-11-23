import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_STATUS_LABELS,
  resolveApplicationReviewTransition,
} from './services/applicationWorkflow.js';

test('Surveyor review requires its ordered handoff and can request documented corrections', () => {
  assert.deepEqual(
    resolveApplicationReviewTransition({
      roleCode: 'SURVEYOR',
      action: 'START_SURVEY_REVIEW',
      currentStatus: 'SUBMITTED',
    }),
    { nextStatus: 'SURVEYOR_REVIEW' }
  );
  assert.deepEqual(
    resolveApplicationReviewTransition({
      roleCode: 'SURVEYOR',
      action: 'PASS_SURVEY_REVIEW',
      currentStatus: 'SURVEYOR_REVIEW',
    }),
    { nextStatus: 'AWAITING_GIS_REVIEW' }
  );
  assert.deepEqual(
    resolveApplicationReviewTransition({
      roleCode: 'SURVEYOR',
      action: 'REQUEST_CORRECTION',
      currentStatus: 'SURVEYOR_REVIEW',
    }),
    { nextStatus: 'CORRECTION_REQUIRED' }
  );
  assert.equal(
    resolveApplicationReviewTransition({
      roleCode: 'SURVEYOR',
      action: 'PASS_SURVEY_REVIEW',
      currentStatus: 'SUBMITTED',
    }).statusCode,
    409
  );
});

test('Registrar approval is only possible after ownership verification and legal review', () => {
  assert.equal(
    resolveApplicationReviewTransition({
      roleCode: 'REGISTRAR',
      action: 'APPROVE_APPLICATION',
      currentStatus: 'GIS_VALIDATED',
    }).statusCode,
    409
  );
  assert.deepEqual(
    resolveApplicationReviewTransition({
      roleCode: 'REGISTRAR',
      action: 'START_LEGAL_REVIEW',
      currentStatus: 'VERIFIED',
    }),
    { nextStatus: 'AWAITING_LEGAL_REVIEW' }
  );
  assert.deepEqual(
    resolveApplicationReviewTransition({
      roleCode: 'REGISTRAR',
      action: 'APPROVE_APPLICATION',
      currentStatus: 'AWAITING_LEGAL_REVIEW',
    }),
    { nextStatus: 'APPROVED' }
  );
  assert.deepEqual(
    resolveApplicationReviewTransition({
      roleCode: 'REGISTRAR',
      action: 'REJECT_APPLICATION',
      currentStatus: 'AWAITING_LEGAL_REVIEW',
    }),
    { nextStatus: 'REJECTED' }
  );
  assert.equal(
    resolveApplicationReviewTransition({
      roleCode: 'CITIZEN',
      action: 'APPROVE_APPLICATION',
      currentStatus: 'AWAITING_LEGAL_REVIEW',
    }).statusCode,
    403
  );
  assert.equal(APPLICATION_STATUS_LABELS.AWAITING_LEGAL_REVIEW, 'Awaiting registrar legal review');
});
