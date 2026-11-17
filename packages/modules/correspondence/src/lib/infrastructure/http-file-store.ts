import type {
  AttachmentDownloadMode,
  AttachmentDownloadTicket,
} from '@enterprise-platform/contracts-correspondence';
import type {
  SharedFilingDocumentRequest,
  SharedFilingDocumentResponse,
  SharedFilingFolderUpdateRequest,
  SharedFilingVersionRequest,
  SharedFilingVersionResponse,
} from '@enterprise-platform/contracts-shared';
import { FileStoreMissingError, type FileStore } from '../application/ports.js';
import { CorrespondenceValidationError, FileStoreUnavailableError } from '../domain/correspondence.error.js';

const MODULE = 'correspondence';
const TIMEOUT_MS = 10_000;

/**
 * Kho tệp của Văn thư là kho tài liệu của Hệ dùng chung, gọi qua route nội bộ
 * `/v1/internal/filings/*` bằng service token. Hệ dùng chung chỉ cho đụng tới
 * thư mục gốc do Văn thư dựng; quyền người dùng thì Văn thư đã kiểm trước khi gọi.
 */
export class HttpFileStore implements FileStore {
  constructor(
    private readonly root: string = (process.env['SHARED_API_URL'] ?? 'http://localhost:3342/api/shared').replace(/\/$/, ''),
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  create(
    tenantId: string,
    input: Omit<SharedFilingDocumentRequest, 'module'>,
  ): Promise<SharedFilingDocumentResponse> {
    return this.call(tenantId, 'POST', '/v1/internal/filings/documents', { ...input, module: MODULE });
  }

  addVersion(
    tenantId: string,
    documentId: string,
    input: Omit<SharedFilingVersionRequest, 'module'>,
  ): Promise<SharedFilingVersionResponse> {
    return this.call(tenantId, 'POST', `/v1/internal/filings/documents/${encodeURIComponent(documentId)}/versions`, {
      ...input,
      module: MODULE,
    });
  }

  async complete(tenantId: string, documentId: string, versionId: string, sizeBytes: number): Promise<void> {
    await this.call(
      tenantId,
      'POST',
      `/v1/internal/filings/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/complete`,
      { module: MODULE, sizeBytes },
    );
  }

  download(
    tenantId: string,
    documentId: string,
    userId: string,
    mode: AttachmentDownloadMode,
  ): Promise<AttachmentDownloadTicket> {
    const query = new URLSearchParams({ module: MODULE, userId, mode });
    return this.call(tenantId, 'GET', `/v1/internal/filings/documents/${encodeURIComponent(documentId)}/download?${query}`);
  }

  async trash(tenantId: string, documentId: string, userId: string): Promise<void> {
    const query = new URLSearchParams({ module: MODULE, userId });
    try {
      await this.call(tenantId, 'DELETE', `/v1/internal/filings/documents/${encodeURIComponent(documentId)}?${query}`);
    } catch (error) {
      if (!(error instanceof FileStoreMissingError)) throw error;
    }
  }

  async updateFolder(
    tenantId: string,
    folderId: string,
    input: Omit<SharedFilingFolderUpdateRequest, 'module'>,
  ): Promise<void> {
    await this.call(tenantId, 'PATCH', `/v1/internal/filings/folders/${encodeURIComponent(folderId)}`, {
      ...input,
      module: MODULE,
    });
  }

  private async call<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.root}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.serviceToken,
          'x-tenant-id': tenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new FileStoreUnavailableError();
    }
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown; code?: unknown };
    if (response.ok) return payload as T;
    if (response.status === 404) throw new FileStoreMissingError();
    const message = typeof payload.message === 'string' && payload.message ? payload.message : undefined;
    // Lỗi người dùng sửa được (hạn mức dung lượng, tệp quá lớn…): chuyển nguyên câu của Hệ dùng chung.
    if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) {
      throw new CorrespondenceValidationError(message ?? 'Kho tài liệu từ chối tệp này.');
    }
    if (payload.code === 'NOT_PROVISIONED' || response.status === 503) {
      throw new FileStoreUnavailableError(
        'Kho tài liệu của Hệ dùng chung chưa sẵn sàng cho tenant này. Cần bật phân hệ Hệ dùng chung để lưu tệp văn thư.',
      );
    }
    throw new FileStoreUnavailableError();
  }
}
