import { INVENTORY_SETTINGS_DEFAULTS, normalizeInventorySetting } from './inventory-settings.js';

describe('cài đặt costing.method (T1-20)', () => {
  it('mặc định bình quân gia quyền tức thời', () => {
    expect(INVENTORY_SETTINGS_DEFAULTS['costing.method']).toEqual({ method: 'MOVING_AVERAGE' });
  });

  it.each([[{ method: 'FIFO' }], [null], ['MOVING_AVERAGE'], [{}]])(
    'giá trị ngoài union đóng %p rơi về MOVING_AVERAGE',
    (value) => {
      expect(normalizeInventorySetting('costing.method', value)).toEqual({ method: 'MOVING_AVERAGE' });
    },
  );
});

describe('cài đặt catalog.trade (phân loại và sử dụng hàng hóa)', () => {
  it('mặc định: chưa có phân loại, có sẵn bốn cách sử dụng của bản đầu', () => {
    expect(INVENTORY_SETTINGS_DEFAULTS['catalog.trade']).toEqual({
      goodsCategories: [],
      serviceCategories: [],
      usageModes: ['Chỉ bán', 'Có thể bán và quà tặng', 'Chỉ tặng', 'Đi kèm combo', 'Chỉ dùng nội bộ'],
    });
  });

  it('chuẩn hoá: cắt khoảng trắng, bỏ mục rỗng, trùng và không phải chuỗi; hai nhóm phân loại tách riêng', () => {
    expect(
      normalizeInventorySetting('catalog.trade', {
        goodsCategories: [' Cáp điện ', 'Cáp điện', '', 7, 'Thiết bị đo'],
        serviceCategories: ['Lắp đặt'],
        usageModes: ['Chỉ bán', null],
      }),
    ).toEqual({
      goodsCategories: ['Cáp điện', 'Thiết bị đo'],
      serviceCategories: ['Lắp đặt'],
      usageModes: ['Chỉ bán'],
    });
  });

  it.each([[null], [undefined], ['x'], [{}]])('payload hỏng %p thành ba danh sách rỗng', (value) => {
    expect(normalizeInventorySetting('catalog.trade', value)).toEqual({
      goodsCategories: [],
      serviceCategories: [],
      usageModes: [],
    });
  });
});

describe('cài đặt catalog.supplier và supplier.input (danh mục nhà cung cấp)', () => {
  it('mặc định: danh mục rỗng và chỉ chọn từ danh mục', () => {
    expect(INVENTORY_SETTINGS_DEFAULTS['catalog.supplier']).toEqual({ suppliers: [] });
    expect(INVENTORY_SETTINGS_DEFAULTS['supplier.input']).toEqual({ mode: 'CATALOG_ONLY' });
  });

  it('chuẩn hoá danh mục: cắt khoảng trắng, gộp khoảng trắng liền nhau, bỏ mục rỗng và không phải chuỗi', () => {
    expect(
      normalizeInventorySetting('catalog.supplier', {
        suppliers: ['  Công   ty A ', '', 7, null, 'ABB'],
      }),
    ).toEqual({ suppliers: ['Công ty A', 'ABB'] });
  });

  it('bỏ mục trùng theo khóa so sánh (hoa thường, dấu, dấu câu), giữ mục đứng trước', () => {
    expect(
      normalizeInventorySetting('catalog.supplier', {
        suppliers: ['Công ty A', 'CÔNG TY A', 'Cong ty A.', 'Công ty B'],
      }),
    ).toEqual({ suppliers: ['Công ty A', 'Công ty B'] });
  });

  it('bỏ mục dài quá 180 ký tự (khớp cột materials.supplier) và chặn trần 500 mục', () => {
    const tooLong = 'A'.repeat(181);
    const ok = 'B'.repeat(180);
    expect(normalizeInventorySetting('catalog.supplier', { suppliers: [tooLong, ok] })).toEqual({
      suppliers: [ok],
    });
    const many = Array.from({ length: 600 }, (_, index) => `Nhà ${index}`);
    expect(normalizeInventorySetting('catalog.supplier', { suppliers: many }).suppliers).toHaveLength(500);
  });

  it.each([[null], [undefined], ['x'], [{}], [{ suppliers: 'A' }]])('payload hỏng %p thành danh mục rỗng', (value) => {
    expect(normalizeInventorySetting('catalog.supplier', value)).toEqual({ suppliers: [] });
  });

  it.each([['CATALOG_ONLY'], ['CATALOG_OR_FREE']])('supplier.input giữ giá trị hợp lệ %s', (mode) => {
    expect(normalizeInventorySetting('supplier.input', { mode })).toEqual({ mode });
  });

  it.each([[{ mode: 'FREE' }], [null], ['CATALOG_ONLY'], [{}]])(
    'supplier.input giá trị lạ %p rơi về CATALOG_ONLY',
    (value) => {
      expect(normalizeInventorySetting('supplier.input', value)).toEqual({ mode: 'CATALOG_ONLY' });
    },
  );
});
