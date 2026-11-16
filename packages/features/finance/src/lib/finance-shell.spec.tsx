/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FinanceCapabilities } from '@enterprise-platform/contracts-finance';
import { FinanceApiError, financeFetch } from './finance-api';
import { FinanceShell } from './finance-shell';

let mockPath = '/modules/finance';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@enterprise-platform/feature-module-shell', () => ({
  ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('./finance-api', () => {
  const actual = jest.requireActual('./finance-api');
  return { ...actual, financeFetch: jest.fn() };
});
const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;

const caps = (over: Partial<FinanceCapabilities> = {}): FinanceCapabilities => ({
  canManage: false,
  canReadAll: false,
  receipt: { create: false, approve: false },
  payment: { create: false, approve: false },
  transfer: { create: false, approve: false },
  canManageAccounts: false,
  canReadReports: false,
  canManageSettings: false,
  procedureAvailable: false,
  ...over,
});

beforeEach(() => fetchMock.mockReset());

describe('FinanceShell theo quyền (ISS-UI-022)', () => {
  it('không có quyền Tài chính (403): thông báo tiếng Việt, không phải lỗi kỹ thuật', async () => {
    mockPath = '/modules/finance';
    fetchMock.mockRejectedValue(new FinanceApiError('Forbidden', 403));
    render(<FinanceShell><p>Nội dung</p></FinanceShell>);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Bạn chưa được cấp quyền dùng phân hệ Tài chính.');
    expect(alert.textContent).not.toContain('Forbidden');
    expect(screen.queryByText('Nội dung')).toBeNull();
  });

  it('người chỉ duyệt phiếu thu mở màn lập phiếu thu: báo chưa được cấp quyền, không hiện form', async () => {
    mockPath = '/modules/finance/receipts/new';
    fetchMock.mockResolvedValue(caps({ receipt: { create: false, approve: true } }));
    render(<FinanceShell><p>Form lập phiếu</p></FinanceShell>);
    expect((await screen.findByRole('alert')).textContent).toContain('chưa được cấp quyền');
    expect(screen.queryByText('Form lập phiếu')).toBeNull();
  });

  it('người được lập phiếu thu thấy form', async () => {
    mockPath = '/modules/finance/receipts/new';
    fetchMock.mockResolvedValue(caps({ receipt: { create: true, approve: false } }));
    render(<FinanceShell><p>Form lập phiếu</p></FinanceShell>);
    expect(await screen.findByText('Form lập phiếu')).toBeTruthy();
  });
});
