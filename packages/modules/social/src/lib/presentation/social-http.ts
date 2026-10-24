import { HttpException } from '@nestjs/common';
import type { SocialActor } from '../application/social-actor.js';
import { SocialError } from '../domain/social.error.js';

/** Guard của `apps/social-api` gắn danh tính đã xác minh vào request dưới tên `socialActor`. */
export interface SocialRequest {
  socialActor?: SocialActor;
}

export function actorOf(request: SocialRequest): SocialActor {
  if (!request.socialActor) {
    // Guard luôn gắn actor trước khi tới đây; thiếu là cấu hình sai.
    throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
  }
  return request.socialActor;
}

/** Đổi lỗi nghiệp vụ thành `HttpException` khung `{ statusCode, code, message }`. */
export async function runSocial<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
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
    if (!(error instanceof SocialError)) throw error;
    throw new HttpException(
      { statusCode: error.statusCode, code: error.code, message: error.message },
      error.statusCode,
    );
  }
}

/** Tham số query dạng số; rỗng là không có. */
export function numberParam(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : Number(value);
}
