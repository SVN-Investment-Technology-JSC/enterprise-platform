/**
 * Lỗi nghiệp vụ của Workspace.
 *
 * Controller bắt đúng lớp này trong `execute()` và đổi thành `HttpException`
 * kèm `{ statusCode, code, message }`. Lỗi không phải `WorkspaceError` được
 * ném tiếp để Nest trả 500 — tức là bug, không phải tình huống nghiệp vụ.
 *
 * `message` là tiếng Việt và hiển thị thẳng cho người dùng.
 */
export class WorkspaceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, WorkspaceError.prototype);
  }
}

export class ProjectNotFoundError extends WorkspaceError {
  constructor(reference: string) {
    super('PROJECT_NOT_FOUND', `Dự án ${reference} không tồn tại hoặc đã bị huỷ.`, 404);
    Object.setPrototypeOf(this, ProjectNotFoundError.prototype);
  }
}

export class WorkItemNotFoundError extends WorkspaceError {
  constructor(reference: string) {
    super('WORK_ITEM_NOT_FOUND', `Công việc ${reference} không tồn tại hoặc đã bị huỷ.`, 404);
    Object.setPrototypeOf(this, WorkItemNotFoundError.prototype);
  }
}

/**
 * Người dùng không phải thành viên dự án.
 *
 * Trả 403 chứ KHÔNG trả danh sách rỗng: trả rỗng là tiết lộ rằng dự án đó
 * tồn tại.
 */
export class ProjectForbiddenError extends WorkspaceError {
  constructor() {
    super('PROJECT_FORBIDDEN', 'Bạn không có quyền truy cập dự án này.', 403);
    Object.setPrototypeOf(this, ProjectForbiddenError.prototype);
  }
}

/** Thiếu trường bắt buộc, sai định dạng, hoặc vượt giới hạn độ dài. */
export class WorkspaceValidationError extends WorkspaceError {
  constructor(message: string) {
    super('VALIDATION', message, 400);
    Object.setPrototypeOf(this, WorkspaceValidationError.prototype);
  }
}

/**
 * Tenant đã bật module nhưng migration chưa chạy xong.
 *
 * Xảy ra khi entitlement chuyển `active` mà `workspace_schema` chưa có bảng —
 * thường là do provisioning job còn đang chạy.
 */
export class WorkspaceSchemaNotReadyError extends WorkspaceError {
  constructor() {
    super(
      'WORKSPACE_SCHEMA_NOT_READY',
      'Dữ liệu Workspace của tenant đang được khởi tạo. Vui lòng thử lại sau ít phút.',
      503,
    );
    Object.setPrototypeOf(this, WorkspaceSchemaNotReadyError.prototype);
  }
}


/**
 * Vai trò trong dự án không đủ để thực hiện thao tác.
 *
 * Khác `ProjectForbiddenError`: người dùng CÓ quyền xem dự án, chỉ là không đủ
 * thẩm quyền cho hành động cụ thể này.
 */
export class ProjectRoleForbiddenError extends WorkspaceError {
  constructor(required: string) {
    super('PROJECT_ROLE_FORBIDDEN', `Thao tác này cần vai trò ${required} trong dự án.`, 403);
    Object.setPrototypeOf(this, ProjectRoleForbiddenError.prototype);
  }
}

/** Vai trò của người gọi trong dự án không có quyền cần cho thao tác này. */
export class ProjectPermissionForbiddenError extends WorkspaceError {
  constructor(permissionLabel: string) {
    super(
      'PROJECT_PERMISSION_FORBIDDEN',
      `Vai trò của bạn trong dự án chưa có quyền "${permissionLabel}".`,
      403,
    );
    Object.setPrototypeOf(this, ProjectPermissionForbiddenError.prototype);
  }
}

/** Vai trò dự án không tìm thấy. */
export class ProjectRoleNotFoundError extends WorkspaceError {
  constructor(key: string) {
    super('PROJECT_ROLE_NOT_FOUND', `Không tìm thấy vai trò "${key}".`, 404);
    Object.setPrototypeOf(this, ProjectRoleNotFoundError.prototype);
  }
}

export class ProjectGroupNotFoundError extends WorkspaceError {
  constructor(id: string) {
    super('PROJECT_GROUP_NOT_FOUND', `Không tìm thấy nhóm dự án "${id}".`, 404);
    Object.setPrototypeOf(this, ProjectGroupNotFoundError.prototype);
  }
}

