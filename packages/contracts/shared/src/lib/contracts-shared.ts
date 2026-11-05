/**
 * Hợp đồng dữ liệu của phân hệ Hệ dùng chung.
 *
 * Phần đầu tiên của phân hệ là **Tài liệu công ty**: kho tài liệu cấp công ty
 * (hợp đồng, quyết định, văn bản lập quy, biểu mẫu…), tách hẳn khỏi tài liệu
 * dự án của Workspace. Tài liệu dự án ở lại Workspace; muốn đưa sang kho công
 * ty thì lưu một bản sao.
 */

import type {
  LimitEnforcement,
  TenantResourceLimit,
} from '@enterprise-platform/contracts-tenancy';

export const SHARED_MODULE_KEY = 'shared';
export const SHARED_LAUNCH_URL = '/modules/shared';

/** Quyền của phân hệ, khai trong danh mục quyền của tenant. */
export const SHARED_PERMISSIONS = [
  'shared.read',
  'shared.manage',
  'shared.document.write',
  'shared.document.delete',
] as const;
export type SharedPermission = (typeof SHARED_PERMISSIONS)[number];

/**
 * Cây thư mục tối đa 6 cấp (depth 0..5).
 *
 * Kho công ty sâu hơn kho dự án: "Tài liệu công ty / 3. HỢP ĐỒNG / HỒ SƠ 2026
 * / 1. HĐ CUNG CẤP DỊCH VỤ / 4. HĐ … / Phụ lục" đã là năm cấp.
 */
export const SHARED_MAX_FOLDER_DEPTH = 6;

/** Một tệp tối đa 200 MB; bản vẽ, video lớn hơn thì để qua liên kết ngoài. */
export const SHARED_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;

/** URL ký sẵn sống 300 giây, như Workspace. */
export const SHARED_PRESIGNED_URL_TTL_SECONDS = 300;

/** Kiểu tệp khi trình duyệt không nhận ra: lưu và tải về như tệp nhị phân. */
export const SHARED_DEFAULT_CONTENT_TYPE = 'application/octet-stream';

const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/**
 * Mọi định dạng tệp đều được nhận; kiểu tệp chỉ cần đúng dạng `loại/kiểu`
 * (RFC 6838, không kèm tham số). An toàn nằm ở chỗ tải về: luôn là
 * `attachment`, chỉ PDF và ảnh được xem tại chỗ.
 */
export function isSharedContentType(value: string): boolean {
  return value.length <= 255 && CONTENT_TYPE_PATTERN.test(value);
}

/** Xem trước ngay trong trình duyệt: PDF và ảnh. */
export const SHARED_PREVIEWABLE_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/** Loại tài liệu. Khoá cố định, nhãn hiển thị ở `SHARED_DOCUMENT_KIND_LABELS`. */
export const SHARED_DOCUMENT_KINDS = [
  'contract',
  'decision',
  'official_letter',
  'notice',
  'minutes',
  'report',
  'regulation',
  'procedure',
  'form',
  'certificate',
  'other',
] as const;
export type SharedDocumentKind = (typeof SHARED_DOCUMENT_KINDS)[number];

export const SHARED_DOCUMENT_KIND_LABELS: Readonly<Record<SharedDocumentKind, string>> = {
  contract: 'Hợp đồng',
  decision: 'Quyết định',
  official_letter: 'Công văn',
  notice: 'Thông báo',
  minutes: 'Biên bản',
  report: 'Báo cáo',
  regulation: 'Quy chế, quy định',
  procedure: 'Quy trình',
  form: 'Biểu mẫu',
  certificate: 'Chứng chỉ',
  other: 'Khác',
};

export const SHARED_CONFIDENTIALITY_LEVELS = ['internal', 'restricted', 'confidential'] as const;
export type SharedConfidentiality = (typeof SHARED_CONFIDENTIALITY_LEVELS)[number];

export const SHARED_CONFIDENTIALITY_LABELS: Readonly<Record<SharedConfidentiality, string>> = {
  internal: 'Nội bộ',
  restricted: 'Hạn chế',
  confidential: 'Mật',
};

export const SHARED_DOCUMENT_STATUSES = ['active', 'archived'] as const;
export type SharedDocumentStatus = (typeof SHARED_DOCUMENT_STATUSES)[number];

