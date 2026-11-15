import { emptyDataImportDataset } from '@enterprise-platform/contracts-data-import';
import { validateImportDataset, type ExistingCoreImportState } from './data-import-validation';

jest.mock('@enterprise-platform/platform-identity', () => ({
  tenantSlugFromEmail: jest.requireActual('../../../identity/src/lib/tenant-login').tenantSlugFromEmail,
}));

const existing: ExistingCoreImportState = {
  userEmails: new Set(),
  nodeTypeCodes: new Set(),
  treeCodes: new Set(),
  nodeCodes: new Set(),
  assignmentKeys: new Set(),
};

function userIssues(email: string, temporaryPassword: string) {
  const dataset = {
    ...emptyDataImportDataset(),
    users: [{ fullName: 'Nguyễn Văn An', email, temporaryPassword, systemRole: 'tenant-user' as const }],
  };
  return validateImportDataset(dataset, existing, { tenantSlug: 'savinajsc' })
    .filter((issue) => issue.level === 'error')
    .map((issue) => issue.code);
}

describe('validateImportDataset users', () => {
  it('ISS-BE-055: rejects emails outside the tenant domain', () => {
    expect(userIssues('an@gmail.com', 'Savina2026x')).toEqual(['USER_EMAIL_TENANT_MISMATCH']);
    expect(userIssues('an@savinajsc.com', 'Savina2026x')).toEqual([]);
  });

  it('ISS-BE-052: applies the shared password policy to temporary passwords', () => {
    expect(userIssues('an@savinajsc.com', '123456')).toEqual(['USER_PASSWORD_INVALID']);
    expect(userIssues('an@savinajsc.com', 'password1')).toEqual(['USER_PASSWORD_INVALID']);
  });
});
