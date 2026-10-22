import { PRESET_IDS, createDocument, createPresetDocuments, createShape, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { BrandApiError } from './brand-api';
import { localStore } from './local-store';
import {
  duplicateOnServer,
  importToServer,
  publishOnServer,
  removeFromServer,
  removeManyFromServer,
  resetPresetOnServer,
  saveManyToServer,
  saveToServer,
  serverInfoOf,
  syncLocalToServer,
} from './remote-library';
import { remoteStore } from './remote-store';
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

const [presetId] = [...PRESET_IDS];

const rect = (x = 4) => createShape({ type: 'rect', x, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' });
const icon = (id: string, name = id, overrides: Partial<IconDocument> = {}): IconDocument => createDocument({ id, name, shapes: [rect()], ...overrides });

const writes = () => mockServer.calls.filter((call) => /^(POST|PUT|DELETE) /.test(call));
const docOf = (id: string) => remoteStore.getSnapshot().docsById.get(id);

async function connect() {
  remoteStore.getSnapshot();
  await remoteStore.settled();
}

async function rejection(task: Promise<unknown>): Promise<BrandApiError> {
  try {
    await task;
  } catch (error) {
    if (error instanceof BrandApiError) return error;
    throw error;
  }
  throw new Error('Mong đợi lời gọi bị lỗi');
}

beforeEach(async () => {
  mockServer = createFakeBrandServer();
  remoteStore.resetForTest();
  window.localStorage.clear();
  localStore.reloadForTest();
  Object.defineProperty(globalThis, 'fetch', { value: jest.fn(), configurable: true, writable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('saveToServer: tạo mới', () => {
  it('icon chưa có trên máy chủ thì POST, hiện ngay và dùng bản chuẩn hoá làm spec (không tải lại)', async () => {
    await connect();
    const specCallsBefore = mockServer.calls.filter((call) => call.includes('/spec')).length;

    const saved = await saveToServer(icon('moi', 'Icon mới'));

    expect(writes()).toEqual(['POST icons']);
    expect(saved.id).toBe('moi');
    expect(docOf('moi')?.name).toBe('Icon mới');
    expect(remoteStore.getSummary('moi')?.currentVersion).toBe(1);
    expect(mockServer.calls.filter((call) => call.includes('/spec'))).toHaveLength(specCallsBefore);
    expect(mockServer.rows.get('moi')?.versions.get(1)?.status).toBe('draft');
  });

  it('trạng thái "Phát hành" thì phát hành ngay sau khi tạo', async () => {
    await connect();

    const saved = await saveToServer(icon('moi', 'Icon mới', { status: 'published' }));

    expect(writes()).toEqual(['POST icons', 'POST icons/moi/publish']);
    expect(saved.status).toBe('published');
    expect(remoteStore.getSummary('moi')?.publishedVersion).toBe(1);
  });

  it('icon mẫu chỉnh sửa lần đầu được tạo trên máy chủ với đúng mã mẫu', async () => {
    await connect();
    const preset = createPresetDocuments()[0];

    await saveToServer({ ...preset, name: 'Mẫu đã đổi tên', status: 'draft' });

    expect(mockServer.rows.has(preset.id)).toBe(true);
    expect(docOf(preset.id)?.name).toBe('Mẫu đã đổi tên');
    expect(remoteStore.getSnapshot().docs.filter((doc) => doc.id === preset.id)).toHaveLength(1);
  });

  it('máy chủ từ chối thì hoàn lại: icon biến mất và lỗi được ném nguyên', async () => {
    await connect();
    mockServer.failWith('POST icons', httpError(503, 'Kho lưu trữ tạm thời không khả dụng.'));
    const seen: boolean[] = [];

    const failing = rejection(saveToServer(icon('moi')));
    seen.push(docOf('moi') !== undefined);
    const error = await failing;

    expect(seen).toEqual([true]);
    expect(error.message).toBe('Kho lưu trữ tạm thời không khả dụng.');
    expect(docOf('moi')).toBeUndefined();
    expect(mockServer.rows.has('moi')).toBe(false);
  });
});

describe('saveToServer: ghi phiên bản mới', () => {
  it('PUT với baseVersion là phiên bản đang giữ, tăng phiên bản và không tải lại spec', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    const before = mockServer.calls.length;

    await saveToServer({ ...icon('a', 'Một đã sửa'), shapes: [rect(5)] });
    await saveToServer({ ...icon('a', 'Một sửa lần hai'), shapes: [rect(6)] });

    expect(mockServer.calls.slice(before)).toEqual(['PUT icons/a', 'PUT icons/a']);
    expect(remoteStore.getSummary('a')?.currentVersion).toBe(3);
    expect(docOf('a')?.name).toBe('Một sửa lần hai');
    expect(mockServer.rows.get('a')?.versions.size).toBe(3);
  });

  it('hiện ngay trong lúc chờ máy chủ', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    const seen: Array<string | undefined> = [];
    mockServer.onRequest('PUT icons/a', async () => {
      seen.push(docOf('a')?.name);
    });

    await saveToServer({ ...icon('a', 'Tên mới'), shapes: [rect(5)] });

    expect(seen).toEqual(['Tên mới']);
  });

  it('xung đột phiên bản: ném lỗi mang mã và phiên bản hiện hành, không ghi đè, thư viện giữ bản máy chủ', async () => {
    mockServer.seed(icon('a', 'Bản một'));
    await connect();
    mockServer.externalSave({ ...icon('a', 'Của người khác'), shapes: [rect(9)] });

    const error = await rejection(saveToServer({ ...icon('a', 'Bản của tôi'), shapes: [rect(5)] }));

    expect(error.isVersionConflict).toBe(true);
    expect(error.code).toBe('BRAND_ICON_VERSION_CONFLICT');
    expect(error.currentVersion).toBe(2);
    expect(mockServer.rows.get('a')?.summary.currentVersion).toBe(2);
    expect(mockServer.rows.get('a')?.versions.get(2)?.name).toBe('Của người khác');
    // Bản đang giữ vẫn là bản cũ (chưa nạp bản của người khác), không phải bản chưa lưu của người dùng.
    expect(docOf('a')?.name).toBe('Bản một');
    expect(remoteStore.getSummary('a')?.currentVersion).toBe(1);
  });

  it('gửi lại đúng nội dung sau khi mất phản hồi thì máy chủ trả "không đổi" và không báo xung đột', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    const edited = { ...icon('a', 'Đã sửa'), shapes: [rect(5)] };
    mockServer.failWith('PUT icons/a', networkError(), 1);
    // Máy chủ đã nhận bản sửa nhưng trình duyệt không thấy phản hồi.
    mockServer.onRequest('PUT icons/a', async () => {
      if (mockServer.rows.get('a')?.summary.currentVersion === 1) mockServer.externalSave(edited);
    });

    await rejection(saveToServer(edited));
    const saved = await saveToServer(edited);

    expect(saved.name).toBe('Đã sửa');
    expect(mockServer.rows.get('a')?.summary.currentVersion).toBe(2);
  });
});

describe('saveToServer: đổi trạng thái phát hành', () => {
  it('chỉ đổi trạng thái (nội dung y nguyên) thì không tạo phiên bản, chỉ phát hành rồi gỡ', async () => {
    mockServer.seed(icon('a'));
    await connect();
    const before = mockServer.calls.length;

    await saveToServer({ ...(docOf('a') as IconDocument), status: 'published' });
    expect(docOf('a')?.status).toBe('published');
    await saveToServer({ ...(docOf('a') as IconDocument), status: 'draft' });
    expect(docOf('a')?.status).toBe('draft');

    expect(mockServer.calls.slice(before)).toEqual(['POST icons/a/publish', 'POST icons/a/unpublish']);
    expect(remoteStore.getSummary('a')?.currentVersion).toBe(1);
  });

  it('sửa nội dung icon đã phát hành thì chỉ lưu phiên bản mới, bản công khai giữ nguyên cho tới khi phát hành lại', async () => {
    mockServer.seed(icon('a'), 'published');
    await connect();

    await saveToServer({ ...(docOf('a') as IconDocument), shapes: [rect(7)] });

    const summary = remoteStore.getSummary('a');
    expect(writes()).toEqual(['PUT icons/a']);
    expect(summary?.currentVersion).toBe(2);
    expect(summary?.publishedVersion).toBe(1);
    expect(summary?.hasUnpublishedChanges).toBe(true);
    expect(docOf('a')?.status).toBe('published');
  });

  it('phát hành bản mới nhất bằng publishOnServer', async () => {
    mockServer.seed(icon('a'), 'published');
    await connect();
    await saveToServer({ ...(docOf('a') as IconDocument), shapes: [rect(7)] });

    const published = await publishOnServer('a');

    expect(published?.status).toBe('published');
    expect(remoteStore.getSummary('a')?.publishedVersion).toBe(2);
    expect(remoteStore.getSummary('a')?.hasUnpublishedChanges).toBe(false);
  });

  it('publishOnServer không gọi máy chủ khi bản mới nhất đã phát hành; icon lạ trả null', async () => {
    mockServer.seed(icon('a'), 'published');
    await connect();

    await publishOnServer('a');
    await expect(publishOnServer('khong-co')).resolves.toBeNull();

    expect(writes()).toEqual([]);
  });

  it('chưa đủ điều kiện phát hành: bản đã lưu vẫn được giữ, lỗi nói rõ phần đã lưu', async () => {
    mockServer.seed(icon('a'));
    await connect();

    const error = await rejection(saveToServer({ ...(docOf('a') as IconDocument), shapes: [], status: 'published' }));

    expect(error.code).toBe('BRAND_ICON_NOT_PUBLISHABLE');
    expect(error.message).toContain('Đã lưu icon nhưng chưa phát hành được.');
    expect(error.message).toContain('chưa có hình nào hiển thị');
    expect(remoteStore.getSummary('a')?.currentVersion).toBe(2);
    expect(remoteStore.getSummary('a')?.status).toBe('draft');
    expect(docOf('a')?.shapes).toHaveLength(0);
  });

  it('phát hành bị từ chối thì hoàn lại trạng thái hiện tạm', async () => {
    mockServer.seed(icon('a', 'Một', { shapes: [] }));
    await connect();

    await rejection(publishOnServer('a'));

    expect(docOf('a')?.status).toBe('draft');
  });
});

describe('xoá = lưu trữ', () => {
  it('remove gọi DELETE, icon biến mất khỏi thư viện nhưng dữ liệu còn trên máy chủ', async () => {
    mockServer.seed(icon('a', 'Một'), 'published');
    await connect();

    await removeFromServer('a');

    expect(writes()).toEqual(['DELETE icons/a']);
    expect(docOf('a')).toBeUndefined();
    expect(remoteStore.getSummary('a')?.status).toBe('archived');
    expect(mockServer.rows.get('a')?.versions.size).toBe(1);
  });

  it('lỗi thì icon trở lại thư viện và lỗi được ném', async () => {
    mockServer.seed(icon('a', 'Một'));
    await connect();
    mockServer.failWith('DELETE icons/a', httpError(503, 'Máy chủ bận.'));

    await expect(removeFromServer('a')).rejects.toThrow('Máy chủ bận.');

    expect(docOf('a')?.name).toBe('Một');
    expect(remoteStore.getSummary('a')?.status).toBe('draft');
  });

  it('icon mẫu không xoá được và icon lạ bị bỏ qua mà không gọi máy chủ', async () => {
    await connect();

    await removeFromServer(presetId);
    await removeFromServer('khong-co');

    expect(writes()).toEqual([]);
    expect(docOf(presetId)).toBeDefined();
  });

  it('removeMany lưu trữ các icon tự tạo, giữ icon mẫu và trả số đã lưu trữ', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('b'));
    await connect();

    const removed = await removeManyFromServer(['a', 'b', presetId, 'khong-co']);

    expect(removed).toBe(2);
    expect(docOf('a')).toBeUndefined();
    expect(docOf('b')).toBeUndefined();
    expect(docOf(presetId)).toBeDefined();
    expect(writes().sort()).toEqual(['DELETE icons/a', 'DELETE icons/b']);
  });

  it('removeMany lỗi một phần: báo số đã làm được, icon lỗi vẫn còn trong thư viện', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('b'));
    await connect();
    mockServer.failWith('DELETE icons/b', httpError(503, 'Máy chủ bận.'));

    await expect(removeManyFromServer(['a', 'b'])).rejects.toThrow('Đã lưu trữ 1/2 icon. Máy chủ bận.');

    expect(docOf('a')).toBeUndefined();
    expect(docOf('b')).toBeDefined();
  });

  it('removeMany lỗi toàn bộ thì ném thẳng lỗi đầu tiên', async () => {
    mockServer.seed(icon('a'));
    await connect();
    mockServer.failWith(/^DELETE/, httpError(503, 'Máy chủ bận.'));

    await expect(removeManyFromServer(['a'])).rejects.toThrow('Máy chủ bận.');
  });
});

