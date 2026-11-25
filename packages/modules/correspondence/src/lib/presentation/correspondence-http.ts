import { HttpException } from '@nestjs/common';
import { CorrespondenceService } from '../application/correspondence.service.js';
import type { CorrespondenceActor } from '../application/ports.js';
import { CorrespondenceError } from '../domain/correspondence.error.js';

/** Guard gắn danh tính đã xác minh vào request dưới tên `correspondenceActor`. */
export interface CorrespondenceRequest {
  correspondenceActor?: CorrespondenceActor;
}

/**
 * Phần chung của các controller Văn thư: lấy danh tính guard đã gắn, đổi lỗi nghiệp vụ thành
 * `HttpException` kèm `{ statusCode, code, message }`. Mỗi controller con lo một nhóm route; mọi
 * nhóm cùng gọi `CorrespondenceService`.
 */
export abstract class CorrespondenceHttp {
  constructor(protected readonly service: CorrespondenceService) {}

  protected actor(request: CorrespondenceRequest): CorrespondenceActor {
    if (!request.correspondenceActor) {
      // Guard luôn gắn actor trước khi tới đây; thiếu là cấu hình sai.
      throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
    }
    return request.correspondenceActor;
  }

  protected async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof CorrespondenceError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
