import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HrmCustodyPanel } from './hrm-custody-panel';

const mockHrmFetch = jest.fn();
let mockGranted = ['hrm.custody.manage'];

jest.mock('../hrm-api', () => ({
  hrmFetch: (...args: unknown[]) => mockHrmFetch(...args),
}));
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({ can: (permission: string) => mockGranted.includes(permission) }),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select aria-label="Chọn tài sản" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const held = [
  { id: 'a1', code: 'TS-001', name: 'Laptop Dell', assetCategory: 'IT_OFFICE', assignedAt: '2026-10-01T00:00:00Z' },
];
const free = [{ id: 'a2', code: 'TS-002', name: 'Màn hình Dell' }];

function route(overrides: Record<string, unknown> = {}) {
  mockHrmFetch.mockImplementation(async (path: string) => {
    if (path in overrides) return overrides[path];
    if (path === '/custody/assignable') return free;
    return held;
  });
}

describe('HrmCustodyPanel', () => {
  beforeEach(() => {
    mockHrmFetch.mockReset();
    mockGranted = ['hrm.custody.manage'];
  });

  it('đọc qua API HRM theo nhân viên và liệt kê tài sản được cấp', async () => {
    route();
    render(<HrmCustodyPanel employeeId="emp 1" />);

    expect(await screen.findByText('Laptop Dell')).toBeTruthy();
    expect(screen.getByText('TS-001')).toBeTruthy();
    expect(screen.getByText('Thiết bị CNTT, văn phòng')).toBeTruthy();
    expect(mockHrmFetch).toHaveBeenCalledWith('/employees/emp%201/custody');
  });

  it('báo chưa được cấp khi danh sách rỗng', async () => {
    route({ '/employees/emp-1/custody': [] });
    render(<HrmCustodyPanel employeeId="emp-1" />);
    expect(await screen.findByText('Chưa được cấp phát vật tư, tài sản nào.')).toBeTruthy();
  });

  it('báo lỗi từ API, không hiện như danh sách rỗng', async () => {
    mockHrmFetch.mockRejectedValue(new Error('Bạn không còn quyền thực hiện thao tác này.'));
    render(<HrmCustodyPanel employeeId="emp-1" />);
    expect((await screen.findByRole('alert')).textContent).toContain('không còn quyền');
    expect(screen.queryByText('Chưa được cấp phát vật tư, tài sản nào.')).toBeNull();
  });

  it('chỉ xem: không có nút cấp hay thu hồi dù có quyền', async () => {
    route();
    render(<HrmCustodyPanel employeeId="emp-1" readOnly onStage={jest.fn()} />);
    await screen.findByText('Laptop Dell');
    expect(screen.queryByText('Cấp tài sản')).toBeNull();
    expect(screen.queryByText('Thu hồi')).toBeNull();
    expect(mockHrmFetch).not.toHaveBeenCalledWith('/custody/assignable');
  });

  it('chế độ sửa nhưng thiếu quyền hrm.custody.manage: không có nút cấp hay thu hồi', async () => {
    mockGranted = [];
    route();
    render(<HrmCustodyPanel employeeId="emp-1" readOnly={false} onStage={jest.fn()} />);
    await screen.findByText('Laptop Dell');
    expect(screen.queryByText('Cấp tài sản')).toBeNull();
    expect(screen.queryByText('Thu hồi')).toBeNull();
  });

  it('chế độ sửa: chọn tài sản rồi cấp thì ghi nhận thay đổi, chưa gọi API ghi', async () => {
    route();
    const onStage = jest.fn();
    render(<HrmCustodyPanel employeeId="emp-1" readOnly={false} onStage={onStage} />);
    await screen.findByText('Laptop Dell');
    await screen.findByText('Màn hình Dell');

    fireEvent.change(screen.getByLabelText('Chọn tài sản'), { target: { value: 'TS-002' } });
    fireEvent.click(screen.getByText('Cấp tài sản'));

    expect(onStage).toHaveBeenCalledTimes(1);
    const change = onStage.mock.calls[0][0];
    expect(change.custody).toEqual({ code: 'TS-002', action: 'assign' });
    expect(mockHrmFetch).not.toHaveBeenCalledWith('/employees/emp-1/custody', expect.anything());

    await change.run();
    expect(mockHrmFetch).toHaveBeenCalledWith('/employees/emp-1/custody', {
      method: 'POST',
      body: JSON.stringify({ materialCode: 'TS-002' }),
    });
  });

  it('chế độ sửa: thu hồi ghi nhận thay đổi và chạy đúng route thu hồi', async () => {
    route();
    const onStage = jest.fn();
    render(<HrmCustodyPanel employeeId="emp-1" readOnly={false} onStage={onStage} />);
    await screen.findByText('Laptop Dell');

    fireEvent.click(screen.getByText('Thu hồi'));
    const change = onStage.mock.calls[0][0];
    expect(change.custody).toEqual({ code: 'TS-001', action: 'revoke' });

    await change.run();
    await waitFor(() =>
      expect(mockHrmFetch).toHaveBeenCalledWith('/employees/emp-1/custody/TS-001/revoke', { method: 'POST' }),
    );
  });

  it('đánh dấu dòng chờ thu hồi và ẩn tài sản đã chờ cấp khỏi ô chọn', async () => {
    route();
    render(
      <HrmCustodyPanel
        employeeId="emp-1"
        readOnly={false}
        onStage={jest.fn()}
        stagedCustody={[
          { code: 'TS-001', action: 'revoke' },
          { code: 'TS-002', action: 'assign' },
        ]}
      />,
    );
    await screen.findByText('Laptop Dell');
    expect(screen.getByText('Chờ thu hồi')).toBeTruthy();
    await waitFor(() => expect(mockHrmFetch).toHaveBeenCalledWith('/custody/assignable'));
    expect(screen.queryByText('Màn hình Dell')).toBeNull();
  });
});
