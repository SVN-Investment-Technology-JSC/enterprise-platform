import { BadRequestException, NotFoundException } from '@nestjs/common';
import { lastValueFrom, throwError, of } from 'rxjs';
import { HrmInvalidInputInterceptor, HRM_INVALID_INPUT, invalidInputMessage } from './hrm-invalid-input.interceptor.js';

const run = (error: unknown) =>
  lastValueFrom(new HrmInvalidInputInterceptor().intercept({} as never, { handle: () => throwError(() => error) }));

describe('HrmInvalidInputInterceptor', () => {
  it.each(['22P02', '22007', '22008', '22003', '22001', '23514', '23503'])('lỗi PostgreSQL %s thành 400', async (code) => {
    const error = await run(Object.assign(new Error('pg'), { code })).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: HRM_INVALID_INPUT });
  });

  it('lỗi hệ thống và lỗi nghiệp vụ giữ nguyên', async () => {
    const internal = Object.assign(new Error('boom'), { code: '57014' });
    await expect(run(internal)).rejects.toBe(internal);
    const notFound = new NotFoundException('x');
    await expect(run(notFound)).rejects.toBe(notFound);
    expect(invalidInputMessage(null)).toBeNull();
  });

  it('kết quả thành công đi qua không đổi', async () => {
    const value = await lastValueFrom(new HrmInvalidInputInterceptor().intercept({} as never, { handle: () => of(7) }));
    expect(value).toBe(7);
  });
});
