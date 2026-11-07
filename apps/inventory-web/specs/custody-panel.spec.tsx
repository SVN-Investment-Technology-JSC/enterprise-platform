import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CustodyPanel, custodyStateOf } from '@enterprise-platform/feature-inventory';

const mockLoadAssets = jest.fn();

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadCustodyAssets: () => mockLoadAssets(),
  loadAuditorCandidates: async () => [
    { id: 'emp-1', name: 'Bùi Công Quyền', code: 'SVN-001' },
    { id: 'emp-2', name: 'Huỳnh Thị Hồng Nhung', code: 'SVN-007' },
  ],
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  // Các hàm và ô nhập dùng chung là mã thuần, dùng bản thật để test khớp hành vi trên giao diện.
  ...jest.requireActual('../../../packages/shared/ui/src/lib/currency-format'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/vn-number-input'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/close-guard'),
  SearchableSelect: ({
    options,
    value,
    placeholder,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const asset = (patch: Record<string, unknown>) => ({
  id: String(patch.code),
  kind: 'ASSET',
  isActive: true,
  status: 'OPERATING',
  assetCategory: 'IT_OFFICE',
  ...patch,
});

const ASSETS = [
  asset({ code: 'TS-LAP-001', name: 'Laptop Dell', assignedEmployeeId: 'emp-1', assignedAt: '2026-11-02T00:00:00Z' }),
  asset({ code: 'TS-MON-001', name: 'Màn hình Dell', status: 'MAINTENANCE' }),
  asset({ code: 'TS-IND-001', name: 'Máy đo Megger', assetCategory: 'INDUSTRIAL' }),
  asset({ code: 'TS-OLD-001', name: 'Máy cũ', status: 'DISPOSED' }),
];

function setup(props: Partial<React.ComponentProps<typeof CustodyPanel>> = {}) {
  const onAssign = jest.fn().mockResolvedValue(true);
  const onDeclare = jest.fn().mockResolvedValue(true);
  render(<CustodyPanel canManage busy={false} onAssign={onAssign} onDeclare={onDeclare} {...props} />);
  return { onAssign, onDeclare };
}

describe('CustodyPanel', () => {
  beforeEach(() => mockLoadAssets.mockResolvedValue(ASSETS));
  afterEach(() => {
    cleanup();
    mockLoadAssets.mockReset();
  });

  it('suy ra tình trạng: đang sử dụng, bảo trì, tồn kho', () => {
    expect(custodyStateOf({ assignedEmployeeId: 'e', status: 'OPERATING' })).toBe('IN_USE');
    expect(custodyStateOf({ status: 'MAINTENANCE' })).toBe('MAINTENANCE');
    expect(custodyStateOf({ status: 'OPERATING' })).toBe('IN_STOCK');
    expect(custodyStateOf({})).toBe('IN_STOCK');
    expect(custodyStateOf({ status: 'DISPOSED' })).toBe('DISPOSED');
  });

  it('hiện cột Trạng thái cho mọi tài sản kèm số lượng ở ô lọc', async () => {
    setup();
    await screen.findByText('Laptop Dell');
    expect(screen.getByRole('columnheader', { name: 'Trạng thái' })).toBeTruthy();
    expect(screen.getByTestId('custody-state-IN_USE').textContent).toBe('Đang sử dụng');
    expect(screen.getByTestId('custody-state-MAINTENANCE').textContent).toBe('Bảo trì');
    expect(screen.getByTestId('custody-state-IN_STOCK').textContent).toBe('Tồn kho');
    expect(screen.getByRole('button', { name: 'Tất cả (4)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đang sử dụng (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bảo trì (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tồn kho (1)' })).toBeTruthy();
    expect(screen.getByText('Bùi Công Quyền (SVN-001)')).toBeTruthy();
  });

  it('lọc theo tình trạng', async () => {
    setup();
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getByRole('button', { name: 'Bảo trì (1)' }));
    expect(screen.getByText('Màn hình Dell')).toBeTruthy();
    expect(screen.queryByText('Laptop Dell')).toBeNull();
    expect(screen.queryByText('Máy đo Megger')).toBeNull();
  });

  it('hai trường tài sản và nhân viên chỉ nằm trong form cấp phát, không ở ngoài màn hình', async () => {
    setup();
    await screen.findByText('Laptop Dell');
    expect(screen.queryByText('Nhân viên nhận')).toBeNull();
    expect(screen.queryByText('Tài sản chưa cấp phát')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cấp phát' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Cấp phát tài sản' });
    expect(within(dialog).getByText(/Tài sản chưa cấp phát/)).toBeTruthy();
    expect(within(dialog).getByText(/Nhân viên nhận/)).toBeTruthy();
  });

  it('ô chọn tài sản chỉ có tài sản tồn kho, không có cái đang dùng hay bảo trì', async () => {
    setup();
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cấp phát' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Cấp phát tài sản' });
    const options = within(dialog)
      .getByLabelText('— Chọn tài sản —')
      .querySelectorAll('option');
    expect([...options].map((o) => o.textContent)).toEqual(['--', 'Máy đo Megger']);
  });

  it('cấp phát: chọn đủ hai trường mới bấm được, gọi onAssign rồi đóng form', async () => {
    const { onAssign } = setup();
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cấp phát' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Cấp phát tài sản' });
    const submit = within(dialog).getByRole('button', { name: 'Cấp phát' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('— Chọn tài sản —'), { target: { value: 'TS-IND-001' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('— Chọn nhân viên —'), { target: { value: 'emp-2' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign.mock.calls[0][0]).toMatchObject({ code: 'TS-IND-001' });
    expect(onAssign.mock.calls[0][1]).toBe('emp-2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cấp phát thất bại thì form vẫn mở và hiện lý do của Kho trong form', async () => {
    const { onAssign } = setup();
    onAssign.mockRejectedValue(new Error('Tài sản TS-IND-001 đang được cấp phát cho người khác.'));
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cấp phát' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Cấp phát tài sản' });
    fireEvent.change(within(dialog).getByLabelText('— Chọn tài sản —'), { target: { value: 'TS-IND-001' } });
    fireEvent.change(within(dialog).getByLabelText('— Chọn nhân viên —'), { target: { value: 'emp-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cấp phát' }));
    await waitFor(() => expect(onAssign).toHaveBeenCalled());
    await waitFor(() => expect(mockLoadAssets).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('dialog', { name: 'Cấp phát tài sản' })).toBeTruthy();
    const alert = await within(screen.getByRole('dialog', { name: 'Cấp phát tài sản' })).findByRole('alert');
    expect(alert.textContent).toContain('Tài sản TS-IND-001 đang được cấp phát cho người khác.');
    // Chọn lại và gửi lần nữa: lỗi cũ được xoá trước khi gửi.
    onAssign.mockResolvedValue(undefined);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cấp phát tài sản' })).getByRole('button', { name: 'Cấp phát' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('khai báo thất bại thì form vẫn mở và hiện lý do của Kho trong form', async () => {
    const { onDeclare } = setup();
    onDeclare.mockRejectedValue(new Error('Mã vật tư TS-LAP-009 đã tồn tại.'));
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getByRole('button', { name: 'Khai báo tài sản' }));
    const dialog = screen.getByRole('dialog', { name: 'Khai báo tài sản' });
    fireEvent.change(within(dialog).getByLabelText(/Mã tài sản/), { target: { value: 'ts-lap-009' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên tài sản/), { target: { value: 'Laptop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khai báo tài sản' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Mã vật tư TS-LAP-009 đã tồn tại.');
    expect((within(dialog).getByLabelText(/Tên tài sản/) as HTMLInputElement).value).toBe('Laptop');
  });

  it('nút Cấp phát ở dòng tồn kho mở form với tài sản đã chọn sẵn', async () => {
    setup();
    await screen.findByText('Máy đo Megger');
    const row = screen.getByText('Máy đo Megger').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Cấp phát' }));
    const dialog = screen.getByRole('dialog', { name: 'Cấp phát tài sản' });
    expect((within(dialog).getByLabelText('— Chọn tài sản —') as HTMLSelectElement).value).toBe('TS-IND-001');
    expect(within(screen.getByText('Laptop Dell').closest('tr') as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('khai báo tài sản: gửi mã viết hoa, nhóm, trạng thái hoạt động và giá', async () => {
    const { onDeclare } = setup();
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getByRole('button', { name: 'Khai báo tài sản' }));
    const dialog = screen.getByRole('dialog', { name: 'Khai báo tài sản' });
    const submit = within(dialog).getByRole('button', { name: 'Khai báo tài sản' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/Mã tài sản/), { target: { value: 'ts-lap-003' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên tài sản/), { target: { value: 'Laptop Lenovo' } });
    fireEvent.change(within(dialog).getByLabelText('— Chọn nhóm —'), { target: { value: 'IT_OFFICE' } });
    fireEvent.change(within(dialog).getByLabelText('Số sê-ri'), { target: { value: 'LN-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Giá mua/), { target: { value: '25000000' } });
    fireEvent.click(submit);

    await waitFor(() => expect(onDeclare).toHaveBeenCalledTimes(1));
    expect(onDeclare.mock.calls[0][0]).toEqual({
      code: 'TS-LAP-003',
      name: 'Laptop Lenovo',
      type: 'EQUIPMENT',
      status: 'OPERATING',
      assetCategory: 'IT_OFFICE',
      serialNumber: 'LN-1',
      unit: 'Cái',
      purchasePrice: 25000000,
      currency: 'VND',
    });
  });

  it('khai báo: giá âm bị chặn, thiếu mã hoặc tên thì không gửi được', async () => {
    const { onDeclare } = setup();
    await screen.findByText('Laptop Dell');
    fireEvent.click(screen.getByRole('button', { name: 'Khai báo tài sản' }));
    const dialog = screen.getByRole('dialog', { name: 'Khai báo tài sản' });
    fireEvent.change(within(dialog).getByLabelText(/Mã tài sản/), { target: { value: 'TS-X' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên tài sản/), { target: { value: 'X' } });
    fireEvent.change(within(dialog).getByLabelText(/Giá mua/), { target: { value: '-5' } });
    expect(within(dialog).getByRole('alert').textContent).toContain('không âm');
    expect((within(dialog).getByRole('button', { name: 'Khai báo tài sản' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onDeclare).not.toHaveBeenCalled();
  });

  it('không có quyền quản lý: chỉ xem, không có nút khai báo, cấp phát hay cột thao tác', async () => {
    setup({ canManage: false });
    await screen.findByText('Laptop Dell');
    expect(screen.queryByRole('button', { name: 'Khai báo tài sản' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cấp phát' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull();
  });

  it('nút Thu hồi vẫn ẩn', async () => {
    setup();
    await screen.findByText('Laptop Dell');
    expect(screen.queryByRole('button', { name: 'Thu hồi' })).toBeNull();
  });
});
