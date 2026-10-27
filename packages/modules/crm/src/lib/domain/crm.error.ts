/**
 * Lỗi nghiệp vụ của Bán hàng.
 *
 * Controller bắt đúng lớp này và đổi thành `HttpException` kèm `{ statusCode,
 * code, message }`; lỗi khác là bug và để Nest trả 500. `message` tiếng Việt,
 * hiển thị thẳng cho người dùng.
 */
export class CrmError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, CrmError.prototype);
  }
}

export class CrmForbiddenError extends CrmError {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.') {
    super('FORBIDDEN', message, 403);
    Object.setPrototypeOf(this, CrmForbiddenError.prototype);
  }
}

/**
 * Không đọc được cơ cấu tổ chức ở Tenant Core và chưa có bản đã biết nào.
 *
 * Phạm vi "nhóm" cần danh sách cấp dưới; thiếu nó thì trả 503 chứ không mở
 * rộng ra toàn bộ, cũng không thu hẹp ngầm về "của tôi" (người dùng sẽ tưởng
 * cấp dưới không có dữ liệu).
 */
export class CrmOrganizationUnavailableError extends CrmError {
  constructor() {
    super(
      'ORGANIZATION_UNAVAILABLE',
      'Không lấy được cơ cấu tổ chức để xác định phạm vi dữ liệu. Vui lòng thử lại sau ít phút.',
      503,
    );
    Object.setPrototypeOf(this, CrmOrganizationUnavailableError.prototype);
  }
}
