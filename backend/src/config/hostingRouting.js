import path from 'node:path';

export function isAdminHtmlRequest({ method = 'GET', reqPath = '' } = {}) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const cleanPath = String(reqPath || '');
  if (cleanPath.startsWith('/admin/src/') || cleanPath.startsWith('/api/')) {
    return false;
  }
  if (cleanPath !== '/admin' && !cleanPath.startsWith('/admin/')) {
    return false;
  }
  return !path.extname(cleanPath);
}

export function isAdminRoutePath(pathname = '') {
  const cleanPath = String(pathname || '');
  return cleanPath === '/admin' || cleanPath.startsWith('/admin/');
}
