import { tenantSlugFromEmail } from './tenant-login';

describe('tenantSlugFromEmail', () => {
  it.each([
    ['user@savina.com', 'savina'],
    ['USER@ACME-GROUP.COM', 'acme-group'],
    ['  user@tenant1.com  ', 'tenant1'],
    ['admin@savina.local', 'savina'],
  ])('resolves the tenant slug from %s', (email, expected) => {
    expect(tenantSlugFromEmail(email)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'user@tenant.vn',
    'user@sub.tenant.com',
    'user@tenant_.com',
    'user@tenant.dev',
    'tenant.com',
  ])('rejects an unsupported tenant email: %s', (email) => {
    expect(tenantSlugFromEmail(email)).toBeUndefined();
  });
});
