/** Only locally bound loopback HTTP is acceptable without TLS. All remote enrollment uses HTTPS. */
export function isAllowedEnrollmentUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash || u.search) return false;
    if (u.pathname !== '/api/device/enroll') return false;
    if (u.protocol === 'https:') return Boolean(u.hostname);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch { return false; }
}
