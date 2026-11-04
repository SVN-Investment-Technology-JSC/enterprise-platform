import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  EMPTY_FILTER,
  TradeItemsPage,
  categoryChoices,
  filterTradeItems,
  paginate,
  parseImportRows,
  toExportRows,
  usageChoices,
  usageLabel,
} from '@enterprise-platform/feature-inventory';

const mockLoadItems = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRetire = jest.fn();
const mockHistory = jest.fn();

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadTradeItems: () => mockLoadItems(),
  createMaterial: (input: unknown) => mockCreate(input),
  updateMaterial: (code: string, patch: unknown) => mockUpdate(code, patch),
  retireMaterial: (code: string) => mockRetire(code),
  loadMaterialHistory: (code: string) => mockHistory(code),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  formatDateTime: (value: string) => value,
  // Bản giả xác nhận ngay khi bấm nút bên trong.
  Popconfirm: ({ children, onConfirm }: { children: React.ReactNode; onConfirm: () => void }) => (
    <span onClick={onConfirm}>{children}</span>
  ),
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
    <select aria-label={placeholder ?? 'Số bản ghi'} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const item = (patch: Record<string, unknown>) => ({
  id: String(patch.code),
  category: 'CONSUMABLE',
  unit: 'Cái',
  minStock: 0,
  maxStock: 0,
  isSerialized: false,
  isActive: true,
  kind: 'STOCK',
  ...patch,
});

const ITEMS = [
  item({
    code: 'VT-001',
    name: 'Cáp điện',
    barcode: '893001',
    tradeMode: 'SALE_ONLY',
    tradeCategory: 'Dây dẫn',
    salePrice: 45000,
    createdBy: 'Hải',
    createdAt: '2026-11-01T00:00:00Z',
  }),
  item({
    code: 'DV-001',
    name: 'Dịch vụ lắp đặt',
    kind: 'SERVICE',
    unit: 'Giờ',
    tradeMode: 'Chỉ bán',
    tradeCategory: 'Lắp đặt',
    salePrice: 300000,
  }),
  item({ code: 'VT-002', name: 'Quà tặng khách', tradeMode: 'GIFT_ONLY' }),
  item({ code: 'VT-003', name: 'Găng tay nội bộ', tradeMode: 'Đi kèm combo' }),
  item({ code: 'VT-OLD', name: 'Mã cũ', isActive: false }),
];

const CATALOG = {
  goodsCategories: ['Dây dẫn', 'Thiết bị đo'],
  serviceCategories: ['Lắp đặt', 'Bảo trì'],
  usageModes: ['Chỉ bán', 'Chỉ tặng', 'Đi kèm combo'],
};

