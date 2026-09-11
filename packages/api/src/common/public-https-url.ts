const PRIVATE_V4 =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|255\.255\.255\.255$)/;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[0-1])\./;
const BLOCKED_NAME = /^(localhost|metadata\.google\.internal)$/;
const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|arpa)$/i;

export function isBlockedSsoHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_NAME.test(host) || BLOCKED_SUFFIX.test(host)) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return host.includes(':');
  }
  return PRIVATE_V4.test(host) || PRIVATE_172.test(host);
}
