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
  /** Dữ liệu thêm trả kèm thân lỗi, ví dụ danh sách khách trùng MST. */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, statusCode = 400, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, CrmError.prototype);
  }
}

/** Dữ liệu nhập sai (400). */
export class CrmValidationError extends CrmError {
  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(code, message, 400, details);
    Object.setPrototypeOf(this, CrmValidationError.prototype);
  }
}

/**
 * Không có, hoặc nằm ngoài phạm vi dữ liệu của người gọi (404). Hai trường hợp
 * trả cùng một lỗi để không lộ sự tồn tại của bản ghi.
 */
export class CrmNotFoundError extends CrmError {
  constructor(message = 'Không tìm thấy mục được yêu cầu.') {
    super('NOT_FOUND', message, 404);
    Object.setPrototypeOf(this, CrmNotFoundError.prototype);
  }
}

/** Xung đột với trạng thái hiện tại: trùng mã, chuyển trạng thái sai, bản đã cũ (409). */
export class CrmConflictError extends CrmError {
  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(code, message, 409, details);
    Object.setPrototypeOf(this, CrmConflictError.prototype);
  }
}

/** Bản đang sửa đã bị người khác cập nhật trước. */
export class CrmStaleVersionError extends CrmConflictError {
  constructor() {
    super('STALE_VERSION', 'Dữ liệu vừa được người khác cập nhật. Vui lòng tải lại rồi sửa tiếp.');
    Object.setPrototypeOf(this, CrmStaleVersionError.prototype);
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
