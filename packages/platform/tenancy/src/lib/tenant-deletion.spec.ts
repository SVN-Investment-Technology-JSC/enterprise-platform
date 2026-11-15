import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  TenantDeletionError,
  TenantDeletionService,
  type TenantDeletionDependencies,
} from './tenant-deletion';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const admin = {
  kind: 'platform-admin',
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
} as AuthenticatedPrincipal;
const tenantUser = { ...admin, kind: 'tenant-user' } as AuthenticatedPrincipal;
const csrf = { header: 'csrf', cookie: 'csrf' };
const input = { confirmSlug: 'savina', previewToken: 'preview-token-123456' };

/** Pool giả trả về một phiên Platform Admin với cờ có quyền xoá tenant hay không. */
function makeService(options: { enabled: boolean; permitted: boolean }) {
  const query = jest.fn().mockResolvedValue({ rows: [{ csrf_token_hash: 'x', permitted: options.permitted }] });
  const dependencies = {
    enabled: () => options.enabled,
    drainSeconds: () => 60,
  } as unknown as TenantDeletionDependencies;
  return new TenantDeletionService({ query } as unknown as ConstructorParameters<typeof TenantDeletionService>[0], dependencies);
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as TenantDeletionError;
  }
  throw new Error('Expected rejection');
}

describe('TenantDeletionService checks permission before the feature flag (ISS-BE-054)', () => {
  it.each([
    ['preview', (s: TenantDeletionService, p: AuthenticatedPrincipal) => s.preview(TENANT, p)],
    ['request', (s: TenantDeletionService, p: AuthenticatedPrincipal) => s.request(TENANT, input, 'idem-key-1234567890', p, csrf)],
    ['retry', (s: TenantDeletionService, p: AuthenticatedPrincipal) => s.retry(TENANT, p, csrf)],
  ])('SEC-BE054-01: %s by a tenant user while deletion is disabled is 403, not DELETION_DISABLED', async (_, call) => {
    const error = await failure(call(makeService({ enabled: false, permitted: false }), tenantUser));
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('SEC-BE054-01: a platform admin without platform.tenants.delete is 403 while disabled', async () => {
    const error = await failure(makeService({ enabled: false, permitted: false }).preview(TENANT, admin));
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('SEC-BE054-03: a permitted platform admin still gets 503 DELETION_DISABLED', async () => {
    const error = await failure(makeService({ enabled: false, permitted: true }).preview(TENANT, admin));
    expect(error).toMatchObject({ status: 503, code: 'DELETION_DISABLED' });
  });
});
