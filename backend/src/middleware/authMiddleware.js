import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env, isDesignatedAdminEmail } from '../config/env.js';
import {
  ensureUserFromTokenPayload,
  findUserByAuthId,
  findUserByEmail,
  findUserById,
  sanitizePublicUser,
  sanitizeUser,
} from '../models/userModel.js';

let cachedJwks = null;
let cachedJwksAt = 0;

async function fetchSupabaseJwks(forceRefresh = false) {
  if (!env.supabase.jwksUrl) return [];
  const now = Date.now();
  if (!forceRefresh && cachedJwks && now - cachedJwksAt < 5 * 60 * 1000) {
    return cachedJwks;
  }
  const res = await fetch(env.supabase.jwksUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch Supabase JWKS (${res.status})`);
  }
  const body = await res.json();
  cachedJwks = Array.isArray(body?.keys) ? body.keys : [];
  cachedJwksAt = now;
  return cachedJwks;
}

async function verifyBearerToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (localErr) {
    if (!env.supabase.jwksUrl) {
      throw localErr;
    }
    const decoded = jwt.decode(token, { complete: true });
    const header = decoded?.header;
    if (!header) {
      throw localErr;
    }

    let keys = await fetchSupabaseJwks(false);
    let jwk =
      (header.kid ? keys.find((k) => k.kid === header.kid) : null) ||
      (keys.length === 1 ? keys[0] : null);

    if (!jwk && header.kid) {
      keys = await fetchSupabaseJwks(true);
      jwk = keys.find((k) => k.kid === header.kid) || null;
    }
    if (!jwk) {
      throw localErr;
    }

    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const algorithms = jwk.kty === 'EC' ? ['ES256'] : jwk.kty === 'RSA' ? ['RS256'] : [];
    if (!algorithms.length) {
      throw new Error('Unsupported Supabase JWT signing key type.');
    }
    return jwt.verify(token, publicKey, {
      algorithms,
    });
  }
}

export function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      roleCode: user.roleCode,
      fullName: user.fullName,
      nationalId: user.nationalId,
      walletAddress: user.walletAddress || '',
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

async function resolveVerifiedUser(payload) {
  if (
    typeof payload?.sub === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)
  ) {
    return findUserByAuthId(payload.sub);
  }

  let userRow = null;
  if (payload?.sub !== undefined && payload?.sub !== null && Number.isFinite(Number(payload.sub))) {
    userRow = await findUserById(payload.sub);
  }
  if (!userRow && payload?.email) {
    userRow = await findUserByEmail(payload.email);
  }
  if (!userRow) {
    userRow = await ensureUserFromTokenPayload(payload);
  }
  return userRow;
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Provide a valid Bearer JWT token.',
    });
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = await verifyBearerToken(token);
    req.authToken = token;
    const userRow = await resolveVerifiedUser(payload);

    if (!userRow) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    if (!userRow.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact the Administrator.' });
    }

    req.user = sanitizeUser(userRow);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

export async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = await verifyBearerToken(token);
    const userRow = await resolveVerifiedUser(payload);
    req.user = userRow && userRow.is_active ? sanitizeUser(userRow) : null;
  } catch {
    req.user = null;
  }
  return next();
}

export function requireUser(req, res, next) {
  return requireAuth(req, res, () => {
    req.user = sanitizePublicUser(req.user);
    return next();
  });
}

export function optionalUser(req, res, next) {
  return optionalAuth(req, res, () => {
    req.user = sanitizePublicUser(req.user);
    return next();
  });
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.roleCode)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Current role: ${req.user.roleCode}.`,
      });
    }
    if (req.user.roleCode === 'LAND_ADMIN' && !isDesignatedAdminEmail(req.user.email)) {
      return res.status(403).json({
        error: 'Access denied. Administrator portal is restricted to the single designated administrator email.',
      });
    }
    return next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.roleCode !== 'LAND_ADMIN' || !isDesignatedAdminEmail(req.user.email)) {
    return res.status(403).json({
      error: 'Access denied. Restricted to the single designated Administrator account.',
    });
  }
  return next();
}