/**
 * Thông tin hồ sơ, dùng chung cho thư mục và tài liệu.
 *
 * 1Office chỉ xếp thư mục, mọi trường này đều trống; ở đây một thư mục hợp
 * đồng ("4. HĐ ĐO CLĐN – ĐG TRUNG NAM") mang được số hợp đồng, đối tác và
 * hạn hiệu lực như chính một tài liệu.
 */
export interface SharedRecordMeta {
  readonly docKind?: SharedDocumentKind;
  /** Số hiệu: số hợp đồng, số quyết định… */
  readonly docNumber?: string;
  /** Đối tác, cơ quan ban hành hoặc nơi gửi. */
  readonly partner?: string;
  /** Ngày ký, ngày ban hành. ISO `YYYY-MM-DD`. */
  readonly issuedOn?: string;
  /** Hiệu lực đến. ISO `YYYY-MM-DD`. */
  readonly effectiveTo?: string;
}

export interface SharedFolder extends SharedRecordMeta {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly depth: number;
  readonly isActive: boolean;
  readonly note?: string;
  /** Tài liệu đang dùng nằm thẳng trong thư mục (không tính thư mục con). */
  readonly documentCount: number;
  /** Tài liệu đang dùng của cả nhánh, kể cả thư mục con. */
  readonly totalDocumentCount: number;
  /** Dung lượng các phiên bản của cả nhánh, byte. */
  readonly totalBytes: number;
  /** Người tạo thư mục, cũng là chủ sở hữu: có quyền Quản lý trên cả nhánh. */
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Quyền của người đang xem trên thư mục này, đã tính kế thừa từ thư mục cha.
   * Quản trị kho luôn là `manager`. Ghi và xoá còn cần quyền của phân hệ.
   */
  readonly access?: SharedFolderRole;
}

export interface SharedDocumentVersion {
  readonly id: string;
  readonly documentId: string;
  readonly versionNo: number;
  readonly fileName: string;
  readonly contentType: string;
  /** Rỗng nghĩa là **chưa tải lên xong**. */
  readonly sizeBytes?: number;
  readonly changeNote?: string;
  readonly uploadedBy: string;
  readonly uploadedByName?: string;
  readonly createdAt: string;
}

