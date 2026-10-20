import {
  DEFAULT_PALETTE,
  PRESET_IDS,
  createDocument,
  createPresetDocuments,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { act, renderHook } from '@testing-library/react';
import { useBrandSettings, useIconLibrary } from './index';
import { localStore } from './local-store';

const presetIds = [...PRESET_IDS];

function mount() {
  return renderHook(() => ({ library: useIconLibrary(), settings: useBrandSettings() }));
}

describe('useIconLibrary', () => {
  beforeEach(() => {
    window.localStorage.clear();
    localStore.reloadForTest();
  });

  it('importDocs đổi mã khi trùng mã đã có và trả về số icon đã thêm', async () => {
    const { result } = mount();
    const before = result.current.library.docs.length;
    const clash = createDocument({ id: presetIds[0], name: 'Trùng mã mẫu' });
    const fresh = createDocument({ id: 'moi-1', name: 'Mã mới' });

    let added = 0;
    await act(async () => {
      added = await result.current.library.importDocs([clash, fresh]);
    });

    const { docs } = result.current.library;
    expect(added).toBe(2);
    expect(docs).toHaveLength(before + 2);
    // icon mẫu gốc còn nguyên, bản nhập có mã khác
    expect(docs.find((doc) => doc.id === presetIds[0])?.name).not.toBe('Trùng mã mẫu');
    const renamed = docs.find((doc) => doc.name === 'Trùng mã mẫu');
    expect(renamed).toBeDefined();
    expect(renamed?.id).not.toBe(presetIds[0]);
    expect(docs.find((doc) => doc.id === 'moi-1')).toBeDefined();
  });

  it('importDocs hai icon cùng mã trong một tệp vẫn được cấp mã khác nhau', async () => {
    const { result } = mount();
    const a = createDocument({ id: 'cung-ma', name: 'A' });
    const b = createDocument({ id: 'cung-ma', name: 'B' });

    await act(async () => {
      await result.current.library.importDocs([a, b]);
    });

    const ids = result.current.library.docs.filter((doc) => doc.name === 'A' || doc.name === 'B').map((doc) => doc.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('gọi liên tiếp nhiều thao tác không ghi đè nhau (không dùng danh sách cũ)', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.library.importDocs([
        createDocument({ id: 'x-1', name: 'X1' }),
        createDocument({ id: 'x-2', name: 'X2' }),
        createDocument({ id: 'x-3', name: 'X3' }),
      ]);
    });
    const { library } = result.current;

    await act(async () => {
      await Promise.all([library.remove('x-1'), library.remove('x-2')]);
    });

    const ids = result.current.library.docs.map((doc) => doc.id);
    expect(ids).not.toContain('x-1');
    expect(ids).not.toContain('x-2');
    expect(ids).toContain('x-3');
  });

  it('remove không xoá icon mẫu', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.library.remove(presetIds[0]);
    });
    expect(result.current.library.get(presetIds[0])).toBeDefined();
  });

  it('removeMany xoá icon tự tạo trong một lần, giữ icon mẫu và trả số đã xoá', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.library.importDocs([createDocument({ id: 'y-1', name: 'Y1' }), createDocument({ id: 'y-2', name: 'Y2' })]);
    });

    let removed = -1;
    await act(async () => {
      removed = await result.current.library.removeMany(['y-1', 'y-2', presetIds[0], 'khong-co']);
    });

    expect(removed).toBe(2);
    expect(result.current.library.get('y-1')).toBeUndefined();
    expect(result.current.library.get(presetIds[0])).toBeDefined();
  });

  it('saveMany cập nhật nhiều icon cùng lúc, đóng dấu updatedAt và thêm icon chưa có', async () => {
    const { result } = mount();
    const [first, second] = result.current.library.docs;
    const brandNew = createDocument({ id: 'moi-saveMany', name: 'Mới' });

    await act(async () => {
      await result.current.library.saveMany([
        { ...first, status: 'draft', updatedAt: '2000-01-01T00:00:00.000Z' },
        { ...second, status: 'draft', updatedAt: '2000-01-01T00:00:00.000Z' },
        brandNew,
      ]);
    });

    const { library } = result.current;
    expect(library.get(first.id)?.status).toBe('draft');
    expect(library.get(second.id)?.status).toBe('draft');
    expect(Date.parse(library.get(first.id)?.updatedAt ?? '')).toBeGreaterThan(Date.parse('2001-01-01'));
    expect(library.get('moi-saveMany')).toBeDefined();
  });

  it('duplicate tạo bản nháp mới, đổi danh mục thương hiệu/phân hệ thành tuỳ biến', async () => {
    const { result } = mount();
    const source = result.current.library.docs.find((doc) => doc.category === 'brand' || doc.category === 'module');
    expect(source).toBeDefined();
    if (!source) return;

    const made: { copy: IconDocument | null } = { copy: null };
    await act(async () => {
      made.copy = await result.current.library.duplicate(source.id);
    });

    expect(made.copy).not.toBeNull();
    expect(made.copy?.id).not.toBe(source.id);
    expect(made.copy?.name).toBe(`${source.name} (bản sao)`);
    expect(made.copy?.status).toBe('draft');
    expect(made.copy?.category).toBe('custom');
    expect(result.current.library.docs).toHaveLength(createPresetDocuments().length + 1);
  });

  it('duplicate icon không tồn tại trả về null', async () => {
    const { result } = mount();
    const made: { copy: IconDocument | null | 'chua-chay' } = { copy: 'chua-chay' };
    await act(async () => {
      made.copy = await result.current.library.duplicate('khong-co');
    });
    expect(made.copy).toBeNull();
  });

  it('resetPreset đưa icon mẫu về bản gốc', async () => {
    const { result } = mount();
    const preset = result.current.library.get(presetIds[0]);
    expect(preset).toBeDefined();
    if (!preset) return;

    await act(async () => {
      await result.current.library.save({ ...preset, name: 'Đã sửa', shapes: [] });
    });
    expect(result.current.library.get(preset.id)?.name).toBe('Đã sửa');

    await act(async () => {
      await result.current.library.resetPreset(preset.id);
    });
    expect(result.current.library.get(preset.id)?.name).toBe(preset.name);
    expect(result.current.library.get(preset.id)?.shapes.length).toBeGreaterThan(0);
  });
});

