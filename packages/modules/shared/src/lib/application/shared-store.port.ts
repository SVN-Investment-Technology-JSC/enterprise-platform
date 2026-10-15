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
  StorageModuleUsage,
} from '@enterprise-platform/contracts-shared';

export const SHARED_STORE = Symbol('SHARED_STORE');

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
  readonly search?: string;
  readonly kind?: SharedDocumentKind;
  readonly status: SharedDocumentStatus;
  readonly expiringWithinDays?: number;
  readonly limit: number;
}

/** Tài liệu kèm phiên bản hiện hành, trước khi tầng application gắn đường dẫn thư mục. */
export type DocumentRow = Omit<SharedDocumentSummary, 'folderPath'>;

export interface SharedStore {
  readonly diagnostics: {
    schemaStatus(tenantId: string): Promise<{ schemaExists: boolean; tablesReady: boolean }>;
  };

  readonly folders: {
    /** Mọi thư mục đang dùng, kèm số tài liệu và dung lượng của cả nhánh. */
    list(tenantId: string): Promise<SharedFolder[]>;
    find(tenantId: string, folderId: string): Promise<SharedFolder | undefined>;
    create(tenantId: string, userId: string, input: FolderInsert): Promise<SharedFolder>;
    update(tenantId: string, folderId: string, input: FolderUpdate): Promise<SharedFolder>;
    deactivate(tenantId: string, folderId: string): Promise<void>;
    countContents(tenantId: string, folderId: string): Promise<{ folders: number; documents: number }>;
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

  readonly storage: {
    /** Dung lượng đã dùng theo từng phân hệ, cộng mọi bảng tệp có trong DB tenant. */
    usageByModule(tenantId: string): Promise<StorageModuleUsage[]>;
  };
}
