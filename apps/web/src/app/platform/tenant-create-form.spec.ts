import {
  organizationNamePatch,
  sanitizeEmailLocal,
  tenantAdminEmail,
  tenantSlugPatch,
} from './tenant-create-form';

describe('tenant creation form rules', () => {
  it('does not derive the tenant slug from the organization name', () => {
    expect(organizationNamePatch('Công ty Savina')).toEqual({
      name: 'Công ty Savina',
    });
  });

  it('derives database defaults only when the tenant slug is entered', () => {
    expect(tenantSlugPatch('savina-group')).toEqual({
      slug: 'savina-group',
      databaseName: 'savina_group',
      secretRef: 'TENANT_SAVINA_GROUP_DATABASE_URL',
    });
  });

  it('prevents an extra @ and composes the fixed tenant email domain', () => {
    const local = sanitizeEmailLocal('admin@');
    expect(local).toBe('admin');
    expect(sanitizeEmailLocal('admin@domain-khac.com')).toBe('admin');
    expect(tenantAdminEmail(local, 'savina')).toBe('admin@savina.com');
  });
});
