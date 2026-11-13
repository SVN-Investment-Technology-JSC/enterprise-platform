import {
  CORRESPONDENCE_API_ROOT,
  type AttachmentDownloadMode,
  type AttachmentDownloadTicket,
  type AttachmentKind,
  type AttachmentUploadTicket,
  type ApproveStepRequest,
  type ArchiveTree,
  type AssignHandlerRequest,
  type CatalogItem,
  type CommentRequest,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type CorrespondenceOverview,
  type CorrespondenceReport,
  type CorrespondenceSettings,
  type CorrespondenceStatus,
  type CreateLetterRequest,
  type CreateOutgoingRequest,
  type DispatchLetterRequest,
  type LetterAttachment,
  type LetterDetail,
  type LetterQuery,
  type LetterSummary,
  type PublishLetterRequest,
  type ReturnLetterRequest,
  type SaveCatalogItemRequest,
  type SaveWorkflowRequest,
  type StepChoice,
  type SubmitLetterRequest,
  type UpdateDeliveryRequest,
  type UpdateLetterRequest,
  type Workflow,
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
export const loadArchiveTree = () => request<ArchiveTree>('/archive-tree', { cache: 'no-store' });
export const loadReport = (year: number) => request<CorrespondenceReport>(`/reports?year=${year}`, { cache: 'no-store' });
export const loadConfig = () => request<CorrespondenceConfig>('/config', { cache: 'no-store' });
export const saveSettings = (settings: CorrespondenceSettings) =>
  request<CorrespondenceSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) });

export const saveCatalogItem = (id: string | undefined, body: SaveCatalogItemRequest) =>
  id
    ? request<CatalogItem>(`/catalog/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) })
    : post<CatalogItem>('/catalog', body);
export const deleteCatalogItem = (id: string) => request<void>(`/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const saveWorkflow = (id: string | undefined, body: SaveWorkflowRequest) =>
  id
    ? request<Workflow>(`/workflows/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) })
    : post<Workflow>('/workflows', body);
export const deleteWorkflow = (id: string) => request<void>(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * Ứng viên cho bước duyệt sắp bắt đầu khi bước đó để người thao tác chọn người duyệt; `null` là không cần chọn.
 * `kind`: loại văn bản đang chọn khi văn thư giao (quy trình đi theo loại văn bản).
 */
export const loadStepChoice = (letterId: string, kind?: string) =>
  request<{ choice: StepChoice | null }>(
    `/letters/${encodeURIComponent(letterId)}/step-choice${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`,
    { cache: 'no-store' },
  ).then((body) => body.choice);

export function listLetters(query: LetterQuery): Promise<LetterSummary[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return request<{ items: LetterSummary[] }>(`/letters${params.size ? `?${params}` : ''}`, { cache: 'no-store' }).then(
    (body) => body.items,
  );
}

export const loadLetter = (id: string) => request<LetterDetail>(`/letters/${encodeURIComponent(id)}`, { cache: 'no-store' });
export const createLetter = (body: CreateLetterRequest) => post<LetterDetail>('/letters', body);
export const createOutgoing = (body: CreateOutgoingRequest) => post<LetterDetail>('/outgoing', body);
export const updateLetter = (id: string, body: UpdateLetterRequest) =>
  request<LetterDetail>(`/letters/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });

const letter = (id: string, action: string) => `/letters/${encodeURIComponent(id)}/${action}`;
const assignment = (id: string, assignmentId: string, action: string) =>
  letter(id, `assignments/${encodeURIComponent(assignmentId)}/${action}`);

export const dispatchLetter = (id: string, body: DispatchLetterRequest) => post<LetterDetail>(letter(id, 'dispatch'), body);
export const assignHandler = (id: string, assignmentId: string, body: AssignHandlerRequest) =>
  post<LetterDetail>(assignment(id, assignmentId, 'handler'), body);
export const respondLetter = (id: string, assignmentId: string, note: string) =>
  post<LetterDetail>(assignment(id, assignmentId, 'respond'), { note });
export const sendToClerk = (id: string, note?: string) => post<LetterDetail>(letter(id, 'send-to-clerk'), { note });
export const submitLetter = (id: string, body: SubmitLetterRequest) => post<LetterDetail>(letter(id, 'submit'), body);
export const approveLetter = (id: string, body: ApproveStepRequest) => post<LetterDetail>(letter(id, 'approve'), body);
export const returnLetter = (id: string, body: ReturnLetterRequest) => post<LetterDetail>(letter(id, 'return'), body);
export const completeLetter = (id: string, note?: string) => post<LetterDetail>(letter(id, 'complete'), { note });
export const publishLetter = (id: string, body: PublishLetterRequest) => post<LetterDetail>(letter(id, 'publish'), body);
export const updateDelivery = (id: string, body: UpdateDeliveryRequest) => post<LetterDetail>(letter(id, 'delivery'), body);
export const cancelLetter = (id: string, reason: string) => post<LetterDetail>(letter(id, 'cancel'), { reason });
export const commentLetter = (id: string, body: CommentRequest) => post<LetterDetail>(letter(id, 'comments'), body);

/* --------------------------------------------------------------- tệp */

/** Trình duyệt nhận diện kiểu tệp; không nhận ra thì đoán theo đuôi tệp, cuối cùng là tệp nhị phân. */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? 'application/octet-stream';
}

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
};

async function putFile(url: string, file: File): Promise<void> {
  const response = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': contentTypeOf(file) } });
  if (!response.ok) {
    throw { code: 'UPLOAD_FAILED', message: `Tải tệp lên thất bại (${response.status}).` } satisfies CorrespondenceApiError;
  }
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
  await putFile(ticket.uploadUrl, file);
  return post<LetterAttachment>(letter(letterId, `attachments/${encodeURIComponent(ticket.attachment.id)}/complete`), {
    sizeBytes: file.size,
  });
}

/** Phiên bản mới của một tệp: phiên bản cũ vẫn giữ trong kho tài liệu của Hệ dùng chung. */
export async function uploadAttachmentVersion(
  letterId: string,
  attachmentId: string,
  file: File,
  note?: string,
): Promise<LetterAttachment> {
  const path = `attachments/${encodeURIComponent(attachmentId)}`;
  const ticket = await post<AttachmentUploadTicket>(letter(letterId, `${path}/versions`), {
    fileName: file.name,
    contentType: contentTypeOf(file),
    sizeBytes: file.size,
    note,
  });
  await putFile(ticket.uploadUrl, file);
  return post<LetterAttachment>(letter(letterId, `${path}/complete`), { sizeBytes: file.size });
}

export const deleteAttachment = (letterId: string, attachmentId: string) =>
  request<void>(letter(letterId, `attachments/${encodeURIComponent(attachmentId)}`), { method: 'DELETE' });

/** URL ký sẵn của tệp: chế độ xem (nhật ký ghi "xem") hay tải xuống. */
export const attachmentTicket = (letterId: string, attachmentId: string, mode: AttachmentDownloadMode) =>
  request<AttachmentDownloadTicket>(
    `${letter(letterId, `attachments/${encodeURIComponent(attachmentId)}/download`)}${mode === 'preview' ? '?mode=preview' : ''}`,
    { cache: 'no-store' },
  );

/** Tải tệp về máy. */
export async function downloadAttachment(letterId: string, attachmentId: string): Promise<void> {
  const ticket = await attachmentTicket(letterId, attachmentId, 'download');
  const link = document.createElement('a');
  link.href = ticket.downloadUrl;
  link.download = ticket.fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
