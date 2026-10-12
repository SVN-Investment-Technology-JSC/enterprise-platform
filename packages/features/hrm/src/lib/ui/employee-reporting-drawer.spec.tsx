/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { CurrentManagerLine } from './employee-reporting-drawer';

const mockFetch = jest.fn();
jest.mock('../hrm-api', () => ({
  hrmFetch: (...args: unknown[]) => mockFetch(...args),
}));

const line = {
  id: 'l1',
  employeeId: 'e1',
  managerEmployeeId: 'm-old',
  managerName: 'Người cũ',
  managerCode: 'NV-OLD',
  relationType: 'DIRECT',
  effectiveFrom: '2025-01-01',
  effectiveTo: null,
  decisionId: null,
  decisionNo: null,
  source: 'DECISION',
  note: null,
};

describe('CurrentManagerLine', () => {
  beforeEach(() => mockFetch.mockReset());

  it('ưu tiên quản lý theo chức danh Core, kèm mã và chức danh của người quản lý', async () => {
    mockFetch.mockResolvedValue({
      data: {
        current: line,
        history: [line],
        manager: {
          employeeId: 'm1',
          name: 'Lê Thị Quản Lý',
          code: 'NV-QL',
          title: 'Trưởng phòng Kinh doanh',
          email: null,
          source: 'CORE_POSITION',
        },
      },
    });
    render(<CurrentManagerLine employeeId="e1" />);
    expect(await screen.findByText('Lê Thị Quản Lý (NV-QL)')).toBeTruthy();
    expect(screen.getByText('Trưởng phòng Kinh doanh')).toBeTruthy();
    expect(screen.queryByText(/Người cũ/)).toBeNull();
  });

  it('không có chức danh Core: dùng quan hệ báo cáo HRM; không có gì thì hiện Chưa có', async () => {
    mockFetch.mockResolvedValue({ data: { current: line, history: [line], manager: null } });
    const { unmount } = render(<CurrentManagerLine employeeId="e1" />);
    expect(await screen.findByText('Người cũ (NV-OLD)')).toBeTruthy();
    unmount();

    mockFetch.mockResolvedValue({ data: { current: null, history: [], manager: null } });
    render(<CurrentManagerLine employeeId="e2" />);
    await waitFor(() => expect(screen.getByText('Chưa có')).toBeTruthy());
  });
});
