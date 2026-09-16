import {
  buildTenantEmail,
  sanitizeTenantEmailLocal,
} from './tenant-user-email';

describe('tenant user email', () => {
  it('keeps only the local part when a full email is pasted', () => {
    expect(sanitizeTenantEmailLocal(' member@another-company.com ')).toBe(
      'member',
    );
  });

  it('builds an email with the current tenant slug', () => {
    expect(buildTenantEmail('member', 'savina')).toBe('member@savina.com');
  });
});