describe('nhân bản, nhập, đặt lại, lưu nhiều', () => {
  it('duplicate tạo bản nháp mới trên máy chủ; icon không có thì trả null', async () => {
    mockServer.seed(icon('a', 'Gốc', { category: 'brand' }), 'published');
    await connect();

    const copy = await duplicateOnServer('a');

    expect(copy?.name).toBe('Gốc (bản sao)');
    expect(copy?.status).toBe('draft');
    expect(copy?.category).toBe('custom');
    expect(copy?.id).not.toBe('a');
    expect(mockServer.rows.has(copy?.id ?? '')).toBe(true);
    expect(writes()).toEqual(['POST icons']);
    await expect(duplicateOnServer('khong-co')).resolves.toBeNull();
  });

  it('duplicate được cả icon mẫu chưa có trên máy chủ', async () => {
    await connect();

    const copy = await duplicateOnServer(presetId);

    expect(copy?.id).not.toBe(presetId);
    expect(mockServer.rows.size).toBe(1);
  });

  it('importDocs đổi mã khi trùng mã trong thư viện, trong máy chủ (kể cả đã lưu trữ) và trong chính tệp', async () => {
    mockServer.seed(icon('co-san', 'Có sẵn'));
    mockServer.seed(icon('cu', 'Cũ'), 'archived');
    await connect();

    const added = await importToServer([
      icon('co-san', 'Trùng thư viện'),
      icon('cu', 'Trùng bản lưu trữ'),
      icon(presetId, 'Trùng mẫu'),
      icon('trong-tep', 'Một'),
      icon('trong-tep', 'Hai'),
      icon('moi', 'Mới'),
    ]);

    expect(added).toBe(6);
    expect(mockServer.rows.get('co-san')?.versions.get(1)?.name).toBe('Có sẵn');
    expect(mockServer.rows.get('cu')?.versions.get(1)?.name).toBe('Cũ');
    const names = [...mockServer.rows.values()].map((row) => row.summary.name);
    expect(names).toEqual(expect.arrayContaining(['Trùng thư viện', 'Trùng bản lưu trữ', 'Trùng mẫu', 'Một', 'Hai', 'Mới']));
    expect(new Set([...mockServer.rows.keys()]).size).toBe(mockServer.rows.size);
  });

  it('importDocs lỗi một phần thì báo số đã nhập được', async () => {
    await connect();
    mockServer.failWith('POST icons', httpError(503, 'Máy chủ bận.'), 1);

    await expect(importToServer([icon('x1'), icon('x2'), icon('x3')])).rejects.toThrow(/^Chỉ nhập được 2\/3 icon\. Máy chủ bận\.$/);

    expect(mockServer.rows.size).toBe(2);
  });

  it('resetPreset đưa icon mẫu đã lưu trên máy chủ về bản gốc; chưa lưu thì không làm gì', async () => {
    await connect();
    await resetPresetOnServer(presetId);
    expect(writes()).toEqual([]);

    const preset = createPresetDocuments().find((item) => item.id === presetId) as IconDocument;
    await saveToServer({ ...preset, name: 'Đã đổi tên' });
    expect(docOf(presetId)?.name).toBe('Đã đổi tên');

    await resetPresetOnServer(presetId);

    expect(docOf(presetId)?.name).toBe(preset.name);
    expect(remoteStore.getSummary(presetId)?.currentVersion).toBe(2);
  });

  it('saveMany đổi trạng thái nhiều icon, không tạo phiên bản mới', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('b'));
    mockServer.seed(icon('c'));
    await connect();

    await saveManyToServer(['a', 'b', 'c'].map((id) => ({ ...(docOf(id) as IconDocument), status: 'published' as const })));

    expect(writes().every((call) => call.endsWith('/publish'))).toBe(true);
    expect(writes()).toHaveLength(3);
    expect(['a', 'b', 'c'].map((id) => docOf(id)?.status)).toEqual(['published', 'published', 'published']);
  });

  it('saveMany lỗi một phần: phần làm được vẫn lưu, lỗi nói rõ số lượng', async () => {
    mockServer.seed(icon('a'));
    mockServer.seed(icon('b', 'Hai', { shapes: [] }));
    await connect();

    await expect(saveManyToServer(['a', 'b'].map((id) => ({ ...(docOf(id) as IconDocument), status: 'published' as const })))).rejects.toThrow(
      /^Đã lưu 1\/2 icon\. /,
    );

    expect(docOf('a')?.status).toBe('published');
    expect(docOf('b')?.status).toBe('draft');
  });
});

