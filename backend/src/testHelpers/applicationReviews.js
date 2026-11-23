import { createUser } from '../models/userModel.js';
import { signAuthToken } from '../middleware/authMiddleware.js';

export async function createReviewStaffToken(roleCode, identifier) {
  const staff = await createUser({
    fullName: `${roleCode} Reviewer`,
    email: `${identifier}-${roleCode.toLowerCase()}@example.com`,
    password: 'Password123!',
    nationalId: `NID-${identifier}-${roleCode}`,
    roleCode,
  });
  return signAuthToken(staff);
}

export async function submitApplicationReviewAction({
  baseUrl,
  applicationId,
  token,
  action,
  reason,
}) {
  const response = await fetch(`${baseUrl}/api/applications/${applicationId}/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, reason }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Review action ${action} failed (${response.status}): ${body.error}`);
  }
  return body;
}

export async function completeSurveyorHandoff({ baseUrl, applicationId, token }) {
  await submitApplicationReviewAction({
    baseUrl,
    applicationId,
    token,
    action: 'START_SURVEY_REVIEW',
    reason: 'Survey documents and parcel details reviewed.',
  });
  await submitApplicationReviewAction({
    baseUrl,
    applicationId,
    token,
    action: 'PASS_SURVEY_REVIEW',
    reason: 'Survey evidence is complete for GIS validation.',
  });
}
