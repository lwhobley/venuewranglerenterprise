import { describe, expect, it } from 'vitest';
import { isBlockedSsoHost } from './public-https-url';

describe('isBlockedSsoHost', () => {
  it.each([
    'localhost',
    'idp.localhost',
    'metadata.google.internal',
    '127.0.0.1',
    '10.0.0.3',
    '192.168.1.9',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.1',
    '::1',
    'fe80::1',
    'fd12:3456::1',
  ])('blocks %s', (host) => {
    expect(isBlockedSsoHost(host)).toBe(true);
  });

  it.each(['login.microsoftonline.com', 'accounts.google.com', 'idp.example.com', '172.32.0.1'])(
    'allows %s',
    (host) => {
      expect(isBlockedSsoHost(host)).toBe(false);
    },
  );
});
