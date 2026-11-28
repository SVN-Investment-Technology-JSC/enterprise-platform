import type {
  LinkableCandidate,
  LinkableCreateForm,
  LinkableCreatePreview,
  LinkableCreateRequest,
  LinkableKind,
  LinkableObject,
} from '@enterprise-platform/contracts-integration';

/**
 * Cổng của tính năng "Đối tượng liên quan".
 *
 * Tách khỏi `WorkspaceStore` và `ExternalReferenceReader` có chủ đích: tính năng mới không đụng tới hai cổng cũ
 * (con trỏ Quy trình), nên logic quy trình đang chạy không bị ảnh hưởng.
 *
 * Quy ước token của repo: store Postgres của chính module dùng chuỗi, cổng HTTP sang module khác dùng Symbol.
 */
export const RELATED_OBJECT_STORE = 'RELATED_OBJECT_STORE';
export const LINKABLE_PROVIDERS = Symbol('LINKABLE_PROVIDERS');

/** Một liên kết đã lưu trong `workspace_schema.related_objects`. */
export interface StoredRelatedObject {
  readonly id: string;
  readonly entityType: 'project' | 'work_item';
  readonly entityId: string;
  readonly projectId: string;
  /** Mã và tên công việc khi gắn ở công việc (đọc kèm lúc liệt kê). */
  readonly entityLabel?: string;
  readonly kind: string;
  readonly moduleKey: string;
  readonly kindLabel?: string;
  readonly moduleLabel?: string;
  readonly objectId: string;
  readonly code?: string;
  readonly label: string;
  readonly status?: string;
  readonly launchUrl: string;
  readonly createdBy: string;
  readonly createdByName?: string;
  readonly createdAt: string;
}

export interface NewRelatedObject {
  readonly entityType: 'project' | 'work_item';
  readonly entityId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly moduleKey: string;
  readonly kindLabel?: string;
  readonly moduleLabel?: string;
  readonly objectId: string;
  readonly code?: string;
  readonly label: string;
  readonly status?: string;
  readonly launchUrl: string;
  readonly createdBy: string;
  readonly createdByName?: string;
}

/** Nhãn mới đọc từ module gốc, ghi đè bản đã lưu để lần sau module tắt vẫn còn bản gần nhất. */
export interface RelatedObjectSnapshotUpdate {
  readonly id: string;
  readonly code?: string;
  readonly label: string;
  readonly status?: string;
  readonly launchUrl: string;
}

export interface RelatedObjectStore {
  /** Liên kết của dự án và của mọi công việc trong dự án, cũ trước. */
  listByProject(tenantId: string, projectId: string): Promise<readonly StoredRelatedObject[]>;
  listByEntity(
    tenantId: string,
    entityType: 'project' | 'work_item',
    entityId: string,
  ): Promise<readonly StoredRelatedObject[]>;
  findById(tenantId: string, id: string): Promise<StoredRelatedObject | undefined>;
  /** Gắn lại đúng hồ sơ đã gắn thì cập nhật nhãn, không sinh dòng thứ hai. */
  upsert(tenantId: string, input: NewRelatedObject): Promise<StoredRelatedObject>;
  refreshSnapshots(tenantId: string, updates: readonly RelatedObjectSnapshotUpdate[]): Promise<void>;
  remove(tenantId: string, id: string): Promise<void>;
}

/** Người đang xem; mọi lời gọi sang module khác đi dưới danh nghĩa họ, không dùng service token. */
export interface LinkableViewer {
  readonly tenantId: string;
  readonly userId: string;
  readonly accessToken: string;
  /**
   * CSRF của chính phiên người dùng (đã được guard của Workspace đối chiếu với cookie `ep_csrf`), chỉ cần cho lệnh ghi
   * (tạo nhanh): module gốc đòi CSRF cho mọi request ghi như khi trình duyệt gọi thẳng.
   */
  readonly csrfToken?: string;
}

/**
 * Lý do một module không trả lời được:
 *  - `module_unavailable`: công ty không dùng module này, hoặc module chưa công bố đối tượng liên kết;
 *  - `forbidden`: người xem không được vào module;
 *  - `unreachable`: module không trả lời kịp hoặc lỗi.
 */
export type LinkableFailure = 'module_unavailable' | 'forbidden' | 'unreachable';

export class LinkableProviderError extends Error {
  constructor(
    readonly reason: LinkableFailure,
    message?: string,
  ) {
    super(message ?? reason);
    Object.setPrototypeOf(this, LinkableProviderError.prototype);
  }
}

/**
 * Module gốc từ chối dữ liệu tạo nhanh: thiếu ô, sai định dạng, người dùng không có quyền tạo, hay cần xác nhận
 * (`LINKABLE_CONFIRM_REQUIRED` kèm `warnings`). Câu chữ là của module gốc, đã lọc, hiện thẳng trong hộp thoại.
 */
export class LinkableCreateRejectedError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly warnings: readonly string[] = [],
    readonly field?: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, LinkableCreateRejectedError.prototype);
  }
}

/** Một module công bố đối tượng liên kết được. Cài đặt ném `LinkableProviderError` khi không đọc được. */
export interface LinkableProvider {
  readonly moduleKey: string;
  kinds(viewer: LinkableViewer): Promise<readonly LinkableKind[]>;
  /** `filters`: tham số lọc của ô tham chiếu trong form tạo nhanh (đã lọc hình dạng); module gốc bỏ qua tham số lạ. */
  search(
    viewer: LinkableViewer,
    kind: string,
    q: string,
    limit: number,
    filters?: Readonly<Record<string, string>>,
  ): Promise<readonly LinkableCandidate[]>;
  resolve(viewer: LinkableViewer, kind: string, ids: readonly string[]): Promise<readonly LinkableObject[]>;
  /** Form tạo nhanh (tuỳ chọn); module không hỗ trợ thì ném `LinkableProviderError('module_unavailable')`. */
  createForm?(viewer: LinkableViewer, kind: string): Promise<LinkableCreateForm>;
  /** Tạo hồ sơ ở module gốc; dữ liệu bị từ chối thì ném `LinkableCreateRejectedError`. */
  create?(viewer: LinkableViewer, kind: string, request: LinkableCreateRequest): Promise<LinkableObject>;
  /** Xem trước theo giá trị một ô có `preview`; giá trị bị từ chối thì ném `LinkableCreateRejectedError`. */
  createPreview?(viewer: LinkableViewer, kind: string, field: string, value: string): Promise<LinkableCreatePreview>;
}

/** Các module Workspace biết hỏi; thứ tự là thứ tự hiện trong menu. */
export interface LinkableProviderRegistry {
  all(): readonly LinkableProvider[];
  get(moduleKey: string): LinkableProvider | undefined;
}
