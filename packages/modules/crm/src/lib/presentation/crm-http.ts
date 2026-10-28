import { HttpException } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { CrmError } from '../domain/crm.error.js';

/** Guard gắn danh tính đã xác minh vào request dưới tên `crmActor`. */
export interface CrmRequest {
  crmActor?: CrmActor;
}

/** Actor của request; thiếu (guard không chạy) là cấu hình sai, trả 401. */
export function crmActor(request: CrmRequest): CrmActor {
  if (!request.crmActor) {
    throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
  }
  return request.crmActor;
}

/**
 * Chạy một thao tác và đổi lỗi nghiệp vụ thành `HttpException` với thân
 * `{ statusCode, code, message }` (cộng `details` nếu có, ví dụ `matches` của
 * cảnh báo trùng MST). Lỗi khác là bug và để Nest trả 500.
 */
export async function runCrm<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
  try {
    return await operation();
  } catch (error) {
    // Id trên URL không phải UUID: với người gọi, đó là "không tìm thấy".
    if ((error as { code?: string } | null)?.code === '22P02') {
      throw new HttpException(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
        404,
      );
    }
    if (!(error instanceof CrmError)) throw error;
    throw new HttpException(
      { ...(error.details ?? {}), statusCode: error.statusCode, code: error.code, message: error.message },
      error.statusCode,
    );
  }
}
