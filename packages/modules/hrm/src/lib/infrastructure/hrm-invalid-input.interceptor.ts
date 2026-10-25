import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

export const HRM_INVALID_INPUT = 'HRM_INVALID_INPUT';

/**
 * Lỗi PostgreSQL do dữ liệu người dùng gửi lên sai, không phải lỗi hệ thống:
 * 22P02 sai định dạng (id không phải UUID, số, giá trị enum), 22007/22008 ngày giờ không hợp lệ (như 2026-02-30),
 * 22003 số ngoài giới hạn, 22001 chuỗi quá dài, 23514 vi phạm ràng buộc giá trị (như loại công tác không có trong danh mục),
 * 23503 tham chiếu không tồn tại (như employeeId sai).
 */
const INVALID_INPUT_MESSAGES: Readonly<Record<string, string>> = {
  '22P02': 'Dữ liệu gửi lên sai định dạng (mã, số hoặc giá trị không hợp lệ).',
  '22007': 'Ngày giờ không hợp lệ.',
  '22008': 'Ngày giờ không hợp lệ.',
  '22003': 'Giá trị số vượt quá giới hạn cho phép.',
  '22001': 'Nội dung quá dài.',
  '23514': 'Giá trị gửi lên không nằm trong danh sách cho phép.',
  '23503': 'Dữ liệu tham chiếu không tồn tại (nhân viên, loại đơn hoặc mục đã chọn).',
};

export function invalidInputMessage(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? (INVALID_INPUT_MESSAGES[code] ?? null) : null;
}

/** Lỗi nhập liệu từ cơ sở dữ liệu thành 400 kèm thông báo tiếng Việt, thay vì "Internal server error" (500). Lỗi khác giữ nguyên. */
@Injectable()
export class HrmInvalidInputInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        const message = invalidInputMessage(error);
        return throwError(() => (message ? new BadRequestException({ code: HRM_INVALID_INPUT, message }) : error));
      }),
    );
  }
}
