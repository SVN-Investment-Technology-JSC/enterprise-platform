import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  PRESET_IDS,
  createDocument,
  createShape,
  type BrandPalette,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBrandSettings, useIconLibrary } from './index';
import { STORAGE_KEYS, localStore } from './local-store';
import { STANDARDS_CACHE_KEY, STANDARDS_DEBOUNCE_MS, remoteStore } from './remote-store';
import { createFakeBrandServer, httpError, type FakeBrandServer } from './testing/fake-brand-server';

let mockServer: FakeBrandServer;

jest.mock('./brand-api', () => {
  const actual = jest.requireActual('./brand-api');
  const { BRAND_API_FUNCTIONS } = jest.requireActual('./testing/api-names') as { BRAND_API_FUNCTIONS: readonly string[] };
  const delegates = Object.fromEntries(
    BRAND_API_FUNCTIONS.map((name) => [name, (...args: unknown[]) => (mockServer.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args)]),
  );
  return { ...actual, ...delegates };
});

const presetCount = PRESET_IDS.size;

const rect = (x = 4) => createShape({ type: 'rect', x, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' });
const icon = (id: string, name = id, overrides: Partial<IconDocument> = {}): IconDocument => createDocument({ id, name, shapes: [rect()], ...overrides });

const palette = (hex: string): BrandPalette => ({ tokens: [{ key: 'xanh', label: 'Xanh', hex }] });
const puts = () => mockServer.calls.filter((call) => call === 'PUT standards');

function mount() {
  return renderHook(() => ({ library: useIconLibrary(), settings: useBrandSettings() }));
}

beforeEach(() => {
  mockServer = createFakeBrandServer();
  remoteStore.resetForTest();
  window.localStorage.clear();
  localStore.reloadForTest();
  Object.defineProperty(globalThis, 'fetch', { value: jest.fn(), configurable: true, writable: true });
});

afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('useIconLibrary: chế độ máy chủ', () => {
  it('lúc kiểm tra kết nối là khung chờ, rồi hiện icon trên máy chủ cộng icon mẫu', async () => {
    mockServer.seed(icon('a', 'Một'), 'published');
    const { result } = mount();

    expect(result.current.library.mode).toBe('checking');
    expect(result.current.library.ready).toBe(false);
    expect(result.current.library.docs).toHaveLength(0);

    await waitFor(() => expect(result.current.library.ready).toBe(true));

    const { library } = result.current;
    expect(library.mode).toBe('server');
    expect(library.docs).toHaveLength(1 + presetCount);
    expect(library.get('a')?.status).toBe('published');
    expect(library.serverInfo('a')).toMatchObject({ version: 1, publishedVersion: 1, hasUnpublishedChanges: false });
    expect(library.serverInfo(`${[...PRESET_IDS][0]}`)).toBeNull();
    expect(library.modeReason).toBeNull();
  });

  it('không hiện icon trong localStorage cho tới khi đồng bộ; đếm đúng số icon chỉ ở trình duyệt', async () => {
    localStore.setDocs([...localStore.getSnapshot().docs, icon('local-1', 'Chỉ ở trình duyệt'), icon('local-2', 'Cũng vậy')]);
    mockServer.seed(icon('a'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.ready).toBe(true));

    expect(result.current.library.get('local-1')).toBeUndefined();
    expect(result.current.library.localOnlyCount).toBe(2);
  });

  it('syncLocalToServer đẩy icon lên, số "chỉ ở trình duyệt" về 0 và icon hiện trong thư viện', async () => {
    localStore.setDocs([...localStore.getSnapshot().docs, icon('local-1', 'Một'), icon('local-2', 'Hai')]);
    const { result } = mount();
    await waitFor(() => expect(result.current.library.ready).toBe(true));

    let outcome = { pushed: -1, failed: -1 };
    await act(async () => {
      outcome = await result.current.library.syncLocalToServer();
    });

    expect(outcome).toEqual({ pushed: 2, failed: 0 });
    expect(result.current.library.localOnlyCount).toBe(0);
    expect(result.current.library.get('local-1')?.name).toBe('Một');
    expect(mockServer.rows.size).toBe(2);
  });

  it('lưu, nhân bản, xoá đi qua máy chủ; xoá là lưu trữ', async () => {
    mockServer.seed(icon('a', 'Gốc'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.ready).toBe(true));

    await act(async () => {
      await result.current.library.save(icon('moi', 'Mới tạo'));
    });
    expect(mockServer.rows.get('moi')?.summary.name).toBe('Mới tạo');

    let copyId = '';
    await act(async () => {
      copyId = (await result.current.library.duplicate('a'))?.id ?? '';
    });
    expect(mockServer.rows.has(copyId)).toBe(true);

    await act(async () => {
      await result.current.library.remove('a');
    });
    expect(result.current.library.get('a')).toBeUndefined();
    expect(mockServer.rows.get('a')?.summary.status).toBe('archived');
  });

  it('xung đột phiên bản được ném ra với mã để màn hình xử lý, và reloadFromServer(id) nạp bản mới nhất', async () => {
    mockServer.seed(icon('a', 'Bản một'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.ready).toBe(true));
    mockServer.externalSave({ ...icon('a', 'Của người khác'), shapes: [rect(9)] });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.library.save({ ...icon('a', 'Của tôi'), shapes: [rect(5)] });
      } catch (error) {
        caught = error;
      }
    });
    expect(caught).toMatchObject({ code: 'BRAND_ICON_VERSION_CONFLICT', currentVersion: 2 });
    expect(result.current.library.get('a')?.name).toBe('Bản một');

    await act(async () => {
      await result.current.library.reloadFromServer('a');
    });
    expect(result.current.library.get('a')?.name).toBe('Của người khác');
    expect(result.current.library.serverInfo('a')?.version).toBe(2);
  });

  it('phát hành bản mới nhất qua publish', async () => {
    mockServer.seed(icon('a'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.ready).toBe(true));

    await act(async () => {
      await result.current.library.publish('a');
    });

    expect(result.current.library.get('a')?.status).toBe('published');
    expect(result.current.library.serverInfo('a')?.publishedVersion).toBe(1);
  });
});

