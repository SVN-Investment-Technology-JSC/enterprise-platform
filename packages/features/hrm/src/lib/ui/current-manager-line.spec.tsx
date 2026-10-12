/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { CurrentManagerLine } from './current-manager-line';

const mockFetch = jest.fn();
jest.mock('../hrm-api', () => ({
  hrmFetch: (...args: unknown[]) => mockFetch(...args),
}));

describe('CurrentManagerLine', () => {
  beforeEach(() => mockFetch.mockReset());

  it('hiện quản lý theo chức danh Core, kèm mã và chức danh của người quản lý', async () => {
    mockFetch.mockResolvedValue({
      data: {
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
    expect(screen.queryByText(/Duyệt mặc định/)).toBeNull();
  });

  it('Tổng giám đốc dự phòng được ghi chú là duyệt mặc định', async () => {
    mockFetch.mockResolvedValue({
      data: {
        manager: {
          employeeId: 'm2',
          name: 'Hà Nguyên Hoàng',
          code: 'NV-TGD',
          title: 'Tổng Giám đốc',
          email: null,
          source: 'CHIEF_FALLBACK',
        },
      },
    });
    render(<CurrentManagerLine employeeId="e1" />);
    expect(await screen.findByText('Hà Nguyên Hoàng (NV-TGD)')).toBeTruthy();
    expect(screen.getByText(/Duyệt mặc định/)).toBeTruthy();
  });

  it('không xác định được quản lý thì hiện Chưa có', async () => {
    mockFetch.mockResolvedValue({ data: { manager: null } });
    render(<CurrentManagerLine employeeId="e2" />);
    await waitFor(() => expect(screen.getByText('Chưa có')).toBeTruthy());
  });
});