/** `member` chỉ được đổi trạng thái công việc của chính mình. */
export class WorkItemAssigneeOnlyError extends WorkspaceError {
  constructor() {
    super(
      'WORK_ITEM_ASSIGNEE_ONLY',
      'Bạn chỉ được đổi trạng thái công việc được giao cho mình.',
      403,
    );
    Object.setPrototypeOf(this, WorkItemAssigneeOnlyError.prototype);
  }
}

/** Mã dự án đã tồn tại. Mã là định danh người dùng đọc, phải duy nhất. */
export class ProjectCodeConflictError extends WorkspaceError {
  constructor(code: string) {
    super('PROJECT_CODE_CONFLICT', `Mã dự án ${code} đã được sử dụng.`, 409);
    Object.setPrototypeOf(this, ProjectCodeConflictError.prototype);
  }
}

/**
 * Tên đã có trong cùng phạm vi — thư mục cùng cấp, hoặc tài liệu cùng thư mục.
 *
 * Ràng buộc `UNIQUE` trong CSDL là chốt chặn; lớp lỗi này để người dùng nhận
 * `409` kèm thông điệp rõ ràng thay vì một lỗi 500.
 */
export class NameConflictError extends WorkspaceError {
  constructor(message: string) {
    super('NAME_CONFLICT', message, 409);
    Object.setPrototypeOf(this, NameConflictError.prototype);
  }
}

/** Không thể đóng một node còn việc con dở dang. */
export class ChildIncompleteError extends WorkspaceError {
  constructor(openChildren: number) {
    super(
      'CHILD_INCOMPLETE',
      `Còn ${openChildren} công việc con chưa đóng. Hoàn thành hoặc huỷ chúng trước.`,
      409,
    );
    Object.setPrototypeOf(this, ChildIncompleteError.prototype);
  }
}

/**
 * Không thể đóng hồ sơ dự án khi còn công việc chưa hoàn thành.
 *
 * Đóng hồ sơ (chuyển dự án sang `completed`) là chốt sổ: còn công việc đang mở
 * mà đóng thì tiến độ và báo cáo không còn phản ánh thực tế. Hoàn thành hoặc
 * huỷ các công việc đó trước.
 */
export class ProjectHasOpenWorkItemsError extends WorkspaceError {
  constructor() {
    super(
      'PROJECT_HAS_OPEN_WORK_ITEMS',
      'Không thể đóng hồ sơ: dự án còn công việc chưa hoàn thành.',
      409,
    );
    Object.setPrototypeOf(this, ProjectHasOpenWorkItemsError.prototype);
  }
}

/** Công việc tiền nhiệm kiểu FS chưa hoàn thành. */
export class DependencyBlockedError extends WorkspaceError {
  constructor(predecessorCode: string) {
    super('DEPENDENCY_BLOCKED', `Công việc tiền nhiệm ${predecessorCode} chưa hoàn thành.`, 409);
    Object.setPrototypeOf(this, DependencyBlockedError.prototype);
  }
}

/** Cạnh phụ thuộc mới sẽ tạo chu trình trong đồ thị. */
export class DependencyCycleError extends WorkspaceError {
  constructor() {
    super(
      'DEPENDENCY_CYCLE',
      'Phụ thuộc này tạo chu trình: hai công việc sẽ chờ nhau vô tận.',
      409,
    );
    Object.setPrototypeOf(this, DependencyCycleError.prototype);
  }
}

export class EventNotFoundError extends WorkspaceError {
  constructor(reference: string) {
    super('EVENT_NOT_FOUND', `Sự kiện ${reference} không tồn tại.`, 404);
    Object.setPrototypeOf(this, EventNotFoundError.prototype);
  }
}

/** Khoảng tra cứu lịch vượt trần; khai triển chuỗi lặp quá dài sẽ rất nặng. */
export class RangeTooWideError extends WorkspaceError {
  constructor(maxDays: number) {
    super('RANGE_TOO_WIDE', `Khoảng tra cứu tối đa ${maxDays} ngày.`, 400);
    Object.setPrototypeOf(this, RangeTooWideError.prototype);
  }
}

/** Chỉ người tổ chức được sửa và huỷ sự kiện. */
export class EventOrganizerOnlyError extends WorkspaceError {
  constructor() {
    super('EVENT_ORGANIZER_ONLY', 'Chỉ người tổ chức được sửa hoặc huỷ sự kiện này.', 403);
    Object.setPrototypeOf(this, EventOrganizerOnlyError.prototype);
  }
}

