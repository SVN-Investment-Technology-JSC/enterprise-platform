import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  PRESET_IDS,
  createDocument,
  createPresetDocuments,
  type LegacyIconSpec,
} from '@enterprise-platform/shared-brand-icon';
import { STORAGE_KEYS, isPresetId, localStore } from './local-store';

const legacyCustom: LegacyIconSpec = {
  id: 'custom-1700000000000',
  name: 'Icon đời đầu',
  category: 'custom',
  description: 'Tạo bằng bản Brand Studio cũ',
  viewBoxSize: 24,
  containerShape: 'squircle',
  containerFill: 'none',
  strokeWidth: 1.75,
  colorTone: 'sapphire',
  cornerRadius: 4,
  accentDot: false,
  glyphPath: 'M 6 6 L 18 18',
  isCustom: true,
};

const presetCount = createPresetDocuments().length;

function reload() {
  localStore.reloadForTest();
  return localStore.getSnapshot();
}

describe('localStore: nạp thư viện', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
    reload();
  });

  it('kho trống thì có đủ icon mẫu và sẵn sàng', () => {
    const snap = reload();
    expect(snap.ready).toBe(true);
    expect(snap.error).toBeNull();
    expect(snap.docs).toHaveLength(presetCount);
    expect(new Set(snap.docs.map((doc) => doc.id))).toEqual(PRESET_IDS);
    expect(snap.palette).toBe(DEFAULT_PALETTE);
    expect(snap.rules).toBe(DEFAULT_RULES);
  });

  it('bản chụp phía máy chủ chưa sẵn sàng và không có icon (tránh lệch hydrate)', () => {
    const server = localStore.getServerSnapshot();
    expect(server.ready).toBe(false);
    expect(server.docs).toHaveLength(0);
  });

  it('giữ icon của người dùng và bổ sung icon mẫu còn thiếu', () => {
    const mine = createDocument({ id: 'mine-1', name: 'Của tôi' });
    const [onePreset] = createPresetDocuments();
    window.localStorage.setItem(STORAGE_KEYS.docs, JSON.stringify([mine, onePreset]));

    const { docs } = reload();
    expect(docs).toHaveLength(presetCount + 1);
    expect(docs.find((doc) => doc.id === 'mine-1')?.name).toBe('Của tôi');
    for (const id of PRESET_IDS) expect(docs.some((doc) => doc.id === id)).toBe(true);
  });

  it('chuyển thư viện từ khoá cũ svndts-brand-studio-icons sang mô hình nhiều lớp', () => {
    window.localStorage.setItem(STORAGE_KEYS.legacyDocs, JSON.stringify([legacyCustom]));

    const { docs } = reload();
    const migrated = docs.find((doc) => doc.id === legacyCustom.id);
    expect(migrated).toBeDefined();
    expect(migrated?.name).toBe('Icon đời đầu');
    expect(migrated?.status).toBe('draft');
    // khung + nét chính
    expect(migrated?.shapes.length).toBeGreaterThanOrEqual(2);
    // icon mẫu mới vẫn được thêm vào
    for (const id of PRESET_IDS) expect(docs.some((doc) => doc.id === id)).toBe(true);
  });

  it('khoá mới được ưu tiên hơn khoá cũ khi có cả hai', () => {
    window.localStorage.setItem(STORAGE_KEYS.legacyDocs, JSON.stringify([legacyCustom]));
    window.localStorage.setItem(STORAGE_KEYS.docs, JSON.stringify([createDocument({ id: 'moi-1', name: 'Bản mới' })]));

    const { docs } = reload();
    expect(docs.some((doc) => doc.id === 'moi-1')).toBe(true);
    expect(docs.some((doc) => doc.id === legacyCustom.id)).toBe(false);
  });

  it('khoá mới hỏng thì dùng khoá cũ, cả hai hỏng thì về icon mẫu', () => {
    window.localStorage.setItem(STORAGE_KEYS.docs, '{không phải json');
    window.localStorage.setItem(STORAGE_KEYS.legacyDocs, JSON.stringify([legacyCustom]));
    expect(reload().docs.some((doc) => doc.id === legacyCustom.id)).toBe(true);

    window.localStorage.setItem(STORAGE_KEYS.legacyDocs, '[[[');
    const { docs } = reload();
    expect(docs).toHaveLength(presetCount);
  });

  it('icon sau khi chuyển được lưu sang khoá mới ở lần lưu đầu tiên, khoá cũ không bị đụng tới', () => {
    window.localStorage.setItem(STORAGE_KEYS.legacyDocs, JSON.stringify([legacyCustom]));
    const { docs } = reload();

    localStore.setDocs(docs);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.docs) ?? '[]') as Array<{ id: string }>;
    expect(stored.some((doc) => doc.id === legacyCustom.id)).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEYS.legacyDocs)).not.toBeNull();
  });
});

