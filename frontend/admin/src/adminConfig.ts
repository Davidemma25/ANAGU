export const ADMIN_ROLE = 'LAND_ADMIN' as const;

export type AdminRole = typeof ADMIN_ROLE;

export interface AdminNavSection {
  to: string;
  label: string;
  iconKey:
    | 'dashboard'
    | 'users'
    | 'gis'
    | 'oracle'
    | 'titles'
    | 'revocations'
    | 'audit'
    | 'evaluation'
    | 'notifications'
    | 'wallet';
}

export const ADMIN_NAV_ITEMS: readonly AdminNavSection[] = [
  { to: '/admin', label: 'Overview', iconKey: 'dashboard' },
  { to: '/admin/users', label: 'Registered Users', iconKey: 'users' },
  { to: '/admin/gis-validation', label: 'GIS Validation', iconKey: 'gis' },
  { to: '/admin/verification', label: 'Oracle Verification', iconKey: 'oracle' },
  { to: '/admin/titles', label: 'Title Issuance & Escrow', iconKey: 'titles' },
  { to: '/admin/revocations', label: 'Statutory Revocations', iconKey: 'revocations' },
  { to: '/admin/audit-logs', label: 'Audit Logs', iconKey: 'audit' },
  { to: '/admin/evaluation', label: 'Fraud & Benchmarks', iconKey: 'evaluation' },
  { to: '/admin/notifications', label: 'Admin Notifications', iconKey: 'notifications' },
  { to: '/admin/profile', label: 'Admin Wallet', iconKey: 'wallet' },
];

export const ADMIN_PAGE_TITLES: Readonly<Record<string, string>> = {
  '/': 'Administrator Overview',
  '/users': 'Registered Users',
  '/gis-validation': 'GIS Boundary Validation',
  '/verification': 'Ownership Verification Oracle',
  '/titles': 'Title Issuance & Escrow Settlement',
  '/revocations': 'Statutory Title Revocations',
  '/audit-logs': 'Immutable Audit History',
  '/evaluation': 'Fraud Simulations & Benchmarks',
  '/notifications': 'Admin MQTT Notifications',
  '/profile': 'Administrator Profile & Wallet',
};

export function isAdminRole(roleCode?: string | null): roleCode is AdminRole {
  return roleCode === ADMIN_ROLE;
}

export function isAdminPathname(pathname = ''): boolean {
  // With basename=/admin, pathname is already relative (e.g. '/', '/users')
  return true;
}

export function getAdminNavigation(roleCode?: string | null): AdminNavSection[] {
  if (!isAdminRole(roleCode)) return [];
  return [...ADMIN_NAV_ITEMS];
}

export function getAdminRedirectForUserRoute(
  pathname: string,
  roleCode?: string | null
): string {
  if (!isAdminRole(roleCode)) return '/dashboard';
  if (pathname === '/gis-map') return '/gis-validation';
  if (pathname === '/titles') return '/titles';
  if (pathname === '/notifications') return '/notifications';
  if (pathname === '/profile') return '/profile';
  return '/';
}
