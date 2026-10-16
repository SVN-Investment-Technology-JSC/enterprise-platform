import type {
  SharedAccessAction,
  SharedAccessLogEntry,
  SharedConfidentiality,
  SharedDocument,
  SharedDocumentKind,
  SharedDocumentStatus,
  SharedDocumentSummary,
  SharedDocumentVersion,
  SharedFolder,
  SharedShareGrant,
  SharedTrashItem,
  StorageModuleUsage,
} from '@enterprise-platform/contracts-shared';
import type { AccessFolder, ShareRecord } from './folder-access.js';

export const SHARED_STORE = Symbol('SHARED_STORE');

/** Người dùng của tenant, để chia sẻ đích danh và hiện tên. */
export interface TenantPerson {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  /** Tài khoản còn hoạt động; tài khoản đã khoá vẫn trả về để hiện tên trên dòng chia sẻ cũ. */
  readonly active: boolean;
}

/** Thông tin hồ sơ khi ghi: `null` là xoá trường, `undefined` không có trong dòng ghi. */
export interface RecordMetaInput {
  readonly docKind: SharedDocumentKind | null;
  readonly docNumber: string | null;
  readonly partner: string | null;
  readonly issuedOn: string | null;
  readonly effectiveTo: string | null;
}

export interface FolderInsert extends RecordMetaInput {
  readonly parentId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly note: string | null;
}

export interface FolderUpdate extends RecordMetaInput {
  readonly name: string;
  readonly parentId: string | null;
  /** Cả nhánh dời cùng: depth của thư mục và mọi con cháu cộng thêm số này. */
  readonly depthDelta: number;
  readonly note: string | null;
}

export interface DocumentInsert extends RecordMetaInput {
  readonly folderId: string;
  readonly name: string;
  readonly description: string | null;
  readonly effectiveFrom: string | null;
  readonly confidentiality: SharedConfidentiality;
  readonly tags: readonly string[];
  readonly sourceLabel: string | null;
  readonly storageKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly changeNote: string | null;
}

export interface DocumentUpdate extends RecordMetaInput {
  readonly folderId: string;
  readonly name: string;
  readonly description: string | null;
  readonly effectiveFrom: string | null;
  readonly confidentiality: SharedConfidentiality;
  readonly tags: readonly string[];
}

export interface VersionInsert {
  readonly documentId: string;
  readonly versionNo: number;
  readonly storageKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly changeNote: string | null;
}

export interface DocumentListQuery {
  readonly folderId?: string;
  /** Chỉ tài liệu trong các thư mục này — những thư mục người gọi được vào. Bỏ trống là cả kho. */
  readonly folderIds?: readonly string[];
  readonly search?: string;
  readonly kind?: SharedDocumentKind;
  readonly status: SharedDocumentStatus;
  readonly expiringWithinDays?: number;
  readonly limit: number;
}

/** Tài liệu kèm phiên bản hiện hành, trước khi tầng application gắn đường dẫn thư mục. */
export type DocumentRow = Omit<SharedDocumentSummary, 'folderPath'>;

/** Chỗ khôi phục một nhánh thư mục: thư mục cha, tên và độ lệch cấp của cả nhánh. */
export interface BranchRestoreTarget {
  readonly parentId: string | null;
  readonly name: string;
  readonly depthDelta: number;
}

/** Một thư mục đang ở Thùng rác, kèm cỡ nhánh đi theo nó. */
export interface TrashedFolder {
  readonly folder: SharedFolder;
  readonly deletedAt: string;
  /** Cấp sâu nhất trong nhánh, để kiểm giới hạn cấp trước khi khôi phục sang chỗ khác. */
  readonly maxDepth: number;
  readonly folders: number;
  readonly documents: number;
}

/**
 * Kết quả xoá vĩnh viễn. Dòng cơ sở dữ liệu đã xoá trong transaction; khoá
 * tệp trả về để tầng application xoá nốt trong kho đối tượng.
 */
export interface PurgeResult {
  readonly storageKeys: readonly string[];
  readonly documents: number;
  readonly folders: number;
}

export interface SharedStore {
  readonly diagnostics: {
    schemaStatus(tenantId: string): Promise<{ schemaExists: boolean; tablesReady: boolean }>;
  };

