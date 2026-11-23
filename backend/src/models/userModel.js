import bcrypt from 'bcryptjs';
import { env, getAdminEmail, isDesignatedAdminEmail } from '../config/env.js';
import {
  getPgPool,
  loadLocalStore,
  saveLocalStore,
  nextSequence,
  ROLES_SEED,
} from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseAuthClient,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

const SALT_ROUNDS = 10;

export function sanitizeUser(userRow) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    roleId: userRow.role_id,
    roleCode: userRow.role_code,
    roleName: userRow.role_name,
    fullName: userRow.full_name,
    email: userRow.email,
    nationalId: userRow.national_id,
    phone: userRow.phone || '',
    walletAddress: userRow.wallet_address || '',
    isActive: userRow.is_active,
    createdAt: userRow.created_at,
    updatedAt: userRow.updated_at,
  };
}

export function sanitizePublicUser(userRow) {
  const user = userRow && userRow.roleCode ? userRow : sanitizeUser(userRow);
  return user ? { ...user, roleCode: 'CITIZEN', roleName: 'Account holder' } : null;
}

export async function listRoles() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query('SELECT id, code, name, description FROM roles ORDER BY id ASC');
    return res.rows;
  }
  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('roles')
      .select('id, code, name, description')
      .order('id', { ascending: true });
    assertNoSupabaseError(error, 'List roles in Supabase');
    return data || [];
  }
  const store = loadLocalStore();
  return store.tables.roles;
}

export async function findRoleByCode(roleCode) {
  const normalized = String(roleCode || '').trim().toUpperCase();
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM roles WHERE code = $1 LIMIT 1', [normalized]);
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .eq('code', normalized)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find role by code in Supabase');
    return data || null;
  }
  const store = loadLocalStore();
  return store.tables.roles.find((r) => r.code === normalized) || null;
}

export async function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT u.*, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = $1
       LIMIT 1`,
      [normalized]
    );
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalized)
      .limit(1)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find user by email in Supabase');
    if (!user) return null;
    const roles = await listRoles();
    const role = roles.find((r) => r.id === user.role_id);
    return {
      ...user,
      role_code: role?.code || 'CITIZEN',
      role_name: role?.name || 'Citizen / Landowner',
    };
  }

  const store = loadLocalStore();
  const user = store.tables.users.find((u) => u.email.toLowerCase() === normalized);
  if (!user) return null;
  const role = store.tables.roles.find((r) => r.id === user.role_id);
  return {
    ...user,
    role_code: role?.code || 'CITIZEN',
    role_name: role?.name || 'Citizen / Landowner',
  };
}

export async function findUserById(id) {
  const numericId = Number(id);
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT u.*, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [numericId]
    );
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', numericId)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find user by id in Supabase');
    if (!user) return null;
    const roles = await listRoles();
    const role = roles.find((r) => r.id === user.role_id);
    return {
      ...user,
      role_code: role?.code || 'CITIZEN',
      role_name: role?.name || 'Citizen / Landowner',
    };
  }

  const store = loadLocalStore();
  const user = store.tables.users.find((u) => u.id === numericId);
  if (!user) return null;
  const role = store.tables.roles.find((r) => r.id === user.role_id);
  return {
    ...user,
    role_code: role?.code || 'CITIZEN',
    role_name: role?.name || 'Citizen / Landowner',
  };
}

export async function findUserByAuthId(authUserId) {
  const normalized = String(authUserId || '').trim();
  if (!normalized) return null;

  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT u.*, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.auth_user_id = $1
       LIMIT 1`,
      [normalized]
    );
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_user_id', normalized)
      .maybeSingle();
    assertNoSupabaseError(error, 'Find user by Supabase Auth ID');
    if (!user) return null;
    const roles = await listRoles();
    const role = roles.find((r) => r.id === user.role_id);
    return {
      ...user,
      role_code: role?.code || 'CITIZEN',
      role_name: role?.name || 'Citizen / Landowner',
    };
  }

  const store = loadLocalStore();
  const user = store.tables.users.find((row) => row.auth_user_id === normalized);
  if (!user) return null;
  const role = store.tables.roles.find((row) => row.id === user.role_id);
  return {
    ...user,
    role_code: role?.code || 'CITIZEN',
    role_name: role?.name || 'Citizen / Landowner',
  };
}