describe('localStore: ghi và lỗi lưu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
    reload();
  });

  it('setDocs ghi vào khoá mới, cập nhật bản chụp và xoá lỗi cũ', () => {
    const doc = createDocument({ id: 'a-1', name: 'A' });
    localStore.setDocs([doc]);

    expect(localStore.getSnapshot().docs).toEqual([doc]);
    expect(localStore.getSnapshot().error).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.docs) ?? 'null')).toHaveLength(1);
  });

  it('bộ nhớ trình duyệt đầy thì báo lỗi nhưng vẫn giữ dữ liệu trong phiên', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const doc = createDocument({ id: 'a-2', name: 'B' });

    localStore.setDocs([doc]);

    expect(localStore.getSnapshot().docs).toEqual([doc]);
    expect(localStore.getSnapshot().error).toMatch(/Không lưu được/);
  });

  it('thông báo lỗi tắt sau lần lưu thành công', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    localStore.setDocs([createDocument({ id: 'a-3', name: 'C' })]);
    expect(localStore.getSnapshot().error).not.toBeNull();

    spy.mockRestore();
    localStore.setDocs([createDocument({ id: 'a-3', name: 'C' })]);
    expect(localStore.getSnapshot().error).toBeNull();
  });

  it('tab khác ghi vào kho thì bản chụp tự nạp lại', () => {
    reload();
    const other = [createDocument({ id: 'tab-khac', name: 'Từ tab khác' })];
    window.localStorage.setItem(STORAGE_KEYS.docs, JSON.stringify(other));

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.docs }));
    expect(localStore.getSnapshot().docs.some((doc) => doc.id === 'tab-khac')).toBe(true);

    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(localStore.getSnapshot().docs).toHaveLength(presetCount);
  });

  it('isPresetId nhận ra icon mẫu', () => {
    expect(isPresetId([...PRESET_IDS][0])).toBe(true);
    expect(isPresetId('mine-1')).toBe(false);
  });
});

describe('localStore: bảng màu và quy chuẩn', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reload();
  });

  it('lưu bảng màu và quy chuẩn rồi nạp lại đúng như đã lưu', () => {
    const palette = { tokens: [{ key: 'xanh', label: 'Xanh', hex: '#112233' }] };
    const rules = { ...DEFAULT_RULES, snapStep: 1, maxShapes: 8 };
    localStore.setPalette(palette);
    localStore.setRules(rules);

    const snap = reload();
    expect(snap.palette.tokens).toEqual(palette.tokens);
    expect(snap.rules.snapStep).toBe(1);
    expect(snap.rules.maxShapes).toBe(8);
  });

  it('dữ liệu bảng màu hỏng thì dùng mặc định', () => {
    window.localStorage.setItem(STORAGE_KEYS.palette, JSON.stringify({ tokens: 'sai' }));
    window.localStorage.setItem(STORAGE_KEYS.rules, '###');
    const snap = reload();
    expect(snap.palette).toBe(DEFAULT_PALETTE);
    expect(snap.rules).toBe(DEFAULT_RULES);
  });

  it('resetSettings xoá cả hai khoá và về mặc định', () => {
    localStore.setPalette({ tokens: [{ key: 'xanh', label: 'Xanh', hex: '#112233' }] });
    localStore.setRules({ ...DEFAULT_RULES, snapStep: 2 });

    localStore.resetSettings();

    expect(localStore.getSnapshot().palette).toBe(DEFAULT_PALETTE);
    expect(localStore.getSnapshot().rules).toBe(DEFAULT_RULES);
    expect(window.localStorage.getItem(STORAGE_KEYS.palette)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.rules)).toBeNull();
  });
});