describe('useIconLibrary: rơi về chế độ cục bộ', () => {
  it('API chưa có (404): dùng localStorage, nêu lý do, mọi thao tác chạy cục bộ và không gọi thêm máy chủ', async () => {
    mockServer.failWith('GET icons', httpError(404, 'x'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.ready).toBe(true));

    expect(result.current.library.mode).toBe('local');
    expect(result.current.library.modeReason).toBe('Máy chủ chưa có API lưu icon.');
    expect(result.current.library.docs).toHaveLength(presetCount);
    expect(result.current.library.serverInfo('a')).toBeNull();
    expect(result.current.library.localOnlyCount).toBe(0);

    await act(async () => {
      await result.current.library.save(icon('cuc-bo', 'Cục bộ'));
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.docs) ?? '[]').some((doc: { id: string }) => doc.id === 'cuc-bo')).toBe(true);
    expect(mockServer.calls.filter((call) => call.startsWith('POST') || call.startsWith('PUT'))).toEqual([]);

    await act(async () => {
      await result.current.library.publish('cuc-bo');
    });
    expect(result.current.library.get('cuc-bo')?.status).toBe('published');
    await expect(result.current.library.syncLocalToServer()).resolves.toEqual({ pushed: 0, failed: 0 });
  });

  it('thử lại khi máy chủ đã chạy thì chuyển sang chế độ máy chủ và hiện số icon cục bộ chưa đồng bộ', async () => {
    mockServer.failWith('GET icons', httpError(404, 'x'));
    mockServer.seed(icon('a', 'Trên máy chủ'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.mode).toBe('local'));
    await act(async () => {
      await result.current.library.save(icon('cuc-bo', 'Cục bộ'));
    });

    mockServer.clearFailures();
    await act(async () => {
      await result.current.library.reloadFromServer();
    });
    await waitFor(() => expect(result.current.library.ready).toBe(true));

    expect(result.current.library.mode).toBe('server');
    expect(result.current.library.get('a')?.name).toBe('Trên máy chủ');
    expect(result.current.library.localOnlyCount).toBe(1);
  });
});

