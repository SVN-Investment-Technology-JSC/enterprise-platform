import { errorMessage } from '../crm-api';
import { resolveContentType, validateUploadFile, type UploadEvent } from './documents.model';

export interface UploadDeps<T> {
  /** Xin máy chủ URL ký (tạo tài liệu hoặc phiên bản mới). */
  readonly requestTicket: (meta: { fileName: string; contentType: string; sizeBytes: number }) => Promise<{ uploadUrl: string; versionId: string; documentId: string }>;
  readonly put: (uploadUrl: string, file: File, contentType: string, onProgress: (loaded: number, total: number) => void) => Promise<void>;
  readonly complete: (documentId: string, versionId: string, sizeBytes: number) => Promise<T>;
  readonly dispatch: (event: UploadEvent) => void;
}

/**
 * Luồng 3 bước: xin URL ký, PUT file, xác nhận. Mọi lỗi (kiểm file, máy chủ, kho lưu trữ) đổi thành
 * `fail` với lời nhắn tiếng Việt; trả `undefined` khi lỗi.
 */
export async function runUpload<T>(file: File, deps: UploadDeps<T>): Promise<T | undefined> {
  const invalid = validateUploadFile(file);
  if (invalid) {
    deps.dispatch({ type: 'fail', message: invalid });
    return undefined;
  }
  const contentType = resolveContentType(file);
  try {
    deps.dispatch({ type: 'prepare' });
    const ticket = await deps.requestTicket({ fileName: file.name, contentType, sizeBytes: file.size });
    await deps.put(ticket.uploadUrl, file, contentType, (loaded, total) => deps.dispatch({ type: 'progress', loaded, total }));
    deps.dispatch({ type: 'confirm' });
    const result = await deps.complete(ticket.documentId, ticket.versionId, file.size);
    deps.dispatch({ type: 'done' });
    return result;
  } catch (cause) {
    deps.dispatch({ type: 'fail', message: errorMessage(cause, cause instanceof Error ? cause.message : 'Tải lên không thành công.') });
    return undefined;
  }
}
