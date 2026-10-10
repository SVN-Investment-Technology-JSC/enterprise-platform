import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

/** Mã lỗi PostgreSQL: bảng không tồn tại (42P01) hoặc cột không tồn tại (42703). */
export const MISSING_SCHEMA_CODES = ['42P01', '42703'] as const;

export const HRM_NOT_MIGRATED = 'HRM_NOT_MIGRATED';

/** Các migration HRM mà phép năm, lý do đơn từ và duyệt đơn cần trên cơ sở dữ liệu của tenant. */
export const HRM_REASON_MIGRATIONS = [
  '0037-request-reason-catalog',
  '0038-request-reason-categories',
  '0039-request-catalog-codes',
  '0043-ot-type-info-no-coordinates',
  '0044-hrm-annual-leave-single-policy',
  '0045-hrm-request-reasons',
] as const;

export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (MISSING_SCHEMA_CODES as readonly string[]).includes(code);
}

/** Lỗi thiếu bảng/cột do tenant chưa chạy migration mới thành thông báo rõ ràng (503), thay vì "Internal server error". */
export function notMigratedException(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: HRM_NOT_MIGRATED,
    message:
      'Cơ sở dữ liệu HRM chưa được cập nhật phiên bản mới (thiếu bảng hoặc cột). Quản trị cần chạy các migration HRM: ' +
      `${HRM_REASON_MIGRATIONS.join(', ')}.`,
  });
}

/**
 * Áp cho các controller phép năm, lý do đơn từ, duyệt đơn: tenant chưa migrate thì trả 503 mã HRM_NOT_MIGRATED
 * kèm danh sách migration cần chạy. Các lỗi khác giữ nguyên.
 */
@Injectable()
export class HrmMissingSchemaInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((error) => throwError(() => (isMissingSchemaError(error) ? notMigratedException() : error))));
  }
}
