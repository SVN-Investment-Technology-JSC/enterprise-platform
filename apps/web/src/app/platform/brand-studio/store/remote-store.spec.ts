import { PRESET_IDS, createDocument, createShape, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { remoteStore, SPEC_CONCURRENCY } from './remote-store';
import { createFakeBrandServer, httpError, networkError, type FakeBrandServer } from './testing/fake-brand-server';

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

const icon = (id: string, name = id, overrides: Partial<IconDocument> = {}): IconDocument =>
  createDocument({
    id,
    name,
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' })],
    ...overrides,
  });

const specCalls = () => mockServer.calls.filter((call) => /\/spec/.test(call));

async function connect() {
  remoteStore.getSnapshot();
  await remoteStore.settled();
  return remoteStore.getSnapshot();
}

beforeEach(() => {
  mockServer = createFakeBrandServer();
  remoteStore.resetForTest();
  window.localStorage.clear();
  Object.defineProperty(globalThis, 'fetch', { value: jest.fn(), configurable: true, writable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('remoteStore: kết nối lần đầu', () => {
  it('chưa trả lời thì đang kiểm tra và chưa sẵn sàng; bản chụp phía máy chủ luôn là khung chờ', () => {
    const first = remoteStore.getSnapshot();
    expect(first.mode).toBe('checking');
    expect(first.ready).toBe(false);
    expect(first.docs).toHaveLength(0);

    expect(remoteStore.getServerSnapshot().mode).toBe('checking');
    expect(remoteStore.getServerSnapshot().ready).toBe(false);
  });

  it('nối được thì sang chế độ máy chủ, nạp danh sách và spec rồi mới sẵn sàng', async () => {
    mockServer.seed(icon('a', 'Một'));
    mockServer.seed(icon('b', 'Hai'), 'published');

    const snap = await connect();

    expect(snap.mode).toBe('server');
    expect(snap.ready).toBe(true);
    expect(snap.loading).toBe(false);
    expect(snap.error).toBeNull();
    expect(snap.docsById.get('a')?.name).toBe('Một');
    expect(snap.docsById.get('a')?.status).toBe('draft');
    expect(snap.docsById.get('b')?.status).toBe('published');
    expect(mockServer.calls.slice(0, 2).sort()).toEqual(['GET icons', 'GET standards']);
    expect(snap.standards?.version).toBe(0);
  });

  it('icon mẫu luôn hiện nếu máy chủ chưa có bản cùng mã; có rồi thì dùng bản máy chủ, không lặp', async () => {
    const [presetId] = [...PRESET_IDS];
    mockServer.seed(icon('a'));
    mockServer.seed(icon(presetId, 'Mẫu đã sửa'));

    const { docs } = await connect();

    expect(docs).toHaveLength(1 + presetCount);
    expect(docs.filter((doc) => doc.id === presetId)).toHaveLength(1);
    expect(docs.find((doc) => doc.id === presetId)?.name).toBe('Mẫu đã sửa');
  });

  it('icon đã lưu trữ không hiện trong thư viện nhưng vẫn nằm trong danh sách tóm tắt', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('cu'), 'archived');

    const snap = await connect();

    expect(snap.docsById.has('cu')).toBe(false);
    expect(snap.summaries.get('cu')?.status).toBe('archived');
    expect(specCalls().some((call) => call.includes('/cu/'))).toBe(false);
  });

  it('nạp spec với tối đa 6 yêu cầu cùng lúc', async () => {
    for (let index = 0; index < 20; index += 1) mockServer.seed(icon(`i-${index}`));

    const snap = await connect();

    expect(SPEC_CONCURRENCY).toBe(6);
    expect(specCalls()).toHaveLength(20);
    expect(mockServer.maxConcurrentSpecs).toBeGreaterThan(1);
    expect(mockServer.maxConcurrentSpecs).toBeLessThanOrEqual(6);
    expect(snap.docs.filter((doc) => doc.id.startsWith('i-'))).toHaveLength(20);
  });

  it('một icon không nạp được spec thì báo lỗi gọn, các icon khác vẫn hiện, nạp lại thì khôi phục', async () => {
    mockServer.seed(icon('tot'));
    mockServer.seed(icon('hong'));
    mockServer.failWith(/hong\/spec/, httpError(502, 'Kho tạm không dùng được.'));

    const snap = await connect();

    expect(snap.mode).toBe('server');
    expect(snap.ready).toBe(true);
    expect(snap.error).toBe('Không nạp được 1 icon từ máy chủ.');
    expect(snap.docsById.has('tot')).toBe(true);
    expect(snap.docsById.has('hong')).toBe(false);

    mockServer.clearFailures();
    await remoteStore.reload();
    expect(remoteStore.getSnapshot().error).toBeNull();
    expect(remoteStore.getSnapshot().docsById.has('hong')).toBe(true);
  });
});

describe('remoteStore: rơi về chế độ cục bộ', () => {
  it.each([
    ['404 chưa có API', httpError(404, 'Máy chủ chưa có API lưu icon.'), 'Máy chủ chưa có API lưu icon.'],
    ['500', httpError(500, 'Máy chủ đang gặp sự cố. Thử lại sau.'), 'Máy chủ đang gặp sự cố. Thử lại sau.'],
    ['mất mạng', networkError(), 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'],
    ['403 không có quyền', httpError(403, 'Chỉ quản trị Platform được dùng chức năng này.'), 'Không có quyền dùng kho icon trên máy chủ.'],
  ])('lần thử đầu gặp %s thì dùng localStorage và nêu lý do', async (_name, error, reason) => {
    mockServer.failWith('GET icons', error);

    const snap = await connect();

    expect(snap.mode).toBe('local');
    expect(snap.localReason).toBe(reason);
    expect(snap.loading).toBe(false);
  });

  it('bảng màu lỗi cũng làm lần thử đầu thất bại (chưa dùng được máy chủ)', async () => {
    mockServer.failWith('GET standards', httpError(500, 'Lỗi.'));

    expect((await connect()).mode).toBe('local');
  });

  it('trình duyệt không có fetch thì vào chế độ cục bộ ngay, không chờ', () => {
    Reflect.deleteProperty(globalThis, 'fetch');
    remoteStore.resetForTest();

    const snap = remoteStore.getSnapshot();

    expect(snap.mode).toBe('local');
    expect(snap.localReason).toContain('không hỗ trợ');
    expect(mockServer.calls).toHaveLength(0);
  });

  it('chỉ thử một lần khi khởi tạo; reload ở chế độ cục bộ là thử kết nối lại và sang máy chủ nếu được', async () => {
    mockServer.seed(icon('a', 'Một'));
    mockServer.failWith('GET icons', networkError());
    expect((await connect()).mode).toBe('local');
    expect(mockServer.calls.filter((call) => call === 'GET icons')).toHaveLength(1);

    mockServer.clearFailures();
    await remoteStore.reload();

    const snap = remoteStore.getSnapshot();
    expect(snap.mode).toBe('server');
    expect(snap.localReason).toBeNull();
    expect(snap.docsById.get('a')?.name).toBe('Một');
  });

  it('thử lại vẫn không được thì ở nguyên chế độ cục bộ', async () => {
    mockServer.failWith('GET icons', httpError(404, 'x'));
    await connect();

    await remoteStore.reload();

    expect(remoteStore.getSnapshot().mode).toBe('local');
    expect(remoteStore.getSnapshot().loading).toBe(false);
  });

  it('sau khi đã vào chế độ máy chủ, reload lỗi chỉ báo lỗi và giữ dữ liệu, không quay về cục bộ', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    mockServer.failWith('GET icons', httpError(503, 'Máy chủ bận.'));

    await expect(remoteStore.reload()).rejects.toThrow('Máy chủ bận.');

    const snap = remoteStore.getSnapshot();
    expect(snap.mode).toBe('server');
    expect(snap.error).toBe('Máy chủ bận.');
    expect(snap.docsById.get('a')?.name).toBe('Một');
  });
});

describe('remoteStore: bộ nhớ đệm bất biến theo (mã, phiên bản)', () => {
  it('nạp lại không tải lại spec của phiên bản đã có', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('b'));
    await connect();
    const before = specCalls().length;

    await remoteStore.reload();
    await remoteStore.reload();

    expect(specCalls()).toHaveLength(before);
  });

  it('chỉ tải spec của icon có phiên bản mới, đúng phiên bản đó', async () => {
    mockServer.seed(icon('a', 'Cũ'));
    mockServer.seed(icon('b'));
    await connect();
    const before = specCalls().length;

    mockServer.externalSave(icon('a', 'Mới do người khác'));
    await remoteStore.reload();

    expect(specCalls().slice(before)).toEqual(['GET icons/a/spec?version=2']);
    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Mới do người khác');
    expect(remoteStore.getSnapshot().summaries.get('a')?.currentVersion).toBe(2);
  });

  it('đổi trạng thái phát hành không làm tải lại spec', async () => {
    mockServer.seed(icon('a'));
    await connect();
    const before = specCalls().length;

    await mockServer.api.publishIcon('a');
    await remoteStore.reload();

    expect(specCalls()).toHaveLength(before);
    expect(remoteStore.getSnapshot().docsById.get('a')?.status).toBe('published');
  });

  it('trong lúc nạp bản mới, icon vẫn hiện bằng bản cũ thay vì biến mất', async () => {
    mockServer.seed(icon('a', 'Bản một'));
    await connect();
    mockServer.externalSave(icon('a', 'Bản hai'));
    const seen: string[] = [];
    mockServer.onRequest('GET icons/a/spec?version=2', async () => {
      seen.push(remoteStore.getSnapshot().docsById.get('a')?.name ?? '(mất)');
    });

    await remoteStore.reload();

    expect(seen).toEqual(['Bản một']);
    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Bản hai');
  });

  it('nạp lại danh sách không đè bản vừa ghi sau khi lần nạp bắt đầu', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    const current = remoteStore.getSummary('a');
    if (!current) throw new Error('thiếu icon a');
    mockServer.onRequest('GET icons', async () => {
      remoteStore.commit({ ...current, currentVersion: 2, name: 'Vừa lưu' });
    });

    await remoteStore.reload();

    expect(remoteStore.getSummary('a')?.currentVersion).toBe(2);
    expect(remoteStore.getSummary('a')?.name).toBe('Vừa lưu');
  });
});