export async function createUser({
  fullName,
  email,
  password,
  nationalId,
  phone = '',
  walletAddress = '',
  roleCode = 'CITIZEN',
  authUserId = null,
}) {
  const normalizedRole = String(roleCode || 'CITIZEN').trim().toUpperCase();
  if (!['CITIZEN', 'SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'LAND_ADMIN', 'GOVERNOR'].includes(normalizedRole)) {
    const err = new Error(`Invalid role code: ${roleCode}. Only CITIZEN or LAND_ADMIN is supported.`);
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (normalizedRole === 'LAND_ADMIN' && !isDesignatedAdminEmail(normalizedEmail)) {
    const err = new Error('Administrator access is restricted exclusively to the single designated admin email.');
    err.statusCode = 403;
    throw err;
  }
  if (normalizedRole === 'CITIZEN' && isDesignatedAdminEmail(normalizedEmail)) {
    const err = new Error('This email is reserved for the designated Administrator Portal.');
    err.statusCode = 403;
    throw err;
  }

  const role = await findRoleByCode(normalizedRole);
  if (!role) {
    throw new Error(`Invalid role code: ${roleCode}`);
  }

  const normalizedNationalId = String(nationalId).trim().toUpperCase();
  const passwordHash =
    password && !isSupabaseActive() ? await bcrypt.hash(String(password), SALT_ROUNDS) : '';

  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, national_id, phone, wallet_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [role.id, fullName.trim(), normalizedEmail, passwordHash, normalizedNationalId, phone, walletAddress]
    );
    const created = res.rows[0];
    return sanitizeUser({ ...created, role_code: role.code, role_name: role.name });
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    let linkedAuthUserId = authUserId;
    let createdAuthUserId = null;
    if (!linkedAuthUserId) {
      if (!password) {
        throw new Error('A password is required when provisioning a Supabase Auth user.');
      }
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: String(password),
        email_confirm: true,
        user_metadata: { full_name: fullName.trim() },
      });
      if (authError) {
        if (authError.code === 'email_exists' || authError.code === 'user_already_exists') {
          const duplicateError = new Error('An account with this email already exists.');
          duplicateError.code = 'DUPLICATE_EMAIL';
          throw duplicateError;
        }
        assertNoSupabaseError(authError, 'Create Supabase Auth user');
      }
      linkedAuthUserId = authData.user.id;
      createdAuthUserId = authData.user.id;
    }

    try {
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          auth_user_id: linkedAuthUserId,
          role_id: role.id,
          full_name: fullName.trim(),
          email: normalizedEmail,
          password_hash: '',
          national_id: normalizedNationalId,
          phone: String(phone || '').trim(),
          wallet_address: String(walletAddress || '').trim(),
          is_active: true,
        })
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') {
          const msg = String(error.message || '').toLowerCase();
          const dupErr = new Error(
            msg.includes('national_id')
              ? 'An account with this National ID already exists.'
              : 'An account with this email already exists.'
          );
          dupErr.code = msg.includes('national_id') ? 'DUPLICATE_NATIONAL_ID' : 'DUPLICATE_EMAIL';
          throw dupErr;
        }
        assertNoSupabaseError(error, 'Create user profile in Supabase');
      }
      return sanitizeUser({ ...created, role_code: role.code, role_name: role.name });
    } catch (error) {
      if (createdAuthUserId) {
        const { error: cleanupError } = await supabase.auth.admin.deleteUser(createdAuthUserId);
        if (cleanupError) {
          console.error('Unable to remove orphaned Supabase Auth user:', cleanupError.message);
        }
      }
      throw error;
    }
  }

  const store = loadLocalStore();
  if (store.tables.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
    const err = new Error('An account with this email already exists.');
    err.code = 'DUPLICATE_EMAIL';
    throw err;
  }
  if (store.tables.users.some((u) => u.national_id.toUpperCase() === normalizedNationalId)) {
    const err = new Error('An account with this National ID already exists.');
    err.code = 'DUPLICATE_NATIONAL_ID';
    throw err;
  }

  const now = new Date().toISOString();
  const row = {
    id: nextSequence(store, 'users'),
    auth_user_id: authUserId,
    role_id: role.id,
    full_name: fullName.trim(),
    email: normalizedEmail,
    password_hash: passwordHash,
    national_id: normalizedNationalId,
    phone: phone.trim(),
    wallet_address: walletAddress.trim(),
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  store.tables.users.push(row);
  saveLocalStore(store);

  return sanitizeUser({ ...row, role_code: role.code, role_name: role.name });
}