  readonly folders: {
    /** Mọi thư mục đang dùng, kèm số tài liệu và dung lượng của cả nhánh. */
    list(tenantId: string): Promise<SharedFolder[]>;
    /** Mọi thư mục, kể cả trong Thùng rác, chỉ những cột cần để tính quyền. */
    skeleton(tenantId: string): Promise<AccessFolder[]>;
    find(tenantId: string, folderId: string): Promise<SharedFolder | undefined>;
    create(tenantId: string, userId: string, input: FolderInsert): Promise<SharedFolder>;
    update(tenantId: string, folderId: string, input: FolderUpdate): Promise<SharedFolder>;
    /**
     * Chuyển thư mục cùng cả nhánh và mọi tài liệu bên trong vào Thùng rác, một
     * transaction. `folderId` làm mã lượt xoá của cả nhánh.
     */
    trash(tenantId: string, folderId: string, userId: string): Promise<{ folders: number; documents: number }>;
    /** Thư mục là gốc của một lượt xoá còn nằm trong Thùng rác. */
    findTrashed(tenantId: string, folderId: string): Promise<TrashedFolder | undefined>;
    /** Khôi phục cả nhánh; tên trùng thư mục đang dùng ở chỗ đó thì ném `SharedNameTakenError`. */
    restoreBranch(tenantId: string, folderId: string, target: BranchRestoreTarget): Promise<SharedFolder>;
    /** Xoá vĩnh viễn cả nhánh trong Thùng rác, kể cả tài liệu từng bị xoá riêng khỏi nhánh đó. */
    purgeBranch(tenantId: string, folderId: string, userId: string): Promise<PurgeResult>;
  };

  readonly documents: {
    list(tenantId: string, query: DocumentListQuery): Promise<DocumentRow[]>;
    find(tenantId: string, documentId: string): Promise<DocumentRow | undefined>;
    create(
      tenantId: string,
      userId: string,
      input: DocumentInsert,
    ): Promise<{ document: SharedDocument; version: SharedDocumentVersion }>;
    update(tenantId: string, documentId: string, input: DocumentUpdate): Promise<void>;
    setLock(tenantId: string, documentId: string, userId: string | null): Promise<void>;
    setStatus(tenantId: string, documentId: string, status: SharedDocumentStatus): Promise<void>;
    /** Chuyển một tài liệu vào Thùng rác; tự mở khoá. */
    trash(tenantId: string, documentId: string, userId: string): Promise<void>;
    /** Đưa tài liệu ra khỏi Thùng rác vào `folderId` với tên `name`; trùng tên thì ném `SharedNameTakenError`. */
    restoreFromTrash(
      tenantId: string,
      documentId: string,
      target: { folderId: string; name: string },
    ): Promise<void>;
    /** Xoá vĩnh viễn một tài liệu đang ở Thùng rác, kèm phiên bản và nhật ký truy cập. */
    purge(tenantId: string, documentId: string, userId: string): Promise<PurgeResult>;
    /** Số tài liệu trong các thư mục này đang bị người khác (không phải `userId`) khoá. */
    countLockedByOthers(tenantId: string, folderIds: readonly string[], userId: string): Promise<number>;
    /** Số tài liệu trong các thư mục này mà người xem không được thấy theo độ mật. */
    countHiddenFrom(
      tenantId: string,
      folderIds: readonly string[],
      viewer: { userId: string; canSeeRestricted: boolean },
    ): Promise<number>;
    listVersions(tenantId: string, documentId: string): Promise<SharedDocumentVersion[]>;
    findVersion(tenantId: string, versionId: string): Promise<SharedDocumentVersion | undefined>;
    addVersion(tenantId: string, userId: string, input: VersionInsert): Promise<SharedDocumentVersion>;
    completeVersion(
      tenantId: string,
      versionId: string,
      sizeBytes: number,
    ): Promise<SharedDocumentVersion | undefined>;
    storageKeyOf(tenantId: string, versionId: string): Promise<string | undefined>;
    log(
      tenantId: string,
      userId: string,
      entry: { documentId: string; versionId?: string; action: SharedAccessAction },
    ): Promise<void>;
    accessLog(tenantId: string, documentId: string, limit: number): Promise<SharedAccessLogEntry[]>;
  };

  readonly trash: {
    /** Mọi dòng Thùng rác: thư mục gốc của mỗi lượt xoá và tài liệu xoá riêng lẻ, mới xoá trước. */
    list(tenantId: string): Promise<SharedTrashItem[]>;
  };

  readonly shares: {
    /** Mọi dòng chia sẻ của kho, kể cả dòng đã quá hạn. */
    list(tenantId: string): Promise<ShareRecord[]>;
    /**
     * Thay toàn bộ chia sẻ đặt trên một thư mục bằng `grants`, một transaction.
     * Dòng giữ nguyên quyền và thời hạn thì giữ cả người, lúc sửa cuối.
     */
    replace(tenantId: string, folderId: string, userId: string, grants: readonly SharedShareGrant[]): Promise<void>;
  };

  readonly people: {
    /** Người dùng của tenant, kể cả tài khoản đã khoá. */
    list(tenantId: string): Promise<TenantPerson[]>;
  };

  readonly storage: {
    /** Dung lượng đã dùng theo từng phân hệ, cộng mọi bảng tệp có trong DB tenant. */
    usageByModule(tenantId: string): Promise<StorageModuleUsage[]>;
  };
}
