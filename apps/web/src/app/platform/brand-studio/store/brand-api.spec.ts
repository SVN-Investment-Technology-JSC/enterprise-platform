import { createDocument } from '@enterprise-platform/shared-brand-icon';
import { authFetch } from '@enterprise-platform/shared-ui';
import {
  BrandApiError,
  archiveIcon,
  createIcon,
  errorMessage,
  getIcon,
  getIconSpec,
  getStandards,
  isBrandApiError,
  listIcons,
  publishIcon,
  restoreIcon,
  saveIcon,
  saveStandards,
  svgUrl,
  unpublishIcon,
} from './brand-api';

jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: jest.fn() }));

const mockFetch = jest.mocked(authFetch);

function reply(status: number, body?: unknown, raw?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => raw ?? (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const BASE = '/api/platform/v1/brand';
const doc = createDocument({ id: 'icon-1', name: 'Một' });

function lastCall() {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: String(url), init: init ?? {} };
}

async function failureOf(task: Promise<unknown>): Promise<BrandApiError> {
  try {
    await task;
  } catch (error) {
    if (error instanceof BrandApiError) return error;
    throw error;
  }
  throw new Error('Mong đợi lời gọi bị lỗi');
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('brand-api: yêu cầu', () => {
  it('listIcons gọi GET và không gửi thân; lọc trạng thái đi qua query', async () => {
    mockFetch.mockResolvedValue(reply(200, { icons: [] }));

    await expect(listIcons()).resolves.toEqual({ icons: [] });
    expect(lastCall().url).toBe(`${BASE}/icons`);
    expect(lastCall().init.method).toBe('GET');
    expect(lastCall().init.body).toBeUndefined();

    await listIcons({ status: ['draft', 'published'] });
    expect(lastCall().url).toBe(`${BASE}/icons?status=draft%2Cpublished`);
  });

  it('getIcon và getIconSpec mã hoá mã icon; spec nhận số phiên bản', async () => {
    mockFetch.mockResolvedValue(reply(200, {}));

    await getIcon('a b');
    expect(lastCall().url).toBe(`${BASE}/icons/a%20b`);

    await getIconSpec('icon-1');
    expect(lastCall().url).toBe(`${BASE}/icons/icon-1/spec`);

    await getIconSpec('icon-1', 3);
    expect(lastCall().url).toBe(`${BASE}/icons/icon-1/spec?version=3`);
  });

  it('createIcon gửi POST với thân JSON và kiểu nội dung', async () => {
    mockFetch.mockResolvedValue(reply(201, { icon: {}, version: {}, unchanged: false }));

    await createIcon({ document: doc, note: 'ghi chú' });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/icons`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ document: JSON.parse(JSON.stringify(doc)), note: 'ghi chú' });
  });

  it('saveIcon gửi PUT kèm baseVersion', async () => {
    mockFetch.mockResolvedValue(reply(200, { icon: {}, version: {}, unchanged: false }));

    await saveIcon('icon-1', { document: doc, baseVersion: 4 });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/icons/icon-1`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toMatchObject({ baseVersion: 4, document: { id: 'icon-1' } });
  });

  it('phát hành, gỡ, lưu trữ và khôi phục dùng đúng phương thức và đường dẫn', async () => {
    mockFetch.mockResolvedValue(reply(200, {}));

    await publishIcon('icon-1');
    expect([lastCall().init.method, lastCall().url]).toEqual(['POST', `${BASE}/icons/icon-1/publish`]);
    await unpublishIcon('icon-1');
    expect([lastCall().init.method, lastCall().url]).toEqual(['POST', `${BASE}/icons/icon-1/unpublish`]);
    await archiveIcon('icon-1');
    expect([lastCall().init.method, lastCall().url]).toEqual(['DELETE', `${BASE}/icons/icon-1`]);
    await restoreIcon('icon-1');
    expect([lastCall().init.method, lastCall().url]).toEqual(['POST', `${BASE}/icons/icon-1/restore`]);
    expect(lastCall().init.body).toBeUndefined();
  });

  it('bảng màu và quy chuẩn: GET rồi PUT kèm baseVersion', async () => {
    mockFetch.mockResolvedValue(reply(200, { version: 0 }));

    await getStandards();
    expect([lastCall().init.method, lastCall().url]).toEqual(['GET', `${BASE}/standards`]);

    await saveStandards({ palette: { tokens: [] }, rules: {} as never, baseVersion: 2 });
    expect([lastCall().init.method, lastCall().url]).toEqual(['PUT', `${BASE}/standards`]);
    expect(JSON.parse(String(lastCall().init.body))).toMatchObject({ baseVersion: 2 });
  });

  it('svgUrl dựng đường dẫn ảnh theo phiên bản và chế độ', () => {
    expect(svgUrl('icon-1', 3)).toBe(`${BASE}/icons/icon-1/svg?v=3&mode=brand`);
    expect(svgUrl('icon-1', 2, 'mono')).toBe(`${BASE}/icons/icon-1/svg?v=2&mode=mono`);
    expect(svgUrl('a b', 1)).toBe(`${BASE}/icons/a%20b/svg?v=1&mode=brand`);
  });
});

describe('brand-api: lỗi', () => {
  it('lấy mã và thông điệp tiếng Việt từ thân lỗi của máy chủ', async () => {
    mockFetch.mockResolvedValue(reply(403, { statusCode: 403, code: 'FORBIDDEN', message: 'Chỉ quản trị Platform được dùng chức năng này.' }));

    const error = await failureOf(listIcons());

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).toBe('Chỉ quản trị Platform được dùng chức năng này.');
    expect(error.isAuthError).toBe(true);
    expect(error.isUnavailable).toBe(false);
    expect(isBrandApiError(error)).toBe(true);
  });

  it('409 xung đột phiên bản mang currentVersion', async () => {
    mockFetch.mockResolvedValue(
      reply(409, { statusCode: 409, code: 'BRAND_ICON_VERSION_CONFLICT', message: 'Icon đã có phiên bản mới hơn.', currentVersion: 7 }),
    );

    const error = await failureOf(saveIcon('icon-1', { document: doc, baseVersion: 3 }));

    expect(error.isVersionConflict).toBe(true);
    expect(error.currentVersion).toBe(7);
    expect(error.message).toBe('Icon đã có phiên bản mới hơn.');
  });

  it('409 xung đột bảng màu được nhận ra riêng', async () => {
    mockFetch.mockResolvedValue(reply(409, { statusCode: 409, code: 'BRAND_STANDARDS_VERSION_CONFLICT', message: 'Đã có bản mới.', currentVersion: 2 }));

    const error = await failureOf(saveStandards({ palette: { tokens: [] }, rules: {} as never, baseVersion: 1 }));

    expect(error.isStandardsConflict).toBe(true);
    expect(error.isVersionConflict).toBe(false);
  });

  it('422 chưa đủ điều kiện phát hành kèm danh sách lý do', async () => {
    mockFetch.mockResolvedValue(
      reply(422, { statusCode: 422, code: 'BRAND_ICON_NOT_PUBLISHABLE', message: 'Icon chưa đạt điều kiện phát hành.', reasons: ['Chưa có hình.', 7] }),
    );

    const error = await failureOf(publishIcon('icon-1'));

    expect(error.code).toBe('BRAND_ICON_NOT_PUBLISHABLE');
    expect(error.reasons).toEqual(['Chưa có hình.']);
  });

  it('thân lỗi không chuẩn (nginx 404, 502) thì dùng câu ngắn theo mã HTTP', async () => {
    mockFetch.mockResolvedValue(reply(404, undefined, '<html>404 Not Found</html>'));
    const notFound = await failureOf(listIcons());
    expect(notFound.message).toBe('Máy chủ chưa có API lưu icon.');
    expect(notFound.isUnavailable).toBe(true);

    mockFetch.mockResolvedValue(reply(502, undefined, 'Bad Gateway'));
    const gateway = await failureOf(listIcons());
    expect(gateway.message).toBe('Máy chủ đang gặp sự cố. Thử lại sau.');
    expect(gateway.isUnavailable).toBe(true);

    mockFetch.mockResolvedValue(reply(401, undefined, ''));
    const expired = await failureOf(listIcons());
    expect(expired.message).toContain('hết hạn');
    expect(expired.isAuthError).toBe(true);
  });

  it('mất mạng thì báo NETWORK_ERROR và coi như máy chủ chưa dùng được', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await failureOf(listIcons());

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.statusCode).toBe(0);
    expect(error.isUnavailable).toBe(true);
    expect(error.message).toContain('Không kết nối được máy chủ');
  });

  it('trả 200 nhưng không phải JSON thì báo BAD_RESPONSE', async () => {
    mockFetch.mockResolvedValue(reply(200, undefined, '<html>ok</html>'));

    const error = await failureOf(listIcons());

    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('quá hạn chờ thì huỷ yêu cầu và báo TIMEOUT', async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );

      const pending = failureOf(listIcons({ timeoutMs: 100 }));
      await jest.advanceTimersByTimeAsync(100);
      const error = await pending;

      expect(error.code).toBe('TIMEOUT');
      expect(error.isUnavailable).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('errorMessage lấy thông điệp của lỗi, không có thì dùng câu mặc định', () => {
    expect(errorMessage(new Error('Lỗi cụ thể'))).toBe('Lỗi cụ thể');
    expect(errorMessage('không phải Error')).toBe('Có lỗi xảy ra. Thử lại sau.');
    expect(errorMessage(null, 'Mặc định riêng')).toBe('Mặc định riêng');
  });
});