describe('remoteStore: reloadIcon', () => {
  it('nạp phiên bản mới nhất của một icon và bỏ phần hiện tạm của người dùng', async () => {
    mockServer.seed(icon('a', 'Một'));
    mockServer.seed(icon('b', 'Hai'));
    await connect();
    remoteStore.begin('a', icon('a', 'Đang sửa dở'));
    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Đang sửa dở');
    mockServer.externalSave(icon('a', 'Của người khác'));
    const before = mockServer.calls.length;

    await remoteStore.reloadIcon('a');

    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Của người khác');
    expect(mockServer.calls.slice(before)).toEqual(['GET icons/a', 'GET icons/a/spec?version=2']);
  });

  it('lỗi thì ném lại và giữ nguyên thay đổi chưa ghi', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    remoteStore.begin('a', icon('a', 'Đang sửa dở'));
    mockServer.failWith('GET icons/a', httpError(503, 'Máy chủ bận.'));

    await expect(remoteStore.reloadIcon('a')).rejects.toThrow('Máy chủ bận.');

    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Đang sửa dở');
  });
});

describe('remoteStore: thay đổi lạc quan', () => {
  it('begin hiện ngay, revert trở về bản máy chủ, commit nhận bản máy chủ làm sự thật', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();

    remoteStore.begin('a', icon('a', 'Tạm'));
    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Tạm');
    remoteStore.revert('a');
    expect(remoteStore.getSnapshot().docsById.get('a')?.name).toBe('Một');

    remoteStore.begin('a', null);
    expect(remoteStore.getSnapshot().docsById.has('a')).toBe(false);
    remoteStore.revert('a');
    expect(remoteStore.getSnapshot().docsById.has('a')).toBe(true);
  });

  it('icon vừa tạo (chưa có trên máy chủ) hiện ngay và biến mất khi hoàn lại', async () => {
    await connect();

    remoteStore.begin('moi', icon('moi', 'Mới tạo'));
    expect(remoteStore.getSnapshot().docsById.get('moi')?.name).toBe('Mới tạo');

    remoteStore.revert('moi');
    expect(remoteStore.getSnapshot().docsById.has('moi')).toBe(false);
  });

  it('bản chụp giữ nguyên tham chiếu icon không đổi qua các lần cập nhật (tránh vẽ lại cả thư viện)', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('b'));
    await connect();
    const before = remoteStore.getSnapshot().docsById.get('a');

    remoteStore.begin('b', icon('b', 'Đổi tên'));

    expect(remoteStore.getSnapshot().docsById.get('a')).toBe(before);
  });
});
