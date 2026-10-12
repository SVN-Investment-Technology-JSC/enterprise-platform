import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  HRM_NOT_MIGRATED,
  HrmMissingSchemaInterceptor,
  isMissingSchemaError,
} from './hrm-missing-schema.interceptor';

const run = (handler: ReturnType<typeof of>) =>
  lastValueFrom(new HrmMissingSchemaInterceptor().intercept({} as never, { handle: () => handler }));

describe('tenant chưa chạy migration mới', () => {
  it('nhận ra lỗi thiếu bảng và thiếu cột của PostgreSQL', () => {
    expect(isMissingSchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingSchemaError({ code: '42703' })).toBe(true);
    expect(isMissingSchemaError({ code: '23505' })).toBe(false);
    expect(isMissingSchemaError(new Error('x'))).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });

  it('thiếu bảng hoặc cột: trả 503 mã HRM_NOT_MIGRATED, nêu rõ cần chạy migration nào', async () => {
    for (const code of ['42P01', '42703']) {
      const error = await run(throwError(() => Object.assign(new Error('relation does not exist'), { code }))).catch((e) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse() as { code: string; message: string };
      expect(response.code).toBe(HRM_NOT_MIGRATED);
      expect(response.message).toContain('0044-hrm-annual-leave-single-policy');
      expect(response.message).toContain('0045-hrm-request-reasons');
      expect(response.message).not.toContain('Internal server error');
    }
  });

  it('lỗi khác giữ nguyên và kết quả thành công đi qua', async () => {
    const business = new BadRequestException('Lý do không hợp lệ');
    await expect(run(throwError(() => business))).rejects.toBe(business);
    await expect(run(of({ data: [] }))).resolves.toEqual({ data: [] });
  });
});
