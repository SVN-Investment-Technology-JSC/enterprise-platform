import {
  CORRESPONDENCE_API_ROOT,
  type AttachmentDownloadMode,
  type AttachmentDownloadTicket,
  type AttachmentKind,
  type AttachmentUploadTicket,
  type ClassifyLetterRequest,
  type CorrespondenceDirectory,
  type CorrespondenceOverview,
  type CorrespondenceSettings,
  type CorrespondenceStatus,
  type CreateLetterRequest,
  type DirectLetterRequest,
  type LetterAttachment,
  type LetterDetail,
  type LetterQuery,
  type LetterSummary,
  type PublishLetterRequest,
  type RequestRevisionRequest,
  type UpdateLetterRequest,
} from '@enterprise-platform/contracts-correspondence';
import { authFetch } from '@enterprise-platform/shared-ui';

/** Lỗi API: thân lỗi có `code` và `message` tiếng Việt. */
export interface CorrespondenceApiError {
  readonly code?: string;
  readonly message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `authFetch` tự gắn cookie phiên, `x-csrf-token` và làm mới phiên một lần khi gặp 401.
  const response = await authFetch(`${CORRESPONDENCE_API_ROOT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    window.location.assign('/');
    throw { code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập đã hết.' } satisfies CorrespondenceApiError;
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw body as CorrespondenceApiError;
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Lời nhắn lỗi để hiện thẳng cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  const message = (cause as CorrespondenceApiError | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** Đường về Tenant Portal cho nút Trang chủ trên thanh bên. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    return response.ok ? '/applications' : '/';
  } catch {
    return '/';
  }
}

export const loadStatus = () => request<CorrespondenceStatus>('/status', { cache: 'no-store' });
export const loadDirectory = () => request<CorrespondenceDirectory>('/directory', { cache: 'no-store' });
export const loadOverview = () => request<CorrespondenceOverview>('/overview', { cache: 'no-store' });
export const saveSettings = (settings: CorrespondenceSettings) =>
  request<CorrespondenceSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) });

export function listLetters(query: LetterQuery): Promise<LetterSummary[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return request<{ items: LetterSummary[] }>(`/letters${params.size ? `?${params}` : ''}`, { cache: 'no-store' }).then(
    (body) => body.items,
  );
}

export const loadLetter = (id: string) =>
  request<LetterDetail>(`/letters/${encodeURIComponent(id)}`, { cache: 'no-store' });
export const createLetter = (body: CreateLetterRequest) => post<LetterDetail>('/letters', body);
export const updateLetter = (id: string, body: UpdateLetterRequest) =>
  request<LetterDetail>(`/letters/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });

const letter = (id: string, action: string) => `/letters/${encodeURIComponent(id)}/${action}`;

export const classifyLetter = (id: string, body: ClassifyLetterRequest) => post<LetterDetail>(letter(id, 'classify'), body);
export const submitLetter = (id: string, leaderUserId: string, note?: string) =>
  post<LetterDetail>(letter(id, 'submit'), { leaderUserId, note });
export const returnLetter = (id: string, reason: string) => post<LetterDetail>(letter(id, 'return'), { reason });
export const directLetter = (id: string, body: DirectLetterRequest) => post<LetterDetail>(letter(id, 'direct'), body);
export const closeForInfo = (id: string, note?: string) => post<LetterDetail>(letter(id, 'close-for-info'), { note });
export const respondLetter = (id: string, assignmentId: string, note: string) =>
  post<LetterDetail>(letter(id, `assignments/${encodeURIComponent(assignmentId)}/respond`), { note });
export const approveLetter = (id: string, note?: string) => post<LetterDetail>(letter(id, 'approve'), { note });
export const requestRevision = (id: string, body: RequestRevisionRequest) =>
  post<LetterDetail>(letter(id, 'request-revision'), body);
export const publishLetter = (id: string, body: PublishLetterRequest) => post<LetterDetail>(letter(id, 'publish'), body);
export const archiveLetter = (id: string, note?: string) => post<LetterDetail>(letter(id, 'archive'), { note });
export const cancelLetter = (id: string, reason: string) => post<LetterDetail>(letter(id, 'cancel'), { reason });

/* --------------------------------------------------------------- tệp */

/** Trình duyệt nhận diện kiểu tệp; không nhận ra thì để kho lưu như tệp nhị phân. */
export function contentTypeOf(file: File): string {
  return file.type || 'application/octet-stream';
}

/**
 * Tải tệp lên trọn ba chặng: Văn thư xin URL ký sẵn (tài liệu được tạo bên Hệ dùng
 * chung), trình duyệt `PUT` thẳng lên kho, rồi báo xong.
 */
export async function uploadAttachment(
  letterId: string,
  file: File,
  kind: AttachmentKind,
  assignmentId?: string,
): Promise<LetterAttachment> {
  const ticket = await post<AttachmentUploadTicket>(letter(letterId, 'attachments'), {
    kind,
    assignmentId,
    fileName: file.name,
    contentType: contentTypeOf(file),
    sizeBytes: file.size,
  });
  const response = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': contentTypeOf(file) },
  });
  if (!response.ok) {
    throw { code: 'UPLOAD_FAILED', message: `Tải tệp lên thất bại (${response.status}).` } satisfies CorrespondenceApiError;
  }
  return post<LetterAttachment>(letter(letterId, `attachments/${encodeURIComponent(ticket.attachment.id)}/complete`), {
    sizeBytes: file.size,
  });
}

export const deleteAttachment = (letterId: string, attachmentId: string) =>
  request<void>(letter(letterId, `attachments/${encodeURIComponent(attachmentId)}`), { method: 'DELETE' });

/** Xem tại chỗ (PDF, ảnh) thì mở tab mới; tải về thì tải ngay. */
export async function openAttachment(
  letterId: string,
  attachmentId: string,
  mode: AttachmentDownloadMode,
): Promise<AttachmentDownloadTicket> {
  const ticket = await request<AttachmentDownloadTicket>(
    `${letter(letterId, `attachments/${encodeURIComponent(attachmentId)}/download`)}${mode === 'preview' ? '?mode=preview' : ''}`,
    { cache: 'no-store' },
  );
  if (mode === 'preview') {
    window.open(ticket.downloadUrl, '_blank', 'noopener');
  } else {
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
