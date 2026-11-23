import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { isDesignatedAdminEmail } from '../config/env.js';
import {
  activateSoleAdmin,
  createUser,
  findUserByAuthId,
  findUserByEmail,
  getSoleAdminStatus,
  listAllUsers,
  listRoles,
  sanitizePublicUser,
  sanitizeUser,
  updateUserProfile,
  updateUserPassword,
  findUserById,
} from '../models/userModel.js';
import { signAuthToken } from '../middleware/authMiddleware.js';
import { recordAuditLog } from '../services/auditService.js';
import {
  getSupabaseAuthClient,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PUBLIC_PROTOTYPE_WALLETS = [
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
  '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
];

async function assignPublicWalletIfBlank(providedWallet) {
  const trimmed = String(providedWallet || '').trim();
  if (trimmed) return trimmed;
  try {
    const existing = await listAllUsers();
    const used = new Set(existing.map((u) => String(u.walletAddress || '').toLowerCase()));
    const available = PUBLIC_PROTOTYPE_WALLETS.find((addr) => !used.has(addr.toLowerCase()));
    return available || PUBLIC_PROTOTYPE_WALLETS[existing.length % PUBLIC_PROTOTYPE_WALLETS.length];
  } catch {
    return PUBLIC_PROTOTYPE_WALLETS[0];
  }
}

export async function register(req, res) {
  try {
    const { fullName, email, password, nationalId, phone = '', walletAddress = '' } = req.body || {};

    if (!fullName || String(fullName).trim().length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }
    if (!email || !EMAIL_REGEX.test(String(email))) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    if (!nationalId || String(nationalId).trim().length < 4) {
      return res.status(400).json({ error: 'National ID is required (minimum 4 characters).' });
    }

    const assignedWallet = await assignPublicWalletIfBlank(walletAddress);

    // Security rule: public registration always assigns CITIZEN role regardless of client payload.
    if (isSupabaseActive()) {
      const authClient = getSupabaseAuthClient();
      if (!authClient) {
        return res.status(503).json({ error: 'Supabase Auth is missing its publishable key.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const { data: authData, error: authError } = await authClient.auth.signUp({
        email: normalizedEmail,
        password: String(password),
        options: {
          data: { full_name: String(fullName).trim() },
          ...(env.supabase.authRedirectUrl
            ? { emailRedirectTo: env.supabase.authRedirectUrl }
            : {}),
        },
      });
      if (authError) {
        if (authError.code === 'email_exists' || authError.code === 'user_already_exists') {
          return res.status(409).json({ error: 'An account with this email already exists.' });
        }
        console.error('Supabase Auth registration failed:', authError.message);
        return res.status(502).json({ error: 'Could not start email verification. Please try again.' });
      }
      if (!authData.user?.id || authData.user.identities?.length === 0) {
        return res.status(202).json({
          message: 'If this address can be registered, a verification email will be sent.',
          confirmationRequired: true,
        });
      }

      let user;
      try {
        user = await createUser({
          fullName,
          email: normalizedEmail,
          password: '',
          nationalId,
          phone,
          walletAddress: assignedWallet,
          roleCode: 'CITIZEN',
          authUserId: authData.user.id,
        });
      } catch (error) {
        const supabase = getSupabaseClient();
        const { error: cleanupError } = await supabase.auth.admin.deleteUser(authData.user.id);
        if (cleanupError) {
          console.error('Unable to remove unlinked signup Auth user:', cleanupError.message);
        }
        if (error.code === 'DUPLICATE_EMAIL' || error.code === 'DUPLICATE_NATIONAL_ID') {
          return res.status(409).json({ error: error.message });
        }
        throw error;
      }

      await recordAuditLog({
        actorId: user.id,
        actorRole: user.roleCode,
        action: 'USER_REGISTERED',
        entityType: 'user',
        entityId: user.id,
        details: { email: user.email, roleCode: user.roleCode },
        ipAddress: req.ip,
      });

      if (!authData.session) {
        return res.status(202).json({
          message: 'Check your email and confirm the address before signing in.',
          confirmationRequired: true,
        });
      }
      return res.status(201).json({
        message: 'Citizen account registered successfully.',
        token: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        user,
      });
    }

    const user = await createUser({
      fullName,
      email,
      password,
      nationalId,
      phone,
      walletAddress: assignedWallet,
      roleCode: 'CITIZEN',
    });

    const token = signAuthToken(user);

    await recordAuditLog({
      actorId: user.id,
      actorRole: user.roleCode,
      action: 'USER_REGISTERED',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email, roleCode: user.roleCode },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message: 'Citizen account registered successfully.',
      token,
      user,
    });
  } catch (error) {
    console.error('Registration failed:', error?.message || error);
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'DUPLICATE_EMAIL' || error.code === 'DUPLICATE_NATIONAL_ID' || error.code === '23505') {
      return res.status(409).json({ error: error.message || 'Email or National ID already registered.' });
    }
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (isSupabaseActive()) {
      const authClient = getSupabaseAuthClient();
      if (!authClient) {
        return res.status(503).json({ error: 'Supabase Auth is missing its publishable key.' });
      }
      const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
        email: String(email).trim().toLowerCase(),
        password: String(password),
      });
      if (authError || !authData.user || !authData.session) {
        return res.status(authError?.code === 'email_not_confirmed' ? 403 : 401).json({
          error:
            authError?.code === 'email_not_confirmed'
              ? 'Confirm your email address before signing in.'
              : 'Invalid email or password.',
        });
      }

      const userRow = await findUserByAuthId(authData.user.id);
      if (!userRow) {
        await getSupabaseClient().auth.admin.signOut(authData.session.access_token, 'local');
        return res.status(403).json({ error: 'ANAGU profile is not linked to this account.' });
      }
      if (!userRow.is_active) {
        await getSupabaseClient().auth.admin.signOut(authData.session.access_token, 'local');
        return res.status(403).json({ error: 'Account is deactivated. Contact the Administrator.' });
      }

      const user = sanitizePublicUser(userRow);
      await recordAuditLog({
        actorId: user.id,
        actorRole: user.roleCode,
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: user.id,
        details: { email: user.email },
        ipAddress: req.ip,
      });
      return res.json({
        message: 'Login successful.',
        token: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        user,
      });
    }

    const userRow = await findUserByEmail(email);
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!userRow.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact the Administrator.' });
    }

    const isMatch = await bcrypt.compare(String(password), userRow.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = sanitizePublicUser(userRow);
    const token = signAuthToken(user);

    await recordAuditLog({
      actorId: user.id,
      actorRole: user.roleCode,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Login successful.',
      token,
      user,
    });
  } catch (error) {
    console.error('Login failed:', error?.message || error);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

export async function logout(req, res) {
  if (isSupabaseActive() && req.authToken) {
    const { error } = await getSupabaseClient().auth.admin.signOut(req.authToken, 'local');
    if (error) {
      console.error('Supabase Auth logout failed:', error.message);
      return res.status(502).json({ error: 'Could not end the Supabase session.' });
    }
  }
  await recordAuditLog({
    actorId: req.user.id,
    actorRole: req.user.roleCode,
    action: 'USER_LOGOUT',
    entityType: 'user',
    entityId: req.user.id,
    details: { email: req.user.email },
    ipAddress: req.ip,
  });
  return res.status(204).end();
}

export async function requestPasswordReset(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (isSupabaseActive()) {
    const authClient = getSupabaseAuthClient();
    if (!authClient) {
      return res.status(503).json({ error: 'Supabase Auth is missing its publishable key.' });
    }
    const { error } = await authClient.auth.resetPasswordForEmail(email, {
      ...(env.supabase.authRedirectUrl
        ? { redirectTo: env.supabase.authRedirectUrl }
        : {}),
    });
    if (error) {
      console.error('Supabase password reset email failed:', error.message);
      return res.status(502).json({ error: 'Could not send password reset email. Please try again.' });
    }
    return res.json({
      message: 'If the account exists, password reset instructions have been sent.',
    });
  }

  try {
    const userRow = await findUserByEmail(email);
    if (userRow && userRow.is_active) {
      const resetToken = jwt.sign(
        { sub: userRow.id, email: userRow.email, purpose: 'password-reset' },
        env.jwtSecret,
        { expiresIn: '15m' }
      );
      await recordAuditLog({
        actorId: userRow.id,
        actorRole: userRow.role_code || null,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: userRow.id,
        details: { email: userRow.email },
        ipAddress: req.ip,
      });

      return res.json({
        message: 'If the account exists, password reset instructions have been sent.',
        ...(env.nodeEnv === 'development'
          ? { resetToken }
          : {}),
      });
    }
  } catch (error) {
    console.error('Password reset request error:', error);
  }

  return res.json({
    message: 'If the account exists, password reset instructions have been sent.',
  });
}

export async function confirmPasswordReset(req, res) {
  const { resetToken, password } = req.body || {};
  const accessToken = req.body?.accessToken;
  if (isSupabaseActive()) {
    if (!accessToken || !password || String(password).length < 8) {
      return res.status(400).json({
        error: 'A valid recovery session and a password of at least 8 characters are required.',
      });
    }
    try {
      const supabase = getSupabaseClient();
      const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
      if (authError || !authData.user) {
        return res.status(400).json({ error: 'Invalid or expired password reset session.' });
      }
      const user = await findUserByAuthId(authData.user.id);
      if (!user || !user.is_active) {
        return res.status(400).json({ error: 'Invalid or expired password reset session.' });
      }
      await updateUserPassword(user.id, String(password));
      const { error: signOutError } = await supabase.auth.admin.signOut(accessToken, 'global');
      if (signOutError) {
        console.error('Unable to revoke sessions after password reset:', signOutError.message);
      }
      await recordAuditLog({
        actorId: user.id,
        actorRole: user.role_code,
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'user',
        entityId: user.id,
        details: { email: user.email },
        ipAddress: req.ip,
      });
      return res.json({ message: 'Password reset successfully. Sign in with your new password.' });
    } catch (error) {
      console.error('Supabase password reset confirmation failed:', error.message);
      return res.status(502).json({ error: 'Password reset failed. Please request a new link.' });
    }
  }

  if (!resetToken || !password || String(password).length < 8) {
    return res.status(400).json({
      error: 'A reset token and a password of at least 8 characters are required.',
    });
  }

  try {
    const payload = jwt.verify(resetToken, env.jwtSecret);
    if (payload.purpose !== 'password-reset') {
      return res.status(400).json({ error: 'Invalid password reset token.' });
    }

    const user = await findUserById(payload.sub);
    if (!user || !user.is_active || String(user.email).toLowerCase() !== String(payload.email).toLowerCase()) {
      return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    await updateUserPassword(user.id, String(password));
    await recordAuditLog({
      actorId: user.id,
      actorRole: user.roleCode,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress: req.ip,
    });

    return res.json({ message: 'Password reset successfully.' });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }
    console.error('Password reset confirmation error:', error);
    return res.status(500).json({ error: 'Password reset failed.' });
  }
}

export async function refreshAuthSession(req, res) {
  const refreshToken = String(req.body?.refreshToken || '').trim();
  if (!refreshToken || !isSupabaseActive()) {
    return res.status(401).json({ error: 'A valid Supabase refresh token is required.' });
  }
  const authClient = getSupabaseAuthClient();
  if (!authClient) {
    return res.status(503).json({ error: 'Supabase Auth is missing its publishable key.' });
  }
  const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  const user = await findUserByAuthId(data.user.id);
  if (!user || !user.is_active) {
    await getSupabaseClient().auth.admin.signOut(data.session.access_token, 'local');
    return res.status(403).json({ error: 'Account is inactive or no longer linked to ANAGU.' });
  }
  return res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
}

export async function getAdminAuthStatus(_req, res) {
  try {
    const status = await getSoleAdminStatus();
    return res.json(status);
  } catch {
    return res.status(500).json({ error: 'Unable to check administrator status.' });
  }
}

export async function setupSoleAdmin(req, res) {
  try {
    const { email, password, fullName } = req.body || {};
    if (!email || !EMAIL_REGEX.test(String(email))) {
      return res.status(400).json({ error: 'A valid administrator email address is required.' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const activation = await activateSoleAdmin({ email, password, fullName });
    if (activation?.user) {
      await recordAuditLog({
        actorId: activation.user.id,
        actorRole: activation.user.roleCode,
        action: 'ADMIN_ACCOUNT_ACTIVATED',
        entityType: 'user',
        entityId: activation.user.id,
        details: { email: activation.user.email },
        ipAddress: req.ip,
      });
      if (activation.session) {
        return res.status(201).json({
          message: 'Sole Administrator account activated.',
          token: activation.session.access_token,
          refreshToken: activation.session.refresh_token,
          user: activation.user,
        });
      }
      return res.status(202).json({
        message: 'Check the designated email and confirm it before signing in.',
        confirmationRequired: true,
      });
    }
    const adminUser = activation;
    const token = signAuthToken(adminUser);

    await recordAuditLog({
      actorId: adminUser.id,
      actorRole: adminUser.roleCode,
      action: 'ADMIN_ACCOUNT_ACTIVATED',
      entityType: 'user',
      entityId: adminUser.id,
      details: { email: adminUser.email },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message: 'Sole Administrator account activated.',
      token,
      user: adminUser,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Administrator activation failed.' });
  }
}

export async function adminLogin(req, res) {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Administrator email and password are required.' });
    }

    if (!isDesignatedAdminEmail(cleanEmail)) {
      return res.status(403).json({
        error: 'Access denied. Only the single designated administrator email may access the Admin Portal.',
      });
    }

    if (isSupabaseActive()) {
      const authClient = getSupabaseAuthClient();
      if (!authClient) {
        return res.status(503).json({ error: 'Supabase Auth is missing its publishable key.' });
      }
      const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
        email: cleanEmail,
        password: String(password),
      });
      if (authError || !authData.user || !authData.session) {
        return res.status(authError?.code === 'email_not_confirmed' ? 403 : 401).json({
          error:
            authError?.code === 'email_not_confirmed'
              ? 'Confirm the designated email address before signing in.'
              : 'Invalid administrator email or password.',
        });
      }
      const adminRow = await findUserByAuthId(authData.user.id);
      if (!adminRow || adminRow.role_code !== 'LAND_ADMIN' || !isDesignatedAdminEmail(adminRow.email)) {
        await getSupabaseClient().auth.admin.signOut(authData.session.access_token, 'local');
        return res.status(403).json({ error: 'Access denied. Administrator role is required.' });
      }
      if (!adminRow.is_active) {
        await getSupabaseClient().auth.admin.signOut(authData.session.access_token, 'local');
        return res.status(403).json({ error: 'Administrator account is deactivated.' });
      }
      const user = sanitizeUser(adminRow);
      await recordAuditLog({
        actorId: user.id,
        actorRole: user.roleCode,
        action: 'ADMIN_LOGIN',
        entityType: 'user',
        entityId: user.id,
        details: { email: user.email },
        ipAddress: req.ip,
      });
      return res.json({
        message: 'Administrator sign in successful.',
        token: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        user,
      });
    }

    const userRow = await findUserByEmail(cleanEmail);
    if (!userRow || !userRow.password_hash) {
      return res.status(401).json({
        error: 'Administrator password has not been activated yet, or credentials are invalid.',
      });
    }
    if (userRow.role_code !== 'LAND_ADMIN') {
      return res.status(403).json({
        error: 'Access denied. Administrator role is required.',
      });
    }
    if (!userRow.is_active) {
      return res.status(403).json({ error: 'Administrator account is deactivated.' });
    }

    const isMatch = await bcrypt.compare(String(password), userRow.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid administrator email or password.' });
    }

    const user = sanitizeUser(userRow);
    const token = signAuthToken(user);

    await recordAuditLog({
      actorId: user.id,
      actorRole: user.roleCode,
      action: 'ADMIN_LOGIN',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Administrator sign in successful.',
      token,
      user,
    });
  } catch (error) {
    console.error('Administrator sign in failed:', error?.message || error);
    return res.status(500).json({ error: 'Administrator sign in failed. Please try again.' });
  }
}

export async function getProfile(req, res) {
  return res.json({ user: req.user });
}

export async function updateProfile(req, res) {
  try {
    const { fullName, phone, walletAddress } = req.body || {};
    if (fullName !== undefined && String(fullName).trim().length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }

    const updated = await updateUserProfile(req.user.id, { fullName, phone, walletAddress });
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'PROFILE_UPDATED',
      entityType: 'user',
      entityId: req.user.id,
      details: { fullName: updated.fullName },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Profile updated successfully.',
      user: sanitizePublicUser(updated),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
}

export async function getRoles(_req, res) {
  const roles = (await listRoles()).filter((role) => role.code === 'CITIZEN');
  return res.json({ roles });
}