export class ChatMessageNotFoundError extends WorkspaceError {
  constructor(reference: string) {
    super('CHAT_MESSAGE_NOT_FOUND', `Tin nhắn ${reference} không tồn tại.`, 404);
    Object.setPrototypeOf(this, ChatMessageNotFoundError.prototype);
  }
}

/**
 * Trả lời vượt quá hai cấp.
 *
 * Luồng sâu hơn rất khó đọc trên một Drawer hẹp, và không có cách hiển thị
 * nào gọn cho nhánh cấp ba.
 */
export class ChatDepthExceededError extends WorkspaceError {
  constructor() {
    super(
      'COMMENT_DEPTH_EXCEEDED',
      'Chỉ trả lời được tối đa hai cấp. Hãy trả lời tin gốc của luồng này.',
      400,
    );
    Object.setPrototypeOf(this, ChatDepthExceededError.prototype);
  }
}

/** Hết cửa sổ sửa, hoặc sửa tin của người khác. */
export class ChatEditForbiddenError extends WorkspaceError {
  constructor(message: string) {
    super('CHAT_EDIT_FORBIDDEN', message, 409);
    Object.setPrototypeOf(this, ChatEditForbiddenError.prototype);
  }
}

export class DocumentNotFoundError extends WorkspaceError {
  constructor(reference: string) {
    super('DOCUMENT_NOT_FOUND', `Tài liệu ${reference} không tồn tại.`, 404);
    Object.setPrototypeOf(this, DocumentNotFoundError.prototype);
  }
}

export class FolderNotFoundError extends WorkspaceError {
  constructor(reference: string) {
    super('FOLDER_NOT_FOUND', `Thư mục ${reference} không tồn tại.`, 404);
    Object.setPrototypeOf(this, FolderNotFoundError.prototype);
  }
}

/**
 * Tài liệu đang bị người khác giữ khoá chỉnh sửa.
 *
 * Khoá không tự hết hạn ở phiên bản này; quản lý dự án gỡ khoá hộ khi người
 * giữ khoá đi vắng.
 */
export class DocumentLockedError extends WorkspaceError {
  constructor(holderUserId: string) {
    super(
      'DOCUMENT_LOCKED',
      `Tài liệu đang được ${holderUserId} khoá để chỉnh sửa.`,
      409,
    );
    Object.setPrototypeOf(this, DocumentLockedError.prototype);
  }
}

/** Mở khoá của người khác cần vai trò quản lý dự án. */
export class DocumentUnlockForbiddenError extends WorkspaceError {
  constructor() {
    super(
      'DOCUMENT_UNLOCK_FORBIDDEN',
      'Chỉ người đang giữ khoá hoặc quản lý dự án mới mở khoá được.',
      403,
    );
    Object.setPrototypeOf(this, DocumentUnlockForbiddenError.prototype);
  }
}

/**
 * Truy vấn báo cáo vượt quá thời gian cho phép.
 *
 * Trả lỗi rõ ràng còn hơn để request treo: người dùng sẽ bấm tải lại, và mỗi
 * lần bấm lại thêm một truy vấn nặng nữa vào cùng cơ sở dữ liệu.
 */
export class ReportTimeoutError extends WorkspaceError {
  constructor(seconds: number) {
    super(
      'REPORT_TIMEOUT',
      `Báo cáo chạy quá ${seconds} giây. Hãy thu hẹp khoảng thời gian hoặc số dự án.`,
      504,
    );
    Object.setPrototypeOf(this, ReportTimeoutError.prototype);
  }
}

/**
 * Người gọi không được xem hoặc sửa số liệu tài chính.
 *
 * Tách khỏi `PROJECT_ROLE_FORBIDDEN` để giao diện và nhật ký phân biệt được:
 * `member` vẫn làm việc bình thường trong dự án, chỉ riêng số tiền là bị chặn.
 */
export class FinanceForbiddenError extends WorkspaceError {
  constructor() {
    super(
      'FINANCE_FORBIDDEN',
      'Chỉ chủ nhiệm và quản lý dự án được xem hoặc sửa số liệu tài chính.',
      403,
    );
    Object.setPrototypeOf(this, FinanceForbiddenError.prototype);
  }
}