describe('useIconLibrary: chế độ cục bộ (không có API)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    localStore.reloadForTest();
  });

  it('báo đang ở chế độ cục bộ, sẵn sàng ngay và không có thông tin máy chủ', () => {
    const { result } = mount();
    const { library } = result.current;

    expect(library.mode).toBe('local');
    expect(library.ready).toBe(true);
    expect(library.modeReason).not.toBeNull();
    expect(library.localOnlyCount).toBe(0);
    expect(library.serverInfo(presetIds[0])).toBeNull();
    expect(result.current.settings.mode).toBe('local');
    expect(result.current.settings.error).toBeNull();
  });

  it('publish đặt trạng thái Phát hành cho icon; icon không có thì trả null', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.library.save(createDocument({ id: 'p-1', name: 'Nháp', status: 'draft' }));
    });

    let published: IconDocument | null = null;
    await act(async () => {
      published = await result.current.library.publish('p-1');
    });
    expect((published as IconDocument | null)?.status).toBe('published');
    expect(result.current.library.get('p-1')?.status).toBe('published');

    let missing: IconDocument | null | 'chua-chay' = 'chua-chay';
    await act(async () => {
      missing = await result.current.library.publish('khong-co');
    });
    expect(missing).toBeNull();
  });

  it('đồng bộ không làm gì và nạp lại từ máy chủ (thử kết nối) không ném lỗi khi vẫn chưa có máy chủ', async () => {
    const { result } = mount();

    await expect(result.current.library.syncLocalToServer()).resolves.toEqual({ pushed: 0, failed: 0 });
    await act(async () => {
      await result.current.library.reloadFromServer();
    });

    expect(result.current.library.mode).toBe('local');
  });
});

describe('useBrandSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    localStore.reloadForTest();
  });

  it('chuẩn hoá bảng màu trước khi lưu: bỏ màu sai mã, cắt tên quá dài', () => {
    const { result } = mount();
    act(() => {
      result.current.settings.setPalette({
        tokens: [
          { key: 'tot', label: 'x'.repeat(100), hex: '#ABC' },
          { key: 'sai-ma', label: 'Sai', hex: 'khong-phai-mau' },
        ],
      });
    });

    const { tokens } = result.current.settings.palette;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ key: 'tot', label: 'x'.repeat(40), hex: '#aabbcc' });
  });

  it('bảng màu rỗng sau chuẩn hoá thì về mặc định', () => {
    const { result } = mount();
    act(() => {
      result.current.settings.setPalette({ tokens: [] });
    });
    expect(result.current.settings.palette.tokens).toEqual(DEFAULT_PALETTE.tokens);
  });

  it('chuẩn hoá quy chuẩn: kẹp giá trị vào khoảng cho phép', () => {
    const { result } = mount();
    act(() => {
      result.current.settings.setRules({ ...result.current.settings.rules, snapStep: 99, maxShapes: 0, allowedStrokeWidths: [9, 2, 2, 1.5] });
    });
    const { rules } = result.current.settings;
    expect(rules.snapStep).toBe(4);
    expect(rules.maxShapes).toBe(1);
    expect(rules.allowedStrokeWidths).toEqual([1.5, 2]);
  });

  it('reset đưa cả bảng màu lẫn quy chuẩn về mặc định', () => {
    const { result } = mount();
    act(() => {
      result.current.settings.setRules({ ...result.current.settings.rules, safePadding: 2 });
    });
    act(() => result.current.settings.reset());
    expect(result.current.settings.palette).toBe(DEFAULT_PALETTE);
    expect(result.current.settings.rules.safePadding).toBe(0.25);
  });
});
