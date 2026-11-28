import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from '@enterprise-platform/shared-ui';
import {
  StorageLocationPanel,
  describeLevels,
  draftsSignature,
  effectiveLevels,
  splitLocationText,
  summarizePrimary,
  toDraft,
  toInputs,
} from '@enterprise-platform/feature-inventory';

const mockLoad = jest.fn();
const mockReplace = jest.fn();

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadMaterialStorageLocations: (code: string) => mockLoad(code),
  replaceMaterialStorageLocations: (code: string, warehouse: string, locations: unknown) =>
    mockReplace(code, warehouse, locations),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
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
    <select aria-label={placeholder ?? 'Chọn'} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const warehouse = (code: string, patch: Record<string, unknown> = {}) => ({
  id: code,
  code,
  name: `Kho ${code}`,
  type: 'PHYSICAL' as const,
  isActive: true,
  ...patch,
});

const stored = (patch: Record<string, unknown>) => ({
  id: String(patch.locationText) + String(patch.warehouseCode),
  warehouseName: `Kho ${patch.warehouseCode}`,
  materialCode: 'VT-001',
  materialName: 'Vòng bi',
  isPrimary: true,
  updatedAt: '2026-11-20T00:00:00.000Z',
  ...patch,
});

const material = { code: 'VT-001', kind: 'STOCK' as const };

