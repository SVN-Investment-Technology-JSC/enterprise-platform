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

describe('cài đặt warehouse.location.levels (mẫu tên cấp vị trí của tenant)', () => {
  it('mặc định không chia cấp', () => {
    expect(INVENTORY_SETTINGS_DEFAULTS['warehouse.location.levels']).toEqual({ levels: [] });
  });

  it('chuẩn hoá: bỏ mục rỗng và không phải chuỗi, cắt tên quá 50 ký tự, không giới hạn số cấp', () => {
    const many = Array.from({ length: 20 }, (_, index) => `Cấp ${index + 1}`);
    expect(normalizeInventorySetting('warehouse.location.levels', { levels: [' Khu ', '', 3, 'Kệ'] })).toEqual({
      levels: ['Khu', 'Kệ'],
    });
    expect(normalizeInventorySetting('warehouse.location.levels', { levels: ['x'.repeat(80)] })).toEqual({
      levels: ['x'.repeat(50)],
    });
    expect(normalizeInventorySetting('warehouse.location.levels', { levels: many }).levels).toHaveLength(20);
  });

  it.each([[null], [undefined], ['x'], [{}], [{ levels: 'Khu' }]])('payload hỏng %p thành danh sách rỗng', (value) => {
    expect(normalizeInventorySetting('warehouse.location.levels', value)).toEqual({ levels: [] });
  });
});
