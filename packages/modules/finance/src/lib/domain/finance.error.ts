/** Lỗi nghiệp vụ Tài chính; controller đổi `status` thành mã HTTP. */
export class FinanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 = 400,
    /** Danh sách lỗi chi tiết (ví dụ từng điều kiện gửi duyệt chưa đạt). */
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}

export const notFound = (what: string) => new FinanceError('FINANCE_NOT_FOUND', `Không tìm thấy ${what}.`, 404);
export const forbidden = (message: string) => new FinanceError('FINANCE_FORBIDDEN', message, 403);
export const conflict = (code: string, message: string) => new FinanceError(code, message, 409);
export const invalid = (message: string) => new FinanceError('FINANCE_INVALID', message, 422);
export const invalidMany = (code: string, details: readonly string[]) =>
  new FinanceError(code, details.join(' '), 422, details);
