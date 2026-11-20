import {
  DEFAULT_TRACKING_BY_CATEGORY,
  isMaterialTrackingMode,
  isSupplierCatalogEnforced,
  resolveTrackingMode,
  suggestTrackingMode,
  type TrackingDefaultsByCategory,
} from './contracts-inventory.js';

describe('cách theo dõi của mặt hàng (tracking_mode)', () => {
  describe('resolveTrackingMode', () => {
    it('ưu tiên trackingMode có trong dữ liệu', () => {
      expect(resolveTrackingMode({ trackingMode: 'LOT', isSerialized: false })).toBe('LOT');
      expect(resolveTrackingMode({ trackingMode: 'NONE', isSerialized: true })).toBe('NONE');
    });

    it('dữ liệu cũ chỉ có cờ isSerialized: bật là SERIAL, còn lại NONE', () => {
      expect(resolveTrackingMode({ isSerialized: true })).toBe('SERIAL');
      expect(resolveTrackingMode({ isSerialized: false })).toBe('NONE');
      expect(resolveTrackingMode({})).toBe('NONE');
    });

    it('không suy từ nhóm: vật tư tiêu hao không tự thành theo lô', () => {
      expect(resolveTrackingMode({ category: 'CONSUMABLE', isSerialized: false } as never)).toBe('NONE');
    });

    it('giá trị lạ hoặc thiếu mặt hàng rơi về NONE', () => {
      expect(resolveTrackingMode({ trackingMode: 'BOTH' as never })).toBe('NONE');
      expect(resolveTrackingMode(undefined)).toBe('NONE');
    });
  });

  it('isMaterialTrackingMode chỉ nhận đúng ba giá trị', () => {
    expect(['NONE', 'LOT', 'SERIAL'].every(isMaterialTrackingMode)).toBe(true);
    expect(isMaterialTrackingMode('LOT_AND_SERIAL')).toBe(false);
    expect(isMaterialTrackingMode(undefined)).toBe(false);
  });

  describe('suggestTrackingMode (gợi ý theo nhóm lúc tạo)', () => {
    it('mặc định tích hợp: ROTABLE và TOOL theo serial, SPARE_PART và CONSUMABLE theo số lượng', () => {
      expect(DEFAULT_TRACKING_BY_CATEGORY).toEqual({
        SPARE_PART: 'NONE',
        CONSUMABLE: 'NONE',
        TOOL: 'SERIAL',
        ROTABLE: 'SERIAL',
      });
      expect(suggestTrackingMode('ROTABLE')).toBe('SERIAL');
      expect(suggestTrackingMode('TOOL')).toBe('SERIAL');
      expect(suggestTrackingMode('SPARE_PART')).toBe('NONE');
      expect(suggestTrackingMode('CONSUMABLE')).toBe('NONE');
    });

    it('tenant sửa bảng gợi ý thì theo bảng của tenant', () => {
      const custom: TrackingDefaultsByCategory = { ...DEFAULT_TRACKING_BY_CATEGORY, CONSUMABLE: 'LOT' };
      expect(suggestTrackingMode('CONSUMABLE', custom)).toBe('LOT');
    });

    it('chưa chọn nhóm thì NONE', () => {
      expect(suggestTrackingMode(undefined)).toBe('NONE');
    });
  });
});

describe('isSupplierCatalogEnforced', () => {
  it('chỉ chọn từ danh mục và danh mục có mục: có hiệu lực', () => {
    expect(isSupplierCatalogEnforced(['Công ty A'], 'CATALOG_ONLY')).toBe(true);
  });

  it('danh mục rỗng thì không chặn, để tenant chưa khai danh mục vẫn nhập kho được', () => {
    expect(isSupplierCatalogEnforced([], 'CATALOG_ONLY')).toBe(false);
    expect(isSupplierCatalogEnforced(['', '  '], 'CATALOG_ONLY')).toBe(false);
  });

  it('cho nhập tự do thì không chặn dù danh mục có mục', () => {
    expect(isSupplierCatalogEnforced(['Công ty A'], 'CATALOG_OR_FREE')).toBe(false);
  });
});
