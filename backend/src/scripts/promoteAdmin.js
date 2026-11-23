import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const targetEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!targetEmail) { console.error('ADMIN_EMAIL is not set'); process.exit(1); }

console.log(`Setting up admin user for ${targetEmail}...`);

// Check if already in users table
const { data: existing } = await supabase
  .from('users')
  .select('id, email, role_id')
  .eq('email', targetEmail)
  .maybeSingle();

// Get roles
const { data: roles } = await supabase.from('roles').select('id, code');
const adminRole = roles.find(r => r.code === 'LAND_ADMIN');
const citizenRole = roles.find(r => r.code === 'CITIZEN');

if (!adminRole) { console.error('LAND_ADMIN role not found'); process.exit(1); }
console.log('LAND_ADMIN role id:', adminRole.id);

if (existing) {
  // Already in users table — just promote
  const { error } = await supabase
    .from('users')
    .update({ role_id: adminRole.id, is_active: true })
    .eq('id', existing.id);
  if (error) { console.error('Promote error:', error.message); process.exit(1); }
  console.log(`SUCCESS: Promoted existing user (id: ${existing.id}) to LAND_ADMIN`);
} else {
  // Not in users table — find the Supabase Auth user id and insert the row
  const { data: authData } = await supabase.auth.admin.listUsers();
  const authUser = authData?.users?.find(u => u.email === targetEmail);
  if (!authUser) { console.error('Auth user not found — sign up first at http://localhost:5173'); process.exit(1); }

  console.log('Found Supabase Auth user id:', authUser.id);

  const { error: insertErr } = await supabase.from('users').insert({
    auth_user_id: authUser.id,
    role_id: adminRole.id,
    full_name: process.env.ADMIN_FULL_NAME || 'ANAGU Administrator',
    email: targetEmail,
    password_hash: '',
    national_id: `NID-ADMIN-${Date.now()}`,
    phone: '',
    wallet_address: '',
    is_active: true,
  });

  if (insertErr) { console.error('Insert error:', insertErr.message); process.exit(1); }
  console.log(`SUCCESS: Created LAND_ADMIN users row for ${targetEmail}`);
}