export interface SharedDocument extends SharedRecordMeta {
  readonly id: string;
  readonly folderId: string;
  readonly name: string;
  readonly description?: string;
  readonly effectiveFrom?: string;
  readonly confidentiality: SharedConfidentiality;
  readonly tags: readonly string[];
  /** Nguồn khi tài liệu là bản sao lưu từ phân hệ khác, ví dụ "Dự án 26-640". */
  readonly sourceLabel?: string;
  readonly currentVersionId?: string;
  readonly status: SharedDocumentStatus;
  readonly lockedByUserId?: string;
  readonly lockedAt?: string;
  /** Có giá trị nghĩa là tài liệu đang ở Thùng rác; mọi danh sách thường không trả những dòng này. */
  readonly deletedAt?: string;
  readonly createdBy: string;
  readonly createdByName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SharedDocumentSummary extends SharedDocument {
  readonly currentVersion?: SharedDocumentVersion;
  readonly versionCount: number;
  /** Đường dẫn thư mục, để kết quả tìm kiếm toàn kho biết tài liệu nằm đâu. */
  readonly folderPath: string;
}

export const SHARED_ACCESS_ACTIONS = [
  'view',
  'download',
  'upload',
  'update',
  'move',
  'lock',
  'unlock',
  'archive',
  'restore',
  'delete',
] as const;
export type SharedAccessAction = (typeof SHARED_ACCESS_ACTIONS)[number];

export interface SharedAccessLogEntry {
  readonly id: string;
  readonly action: SharedAccessAction;
  readonly versionNo?: number;
  readonly userId: string;
  readonly userName?: string;
  readonly createdAt: string;
}

export interface SharedDocumentDetail extends SharedDocumentSummary {
  readonly versions: readonly SharedDocumentVersion[];
  readonly accessLog: readonly SharedAccessLogEntry[];
}

/* ---------------------------------------------------------------- thùng rác */

/**
 * Thùng rác giữ tài liệu và thư mục đã xoá cho tới khi quản lý xoá vĩnh viễn.
 * Tệp vẫn nằm trong kho nên vẫn tính vào dung lượng.
 */
export type SharedTrashKind = 'folder' | 'document';

/** Tên đoạn đường dẫn REST của từng loại: `/trash/folders/:id`, `/trash/documents/:id`. */
export const SHARED_TRASH_PATHS: Readonly<Record<SharedTrashKind, string>> = {
  folder: 'folders',
  document: 'documents',
};

/**
 * Một dòng của Thùng rác. Xoá một thư mục là một dòng: thư mục con và tài
 * liệu bên trong đi theo và khôi phục cùng nó.
 */
export interface SharedTrashItem {
  readonly kind: SharedTrashKind;
  readonly id: string;
  readonly name: string;
  /** Đường dẫn của thư mục chứa nó trước khi xoá; rỗng là thư mục gốc. */
  readonly location: string;
  /** Tài liệu: thư mục chứa nó trước khi xoá. */
  readonly folderId?: string;
  /** Thư mục chứa nó còn dùng được, khôi phục tại chỗ được. */
  readonly locationAvailable: boolean;
  /** Thư mục: số tài liệu đi theo. Tài liệu: luôn là 1. */
  readonly documentCount: number;
  /** Số thư mục con đi theo (không tính chính nó); tài liệu: 0. */
  readonly folderCount: number;
  readonly totalBytes: number;
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly deletedByName?: string;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly docKind?: SharedDocumentKind;
  readonly docNumber?: string;
  readonly confidentiality?: SharedConfidentiality;
  readonly createdBy?: string;
}

export interface RestoreSharedTrashRequest {
  /**
   * Chỗ khôi phục khi chỗ cũ không còn: thư mục chứa (tài liệu) hoặc thư mục
   * cha (thư mục). Bỏ trống là về chỗ cũ.
   */
  readonly targetFolderId?: string;
}

export interface SharedTrashRestoreResult {
  readonly kind: SharedTrashKind;
  readonly id: string;
  /** Tên sau khi khôi phục; có thể khác tên cũ nếu chỗ đó đã có mục cùng tên. */
  readonly name: string;
}

/** Kết quả xoá một thư mục (vào Thùng rác): số thư mục con và tài liệu đi theo. */
export interface SharedFolderDeleteResult {
  readonly folders: number;
  readonly documents: number;
}

export interface EmptySharedTrashResult {
  readonly purged: number;
  readonly failed: number;
}

/* ------------------------------------------------------------- chia sẻ */

/**
 * Quyền trên một thư mục, áp xuống mọi thư mục con:
 *
 * - Xem: thấy thư mục, mở và tải tài liệu "Nội bộ";
 * - Sửa: thêm tải lên, sửa, tạo thư mục con, xoá; thấy tài liệu "Hạn chế";
 * - Quản lý: thêm chia sẻ thư mục; thấy tài liệu "Mật".
 *
 * Quyền phân hệ vẫn là trần: "Sửa" chỉ cho ghi khi người đó có
 * `shared.document.write`, chỉ cho xoá khi có `shared.document.delete`.
 */
export const SHARED_FOLDER_ROLES = ['viewer', 'editor', 'manager'] as const;
export type SharedFolderRole = (typeof SHARED_FOLDER_ROLES)[number];

export const SHARED_FOLDER_ROLE_LABELS: Readonly<Record<SharedFolderRole, string>> = {
  viewer: 'Xem',
  editor: 'Sửa',
  manager: 'Quản lý',
};

/** `role` có bằng hoặc cao hơn `minimum` không; không có quyền thì không. */
export function roleAtLeast(role: SharedFolderRole | undefined, minimum: SharedFolderRole): boolean {
  return role !== undefined && SHARED_FOLDER_ROLES.indexOf(role) >= SHARED_FOLDER_ROLES.indexOf(minimum);
}

/**
 * Đối tượng được chia sẻ. Phòng ban và chức danh là node của sơ đồ tổ chức:
 * chia cho một phòng ban là chia cho mọi người thuộc phòng đó và các đơn vị
 * bên dưới; chia cho chức danh là chia cho người đang giữ chức danh đó.
 */
export const SHARED_PRINCIPAL_TYPES = ['everyone', 'unit', 'position', 'user'] as const;
export type SharedPrincipalType = (typeof SHARED_PRINCIPAL_TYPES)[number];

export const SHARED_PRINCIPAL_TYPE_LABELS: Readonly<Record<SharedPrincipalType, string>> = {
  everyone: 'Mọi người',
  unit: 'Phòng ban',
  position: 'Chức danh',
  user: 'Nhân sự',
};

/** Một thư mục giữ tối đa từng này dòng chia sẻ. */
export const SHARED_MAX_SHARES_PER_FOLDER = 100;

/** Một dòng chia sẻ khi ghi. */
export interface SharedShareGrant {
  readonly principalType: SharedPrincipalType;
  /** Id người dùng hay id node sơ đồ tổ chức; bỏ trống với `everyone`. */
  readonly principalId?: string;
  readonly role: SharedFolderRole;
  /** Còn hiệu lực tới hết ngày này, `YYYY-MM-DD`; bỏ trống là không thời hạn. */
  readonly expiresOn?: string;
}

export interface SharedFolderShare extends SharedShareGrant {
  /** Tên người, tên phòng ban hay chức danh. */
  readonly label: string;
  /** Đường dẫn trong sơ đồ tổ chức ("Công ty › Khối thí nghiệm"), hoặc phòng ban của người. */
  readonly detail?: string;
  /** Đối tượng không còn trong sơ đồ tổ chức hay danh sách người dùng. */
  readonly missing: boolean;
  /** Quá thời hạn: dòng còn đó nhưng không còn cho quyền. */
  readonly expired: boolean;
  readonly updatedAt?: string;
  readonly updatedByName?: string;
}

/** Quyền đến từ một thư mục cha: chia sẻ của nó, hoặc chủ sở hữu của nó. */
export interface SharedInheritedShare extends SharedFolderShare {
  readonly fromFolderId: string;
  readonly fromFolderName: string;
  /** Chủ sở hữu thư mục cha (quyền Quản lý), không phải một dòng chia sẻ. */
  readonly owner?: boolean;
}

/** Ai được vào một thư mục và bằng quyền gì. */
export interface SharedFolderSharing {
  readonly folderId: string;
  readonly folderName: string;
  readonly owner: { readonly userId: string; readonly name?: string };
  /** Chia sẻ đặt ngay trên thư mục này, sửa được. */
  readonly shares: readonly SharedFolderShare[];
  /** Chia sẻ từ các thư mục cha, chỉ đọc ở đây. */
  readonly inherited: readonly SharedInheritedShare[];
}

/** Thay toàn bộ chia sẻ đặt trên thư mục. */
export interface UpdateSharedFolderSharesRequest {
  readonly shares: readonly SharedShareGrant[];
}

/** Người trong danh bạ của hộp thoại chia sẻ. */
export interface SharedDirectoryPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly email?: string;
  readonly unitNames: readonly string[];
  readonly positionName?: string;
}

