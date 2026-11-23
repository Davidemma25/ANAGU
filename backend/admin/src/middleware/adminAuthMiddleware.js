import {
  requireAdmin,
  requireAuth,
  signAuthToken,
} from '../../../../backend/src/middleware/authMiddleware.js';

export { signAuthToken };

export async function requireAdminSession(req, res, next) {
  await requireAuth(req, res, () => requireAdmin(req, res, next));
}