describe('syncLocalToServer: đẩy icon chỉ có trong trình duyệt', () => {
  it('đẩy từng icon tự tạo lên máy chủ, bỏ qua icon mẫu còn nguyên, rồi không còn gì để đẩy', async () => {
    localStore.setDocs([...localStore.getSnapshot().docs, icon('local-1', 'Cục bộ một'), icon('local-2', 'Cục bộ hai', { status: 'published' })]);
    mockServer.seed(icon('local-3', 'Đã có trên máy chủ'));
    localStore.setDocs([...localStore.getSnapshot().docs, icon('local-3', 'Bản cũ trong trình duyệt')]);
    await connect();

    const result = await syncLocalToServer();

    expect(result).toEqual({ pushed: 2, failed: 0 });
    expect(mockServer.rows.get('local-1')?.summary.name).toBe('Cục bộ một');
    expect(mockServer.rows.get('local-2')?.summary.status).toBe('published');
    expect(mockServer.rows.get('local-3')?.versions.get(1)?.name).toBe('Đã có trên máy chủ');
    expect(docOf('local-1')?.name).toBe('Cục bộ một');
    expect(writes().filter((call) => call === 'POST icons')).toHaveLength(2);

    await expect(syncLocalToServer()).resolves.toEqual({ pushed: 0, failed: 0 });
  });

  it('icon mẫu đã sửa trong trình duyệt cũng được đẩy lên', async () => {
    const preset = createPresetDocuments()[0];
    localStore.setDocs(localStore.getSnapshot().docs.map((doc) => (doc.id === preset.id ? { ...doc, name: 'Mẫu tôi đã sửa', status: 'draft' as const } : doc)));
    await connect();

    const result = await syncLocalToServer();

    expect(result).toEqual({ pushed: 1, failed: 0 });
    expect(mockServer.rows.get(preset.id)?.summary.name).toBe('Mẫu tôi đã sửa');
  });

  it('icon nào lỗi thì tính vào failed, icon khác vẫn được đẩy; icon lỗi vẫn là "chỉ ở trình duyệt" để thử lại', async () => {
    localStore.setDocs([...localStore.getSnapshot().docs, icon('ok-1'), icon('hong-1'), icon('ok-2')]);
    await connect();
    mockServer.failWith('POST icons', httpError(503, 'Máy chủ bận.'), 1);

    const result = await syncLocalToServer();

    expect(result.pushed + result.failed).toBe(3);
    expect(result.failed).toBe(1);
    expect(mockServer.rows.size).toBe(2);

    const retry = await syncLocalToServer();
    expect(retry).toEqual({ pushed: 1, failed: 0 });
    expect(mockServer.rows.size).toBe(3);
  });

  it('phát hành không được thì icon vẫn lên máy chủ ở dạng nháp và tính là đã đẩy', async () => {
    localStore.setDocs([...localStore.getSnapshot().docs, icon('trong', 'Trống', { shapes: [], status: 'published' })]);
    await connect();

    const result = await syncLocalToServer();

    expect(result).toEqual({ pushed: 1, failed: 0 });
    expect(mockServer.rows.get('trong')?.summary.status).toBe('draft');
  });
});

describe('serverInfoOf', () => {
  it('trả phiên bản, bản phát hành và đường dẫn SVG; icon lưu trữ hoặc lạ trả null', async () => {
    mockServer.seed(icon('a'), 'published');
    mockServer.seed(icon('cu'), 'archived');
    await connect();
    await saveToServer({ ...(docOf('a') as IconDocument), shapes: [rect(7)] });
    const { summaries } = remoteStore.getSnapshot();

    expect(serverInfoOf(summaries, 'a')).toEqual({
      version: 2,
      publishedVersion: 1,
      hasUnpublishedChanges: true,
      svgUrl: '/api/platform/v1/brand/icons/a/svg?v=2&mode=brand',
      publicSvgUrl: '/api/platform/v1/brand/icons/a/svg?v=1&mode=brand',
    });
    expect(serverInfoOf(summaries, 'cu')).toBeNull();
    expect(serverInfoOf(summaries, 'khong-co')).toBeNull();
  });

  it('icon chưa phát hành thì không có đường dẫn công khai', async () => {
    mockServer.seed(icon('a'));
    await connect();

    expect(serverInfoOf(remoteStore.getSnapshot().summaries, 'a')?.publicSvgUrl).toBeNull();
  });
});
