import { authFetch } from '@enterprise-platform/shared-ui';
import { ChatApiError, chatApi } from './chat-api';

jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: jest.fn() }));

/** jsdom không có Response: dựng phản hồi giả đủ cho cách màn này đọc (status, ok, json). */
function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

describe('chatApi.setAvatar', () => {
  beforeEach(() => jest.mocked(authFetch).mockReset());

  // OPS006-06: gateway nginx trả 413 với thân HTML, form ảnh đại diện phải báo tiếng Việt.
  it('báo "Tệp quá lớn" bằng tiếng Việt khi gateway trả 413 dạng HTML', async () => {
    jest.mocked(authFetch).mockResolvedValue(
      fakeResponse(413, '<html><head><title>413 Request Entity Too Large</title></head></html>'),
    );
    const failure = await chatApi.setAvatar(new Blob(['x'], { type: 'image/jpeg' })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatApiError);
    expect((failure as ChatApiError).status).toBe(413);
    expect((failure as ChatApiError).message).toMatch(/^Tệp quá lớn/);
  });

  it('báo "Tệp quá lớn" khi API trả 413 với thông điệp tiếng Anh', async () => {
    jest.mocked(authFetch).mockResolvedValue(
      fakeResponse(413, JSON.stringify({ statusCode: 413, message: 'File too large' })),
    );
    await expect(chatApi.setAvatar(new Blob(['x'], { type: 'image/png' }))).rejects.toThrow(/^Tệp quá lớn/);
  });

  it('giữ thông điệp của API cho lỗi khác', async () => {
    jest.mocked(authFetch).mockResolvedValue(
      fakeResponse(400, JSON.stringify({ message: 'Ảnh không hợp lệ.' })),
    );
    await expect(chatApi.setAvatar(new Blob(['x'], { type: 'image/png' }))).rejects.toThrow('Ảnh không hợp lệ.');
  });
});
