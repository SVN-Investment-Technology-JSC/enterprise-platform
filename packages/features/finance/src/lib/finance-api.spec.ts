/** @jest-environment jsdom */
import { FinanceApiError, financeFetch } from './finance-api';

function mockResponse(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ status, ok: false, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

describe('financeFetch: lỗi 403 (ISS-UI-022)', () => {
  it('giữ câu tiếng Việt server trả', async () => {
    mockResponse(403, { code: 'ACCESS_DENIED', message: 'Bạn không có quyền lập phiếu thu.' });
    await expect(financeFetch('/vouchers')).rejects.toMatchObject({ status: 403, message: 'Bạn không có quyền lập phiếu thu.' });
  });

  it('403 mặc định "Forbidden resource" đổi thành câu tiếng Việt', async () => {
    mockResponse(403, { message: 'Forbidden resource', statusCode: 403 });
    const error = await financeFetch('/vouchers').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(FinanceApiError);
    expect((error as FinanceApiError).message).toBe('Bạn không còn quyền thực hiện thao tác này.');
  });
});
