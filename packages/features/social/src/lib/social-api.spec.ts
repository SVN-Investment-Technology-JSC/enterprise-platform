import { authFetch } from '@enterprise-platform/shared-ui';

import { attachmentErrorMessage, errorMessage, request, SocialRequestError } from './social-api';

jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: jest.fn() }));

const mockAuthFetch = authFetch as jest.MockedFunction<typeof authFetch>;

function respond(status: number, body?: unknown): void {
  mockAuthFetch.mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: () => (body === undefined ? Promise.reject(new Error('không có thân')) : Promise.resolve(body)),
  } as Response);
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (cause) {
    return cause;
  }
  throw new Error('Yêu cầu không ném lỗi như mong đợi.');
}

beforeEach(() => mockAuthFetch.mockReset());

describe('request: lỗi API là Error', () => {
  it('server trả lỗi kèm mã và lời nhắn thì ném SocialRequestError giữ nguyên mã và lời nhắn', async () => {
    respond(404, { code: 'PERSON_NOT_FOUND', message: 'Không tìm thấy người này.' });

    const cause = await captureError(request('/people/1'));

    expect(cause).toBeInstanceOf(Error);
    expect(cause).toBeInstanceOf(SocialRequestError);
    expect(cause).toMatchObject({
      code: 'PERSON_NOT_FOUND',
      status: 404,
      message: 'Không tìm thấy người này.',
      serverMessage: 'Không tìm thấy người này.',
    });
    expect(errorMessage(cause, 'Dự phòng')).toBe('Không tìm thấy người này.');
  });

  it('thân lỗi không đọc được thì Error có lời nhắn tiếng Việt mặc định, còn errorMessage dùng lời nhắn dự phòng', async () => {
    respond(500);

    const cause = await captureError(request('/feed'));

    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe('Không thực hiện được yêu cầu. Vui lòng thử lại.');
    expect((cause as SocialRequestError).serverMessage).toBeUndefined();
    expect(errorMessage(cause, 'Không tải được bảng tin.')).toBe('Không tải được bảng tin.');
  });

  it('401 thì ném Error mã UNAUTHENTICATED có lời nhắn tiếng Việt', async () => {
    // jsdom không điều hướng thật và báo "Not implemented: navigation" qua console.error.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      respond(401, {});

      const cause = await captureError(request('/me'));

      expect(cause).toBeInstanceOf(Error);
      expect(cause).toMatchObject({ code: 'UNAUTHENTICATED', status: 401, message: 'Phiên đăng nhập đã hết.' });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('lỗi tệp không kèm lời nhắn thì attachmentErrorMessage dùng lời nhắn theo mã', async () => {
    respond(409, { code: 'SOCIAL_VIDEO_FAILED' });

    const cause = await captureError(request('/attachments/1'));

    expect(attachmentErrorMessage(cause, 'Dự phòng')).toBe(
      'Video xử lý lỗi, chưa thể đăng. Hãy gỡ video rồi thử lại.',
    );
  });

  it('thành công thì trả thân, 204 thì trả undefined', async () => {
    respond(200, { id: 'p1' });
    await expect(request('/posts/p1')).resolves.toEqual({ id: 'p1' });

    respond(204);
    await expect(request('/posts/p1')).resolves.toBeUndefined();
  });
});
