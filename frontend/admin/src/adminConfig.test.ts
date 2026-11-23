import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_NAV_ITEMS,
  ADMIN_ROLE,
  getAdminNavigation,
  getAdminRedirectForUserRoute,
  isAdminPathname,
  isAdminRole,
} from './adminConfig';

test('isAdminRole allows only sole LAND_ADMIN and rejects citizen and removed official roles', () => {
  assert.equal(ADMIN_ROLE, 'LAND_ADMIN');
  assert.equal(isAdminRole('LAND_ADMIN'), true);

  for (const denied of ['CITIZEN', 'SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'GOVERNOR', '', null, undefined]) {
    assert.equal(isAdminRole(denied), false);
  }
});

test('isAdminPathname matches /admin and /admin/* without colliding with citizen paths', () => {
  assert.equal(isAdminPathname('/admin'), true);
  assert.equal(isAdminPathname('/admin/login'), true);
  assert.equal(isAdminPathname('/admin/users'), true);
  assert.equal(isAdminPathname('/applications'), false);
  assert.equal(isAdminPathname('/dashboard'), false);
  assert.equal(isAdminPathname('/'), false);
});

test('getAdminNavigation returns full admin navigation only for LAND_ADMIN', () => {
  const adminNav = getAdminNavigation('LAND_ADMIN');
  assert.equal(adminNav.length, ADMIN_NAV_ITEMS.length);
  assert.equal(adminNav.some((item) => item.to === '/admin/users'), true);
  assert.equal(adminNav.some((item) => item.to === '/admin/revocations'), true);

  for (const denied of ['CITIZEN', 'SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'GOVERNOR', null]) {
    assert.deepEqual(getAdminNavigation(denied), []);
  }
});

test('getAdminRedirectForUserRoute routes admin out of citizen paths and falls back to /dashboard for non-admins', () => {
  assert.equal(getAdminRedirectForUserRoute('/dashboard', 'LAND_ADMIN'), '/admin');
  assert.equal(getAdminRedirectForUserRoute('/gis-map', 'LAND_ADMIN'), '/admin/gis-validation');
  assert.equal(getAdminRedirectForUserRoute('/titles', 'LAND_ADMIN'), '/admin/titles');
  assert.equal(getAdminRedirectForUserRoute('/notifications', 'LAND_ADMIN'), '/admin/notifications');
  assert.equal(getAdminRedirectForUserRoute('/profile', 'LAND_ADMIN'), '/admin/profile');

  assert.equal(getAdminRedirectForUserRoute('/gis-map', 'CITIZEN'), '/dashboard');
  assert.equal(getAdminRedirectForUserRoute('/admin', 'SURVEYOR'), '/dashboard');
});