describe('useBrandSettings: máy chủ', () => {
  async function connected() {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.library.ready).toBe(true));
    return hook;
  }

  it('lấy bảng màu và quy chuẩn từ máy chủ; chưa lưu lần nào thì là mặc định', async () => {
    const { result } = await connected();

    expect(result.current.settings.mode).toBe('server');
    expect(result.current.settings.ready).toBe(true);
    expect(result.current.settings.palette.tokens).toEqual(DEFAULT_PALETTE.tokens);
    expect(result.current.settings.rules).toEqual(DEFAULT_RULES);
    expect(result.current.settings.error).toBeNull();
  });

  it('bản sao lần trước giúp sẵn sàng ngay từ lúc kiểm tra kết nối, rồi nhận bản máy chủ', async () => {
    mockServer.standards = { version: 2, palette: palette('#112233'), rules: DEFAULT_RULES };
    window.localStorage.setItem(STANDARDS_CACHE_KEY, JSON.stringify({ version: 2, palette: palette('#112233'), rules: DEFAULT_RULES }));
    const { result } = mount();

    expect(result.current.settings.mode).toBe('checking');
    expect(result.current.settings.ready).toBe(true);
    expect(result.current.settings.palette.tokens[0].hex).toBe('#112233');

    await waitFor(() => expect(result.current.settings.mode).toBe('server'));
    expect(result.current.settings.palette.tokens[0].hex).toBe('#112233');
  });

  it('không có bản sao thì chờ máy chủ mới sẵn sàng; bản sao hỏng bị bỏ qua', async () => {
    window.localStorage.setItem(STANDARDS_CACHE_KEY, '{không phải json');
    const { result } = mount();

    expect(result.current.settings.ready).toBe(false);
    await waitFor(() => expect(result.current.settings.ready).toBe(true));
  });

  it('bản sao cũ hơn máy chủ thì lấy bản máy chủ', async () => {
    mockServer.standards = { version: 5, palette: palette('#abcdef'), rules: DEFAULT_RULES };
    window.localStorage.setItem(STANDARDS_CACHE_KEY, JSON.stringify({ version: 3, palette: palette('#112233'), rules: DEFAULT_RULES }));
    const { result } = mount();

    await waitFor(() => expect(result.current.settings.mode).toBe('server'));

    expect(result.current.settings.palette.tokens[0].hex).toBe('#abcdef');
  });

  it('sửa bảng màu hiện ngay nhưng chỉ gửi một lần sau khi ngừng sửa, kèm baseVersion', async () => {
    mockServer.standards = { version: 3, palette: DEFAULT_PALETTE, rules: DEFAULT_RULES };
    const { result } = await connected();
    jest.useFakeTimers();

    act(() => result.current.settings.setPalette(palette('#111111')));
    act(() => result.current.settings.setPalette(palette('#222222')));
    act(() => result.current.settings.setPalette(palette('#333333')));
    expect(result.current.settings.palette.tokens[0].hex).toBe('#333333');
    expect(puts()).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(STANDARDS_DEBOUNCE_MS - 1);
    });
    expect(puts()).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await remoteStore.flushStandards();
    });

    expect(puts()).toHaveLength(1);
    expect(mockServer.standards.version).toBe(4);
    expect(mockServer.standards.palette.tokens[0].hex).toBe('#333333');
    expect(result.current.settings.saving).toBe(false);
    expect(result.current.settings.error).toBeNull();

    act(() => result.current.settings.setPalette(palette('#444444')));
    await act(async () => {
      await remoteStore.flushStandards();
    });
    expect(mockServer.standards.version).toBe(5);
    expect(JSON.parse(window.localStorage.getItem(STANDARDS_CACHE_KEY) ?? '{}')).toMatchObject({ version: 5 });
  });

  it('dữ liệu gửi đi được chuẩn hoá: màu sai mã bị bỏ', async () => {
    const { result } = await connected();

    act(() => {
      result.current.settings.setPalette({
        tokens: [
          { key: 'tot', label: 'Tốt', hex: '#ABC' },
          { key: 'sai', label: 'Sai', hex: 'khong-phai-mau' },
        ],
      });
    });
    await act(async () => {
      await remoteStore.flushStandards();
    });

    expect(mockServer.standards.palette.tokens).toEqual([{ key: 'tot', label: 'Tốt', hex: '#aabbcc' }]);
  });

  it('sửa quy chuẩn cũng đi qua cùng đường, giữ nguyên bảng màu', async () => {
    mockServer.standards = { version: 1, palette: palette('#112233'), rules: DEFAULT_RULES };
    const { result } = await connected();

    act(() => result.current.settings.setRules({ ...result.current.settings.rules, snapStep: 2 }));
    await act(async () => {
      await remoteStore.flushStandards();
    });

    expect(mockServer.standards.rules.snapStep).toBe(2);
    expect(mockServer.standards.palette.tokens[0].hex).toBe('#112233');
  });

  it('xung đột: nạp lại bản mới nhất, không ghi đè bản của người khác, báo cho người dùng', async () => {
    mockServer.standards = { version: 1, palette: DEFAULT_PALETTE, rules: DEFAULT_RULES };
    const { result } = await connected();
    // Người khác lưu trước.
    mockServer.standards = { version: 2, palette: palette('#999999'), rules: DEFAULT_RULES };

    act(() => result.current.settings.setPalette(palette('#111111')));
    await act(async () => {
      await remoteStore.flushStandards();
    });

    expect(mockServer.standards.version).toBe(2);
    expect(mockServer.standards.palette.tokens[0].hex).toBe('#999999');
    expect(result.current.settings.palette.tokens[0].hex).toBe('#999999');
    expect(result.current.settings.error).toContain('Đã nạp bản mới nhất');
    expect(result.current.settings.saving).toBe(false);

    // Sửa tiếp trên bản mới thì lưu được.
    act(() => result.current.settings.setPalette(palette('#777777')));
    await act(async () => {
      await remoteStore.flushStandards();
    });
    expect(mockServer.standards.version).toBe(3);
    expect(result.current.settings.error).toBeNull();
  });

  it('lỗi mạng khi lưu: giữ thay đổi, báo lỗi, lần sửa kế tiếp thử lại và xoá lỗi', async () => {
    const { result } = await connected();
    mockServer.failWith('PUT standards', httpError(503, 'Máy chủ bận.'), 1);

    act(() => result.current.settings.setPalette(palette('#111111')));
    await act(async () => {
      await remoteStore.flushStandards();
    });
    expect(result.current.settings.error).toBe('Chưa lưu được bảng màu: Máy chủ bận.');
    expect(result.current.settings.palette.tokens[0].hex).toBe('#111111');
    expect(mockServer.standards.version).toBe(0);

    act(() => result.current.settings.setPalette(palette('#222222')));
    await act(async () => {
      await remoteStore.flushStandards();
    });
    expect(result.current.settings.error).toBeNull();
    expect(mockServer.standards.palette.tokens[0].hex).toBe('#222222');
  });

  it('đặt lại mặc định gửi ngay, không chờ', async () => {
    mockServer.standards = { version: 1, palette: palette('#112233'), rules: { ...DEFAULT_RULES, snapStep: 2 } };
    const { result } = await connected();
    jest.useFakeTimers();

    await act(async () => {
      result.current.settings.reset();
      await remoteStore.flushStandards();
    });

    expect(puts()).toHaveLength(1);
    expect(mockServer.standards.palette).toEqual(DEFAULT_PALETTE);
    expect(mockServer.standards.rules).toEqual(DEFAULT_RULES);
  });

  it('sửa trong lúc đang kết nối (từ bản sao) vẫn được gửi khi máy chủ có cùng phiên bản', async () => {
    mockServer.standards = { version: 2, palette: palette('#112233'), rules: DEFAULT_RULES };
    window.localStorage.setItem(STANDARDS_CACHE_KEY, JSON.stringify({ version: 2, palette: palette('#112233'), rules: DEFAULT_RULES }));
    const { result } = mount();

    act(() => result.current.settings.setPalette(palette('#555555')));
    await waitFor(() => expect(result.current.library.ready).toBe(true));
    await act(async () => {
      await remoteStore.flushStandards();
    });

    expect(mockServer.standards.version).toBe(3);
    expect(mockServer.standards.palette.tokens[0].hex).toBe('#555555');
  });

  it('sửa trong lúc đang kết nối nhưng máy chủ đã có bản khác thì bỏ bản sửa và báo, không ghi đè', async () => {
    mockServer.standards = { version: 4, palette: palette('#999999'), rules: DEFAULT_RULES };
    window.localStorage.setItem(STANDARDS_CACHE_KEY, JSON.stringify({ version: 2, palette: palette('#112233'), rules: DEFAULT_RULES }));
    const { result } = mount();

    act(() => result.current.settings.setPalette(palette('#555555')));
    await waitFor(() => expect(result.current.library.ready).toBe(true));
    await act(async () => {
      await remoteStore.flushStandards();
    });

    expect(mockServer.standards.version).toBe(4);
    expect(result.current.settings.palette.tokens[0].hex).toBe('#999999');
    expect(result.current.settings.error).toContain('Đã nạp bản mới nhất');
  });
});

describe('useBrandSettings: chế độ cục bộ', () => {
  it('lưu vào localStorage như trước và không gọi máy chủ', async () => {
    mockServer.failWith('GET standards', httpError(404, 'x'));
    const { result } = mount();
    await waitFor(() => expect(result.current.library.mode).toBe('local'));

    act(() => result.current.settings.setPalette(palette('#123456')));

    expect(result.current.settings.mode).toBe('local');
    expect(result.current.settings.ready).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.palette) ?? '{}').tokens[0].hex).toBe('#123456');
    expect(puts()).toHaveLength(0);
  });
});
