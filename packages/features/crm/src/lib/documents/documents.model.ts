import {
  CRM_ALLOWED_DOCUMENT_CONTENT_TYPES,
  CRM_DOCUMENT_MAX_BYTES,
  type CrmCapabilities,
  type CrmDocument,
  type CrmDocumentAudience,
  type CrmDocumentFolder,
} from '@enterprise-platform/contracts-crm';

export const DOCUMENT_AUDIENCE_LABELS: Record<CrmDocumentAudience, string> = {
  internal: 'Nội bộ',
  customer: 'Hướng ra khách',
};

/** Đuôi file sang loại nội dung, dùng khi trình duyệt không khai `file.type` (thường gặp với csv trên Windows). */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  csv: 'text/csv',
  txt: 'text/plain',
};

export interface PickedFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

/** Loại nội dung gửi lên máy chủ: ưu tiên `file.type`, thiếu thì suy từ đuôi file. */
export function resolveContentType(file: Pick<PickedFile, 'name' | 'type'>): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? '';
}

/** Kiểm file trước khi xin URL ký (máy chủ vẫn kiểm lại); trả lời nhắn lỗi hoặc `undefined` nếu hợp lệ. */
export function validateUploadFile(file: PickedFile): string | undefined {
  if (!file.name.trim()) return 'File chưa có tên.';
  if (file.size <= 0) return 'File rỗng, hãy chọn file khác.';
  if (file.size > CRM_DOCUMENT_MAX_BYTES) {
    return `File vượt quá ${formatBytes(CRM_DOCUMENT_MAX_BYTES)}; hãy chọn file nhỏ hơn.`;
  }
  const contentType = resolveContentType(file);
  if (!CRM_ALLOWED_DOCUMENT_CONTENT_TYPES.includes(contentType)) {
    return 'Loại file này chưa được hỗ trợ. Chấp nhận PDF, Word, Excel, PowerPoint, ZIP, ảnh JPG, PNG, WEBP, CSV và văn bản.';
  }
  return undefined;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

// --- Trạng thái tải lên ----------------------------------------------------

export type UploadPhase = 'idle' | 'preparing' | 'uploading' | 'confirming' | 'done' | 'error';

export interface UploadState {
  readonly phase: UploadPhase;
  /** 0 đến 100, chỉ có nghĩa ở pha `uploading`. */
  readonly percent: number;
  readonly error?: string;
}

export const UPLOAD_IDLE: UploadState = { phase: 'idle', percent: 0 };

export type UploadEvent =
  | { readonly type: 'prepare' }
  | { readonly type: 'progress'; readonly loaded: number; readonly total: number }
  | { readonly type: 'confirm' }
  | { readonly type: 'done' }
  | { readonly type: 'fail'; readonly message: string }
  | { readonly type: 'reset' };

export function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case 'prepare':
      return { phase: 'preparing', percent: 0 };
    case 'progress': {
      if (state.phase !== 'preparing' && state.phase !== 'uploading') return state;
      const percent = event.total > 0 ? Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))) : 0;
      return { phase: 'uploading', percent };
    }
    case 'confirm':
      return { phase: 'confirming', percent: 100 };
    case 'done':
      return { phase: 'done', percent: 100 };
    case 'fail':
      return { phase: 'error', percent: 0, error: event.message };
    case 'reset':
      return UPLOAD_IDLE;
  }
}

export const isUploadBusy = (state: UploadState): boolean =>
  state.phase === 'preparing' || state.phase === 'uploading' || state.phase === 'confirming';

export function uploadPhaseLabel(state: UploadState): string {
  switch (state.phase) {
    case 'preparing':
      return 'Đang chuẩn bị tải lên…';
    case 'uploading':
      return `Đang tải lên ${state.percent}%`;
    case 'confirming':
      return 'Đang xác nhận với máy chủ…';
    case 'done':
      return 'Đã tải lên.';
    case 'error':
      return state.error ?? 'Tải lên không thành công.';
    default:
      return '';
  }
}

// --- Quyền và khoá ---------------------------------------------------------

type DocumentCapabilities = Pick<CrmCapabilities, 'canWriteDocument' | 'canDeleteDocument'>;

export const isLocked = (doc: Pick<CrmDocument, 'lockedByUserId'>): boolean => doc.lockedByUserId !== null;

export const isLockedByOther = (doc: Pick<CrmDocument, 'lockedByUserId'>, currentUserId?: string): boolean =>
  doc.lockedByUserId !== null && doc.lockedByUserId !== currentUserId;

export interface DocumentActions {
  readonly newVersion: boolean;
  readonly edit: boolean;
  readonly lock: boolean;
  readonly unlock: boolean;
  readonly audience: boolean;
  readonly remove: boolean;
}

/** Nút nào hiện cho một tài liệu. Ẩn nút chỉ là gợi ý, máy chủ mới là nơi kiểm quyền. */
export function documentActions(
  doc: Pick<CrmDocument, 'lockedByUserId'>,
  capabilities: DocumentCapabilities,
  currentUserId?: string,
): DocumentActions {
  const write = capabilities.canWriteDocument;
  const lockedByOther = isLockedByOther(doc, currentUserId);
  return {
    newVersion: write && !lockedByOther,
    edit: write && !lockedByOther,
    lock: write && !isLocked(doc),
    unlock: write && isLocked(doc),
    audience: write && !lockedByOther,
    remove: capabilities.canDeleteDocument && !lockedByOther,
  };
}

// --- Thư mục ---------------------------------------------------------------

export interface FolderOption {
  readonly value: string;
  readonly label: string;
}

/** Cây thư mục phẳng theo thứ tự cha trước con, nhãn là đường dẫn đầy đủ ("Hợp đồng / Phụ lục"). */
export function folderOptions(folders: readonly CrmDocumentFolder[]): FolderOption[] {
  const byParent = new Map<string | null, CrmDocumentFolder[]>();
  const ids = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
    const key = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), folder]);
  }
  const result: FolderOption[] = [];
  const walk = (parent: string | null, prefix: string) => {
    const children = [...(byParent.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    for (const child of children) {
      const label = prefix ? `${prefix} / ${child.name}` : child.name;
      result.push({ value: child.id, label });
      walk(child.id, label);
    }
  };
  walk(null, '');
  return result;
}

export const FOLDER_ALL = '';
export const FOLDER_ROOT = 'root';

export function folderLabel(folderId: string | null, options: readonly FolderOption[]): string {
  if (!folderId) return 'Thư mục gốc';
  return options.find((option) => option.value === folderId)?.label ?? 'Thư mục không rõ';
}
