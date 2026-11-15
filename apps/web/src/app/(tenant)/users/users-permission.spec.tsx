import { render, screen } from '@testing-library/react';
import { StoreProvider } from '@/store/store-provider';
import TenantUsersPage from './page';
import { TenantUsers } from './tenant-users';

const redirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next/headers', () => ({
  cookies: async () => ({ toString: (): string => 'ep_access=token' }),
}));

jest.mock('@enterprise-platform/shared-ui', () => {
  const actual = jest.requireActual('@enterprise-platform/shared-ui');
  return {
    ...actual,
    authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ users: [] }) })),
  };
});

function principal(permissions: string[]) {
  return { kind: 'tenant-user', tenantSlug: 'acme', roles: [], permissions };
}

describe('Người dùng: ẩn nút ghi và báo chưa được cấp quyền (ISS-UI-022)', () => {
  beforeEach(() => {
    redirect.mockReset();
  });

  // SEC-UI022-03
  it('không có core.users.read thì hiện thông báo tiếng Việt thay cho lỗi kỹ thuật', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => principal([]) });
    render(await TenantUsersPage());
    expect(screen.getByRole('alert').textContent).toContain('Bạn chưa được cấp quyền xem danh sách người dùng');
  });

  // SEC-UI022-01, SEC-UI022-02
  it('chỉ có quyền đọc thì không thấy nút Thêm người dùng', () => {
    render(
      <StoreProvider>
        <TenantUsers tenantSlug="acme" permissions={['core.users.read']} />
      </StoreProvider>,
    );
    expect(screen.queryByRole('button', { name: /Thêm người dùng/ })).toBeNull();
  });

  it('có core.users.create thì thấy nút Thêm người dùng', () => {
    render(
      <StoreProvider>
        <TenantUsers tenantSlug="acme" permissions={['core.users.read', 'core.users.create']} />
      </StoreProvider>,
    );
    expect(screen.getByRole('button', { name: /Thêm người dùng/ })).not.toBeNull();
  });
});
