export const APPLICATION_STATUS_LABELS = {
  SUBMITTED: 'Submitted',
  SURVEYOR_REVIEW: 'Surveyor review',
  AWAITING_GIS_REVIEW: 'Awaiting GIS review',
  GIS_REJECTED: 'GIS correction required',
  CORRECTION_REQUIRED: 'Correction required',
  GIS_VALIDATED: 'GIS validated',
  VERIFICATION_REJECTED: 'Ownership verification rejected',
  VERIFIED: 'Ownership verified',
  AWAITING_LEGAL_REVIEW: 'Awaiting registrar legal review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  TITLE_ISSUED: 'Title issued',
  REVOKED: 'Revoked',
};

const REVIEW_TRANSITIONS = {
  SURVEYOR: {
    START_SURVEY_REVIEW: { from: ['SUBMITTED'], to: 'SURVEYOR_REVIEW' },
    PASS_SURVEY_REVIEW: { from: ['SURVEYOR_REVIEW'], to: 'AWAITING_GIS_REVIEW' },
    REQUEST_CORRECTION: { from: ['SURVEYOR_REVIEW'], to: 'CORRECTION_REQUIRED' },
  },
  REGISTRAR: {
    START_LEGAL_REVIEW: { from: ['VERIFIED'], to: 'AWAITING_LEGAL_REVIEW' },
    APPROVE_APPLICATION: { from: ['AWAITING_LEGAL_REVIEW'], to: 'APPROVED' },
    REJECT_APPLICATION: { from: ['AWAITING_LEGAL_REVIEW'], to: 'REJECTED' },
  },
};

export function resolveApplicationReviewTransition({ roleCode, action, currentStatus }) {
  const transition = REVIEW_TRANSITIONS[roleCode]?.[action];
  if (!transition) {
    return { error: 'This review action is not available to your role.', statusCode: 403 };
  }
  if (!transition.from.includes(currentStatus)) {
    return {
      error: `Cannot perform ${action} while the application is ${currentStatus}.`,
      statusCode: 409,
    };
  }
  return { nextStatus: transition.to };
}
