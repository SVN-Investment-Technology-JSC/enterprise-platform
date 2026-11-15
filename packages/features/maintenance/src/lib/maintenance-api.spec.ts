import { authFetch } from '@enterprise-platform/shared-ui';
import { uploadOccurrenceAttachment } from './maintenance-api';

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  authFetch: jest.fn(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const attachment = {
  id: 'a1',
  occurrenceId: 'occ-1',
  fileName: 'bien-ban.pdf',
  contentType: 'application/pdf',
  uploadedBy: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('uploadOccurrenceAttachment — bước đã tải tệp xong (ISS-BE-016)', () => {
  const originalFetch = global.fetch;
  let putMock: jest.Mock;

  beforeEach(() => {
    authFetchMock.mockReset();
    putMock = jest.fn(async () => ({ ok: true, status: 200 }) as Response);
    global.fetch = putMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('PUT tệp lên kho xong thì gọi complete và trả đính kèm đã xác nhận', async () => {
    authFetchMock
      .mockResolvedValueOnce(jsonResponse(200, { attachment, uploadUrl: 'https://s3.test/put', expiresInSeconds: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { ...attachment, sizeBytes: 4 }));

    const file = new File(['abcd'], 'bien-ban.pdf', { type: 'application/pdf' });
    const result = await uploadOccurrenceAttachment('occ-1', file);

    expect(putMock).toHaveBeenCalledWith('https://s3.test/put', expect.objectContaining({ method: 'PUT' }));
    expect(authFetchMock).toHaveBeenCalledTimes(2);
    const [completeUrl, completeInit] = authFetchMock.mock.calls[1];
    expect(completeUrl).toBe('/api/maintenance/v1/occurrences/occ-1/attachments/a1/complete');
    expect(completeInit).toMatchObject({ method: 'POST' });
    // complete chạy SAU khi PUT xong.
    expect(putMock.mock.invocationCallOrder[0]).toBeLessThan(authFetchMock.mock.invocationCallOrder[1]);
    expect(result.sizeBytes).toBe(4);
  });

  it('PUT lỗi thì không gọi complete', async () => {
    authFetchMock.mockResolvedValueOnce(
      jsonResponse(200, { attachment, uploadUrl: 'https://s3.test/put', expiresInSeconds: 900 }),
    );
    putMock.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    await expect(uploadOccurrenceAttachment('occ-1', new File(['x'], 'a.pdf'))).rejects.toThrow(
      'Không tải được tệp lên kho lưu trữ.',
    );
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });

  it('complete trả 409 thì lỗi mang câu tiếng Việt của server', async () => {
    authFetchMock
      .mockResolvedValueOnce(jsonResponse(200, { attachment, uploadUrl: 'https://s3.test/put', expiresInSeconds: 900 }))
      .mockResolvedValueOnce(
        jsonResponse(409, {
          statusCode: 409,
          code: 'UPLOAD_NOT_FOUND',
          message: 'Chưa thấy tệp trên kho lưu trữ, hãy tải lên lại.',
        }),
      );

    await expect(uploadOccurrenceAttachment('occ-1', new File(['x'], 'a.pdf'))).rejects.toMatchObject({
      message: 'Chưa thấy tệp trên kho lưu trữ, hãy tải lên lại.',
      code: 'UPLOAD_NOT_FOUND',
    });
  });
});
