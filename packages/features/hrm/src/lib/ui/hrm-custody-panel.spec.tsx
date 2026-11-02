import { render, screen } from '@testing-library/react';
import { HrmCustodyPanel } from './hrm-custody-panel';

function mockFetch(status: number, body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('HrmCustodyPanel', () => {
  it('gọi API Kho theo nhân viên và liệt kê tài sản được cấp', async () => {
    const fetchMock = mockFetch(200, [
      { id: 'a1', code: 'TS-001', name: 'Laptop Dell', assetCategory: 'IT_OFFICE', assignedAt: '2026-10-01T00:00:00Z' },
    ]);
    render(<HrmCustodyPanel employeeId="emp 1" />);

    expect(await screen.findByText('Laptop Dell')).toBeTruthy();
    expect(screen.getByText('TS-001')).toBeTruthy();
    expect(screen.getByText('Thiết bị CNTT, văn phòng')).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/inventory/v1/custody/employees/emp%201');
  });

  it('báo chưa được cấp khi danh sách rỗng', async () => {
    mockFetch(200, []);
    render(<HrmCustodyPanel employeeId="emp-1" />);
    expect(await screen.findByText('Chưa được cấp phát vật tư, tài sản nào.')).toBeTruthy();
  });

  it('báo thiếu quyền khi Kho trả 403, không hiện như danh sách rỗng', async () => {
    mockFetch(403, {});
    render(<HrmCustodyPanel employeeId="emp-1" />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('không có quyền'));
    expect(screen.queryByText('Chưa được cấp phát vật tư, tài sản nào.')).toBeNull();
  });
});
