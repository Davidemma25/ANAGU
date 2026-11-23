export const CITIZEN_ROLE = 'CITIZEN' as const;

export type AnaguRole = typeof CITIZEN_ROLE;

export function getDefaultHomeRoute(_roleCode?: string | null): string {
  return '/dashboard';
}
