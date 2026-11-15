import { render, screen } from '@testing-library/react';
import {
  ACTION_DENIED_MESSAGE,
  AccessDeniedNotice,
  ApiRequestError,
  isAccessDeniedError,
  readApiRequestError,
} from './access-denied';

function response(status: number, body?: unknown): Response {
  return {
    status,
    ok: status < 400,
    json: () => (body === undefined ? Promise.reject(new Error('empty')) : Promise.resolve(body)),
  } as unknown as Response;
}

describe('readApiRequestError', () => {
  it('giữ câu tiếng Việt server trả kèm mã HTTP', async () => {
    const error = await readApiRequestError(response(403, { code: 'ACCESS_DENIED', message: 'Bạn không có quyền xử lý phiếu bảo trì.' }), 'Lỗi');
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('ACCESS_DENIED');
    expect(error.message).toBe('Bạn không có quyền xử lý phiếu bảo trì.');
  });

  it('403 kiểu "Forbidden" hoặc không có thân thì đổi thành câu tiếng Việt', async () => {
    expect((await readApiRequestError(response(403, { message: 'Forbidden resource' }), 'Lỗi')).message).toBe(ACTION_DENIED_MESSAGE);
    expect((await readApiRequestError(response(403), 'Lỗi')).message).toBe(ACTION_DENIED_MESSAGE);
  });

  it('lỗi khác không có câu thì dùng câu dự phòng; mảng câu được nối lại', async () => {
    expect((await readApiRequestError(response(500), 'Không lưu được.')).message).toBe('Không lưu được.');
    expect((await readApiRequestError(response(400, { message: ['Thiếu tên', 'Thiếu mã'] }), 'x')).message).toBe('Thiếu tên; Thiếu mã');
  });
});

describe('isAccessDeniedError', () => {
  it('nhận 403 theo statusCode hoặc status', () => {
    expect(isAccessDeniedError(new ApiRequestError(403, 'x'))).toBe(true);
    expect(isAccessDeniedError({ status: 403 })).toBe(true);
    expect(isAccessDeniedError(new ApiRequestError(500, 'x'))).toBe(false);
    expect(isAccessDeniedError(new Error('x'))).toBe(false);
    expect(isAccessDeniedError(undefined)).toBe(false);
  });
});

describe('AccessDeniedNotice', () => {
  it('hiện câu tiếng Việt theo tên phân hệ', () => {
    render(<AccessDeniedNotice moduleLabel="Bảo trì" />);
    expect(screen.getByRole('alert').textContent).toContain('Bạn chưa được cấp quyền dùng phân hệ Bảo trì.');
  });
});
