import type {
  CreateSharedDocumentRequest,
  CreateSharedDocumentResponse,
  CreateSharedFolderRequest,
  CreateSharedVersionRequest,
  SharedDocumentDetail,
  SharedDocumentQuery,
  SharedDocumentSummary,
  SharedDocumentVersion,
  SharedDownloadMode,
  SharedDownloadTicket,
  SharedFolder,
  SharedStatus,
  SharedUploadTicket,
  StorageUsage,
  UpdateSharedDocumentRequest,
  UpdateSharedFolderRequest,
} from '@enterprise-platform/contracts-shared';
import { authFetch } from '@enterprise-platform/shared-ui';
import { contentTypeOf } from './library.model';

const API = '/api/shared/v1';

/** Lỗi API: thân lỗi đã có `code` và `message` tiếng Việt. */
export interface SharedApiError {
  readonly code?: string;
  readonly message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `authFetch` tự gắn cookie phiên, `x-csrf-token` và làm mới phiên một lần khi gặp 401.
  const response = await authFetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    window.location.assign('/');
    throw { code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập đã hết.' } satisfies SharedApiError;
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw body as SharedApiError;
  return body as T;
}

/** Lời nhắn lỗi để hiện thẳng cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  const message = (cause as SharedApiError | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export const loadSharedStatus = () => request<SharedStatus>('/status', { cache: 'no-store' });

export const loadStorageUsage = () => request<StorageUsage>('/storage', { cache: 'no-store' });

/** Đường về Tenant Portal cho nút Trang chủ trên thanh bên. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    return response.ok ? '/applications' : '/';
  } catch {
    return '/';
  }
}

/** Id người đang đăng nhập, để biết ai đang giữ khoá tài liệu. */
export async function loadCurrentUserId(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    if (!response.ok) return '';
    const principal = (await response.json()) as { userId?: string; id?: string };
    return principal.userId ?? principal.id ?? '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------ thư mục */

export const listFolders = () =>
  request<{ items: SharedFolder[] }>('/folders', { cache: 'no-store' }).then((body) => body.items);

export const createFolder = (body: CreateSharedFolderRequest) =>
  request<SharedFolder>('/folders', { method: 'POST', body: JSON.stringify(body) });

export const updateFolder = (id: string, body: UpdateSharedFolderRequest) =>
  request<SharedFolder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const removeFolder = (id: string) =>
  request<void>(`/folders/${id}`, { method: 'DELETE' });

/* ----------------------------------------------------------- tài liệu */

export const listDocuments = (query: SharedDocumentQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.size ? `?${params}` : '';
  return request<{ items: SharedDocumentSummary[] }>(`/documents${suffix}`, {
    cache: 'no-store',
  }).then((body) => body.items);
};

export const loadDocument = (id: string) =>
  request<SharedDocumentDetail>(`/documents/${id}`, { cache: 'no-store' });

export const createDocument = (body: CreateSharedDocumentRequest) =>
  request<CreateSharedDocumentResponse>('/documents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateDocument = (id: string, body: UpdateSharedDocumentRequest) =>
  request<SharedDocumentSummary>(`/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const createVersion = (id: string, body: CreateSharedVersionRequest) =>
  request<SharedUploadTicket>(`/documents/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const completeUpload = (id: string, versionId: string, sizeBytes: number) =>
  request<SharedDocumentVersion>(`/documents/${id}/versions/${versionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ sizeBytes }),
  });

export const downloadTicket = (id: string, versionId?: string, mode: SharedDownloadMode = 'download') => {
  const params = new URLSearchParams();
  if (versionId) params.set('versionId', versionId);
  if (mode === 'preview') params.set('mode', 'preview');
  const suffix = params.size ? `?${params}` : '';
  return request<SharedDownloadTicket>(`/documents/${id}/download${suffix}`, { cache: 'no-store' });
};

export const lockDocument = (id: string) =>
  request<SharedDocumentSummary>(`/documents/${id}/lock`, { method: 'POST' });

export const unlockDocument = (id: string) =>
  request<SharedDocumentSummary>(`/documents/${id}/lock`, { method: 'DELETE' });

export const archiveDocument = (id: string) =>
  request<SharedDocumentSummary>(`/documents/${id}/archive`, { method: 'POST' });

export const restoreDocument = (id: string) =>
  request<SharedDocumentSummary>(`/documents/${id}/restore`, { method: 'POST' });

/** Chặng 2 của tải lên: trình duyệt `PUT` thẳng vào kho đối tượng qua URL ký sẵn. */
export async function uploadToStorage(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': contentTypeOf(file) },
  });
  if (!response.ok) {
    throw {
      code: 'UPLOAD_FAILED',
      message: `Tải tệp lên thất bại (${response.status}).`,
    } satisfies SharedApiError;
  }
}

/** Tải lên trọn ba chặng: xin URL, `PUT` tệp, báo xong. */
export async function uploadDocument(
  body: Omit<CreateSharedDocumentRequest, 'fileName' | 'contentType' | 'sizeBytes'>,
  file: File,
): Promise<CreateSharedDocumentResponse> {
  const created = await createDocument({
    ...body,
    fileName: file.name,
    contentType: contentTypeOf(file),
    sizeBytes: file.size,
  });
  await uploadToStorage(created.uploadUrl, file);
  // Chỉ báo xong sau khi PUT thành công; hỏng giữa chừng thì phiên bản ở lại
  // trạng thái "chưa tải lên xong" và không ai tải xuống được một tệp rỗng.
  await completeUpload(created.document.id, created.version.id, file.size);
  return created;
}

export async function uploadVersion(documentId: string, file: File, changeNote: string) {
  const ticket = await createVersion(documentId, {
    fileName: file.name,
    contentType: contentTypeOf(file),
    sizeBytes: file.size,
    changeNote,
  });
  await uploadToStorage(ticket.uploadUrl, file);
  return completeUpload(documentId, ticket.version.id, file.size);
}

/** Mở tệp: xem tại chỗ (`preview`) hoặc tải về. */
export async function openDocumentFile(
  id: string,
  versionId?: string,
  mode: SharedDownloadMode = 'download',
): Promise<SharedDownloadTicket> {
  const ticket = await downloadTicket(id, versionId, mode);
  if (mode === 'download') {
    const link = document.createElement('a');
    link.href = ticket.downloadUrl;
    link.download = ticket.fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  return ticket;
}
