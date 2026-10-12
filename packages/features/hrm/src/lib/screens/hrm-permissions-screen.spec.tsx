/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { authFetch } from '@enterprise-platform/shared-ui';
import {
  ROLE_TEMPLATE_SYNC_URL,
  ROLE_TEMPLATE_URL,
  normalizeSeedResult,
  summarizeSeedResult,
} from '../hrm-role-template-sync';
import HrmPermissionsScreen from './hrm-permissions-screen';

jest.mock('antd', () => ({ Table: () => <div data-testid="table" /> }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  authFetch: jest.fn(),
}));
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({ can: () => true, any: () => true, actions: [], loading: false, error: '', displayName: '' }),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

let isAdmin = true;
let syncResponse: Response;

beforeEach(() => {
  isAdmin = true;
  syncResponse = json(200, {
    created: [],
    skipped: ['HRM - Nhân viên'],
    updated: [{ name: 'HRM - Trưởng bộ phận', added: ['hrm.self.read'], removed: ['hrm.request.read'] }],
  });
  authFetchMock.mockReset();
  authFetchMock.mockImplementation((async (url: string) => {
    if (String(url).includes('/me')) return json(200, { roles: isAdmin ? ['tenant-admin'] : [] });
    return syncResponse;
  }) as never);
});

describe('HrmPermissionsScreen role template sync', () => {
  it('normalizes and summarizes the seed result', () => {
    expect(normalizeSeedResult(null)).toEqual({ created: [], updated: [], skipped: [] });
    const result = normalizeSeedResult({ created: ['A'], skipped: ['B', 3], updated: [{ name: 'C', added: ['x'] }, { bad: 1 }] });
    expect(result).toEqual({ created: ['A'], skipped: ['B'], updated: [{ name: 'C', added: ['x'], removed: [] }] });
    expect(summarizeSeedResult(result)).toBe('Đã tạo 1 vai trò mẫu, cập nhật 1, giữ nguyên 1.');
    expect(ROLE_TEMPLATE_SYNC_URL).toBe(`${ROLE_TEMPLATE_URL}?sync=true`);
  });

  it('asks for confirmation, calls the sync URL and lists added and removed permissions', async () => {
    render(<HrmPermissionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đồng bộ vai trò mẫu' }));
    expect(await screen.findByText(/bị GỠ khỏi vai trò/)).toBeTruthy();
    expect(authFetchMock.mock.calls.some(([url]) => String(url).includes('sync=true'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Đồng bộ' }));
    await waitFor(() => expect(authFetchMock.mock.calls.some(([url]) => url === ROLE_TEMPLATE_SYNC_URL)).toBe(true));
    const list = await screen.findByRole('list', { name: 'Vai trò mẫu đã cập nhật' });
    expect(within(list).getByText('HRM - Trưởng bộ phận')).toBeTruthy();
    expect(list.textContent).toContain('thêm hrm.self.read');
    expect(list.textContent).toContain('gỡ hrm.request.read');
    expect(screen.getByRole('status').textContent).toContain('cập nhật 1');
    const call = authFetchMock.mock.calls.find(([url]) => url === ROLE_TEMPLATE_SYNC_URL);
    expect((call?.[1] as RequestInit).method).toBe('POST');
  });

  it('shows the forbidden message when the backend refuses the sync', async () => {
    syncResponse = json(403, {});
    render(<HrmPermissionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đồng bộ vai trò mẫu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng bộ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chỉ quản trị viên tenant');
  });

  it('hides the template buttons when the session is not a tenant admin', async () => {
    isAdmin = false;
    render(<HrmPermissionsScreen />);
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đồng bộ vai trò mẫu' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Tạo vai trò mẫu HRM' })).toBeNull();
  });
});