/** Một phòng ban hay chức danh của sơ đồ tổ chức. */
export interface SharedDirectoryNode {
  readonly id: string;
  readonly name: string;
  readonly kind: 'unit' | 'position';
  readonly parentId?: string;
  /** "Công ty › Khối thí nghiệm" — tên các node cha, không gồm chính nó. */
  readonly path: string;
}

export interface SharedDirectory {
  readonly people: readonly SharedDirectoryPerson[];
  readonly nodes: readonly SharedDirectoryNode[];
  /** Không đọc được sơ đồ tổ chức: chỉ chia sẻ được cho từng người hoặc mọi người. */
  readonly degraded: boolean;
}

/* --------------------------------------------------------------- yêu cầu */

export interface CreateSharedFolderRequest extends SharedRecordMeta {
  readonly parentId?: string;
  readonly name: string;
  readonly note?: string;
}

export interface UpdateSharedFolderRequest extends SharedRecordMeta {
  readonly name?: string;
  /** `null` chuyển ra gốc; bỏ trống là giữ nguyên chỗ. */
  readonly parentId?: string | null;
  readonly note?: string;
}

export interface CreateSharedDocumentRequest extends SharedRecordMeta {
  readonly folderId: string;
  readonly name: string;
  readonly description?: string;
  readonly effectiveFrom?: string;
  readonly confidentiality?: SharedConfidentiality;
  readonly tags?: readonly string[];
  readonly fileName: string;
  readonly contentType: string;
  /** Dung lượng client khai, để kiểm hạn mức trước khi ký URL. */
  readonly sizeBytes: number;
  readonly note?: string;
}