describe('trade-items.model', () => {
  it('đổi mã sử dụng cũ sang nhãn, giữ nguyên chuỗi tự khai', () => {
    expect(usageLabel('SALE_ONLY')).toBe('Chỉ bán');
    expect(usageLabel('Đi kèm combo')).toBe('Đi kèm combo');
    expect(usageLabel(undefined)).toBe('');
  });

  it('lọc theo từ khóa không dấu, nhóm, phân loại, sử dụng và ẩn mã đã ngừng', () => {
    const codes = (filter: Partial<typeof EMPTY_FILTER>) =>
      filterTradeItems(ITEMS as never, { ...EMPTY_FILTER, ...filter }).map((i) => i.code);
    expect(codes({})).toEqual(['VT-001', 'DV-001', 'VT-002', 'VT-003']);
    expect(codes({ search: 'cap dien' })).toEqual(['VT-001']);
    expect(codes({ search: '893001' })).toEqual(['VT-001']);
    expect(codes({ group: 'SERVICE' })).toEqual(['DV-001']);
    expect(codes({ group: 'GOODS' })).toEqual(['VT-001', 'VT-002', 'VT-003']);
    expect(codes({ category: 'Lắp đặt' })).toEqual(['DV-001']);
    // Mã cũ SALE_ONLY và nhãn "Chỉ bán" là cùng một cách sử dụng.
    expect(codes({ usage: 'Chỉ bán' })).toEqual(['VT-001', 'DV-001']);
    expect(codes({ usage: 'Chỉ tặng' })).toEqual(['VT-002']);
    expect(codes({ includeInactive: true })).toHaveLength(5);
  });

  it('ô lọc: phân loại theo nhóm, cộng giá trị đang dùng; sử dụng gộp mã cũ với nhãn', () => {
    const goods = categoryChoices(ITEMS as never, CATALOG, 'GOODS').map((c) => c.value);
    expect(goods).toEqual(['Dây dẫn', 'Thiết bị đo']);
    const services = categoryChoices(ITEMS as never, CATALOG, 'SERVICE').map((c) => c.value);
    expect(services).toEqual(['Lắp đặt', 'Bảo trì']);
    // Danh mục rỗng: vẫn lọc được theo giá trị mặt hàng đang dùng.
    expect(categoryChoices(ITEMS as never, undefined, '').map((c) => c.value)).toEqual(['Dây dẫn', 'Lắp đặt']);
    expect(usageChoices(ITEMS as never, CATALOG).map((c) => c.value)).toEqual(['Chỉ bán', 'Chỉ tặng', 'Đi kèm combo']);
    expect(usageChoices(ITEMS as never, undefined).map((c) => c.value)).toEqual(['Chỉ bán', 'Chỉ tặng', 'Đi kèm combo']);
  });

  it('phân trang và lùi về trang cuối khi số trang vượt quá', () => {
    const rows = Array.from({ length: 40 }, (_, i) => i);
    expect(paginate(rows, 1, 15)).toMatchObject({ pageCount: 3, from: 1, to: 15, total: 40 });
    expect(paginate(rows, 3, 15)).toMatchObject({ page: 3, from: 31, to: 40 });
    expect(paginate(rows, 9, 15).page).toBe(3);
    expect(paginate([], 1, 15)).toMatchObject({ pageCount: 1, from: 0, to: 0, total: 0 });
  });

  it('xuất đủ tám cột, mã sử dụng cũ thành nhãn', () => {
    const [row] = toExportRows([ITEMS[0]] as never);
    expect(Object.keys(row)).toEqual(['Mã', 'Tên', 'Barcode', 'Nhóm', 'Phân loại', 'Đơn vị', 'Sử dụng', 'Giá bán']);
    expect(row['Sử dụng']).toBe('Chỉ bán');
    expect(row['Nhóm']).toBe('Hàng hóa');
    expect(row['Phân loại']).toBe('Dây dẫn');
  });

  it('nhập: đọc đúng dòng hợp lệ và báo từng dòng sai kèm lý do', () => {
    const rows = parseImportRows(
      [
        { Mã: 'vt-9', Tên: 'Ống', Barcode: '1', Nhóm: 'Dịch vụ', 'Phân loại': 'Bảo trì', 'Đơn vị': 'Giờ', 'Sử dụng': 'Chỉ tặng', 'Giá bán': '1.500' },
        { Mã: '', Tên: 'Thiếu mã', 'Đơn vị': 'Cái' },
        { Mã: 'VT-9', Tên: 'Lặp', 'Đơn vị': 'Cái' },
        { Mã: 'VT-8', Tên: 'Sai nhóm', 'Đơn vị': 'Cái', Nhóm: 'Xe' },
        { Mã: 'VT-7', Tên: 'Giá âm', 'Đơn vị': 'Cái', 'Giá bán': '-5' },
        { Mã: 'VT-6', Tên: 'Phân loại của nhóm khác', 'Đơn vị': 'Cái', 'Phân loại': 'Bảo trì' },
        { Mã: 'VT-5', Tên: 'Sử dụng lạ', 'Đơn vị': 'Cái', 'Sử dụng': 'Cho thuê' },
        { Mã: 'VT-4', Tên: 'Mã cũ', 'Đơn vị': 'Cái', Nhóm: 'Vật tư', 'Sử dụng': 'SALE_ONLY' },
      ],
      CATALOG,
    );
    expect(rows[0].input).toMatchObject({
      code: 'VT-9',
      kind: 'SERVICE',
      tradeCategory: 'Bảo trì',
      tradeMode: 'Chỉ tặng',
      salePrice: 1500,
      currency: 'VND',
    });
    expect(rows.slice(1, 7).map((r) => r.error)).toEqual([
      'Thiếu mã.',
      'Mã VT-9 bị lặp trong tệp.',
      'Nhóm "Xe" không hợp lệ (Hàng hóa hoặc Dịch vụ).',
      'Giá bán phải là số không âm.',
      'Phân loại "Bảo trì" chưa khai báo trong Cài đặt.',
      'Sử dụng "Cho thuê" chưa khai báo trong Cài đặt.',
    ]);
    // "Vật tư" của tệp mẫu cũ vẫn đọc được, mã cũ đổi thành nhãn.
    expect(rows[7].input).toMatchObject({ code: 'VT-4', kind: 'STOCK', tradeMode: 'Chỉ bán' });
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('nhập: chưa có danh mục thì nhận giá trị tự do', () => {
    const [row] = parseImportRows([{ Mã: 'A', Tên: 'B', 'Đơn vị': 'Cái', 'Phân loại': 'Bất kỳ', 'Sử dụng': 'Tùy ý' }]);
    expect(row.input).toMatchObject({ tradeCategory: 'Bất kỳ', tradeMode: 'Tùy ý' });
  });
});

describe('TradeItemsPage', () => {
  beforeEach(() => {
    mockLoadItems.mockResolvedValue(ITEMS);
    mockHistory.mockResolvedValue([
      {
        id: 't1',
        transactionCode: 'TX-1',
        warehouseId: 'w1',
        materialId: 'VT-001',
        type: 'IMPORT',
        quantity: 10,
        unitCost: 1,
        workflowStatus: 'POSTED',
        createdBy: 'Thủ kho',
        createdAt: '2026-11-02T00:00:00Z',
        documentNumber: 'PN-01',
      },
    ]);
    mockCreate.mockResolvedValue({ code: 'VT-NEW' });
    mockUpdate.mockResolvedValue({ code: 'VT-001' });
    mockRetire.mockResolvedValue({ code: 'VT-001', mode: 'deactivated' });
  });
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  const warehouses = [{ id: 'w1', code: 'K1', name: 'Kho chính', type: 'MAIN' }] as never;
  const stock = [
    { id: 's1', warehouseId: 'w1', materialId: 'VT-001', quantity: 10, quantityReserved: 2, quantityBlocked: 0, available: 8 },
  ] as never;

  it('hiện bảng bảy cột theo thứ tự, mã đã ngừng bị ẩn, có nhập xuất và tạo mới', async () => {
    render(<TradeItemsPage canManage warehouses={warehouses} stock={stock} catalog={CATALOG} />);
    await screen.findByText('Cáp điện', { selector: 'td' });
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Mã', 'Tên', 'Nhóm', 'Phân loại', 'Đơn vị', 'Sử dụng', 'Giá']);
    expect(screen.queryByText('Mã cũ')).toBeNull();
    expect(screen.getByRole('button', { name: /Nhập Excel/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Xuất Excel/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tạo mới/ })).toBeTruthy();
    expect(screen.getByText('45.000 đ')).toBeTruthy();
    // Mã cũ SALE_ONLY hiển thị bằng nhãn; barcode không còn là cột.
    expect(screen.queryByText('SALE_ONLY')).toBeNull();
    expect(screen.queryByText('893001')).toBeNull();
  });

  it('không có quyền quản lý: chỉ xuất, không nhập hay tạo', async () => {
    render(<TradeItemsPage canManage={false} warehouses={warehouses} />);
    await screen.findByText('Cáp điện', { selector: 'td' });
    expect(screen.queryByRole('button', { name: /Nhập Excel/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tạo mới/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Xuất Excel/ })).toBeTruthy();
  });

  it('lọc theo sử dụng, nhóm, phân loại và tìm kiếm', async () => {
    render(<TradeItemsPage canManage warehouses={warehouses} catalog={CATALOG} />);
    await screen.findByText('Cáp điện', { selector: 'td' });
    fireEvent.change(screen.getByLabelText('Sử dụng'), { target: { value: 'Chỉ tặng' } });
    expect(screen.getByText('Quà tặng khách')).toBeTruthy();
    expect(screen.queryByText('Dịch vụ lắp đặt')).toBeNull();
    fireEvent.change(screen.getByLabelText('Sử dụng'), { target: { value: '' } });

    fireEvent.change(screen.getByLabelText('Nhóm'), { target: { value: 'SERVICE' } });
    expect(screen.getByText('Dịch vụ lắp đặt')).toBeTruthy();
    expect(screen.queryByText('Quà tặng khách')).toBeNull();
    // Chọn nhóm dịch vụ thì ô phân loại chỉ có phân loại của dịch vụ.
    const category = screen.getByLabelText('Phân loại') as HTMLSelectElement;
    expect([...category.options].map((o) => o.value)).toEqual(['', 'Lắp đặt', 'Bảo trì']);
    fireEvent.change(category, { target: { value: 'Bảo trì' } });
    expect(screen.queryByText('Dịch vụ lắp đặt')).toBeNull();
    // Đổi nhóm thì bỏ phân loại đang lọc.
    fireEvent.change(screen.getByLabelText('Nhóm'), { target: { value: '' } });
    expect((screen.getByLabelText('Phân loại') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('Dịch vụ lắp đặt')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tìm hàng hóa'), { target: { value: 'lap dat' } });
    expect(screen.getByText('Dịch vụ lắp đặt')).toBeTruthy();
    expect(screen.queryByText('Quà tặng khách')).toBeNull();
  });

  it('chân trang đổi số bản ghi mỗi trang (15, 30, 45) và chuyển trang', async () => {
    mockLoadItems.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => item({ code: `VT-${String(i).padStart(3, '0')}`, name: `Hàng ${i}` })),
    );
    render(<TradeItemsPage canManage warehouses={warehouses} />);
    await screen.findByText('Hàng 0');
    const sizes = screen.getByLabelText('Số bản ghi') as HTMLSelectElement;
    expect([...sizes.options].map((o) => o.value).filter(Boolean)).toEqual(['15', '30', '45']);
    expect(screen.getByText('1–15 / 40')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText('16–30 / 40')).toBeTruthy();
    expect(screen.getByText('Hàng 15')).toBeTruthy();
    fireEvent.change(sizes, { target: { value: '45' } });
    expect(screen.getByText('1–40 / 40')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bấm một dòng mở drawer: người khai báo, thời gian, barcode, lịch sử xuất nhập và tồn kho', async () => {
    render(<TradeItemsPage canManage warehouses={warehouses} stock={stock} catalog={CATALOG} />);
    fireEvent.click(await screen.findByText('Cáp điện', { selector: 'td' }));
    const drawer = screen.getByRole('dialog', { name: 'Chi tiết VT-001' });
    for (const label of ['Người khai báo', 'Thời gian khai báo', 'Barcode', 'Phân loại', 'Sử dụng']) {
      expect(within(drawer).getByText(label)).toBeTruthy();
    }
    expect(within(drawer).getByText('Hải')).toBeTruthy();
    expect(within(drawer).getByText('893001')).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Lịch sử xuất nhập' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Tồn kho' })).toBeTruthy();
    await within(drawer).findByText('PN-01');
    expect(within(drawer).getByText('Nhập kho')).toBeTruthy();
    // Kho xuất hiện ở bảng lịch sử và bảng tồn.
    expect(within(drawer).getAllByText('Kho chính')).toHaveLength(2);
    expect(within(drawer).getByText('Tồn thực tế')).toBeTruthy();
    expect(mockHistory).toHaveBeenCalledWith('VT-001');
  });

  it('drawer của dịch vụ không tải lịch sử xuất nhập và báo không quản lý tồn', async () => {
    render(<TradeItemsPage canManage warehouses={warehouses} stock={stock} catalog={CATALOG} />);
    fireEvent.click(await screen.findByText('Dịch vụ lắp đặt'));
    const drawer = screen.getByRole('dialog', { name: 'Chi tiết DV-001' });
    expect(within(drawer).getByText(/không có lịch sử xuất nhập/)).toBeTruthy();
    expect(within(drawer).getByText('Dịch vụ không quản lý tồn kho.')).toBeTruthy();
    expect(mockHistory).not.toHaveBeenCalled();
  });

  it('tạo mới: gửi mã viết hoa, nhóm, phân loại của nhóm, sử dụng và giá', async () => {
    render(<TradeItemsPage canManage warehouses={warehouses} catalog={CATALOG} />);
    await screen.findByText('Cáp điện', { selector: 'td' });
    fireEvent.click(screen.getByRole('button', { name: /Tạo mới/ }));
    const dialog = screen.getByRole('dialog', { name: 'Tạo hàng hóa' });
    const submit = within(dialog).getByRole('button', { name: 'Tạo mới' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/^Mã/), { target: { value: 'vt-new' } });
    fireEvent.change(within(dialog).getByLabelText(/^Tên/), { target: { value: 'Hàng mới' } });
    fireEvent.change(within(dialog).getByLabelText(/^Đơn vị/), { target: { value: 'Bộ' } });
    fireEvent.change(within(dialog).getByLabelText('— Chọn nhóm —'), { target: { value: 'SERVICE' } });
    // Phân loại chỉ có của dịch vụ.
    const category = within(dialog).getByLabelText('— Chọn phân loại —') as HTMLSelectElement;
    expect([...category.options].map((o) => o.value)).toEqual(['', 'Lắp đặt', 'Bảo trì']);
    fireEvent.change(category, { target: { value: 'Bảo trì' } });
    fireEvent.change(within(dialog).getByLabelText('— Chọn cách sử dụng —'), { target: { value: 'Đi kèm combo' } });
    fireEvent.change(within(dialog).getByLabelText(/Giá bán/), { target: { value: '99000' } });
    fireEvent.click(submit);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      code: 'VT-NEW',
      name: 'Hàng mới',
      unit: 'Bộ',
      kind: 'SERVICE',
      tradeCategory: 'Bảo trì',
      tradeMode: 'Đi kèm combo',
      salePrice: 99000,
    });
    await screen.findByText('Đã tạo VT-NEW.');
  });

  it('tạo mới: đổi nhóm thì bỏ phân loại đã chọn', async () => {
    render(<TradeItemsPage canManage warehouses={warehouses} catalog={CATALOG} />);
    await screen.findByText('Cáp điện', { selector: 'td' });
    fireEvent.click(screen.getByRole('button', { name: /Tạo mới/ }));
    const dialog = screen.getByRole('dialog', { name: 'Tạo hàng hóa' });
    fireEvent.change(within(dialog).getByLabelText(/^Mã/), { target: { value: 'a' } });
    fireEvent.change(within(dialog).getByLabelText(/^Tên/), { target: { value: 'A' } });
    fireEvent.change(within(dialog).getByLabelText(/^Đơn vị/), { target: { value: 'Cái' } });
    fireEvent.change(within(dialog).getByLabelText('— Chọn phân loại —'), { target: { value: 'Thiết bị đo' } });
    fireEvent.change(within(dialog).getByLabelText('— Chọn nhóm —'), { target: { value: 'SERVICE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo mới' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0].tradeCategory).toBeUndefined();
  });

  it('tạo thất bại: giữ form mở và hiện lỗi của Kho', async () => {
    mockCreate.mockRejectedValue(new Error('Mã vật tư VT-X đã tồn tại.'));
    render(<TradeItemsPage canManage warehouses={warehouses} />);
    await screen.findByText('Cáp điện', { selector: 'td' });
    fireEvent.click(screen.getByRole('button', { name: /Tạo mới/ }));
    const dialog = screen.getByRole('dialog', { name: 'Tạo hàng hóa' });
    fireEvent.change(within(dialog).getByLabelText(/^Mã/), { target: { value: 'VT-X' } });
    fireEvent.change(within(dialog).getByLabelText(/^Tên/), { target: { value: 'X' } });
    fireEvent.change(within(dialog).getByLabelText(/^Đơn vị/), { target: { value: 'Cái' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo mới' }));
    await screen.findByText('Mã vật tư VT-X đã tồn tại.');
    expect(screen.getByRole('dialog', { name: 'Tạo hàng hóa' })).toBeTruthy();
  });

  it('sửa từ drawer: khoá mã, gửi phần thay đổi, mã sử dụng cũ gửi lại dưới dạng nhãn', async () => {
    const onChanged = jest.fn();
    render(<TradeItemsPage canManage warehouses={warehouses} catalog={CATALOG} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Cáp điện', { selector: 'td' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Chi tiết VT-001' })).getByRole('button', { name: 'Sửa' }));
    const dialog = screen.getByRole('dialog', { name: 'Sửa hàng hóa' });
    expect((within(dialog).getByLabelText(/^Mã/) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Giá bán/), { target: { value: '50000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0]).toBe('VT-001');
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ salePrice: 50000, tradeMode: 'Chỉ bán', tradeCategory: 'Dây dẫn' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('ngừng dùng từ drawer: gọi Kho rồi nạp lại danh sách', async () => {
    const onChanged = jest.fn();
    render(<TradeItemsPage canManage warehouses={warehouses} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Cáp điện', { selector: 'td' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Chi tiết VT-001' })).getByRole('button', { name: 'Ngừng dùng' }));
    await waitFor(() => expect(mockRetire).toHaveBeenCalledWith('VT-001'));
    await screen.findByText(/Đã ngừng dùng VT-001/);
    expect(onChanged).toHaveBeenCalled();
  });
});
