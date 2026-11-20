import { INVENTORY_SETTINGS_DEFAULTS, normalizeInventorySetting } from './inventory-settings.js';

describe('cài đặt theo dõi lô và serial', () => {
  it('công tắc lô và serial mặc định TẮT', () => {
    expect(INVENTORY_SETTINGS_DEFAULTS['tracking.lot.enabled']).toEqual({ enabled: false });
    expect(INVENTORY_SETTINGS_DEFAULTS['tracking.serial.enabled']).toEqual({ enabled: false });
  });

  it.each(['tracking.lot.enabled', 'tracking.serial.enabled'] as const)(
    '%s: chỉ true thật mới bật, payload hỏng rơi về tắt',
    (key) => {
      expect(normalizeInventorySetting(key, { enabled: true })).toEqual({ enabled: true });
      expect(normalizeInventorySetting(key, { enabled: 'true' })).toEqual({ enabled: false });
      expect(normalizeInventorySetting(key, { enabled: 1 })).toEqual({ enabled: false });
      expect(normalizeInventorySetting(key, null)).toEqual({ enabled: false });
      expect(normalizeInventorySetting(key, undefined)).toEqual({ enabled: false });
    },
  );

  it('gợi ý theo nhóm mặc định: ROTABLE và TOOL theo serial, còn lại theo số lượng', () => {
    expect(INVENTORY_SETTINGS_DEFAULTS['tracking.defaultByCategory']).toEqual({
      SPARE_PART: 'NONE',
      CONSUMABLE: 'NONE',
      TOOL: 'SERIAL',
      ROTABLE: 'SERIAL',
    });
  });

  it('gợi ý theo nhóm: tenant sửa được, giá trị lạ hoặc thiếu rơi về mặc định của nhóm đó', () => {
    expect(
      normalizeInventorySetting('tracking.defaultByCategory', {
        CONSUMABLE: 'LOT',
        TOOL: 'LOT_AND_SERIAL',
        ROTABLE: 7,
        EXTRA: 'SERIAL',
      }),
    ).toEqual({
      SPARE_PART: 'NONE',
      CONSUMABLE: 'LOT',
      TOOL: 'SERIAL',
      ROTABLE: 'SERIAL',
    });
  });

  it.each([[null], [undefined], ['x'], [[]]])('gợi ý theo nhóm: payload hỏng %p thành mặc định', (value) => {
    expect(normalizeInventorySetting('tracking.defaultByCategory', value)).toEqual(
      INVENTORY_SETTINGS_DEFAULTS['tracking.defaultByCategory'],
    );
  });
});