/**
 * Việc giao lẻ không tồn tại, hoặc người gọi không liên quan tới nó.
 *
 * Gộp hai trường hợp làm một 404: trả 403 là tiết lộ rằng việc đó có thật.
 */
export class StandaloneTaskNotFoundError extends WorkspaceError {
  constructor() {
    // Không nêu id: người nhận link thường chỉ thấy một chuỗi UUID vô nghĩa.
    super(
      'STANDALONE_TASK_NOT_FOUND',
      'Công việc không tồn tại, đã bị xoá, hoặc bạn không còn liên quan tới công việc này.',
      404,
    );
    Object.setPrototypeOf(this, StandaloneTaskNotFoundError.prototype);
  }
}

/** Khách hàng không tồn tại. */
export class CustomerNotFoundError extends WorkspaceError {
  constructor() {
    super('CUSTOMER_NOT_FOUND', 'Khách hàng không tồn tại.', 404);
    Object.setPrototypeOf(this, CustomerNotFoundError.prototype);
  }
}

/** Mã khách hàng đã tồn tại. Mã là định danh người dùng đọc, phải duy nhất. */
export class CustomerCodeConflictError extends WorkspaceError {
  constructor(code: string) {
    super('CUSTOMER_CODE_CONFLICT', `Mã khách hàng ${code} đã được sử dụng.`, 409);
    Object.setPrototypeOf(this, CustomerCodeConflictError.prototype);
  }
}

/**
 * Tenant bật Bán hàng: khách hàng là bản sao của Bán hàng (D1), không tạo, sửa,
 * xoá trong Workspace. Chặn ở server, không chỉ ẩn nút.
 */
export class CustomerManagedByCrmError extends WorkspaceError {
  constructor() {
    super(
      'CUSTOMER_MANAGED_BY_CRM',
      'Khách hàng do phân hệ Bán hàng quản lý. Hãy tạo hoặc sửa khách hàng ở Bán hàng.',
      409,
    );
    Object.setPrototypeOf(this, CustomerManagedByCrmError.prototype);
  }
}

/** Không gắn được bản sao khách Bán hàng vì mã hoặc khách Workspace đã thuộc khách Bán hàng khác. */
export class CrmCustomerLinkConflictError extends WorkspaceError {
  constructor(message: string) {
    super('CRM_CUSTOMER_LINK_CONFLICT', message, 409);
    Object.setPrototypeOf(this, CrmCustomerLinkConflictError.prototype);
  }
}

/** Tenant không bật Bán hàng nên không tra được khách ở đó. */
export class CrmNotEnabledError extends WorkspaceError {
  constructor() {
    super('CRM_NOT_ENABLED', 'Công ty chưa bật phân hệ Bán hàng.', 409);
    Object.setPrototypeOf(this, CrmNotEnabledError.prototype);
  }
}

/** Hợp đồng không tồn tại. */
export class ContractNotFoundError extends WorkspaceError {
  constructor() {
    super('CONTRACT_NOT_FOUND', 'Hợp đồng không tồn tại.', 404);
    Object.setPrototypeOf(this, ContractNotFoundError.prototype);
  }
}

/** Mã hợp đồng đã tồn tại. Mã là định danh người dùng đọc, phải duy nhất. */
export class ContractCodeConflictError extends WorkspaceError {
  constructor(code: string) {
    super('CONTRACT_CODE_CONFLICT', `Mã hợp đồng ${code} đã được sử dụng.`, 409);
    Object.setPrototypeOf(this, ContractCodeConflictError.prototype);
  }
}

/** Người gọi có liên quan tới việc nhưng vai của họ không làm được thao tác này. */
export class StandaloneTaskForbiddenError extends WorkspaceError {
  constructor(message: string) {
    super('STANDALONE_TASK_FORBIDDEN', message, 403);
    Object.setPrototypeOf(this, StandaloneTaskForbiddenError.prototype);
  }
}

/** Trạng thái đã bị người khác đổi trong lúc người gọi đang thao tác. */
export class StandaloneTaskConflictError extends WorkspaceError {
  constructor() {
    super(
      'STANDALONE_TASK_CONFLICT',
      'Công việc vừa được người khác cập nhật. Hãy tải lại rồi thử lại.',
      409,
    );
    Object.setPrototypeOf(this, StandaloneTaskConflictError.prototype);
  }
}
