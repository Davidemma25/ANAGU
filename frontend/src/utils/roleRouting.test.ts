import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CITIZEN_ROLE,
  getDefaultHomeRoute,
} from './roleRouting';

test('all account types use the basic user dashboard', () => {
  assert.equal(CITIZEN_ROLE, 'CITIZEN');
  assert.equal(getDefaultHomeRoute('CITIZEN'), '/dashboard');

  for (const legacyRole of ['LAND_ADMIN', 'SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'GOVERNOR']) {
    assert.equal(getDefaultHomeRoute(legacyRole), '/dashboard');
  }

  assert.equal(getDefaultHomeRoute(null), '/dashboard');
});