export interface UpdateSharedDocumentRequest extends SharedRecordMeta {
  readonly name?: string;
  readonly description?: string;
  readonly effectiveFrom?: string;
  readonly confidentiality?: SharedConfidentiality;
  readonly tags?: readonly string[];
  /** Chuyển sang thư mục khác. */
  readonly folderId?: string;
}

export interface CreateSharedVersionRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly changeNote: string;
}

export interface CompleteSharedUploadRequest {
  readonly sizeBytes: number;
}

export interface SharedUploadTicket {
  readonly version: SharedDocumentVersion;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

export interface CreateSharedDocumentResponse extends SharedUploadTicket {
  readonly document: SharedDocument;
}

export type SharedDownloadMode = 'download' | 'preview';

export interface SharedDownloadTicket {
  readonly downloadUrl: string;
  readonly expiresInSeconds: number;
  readonly fileName: string;
  readonly contentType: string;
}

export interface SharedDocumentQuery {
  readonly folderId?: string;
  readonly search?: string;
  readonly kind?: SharedDocumentKind;
  readonly status?: SharedDocumentStatus;
  /** Chỉ tài liệu hết hiệu lực trong số ngày tới (đã hết thì cũng tính). */
  readonly expiringWithinDays?: number;
}

/* ------------------------------------------------------------ dung lượng */

/**
 * Hạn mức dung lượng của **cả tenant**, theo gói.
 *
 * Mọi tệp tính chung một hạn mức: tài liệu công ty, tài liệu và đính kèm của
 * Workspace, HRM, Quy trình, Kho, Bảo trì. Platform giữ con số theo gói và gói
 * mua thêm (hợp đồng ở `contracts-tenancy`); phân hệ này chỉ đọc và cộng dung
 * lượng đang dùng.
 */
export {
  STORAGE_ADD_ON_STEP_GB,
  STORAGE_DEFAULT_QUOTA_GB,
  STORAGE_PLAN_QUOTAS_GB,
  STORAGE_RESOURCE_KEY,
  type TenantLimitsResponse,
} from '@enterprise-platform/contracts-tenancy';

/** Báo trước khi dùng tới 80% hạn mức. */
export const STORAGE_WARN_PERCENT = 80;

export type StorageQuotaSource = TenantResourceLimit['source'];
export type StorageEnforcement = LimitEnforcement;
/** Hạn mức dung lượng Platform trả về, đã cộng gói mua thêm. */
export type TenantStorageLimit = TenantResourceLimit;

export interface StorageModuleUsage {
  readonly moduleKey: string;
  readonly label: string;
  readonly bytes: number;
  readonly files: number;
}

export interface StorageUsage {
  readonly quotaBytes: number;
  readonly usedBytes: number;
  /** Phần trăm đã dùng, làm tròn một chữ số. */
  readonly usedPercent: number;
  readonly warnPercent: number;
  readonly enforcement: StorageEnforcement;
  readonly source: StorageQuotaSource;
  readonly planKey?: string;
  /** Dung lượng gói mua thêm, đã gộp trong `quotaBytes`. */
  readonly addOnBytes: number;
  readonly byModule: readonly StorageModuleUsage[];
}

/* -------------------------------------------------------------- trạng thái */

export interface SharedCapabilities {
  readonly isTenantAdmin: boolean;
  readonly canManage: boolean;
  readonly canWriteDocuments: boolean;
  readonly canDeleteDocuments: boolean;
}

export interface SharedStatus {
  readonly tenantId: string;
  readonly schemaExists: boolean;
  readonly tablesReady: boolean;
  readonly capabilities: SharedCapabilities;
}

/* -------------------------------------------------------------- tiện ích */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[unit]}`;
}

export const BYTES_PER_GB = 1024 * 1024 * 1024;