beforeEach(() => {
  mockLoad.mockReset();
  mockReplace.mockReset();
  jest.mocked(toast.success).mockClear();
  jest.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

describe('mô hình vị trí lưu trữ (feature)', () => {
  it('tên cấp có hiệu lực: cấp riêng của kho thắng mẫu tenant; mảng rỗng là không chia cấp', () => {
    expect(effectiveLevels({ locationLevels: undefined }, ['Khu', 'Kệ'])).toEqual(['Khu', 'Kệ']);
    expect(effectiveLevels({ locationLevels: ['Dãy'] }, ['Khu', 'Kệ'])).toEqual(['Dãy']);
    expect(effectiveLevels({ locationLevels: [] }, ['Khu', 'Kệ'])).toEqual([]);
    expect(describeLevels(['Khu', 'Kệ'])).toBe('Khu / Kệ');
    expect(describeLevels([])).toBe('Không chia cấp');
  });

  it('tách chuỗi chỉ theo / và >, giữ mã có gạch ngang', () => {
    expect(splitLocationText('Khu A / Kệ 3 > Ngăn 2')).toEqual(['Khu A', 'Kệ 3', 'Ngăn 2']);
    expect(splitLocationText('A-03-02')).toEqual(['A-03-02']);
  });

  it('dòng sửa: đệm đủ số ô, giữ phần dư khi chuỗi nhiều cấp hơn kho, chuỗi tự do thành một ô', () => {
    const long = stored({ warehouseCode: 'A', locationText: 'a / b / c / d' });
    expect(toDraft(long as never, ['Khu', 'Kệ']).parts).toEqual(['a', 'b', 'c', 'd']);
    const short = stored({ warehouseCode: 'A', locationText: 'gần cửa' });
    expect(toDraft(short as never, ['Khu', 'Kệ', 'Ngăn']).parts).toEqual(['gần cửa', '', '']);
    expect(toDraft(short as never, []).parts).toEqual([]);
  });

  it('yêu cầu gửi: bỏ dòng trống, ghép chuỗi theo cấp, có segments khi kho chia cấp', () => {
    const levels = ['Khu', 'Kệ'];
    const drafts = [
      { key: '1', parts: ['A', '3'], text: '', isPrimary: true, note: ' nặng ' },
      { key: '2', parts: ['', ''], text: '', isPrimary: false, note: '' },
    ];
    expect(toInputs(drafts, levels)).toEqual([
      { locationText: 'A / 3', segments: ['A', '3'], isPrimary: true, note: 'nặng' },
    ]);
    expect(toInputs([{ key: '3', parts: [], text: ' Tủ  hóa chất ', isPrimary: true, note: '' }], [])).toEqual([
      { locationText: 'Tủ hóa chất', segments: undefined, isPrimary: true, note: undefined },
    ]);
  });

  it('chữ ký đổi khi nội dung đổi, không đổi khi chỉ khác khóa dòng hay dòng trống', () => {
    const a = [{ key: '1', parts: ['A', '3'], text: '', isPrimary: true, note: '' }];
    const same = [
      { key: 'khác', parts: ['A', '3'], text: '', isPrimary: true, note: '' },
      { key: 'trống', parts: ['', ''], text: '', isPrimary: false, note: '' },
    ];
    const changed = [{ key: '1', parts: ['A', '4'], text: '', isPrimary: true, note: '' }];
    expect(draftsSignature(same, ['Khu', 'Kệ'])).toBe(draftsSignature(a, ['Khu', 'Kệ']));
    expect(draftsSignature(changed, ['Khu', 'Kệ'])).not.toBe(draftsSignature(a, ['Khu', 'Kệ']));
  });

  it('tóm tắt vị trí chính của từng kho', () => {
    expect(
      summarizePrimary([
        stored({ warehouseCode: 'A', locationText: 'Kệ 3' }),
        stored({ warehouseCode: 'A', locationText: 'Kệ 4', isPrimary: false }),
        stored({ warehouseCode: 'B', locationText: 'Dãy 1' }),
      ] as never),
    ).toBe('A: Kệ 3; B: Dãy 1');
  });
});

describe('StorageLocationPanel', () => {
  it('mặt hàng ở hai kho: mỗi kho một khối, kho chia cấp hiện ô theo tên cấp, kho không chia cấp hiện một ô', async () => {
    mockLoad.mockResolvedValue([
      stored({ warehouseCode: 'A', locationText: 'Khu A / Kệ 3', segments: ['Khu A', 'Kệ 3'] }),
      stored({ warehouseCode: 'B', locationText: 'gần cửa' }),
    ]);
    render(
      <StorageLocationPanel
        material={material}
        warehouses={[warehouse('A'), warehouse('B', { locationLevels: [] })]}
        templateLevels={['Khu', 'Kệ']}
        canManage
      />,
    );
    expect(await screen.findByLabelText('Khu của vị trí 1 ở kho A')).toHaveProperty('value', 'Khu A');
    expect(screen.getByLabelText('Kệ của vị trí 1 ở kho A')).toHaveProperty('value', 'Kệ 3');
    expect(screen.getByLabelText('Vị trí 1 ở kho B')).toHaveProperty('value', 'gần cửa');
    expect(screen.getByText('Cấp: Khu / Kệ (theo mẫu chung)')).toBeTruthy();
    expect(screen.getByText('Cấp: Không chia cấp (riêng của kho)')).toBeTruthy();
    expect(mockLoad).toHaveBeenCalledWith('VT-001');
  });

  it('kho có cấp riêng thắng mẫu tenant, không giới hạn số cấp', async () => {
    mockLoad.mockResolvedValue([stored({ warehouseCode: 'A', locationText: 'a / b / c / d / e / f / g' })]);
    render(
      <StorageLocationPanel
        material={material}
        warehouses={[warehouse('A', { locationLevels: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] })]}
        templateLevels={['Khu']}
        canManage
      />,
    );
    expect(await screen.findByLabelText('C7 của vị trí 1 ở kho A')).toHaveProperty('value', 'g');
  });

  it('sửa một ô rồi lưu: gửi chuỗi ghép, các cấp và vị trí chính; chỉ nút Lưu bật khi có thay đổi', async () => {
    mockLoad.mockResolvedValue([
      stored({ warehouseCode: 'A', locationText: 'Khu A / Kệ 3', segments: ['Khu A', 'Kệ 3'] }),
    ]);
    mockReplace.mockResolvedValue([
      stored({ warehouseCode: 'A', locationText: 'Khu A / Kệ 9', segments: ['Khu A', 'Kệ 9'] }),
    ]);
    const onChanged = jest.fn();
    render(
      <StorageLocationPanel
        material={material}
        warehouses={[warehouse('A')]}
        templateLevels={['Khu', 'Kệ']}
        canManage
        onChanged={onChanged}
      />,
    );
    const save = await screen.findByRole('button', { name: 'Lưu vị trí' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Kệ của vị trí 1 ở kho A'), { target: { value: 'Kệ 9' } });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('VT-001', 'A', [
      { locationText: 'Khu A / Kệ 9', segments: ['Khu A', 'Kệ 9'], isPrimary: true, note: undefined },
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect((await screen.findByLabelText('Kệ của vị trí 1 ở kho A')) as HTMLInputElement).toHaveProperty('value', 'Kệ 9');
  });

  it('thêm vị trí thứ hai và đổi vị trí chính', async () => {
    mockLoad.mockResolvedValue([stored({ warehouseCode: 'A', locationText: 'Kệ 1' })]);
    mockReplace.mockResolvedValue([]);
    render(<StorageLocationPanel material={material} warehouses={[warehouse('A', { locationLevels: [] })]} canManage />);
    await screen.findByLabelText('Vị trí 1 ở kho A');
    fireEvent.click(screen.getByRole('button', { name: /Thêm vị trí$/ }));
    fireEvent.change(screen.getByLabelText('Vị trí 2 ở kho A'), { target: { value: 'Kệ 2' } });
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vị trí' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('VT-001', 'A', [
      { locationText: 'Kệ 1', segments: undefined, isPrimary: false, note: undefined },
      { locationText: 'Kệ 2', segments: undefined, isPrimary: true, note: undefined },
    ]);
  });

  it('xóa hết dòng rồi lưu: gửi danh sách rỗng và báo đã xóa', async () => {
    mockLoad.mockResolvedValue([stored({ warehouseCode: 'A', locationText: 'Kệ 1' })]);
    mockReplace.mockResolvedValue([]);
    render(<StorageLocationPanel material={material} warehouses={[warehouse('A', { locationLevels: [] })]} canManage />);
    await screen.findByLabelText('Vị trí 1 ở kho A');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa vị trí 1 ở kho A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vị trí' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('VT-001', 'A', []));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã xóa vị trí của VT-001 ở kho A.'));
    expect(await screen.findByText('Chưa khai vị trí ở kho nào.')).toBeTruthy();
  });

  it('thêm vị trí ở kho khác qua ô chọn; kho trung chuyển và kho ngừng dùng không có trong ô chọn', async () => {
    mockLoad.mockResolvedValue([]);
    mockReplace.mockResolvedValue([stored({ warehouseCode: 'B', locationText: 'Dãy 1' })]);
    render(
      <StorageLocationPanel
        material={material}
        warehouses={[
          warehouse('A', { locationLevels: [] }),
          warehouse('B', { locationLevels: [] }),
          warehouse('TC', { type: 'VIRTUAL_IN_TRANSIT' }),
          warehouse('OLD', { isActive: false }),
        ]}
        canManage
      />,
    );
    const picker = (await screen.findByLabelText('Thêm vị trí ở kho khác…')) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['', 'A', 'B']);
    fireEvent.change(picker, { target: { value: 'B' } });
    fireEvent.change(await screen.findByLabelText('Vị trí 1 ở kho B'), { target: { value: 'Dãy 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vị trí' }));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('VT-001', 'B', [
        { locationText: 'Dãy 1', segments: undefined, isPrimary: true, note: undefined },
      ]),
    );
  });

  it('dịch vụ không có vị trí lưu trữ và không gọi server', async () => {
    render(<StorageLocationPanel material={{ code: 'DV-1', kind: 'SERVICE' }} warehouses={[warehouse('A')]} canManage />);
    expect(screen.getByText('Dịch vụ không có vị trí lưu trữ.')).toBeTruthy();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('không có quyền sửa: ô bị khóa, không có nút lưu hay thêm', async () => {
    mockLoad.mockResolvedValue([stored({ warehouseCode: 'A', locationText: 'Kệ 1' })]);
    render(<StorageLocationPanel material={material} warehouses={[warehouse('A', { locationLevels: [] })]} canManage={false} />);
    expect(await screen.findByLabelText('Vị trí 1 ở kho A')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Lưu vị trí' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thêm vị trí/ })).toBeNull();
  });

  it('lỗi tải hiện thông báo; lỗi lưu hiện toast và giữ dữ liệu đang sửa', async () => {
    mockLoad.mockRejectedValueOnce(new Error('Máy chủ bận.'));
    const first = render(<StorageLocationPanel material={material} warehouses={[warehouse('A')]} canManage />);
    expect((await screen.findByRole('alert')).textContent).toBe('Máy chủ bận.');
    first.unmount();

    mockLoad.mockResolvedValue([stored({ warehouseCode: 'A', locationText: 'Kệ 1' })]);
    mockReplace.mockRejectedValue(new Error('Kho trung chuyển không khai vị trí.'));
    render(<StorageLocationPanel material={material} warehouses={[warehouse('A', { locationLevels: [] })]} canManage />);
    const input = await screen.findByLabelText('Vị trí 1 ở kho A');
    fireEvent.change(input, { target: { value: 'Kệ 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vị trí' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kho trung chuyển không khai vị trí.'));
    expect(screen.getByLabelText('Vị trí 1 ở kho A')).toHaveProperty('value', 'Kệ 2');
  });
});