export async function updateUserPassword(userId, password) {
  const numericId = Number(userId);
  if (isSupabaseActive()) {
    const user = await findUserById(numericId);
    if (user?.auth_user_id) {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.admin.updateUserById(user.auth_user_id, {
        password: String(password),
      });
      assertNoSupabaseError(error, 'Update Supabase Auth password');
      return sanitizeUser(await findUserById(numericId));
    }
  }
  const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);

  if (env.pg.enabled) {
    const pool = getPgPool();
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, numericId]
    );
    return sanitizeUser(await findUserById(numericId));
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq('id', numericId);
    assertNoSupabaseError(error, 'Update user password in Supabase');
    return sanitizeUser(await findUserById(numericId));
  }

  const store = loadLocalStore();
  const user = store.tables.users.find((u) => u.id === numericId);
  if (!user) return null;
  user.password_hash = passwordHash;
  user.updated_at = new Date().toISOString();
  saveLocalStore(store);
  return sanitizeUser(await findUserById(numericId));
}

export async function updateUserProfile(userId, { fullName, phone, walletAddress }) {
  const numericId = Number(userId);
  if (env.pg.enabled) {
    const pool = getPgPool();
    await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           wallet_address = COALESCE($3, wallet_address),
           updated_at = NOW()
       WHERE id = $4`,
      [fullName ?? null, phone ?? null, walletAddress ?? null, numericId]
    );
    return sanitizeUser(await findUserById(numericId));
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const patch = { updated_at: new Date().toISOString() };
    if (typeof fullName === 'string' && fullName.trim()) patch.full_name = fullName.trim();
    if (typeof phone === 'string') patch.phone = phone.trim();
    if (typeof walletAddress === 'string') patch.wallet_address = walletAddress.trim();
    const { error } = await supabase.from('users').update(patch).eq('id', numericId);
    assertNoSupabaseError(error, 'Update user profile in Supabase');
    return sanitizeUser(await findUserById(numericId));
  }

  const store = loadLocalStore();
  const idx = store.tables.users.findIndex((u) => u.id === numericId);
  if (idx === -1) return null;

  const user = store.tables.users[idx];
  if (typeof fullName === 'string' && fullName.trim()) {
    user.full_name = fullName.trim();
  }
  if (typeof phone === 'string') {
    user.phone = phone.trim();
  }
  if (typeof walletAddress === 'string') {
    user.wallet_address = walletAddress.trim();
  }
  user.updated_at = new Date().toISOString();
  saveLocalStore(store);

  return sanitizeUser(await findUserById(numericId));
}

export async function updateUserAdmin(userId, { roleCode, isActive }) {
  const numericId = Number(userId);
  const existing = await findUserById(numericId);
  if (!existing) return null;

  let targetRole = null;
  if (roleCode) {
    const normalizedRole = String(roleCode).trim().toUpperCase();
    if (!['CITIZEN', 'SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'LAND_ADMIN', 'GOVERNOR'].includes(normalizedRole)) {
      throw new Error(`Invalid role code: ${roleCode}`);
    }
    if (normalizedRole === 'LAND_ADMIN' && !isDesignatedAdminEmail(existing.email)) {
      const err = new Error('Only the single designated administrator email may hold the Administrator role.');
      err.statusCode = 403;
      throw err;
    }
    if (normalizedRole !== 'LAND_ADMIN' && isDesignatedAdminEmail(existing.email)) {
      const err = new Error('Cannot demote the single designated Administrator.');
      err.statusCode = 403;
      throw err;
    }
    targetRole = await findRoleByCode(normalizedRole);
    if (!targetRole) {
      throw new Error(`Invalid role code: ${roleCode}`);
    }
  }

  if (typeof isActive === 'boolean' && !isActive && isDesignatedAdminEmail(existing.email)) {
    const err = new Error('Cannot deactivate the single designated Administrator account.');
    err.statusCode = 403;
    throw err;
  }

  if (env.pg.enabled) {
    const pool = getPgPool();
    await pool.query(
      `UPDATE users
       SET role_id = COALESCE($1, role_id),
           is_active = COALESCE($2, is_active),
           updated_at = NOW()
       WHERE id = $3`,
      [targetRole ? targetRole.id : null, typeof isActive === 'boolean' ? isActive : null, numericId]
    );
    return sanitizeUser(await findUserById(numericId));
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const patch = { updated_at: new Date().toISOString() };
    if (targetRole) patch.role_id = targetRole.id;
    if (typeof isActive === 'boolean') patch.is_active = isActive;
    const { error } = await supabase.from('users').update(patch).eq('id', numericId);
    assertNoSupabaseError(error, 'Update user admin access in Supabase');
    return sanitizeUser(await findUserById(numericId));
  }

  const store = loadLocalStore();
  const user = store.tables.users.find((u) => u.id === numericId);
  if (!user) return null;

  if (targetRole) {
    user.role_id = targetRole.id;
  }
  if (typeof isActive === 'boolean') {
    user.is_active = isActive;
  }
  user.updated_at = new Date().toISOString();
  saveLocalStore(store);

  return sanitizeUser(await findUserById(numericId));
}

export async function listAllUsers() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT u.*, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
    );
    return res.rows.map(sanitizeUser);
  }

  if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const [{ data: users, error: usersErr }, roles] = await Promise.all([
      supabase.from('users').select('*').order('id', { ascending: true }),
      listRoles(),
    ]);
    assertNoSupabaseError(usersErr, 'List users in Supabase');
    const rolesById = new Map(roles.map((r) => [r.id, r]));
    return (users || []).map((u) => {
      const role = rolesById.get(u.role_id) || ROLES_SEED[0];
      return sanitizeUser({ ...u, role_code: role.code, role_name: role.name });
    });
  }

  const store = loadLocalStore();
  const rolesById = new Map(store.tables.roles.map((r) => [r.id, r]));
  return store.tables.users.map((u) => {
    const role = rolesById.get(u.role_id) || ROLES_SEED[0];
    return sanitizeUser({ ...u, role_code: role.code, role_name: role.name });
  });
}

const LEGACY_DEMO_EMAILS = new Set([
  'citizen@anagu.test',
  'surveyor@anagu.test',
  'officer@anagu.test',
  'registrar@anagu.test',
  'admin@anagu.test',
  'governor@anagu.test',
]);

export function cleanupLegacyDemoAccountsAndRoles() {
  if (env.pg.enabled || isSupabaseActive()) return;

  const store = loadLocalStore();
  let changed = false;

  // Enforce strictly CITIZEN (1) and LAND_ADMIN (2) roles
  const expectedRoles = JSON.stringify(ROLES_SEED);
  if (JSON.stringify(store.tables.roles || []) !== expectedRoles) {
    store.tables.roles = [...ROLES_SEED];
    store.sequences.roles = ROLES_SEED.length;
    changed = true;
  }

  const removedUserIds = new Set();
  const keptUsers = [];
  for (const user of store.tables.users || []) {
    const email = String(user.email || '').trim().toLowerCase();
    if (LEGACY_DEMO_EMAILS.has(email) || email.endsWith('@anagu.test')) {
      removedUserIds.add(user.id);
      changed = true;
      continue;
    }

    // Enforce single-admin role assignment
    const desiredRoleId = isDesignatedAdminEmail(email) ? 2 : 1;
    if (user.role_id !== desiredRoleId) {
      user.role_id = desiredRoleId;
      changed = true;
    }
    keptUsers.push(user);
  }

  if (removedUserIds.size > 0) {
    store.tables.users = keptUsers;

    const removedAppIds = new Set(
      (store.tables.land_applications || [])
        .filter((a) => removedUserIds.has(a.applicant_id))
        .map((a) => a.id)
    );
    const removedTitleIds = new Set(
      (store.tables.land_titles || [])
        .filter((t) => removedUserIds.has(t.owner_id) || removedAppIds.has(t.application_id))
        .map((t) => t.id)
    );

    store.tables.land_applications = (store.tables.land_applications || []).filter(
      (a) => !removedAppIds.has(a.id)
    );
    store.tables.land_parcels = (store.tables.land_parcels || []).filter(
      (p) => !removedAppIds.has(p.application_id)
    );
    store.tables.supporting_documents = (store.tables.supporting_documents || []).filter(
      (d) => !removedAppIds.has(d.application_id)
    );
    store.tables.verification_records = (store.tables.verification_records || []).filter(
      (v) => !removedAppIds.has(v.application_id)
    );
    store.tables.land_titles = (store.tables.land_titles || []).filter(
      (t) => !removedTitleIds.has(t.id)
    );
    store.tables.land_listings = (store.tables.land_listings || []).filter(
      (l) => !removedUserIds.has(l.seller_id) && !removedAppIds.has(l.application_id)
    );
    store.tables.payments = (store.tables.payments || []).filter(
      (p) => !removedUserIds.has(p.user_id) && !removedAppIds.has(p.registration_id)
    );
    store.tables.revocation_records = (store.tables.revocation_records || []).filter(
      (r) => !removedTitleIds.has(r.title_id)
    );
    store.tables.blockchain_transactions = (store.tables.blockchain_transactions || []).filter(
      (tx) => !removedAppIds.has(tx.application_id) && !removedTitleIds.has(tx.title_id)
    );
  }

  if (changed) {
    saveLocalStore(store);
  }
}

export async function getSoleAdminStatus() {
  const adminEmail = getAdminEmail();
  const adminUser = await findUserByEmail(adminEmail);
  return {
    adminConfigured: Boolean(
      adminUser &&
        (adminUser.auth_user_id || adminUser.password_hash) &&
        adminUser.role_code === 'LAND_ADMIN'
    ),
  };
}

export async function activateSoleAdmin({
  email,
  password,
  fullName = env.admin.fullName || 'ANAGU Administrator',
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!isDesignatedAdminEmail(normalizedEmail)) {
    const err = new Error(
      'Access denied. Only the single designated administrator email can activate this portal.'
    );
    err.statusCode = 403;
    throw err;
  }
  if (!password || String(password).length < 8) {
    const err = new Error('Administrator password must be at least 8 characters long.');
    err.statusCode = 400;
    throw err;
  }

  if (isSupabaseActive()) {
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      const err = new Error('Administrator account is already activated. Please sign in.');
      err.statusCode = 409;
      throw err;
    }

    const authClient = getSupabaseAuthClient();
    if (!authClient) {
      throw new Error('Supabase Auth is not configured with a publishable key.');
    }
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
        const err = new Error('Administrator account is already activated. Please sign in.');
        err.statusCode = 409;
        throw err;
      }
      assertNoSupabaseError(authError, 'Register designated administrator with Supabase Auth');
    }
    if (!authData.user?.id || authData.user.identities?.length === 0) {
      const err = new Error('Administrator account is already activated. Please sign in.');
      err.statusCode = 409;
      throw err;
    }

    try {
      const user = await createUser({
        fullName: String(fullName || 'ANAGU Administrator').trim(),
        email: normalizedEmail,
        password: '',
        nationalId: 'NID-ADMIN-SOLE',
        phone: '',
        walletAddress: '',
        roleCode: 'LAND_ADMIN',
        authUserId: authData.user.id,
      });
      return {
        user,
        session: authData.session,
        confirmationRequired: !authData.session,
      };
    } catch (error) {
      if (authData.user.id) {
        const supabase = getSupabaseClient();
        const { error: cleanupError } = await supabase.auth.admin.deleteUser(authData.user.id);
        if (cleanupError) {
          console.error('Unable to remove unlinked administrator Auth user:', cleanupError.message);
        }
      }
      throw error;
    }
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing && existing.password_hash) {
    const err = new Error('Administrator account is already activated. Please sign in.');
    err.statusCode = 409;
    throw err;
  }

  if (existing) {
    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const adminRole = await findRoleByCode('LAND_ADMIN');
    if (env.pg.enabled) {
      const pool = getPgPool();
      await pool.query(
        'UPDATE users SET password_hash = $1, role_id = $2, full_name = $3, is_active = TRUE, updated_at = NOW() WHERE id = $4',
        [passwordHash, adminRole.id, String(fullName).trim(), existing.id]
      );
      return sanitizeUser(await findUserById(existing.id));
    }
    if (isSupabaseActive()) {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('users')
        .update({
          password_hash: passwordHash,
          role_id: adminRole.id,
          full_name: String(fullName).trim(),
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      assertNoSupabaseError(error, 'Activate sole admin in Supabase');
      return sanitizeUser(await findUserById(existing.id));
    }
    const store = loadLocalStore();
    const row = store.tables.users.find((u) => u.id === existing.id);
    row.password_hash = passwordHash;
    row.role_id = adminRole.id;
    row.full_name = String(fullName).trim();
    row.is_active = true;
    row.updated_at = new Date().toISOString();
    saveLocalStore(store);
    return sanitizeUser(await findUserById(existing.id));
  }

  return createUser({
    fullName: String(fullName || 'ANAGU Administrator').trim(),
    email: normalizedEmail,
    password: String(password),
    nationalId: 'NID-ADMIN-SOLE',
    phone: '',
    walletAddress: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    roleCode: 'LAND_ADMIN',
  });
}

export async function ensureSeedUsers(options = {}) {
  cleanupLegacyDemoAccountsAndRoles();

  const adminEmail = String(
    process.env.ADMIN_EMAIL || options.defaultAdminEmail || getAdminEmail()
  )
    .trim()
    .toLowerCase();
  const configuredPassword =
    process.env.ADMIN_PASSWORD || options.defaultAdminPassword || '';

  if (configuredPassword && String(configuredPassword).length >= 8) {
    const existing = await findUserByEmail(adminEmail);
    if (!existing) {
      try {
        await createUser({
          fullName: env.admin.fullName || 'ANAGU Administrator',
          email: adminEmail,
          password: String(configuredPassword),
          nationalId: 'NID-ADMIN-SOLE',
          phone: '',
          walletAddress: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
          roleCode: 'LAND_ADMIN',
        });
      } catch (err) {
        if (err?.code === 'DUPLICATE_NATIONAL_ID' || err?.code === '23505') {
          await createUser({
            fullName: env.admin.fullName || 'ANAGU Administrator',
            email: adminEmail,
            password: String(configuredPassword),
            nationalId: `NID-ADMIN-${Date.now()}`,
            phone: '',
            walletAddress: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
            roleCode: 'LAND_ADMIN',
          });
        } else {
          throw err;
        }
      }
    } else if (options.syncDefaultPassword) {
      const matches = existing.password_hash
        ? await bcrypt.compare(String(configuredPassword), existing.password_hash)
        : false;
      if (!matches || existing.role_code !== 'LAND_ADMIN' || !existing.is_active) {
        const passwordHash = await bcrypt.hash(String(configuredPassword), SALT_ROUNDS);
        const adminRole = await findRoleByCode('LAND_ADMIN');
        if (env.pg.enabled) {
          const pool = getPgPool();
          await pool.query(
            'UPDATE users SET password_hash = $1, role_id = $2, is_active = TRUE, updated_at = NOW() WHERE id = $3',
            [passwordHash, adminRole.id, existing.id]
          );
        } else if (isSupabaseActive()) {
          const supabase = getSupabaseClient();
          const { error } = await supabase
            .from('users')
            .update({
              password_hash: passwordHash,
              role_id: adminRole.id,
              is_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          assertNoSupabaseError(error, 'Sync default admin password in Supabase');
        } else {
          const store = loadLocalStore();
          const row = store.tables.users.find((u) => u.id === existing.id);
          if (row) {
            row.password_hash = passwordHash;
            row.role_id = adminRole.id;
            row.is_active = true;
            row.updated_at = new Date().toISOString();
            saveLocalStore(store);
          }
        }
      }
    }
  }
}

export async function ensureUserFromTokenPayload(payload) {
  if (env.pg.enabled || isSupabaseActive() || !process.env.VERCEL || !payload?.email) {
    return null;
  }

  const byEmail = await findUserByEmail(payload.email);
  if (byEmail) {
    return byEmail;
  }

  const normalizedEmail = String(payload.email).trim().toLowerCase();
  const resolvedRoleCode =
    payload.roleCode === 'LAND_ADMIN' && isDesignatedAdminEmail(normalizedEmail)
      ? 'LAND_ADMIN'
      : 'CITIZEN';
  const role =
    (await findRoleByCode(resolvedRoleCode)) ||
    ROLES_SEED.find((r) => r.code === 'CITIZEN');
  const store = loadLocalStore();
  const numericId = Number(payload.sub);
  const now = new Date().toISOString();

  const row = {
    id:
      Number.isInteger(numericId) && numericId > 0
        ? numericId
        : nextSequence(store, 'users'),
    role_id: role.id,
    full_name: String(payload.fullName || normalizedEmail.split('@')[0] || 'ANAGU User'),
    email: normalizedEmail,
    password_hash: '',
    national_id: String(payload.nationalId || `NID-VERCEL-${numericId || Date.now()}`),
    phone: String(payload.phone || ''),
    wallet_address: String(payload.walletAddress || ''),
    is_active: true,
    created_at: now,
    updated_at: now,
  };

  if (row.id > (store.sequences.users || 0)) {
    store.sequences.users = row.id;
  }
  store.tables.users.push(row);
  saveLocalStore(store);

  return {
    ...row,
    role_code: role.code,
    role_name: role.name,
  };
}

