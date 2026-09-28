import type {
  AddDependencyRequest,
  CalendarEvent,
  CalendarRangeResponse,
  ChangeWorkItemStatusRequest,
  ChatEntityType,
  ChatMessage,
  ChatThread,
  CompleteUploadRequest,
  CostEntry,
  CostEntryList,
  CreateCostEntryRequest,
  CreateDocumentRequest,
  CreateDocumentResponse,
  CreateEventRequest,
  CreateExternalReferenceRequest,
  CreateFolderRequest,
  EnsureFolderPathRequest,
  CreateProjectRequest,
  CreateVersionRequest,
  CreateWorkItemRequest,
  DocumentDetail,
  DocumentFolder,
  DocumentLink,
  DocumentSummary,
  DirectoryResponse,
  DocumentVersion,
  DownloadTicket,
  EventMutationResponse,
  EventParticipant,
  ExternalReference,
  ExternalReferenceList,
  LinkDocumentRequest,
  MoveWorkItemRequest,
  MyWorkSummary,
  Paged,
  Project,
  ProjectFinance,
  ProjectMember,
  ProjectSummary,
  RecurrenceScope,
  ReportBundle,
  RespondToEventRequest,
  SendChatMessageRequest,
  SendChatMessageResponse,
  SetProjectMembersRequest,
  UnreadSummary,
  UpdateChatMessageRequest,
  UpdateEventRequest,
  UpdateProjectFinanceRequest,
  UpdateProjectRequest,
  UpdateWorkItemCostRequest,
  UpdateWorkItemRequest,
  UploadTicket,
  WorkItem,
  WorkItemDependency,
  WorkItemStatusHistoryEntry,
  WorkItemTree,
  WorkspaceDocument,
} from '@enterprise-platform/contracts-workspace';
import { authFetch } from '@enterprise-platform/shared-ui';

const API = '/api/workspace/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `authFetch` của shared-ui tự gắn cookie phiên và `x-csrf-token`, và tự làm
  // mới phiên một lần khi gặp 401 rồi phát lại request — nên ở đây không tự
  // đọc cookie hay tự chuyển hướng sớm nữa.
  const response = await authFetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  // Làm mới phiên vẫn không cứu được thì mới đưa về trang đăng nhập.
  if (response.status === 401) {
    window.location.assign('/');
    throw new Error('unauthenticated');
  }
  // 204 không có body; gọi .json() sẽ ném lỗi parse.
  if (response.status === 204) return undefined as T;

  const body = await response.json();
  // Thân lỗi đã có `code` và `message` tiếng Việt, ném nguyên để màn hình
  // hiển thị thẳng, không cần dịch lại.
  if (!response.ok) throw body;
  return body as T;
}

export interface WorkspaceStatus {
  readonly tenantId: string;
  readonly schemaExists: boolean;
  readonly tablesReady: boolean;
  /** Quyền của người đang đăng nhập; chỉ dùng để ẩn hiện, server vẫn kiểm lại. */
  readonly capabilities?: {
    readonly isTenantAdmin: boolean;
    readonly canManage: boolean;
    readonly canWriteTasks: boolean;
    readonly canWriteDocuments: boolean;
    readonly canDeleteDocuments: boolean;
  };
}

/** Mức độ sẵn sàng của module cho tenant đang đăng nhập. */
export const loadWorkspaceStatus = () =>
  request<WorkspaceStatus>('/status', { cache: 'no-store' });

/**
 * Đường về Tenant Portal, dùng cho nút "← Trang chủ" trên thanh dọc.
 *
 * Portal đã bỏ tiền tố `/t/{slug}`: mỗi tenant có host riêng nên trang ứng
 * dụng nằm thẳng ở `/applications`.
 */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    if (!response.ok) return '/';
    return '/applications';
  } catch {
    return '/';
  }
}

/* =========================================================================
   DỰ ÁN VÀ CÔNG VIỆC (P1)
   ========================================================================= */

/** Danh sách dự án người dùng được xem. */
export const listProjects = (params: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
} = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query}` : '';
  return request<Paged<ProjectSummary>>(`/projects${suffix}`, { cache: 'no-store' });
};

export const getProject = (id: string) =>
  request<ProjectSummary>(`/projects/${id}`, { cache: 'no-store' });

export const createProject = (body: CreateProjectRequest) =>
  request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });

export const updateProject = (id: string, body: UpdateProjectRequest) =>
  request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const cancelProject = (id: string) =>
  request<Project>(`/projects/${id}`, { method: 'DELETE' });

export const listMembers = (id: string) =>
  request<{ items: ProjectMember[] }>(`/projects/${id}/members`, { cache: 'no-store' });

export const setMembers = (id: string, body: SetProjectMembersRequest) =>
  request<{ items: ProjectMember[] }>(`/projects/${id}/members`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/** Toàn bộ cây WBS, trả phẳng kèm `parentId` và `depth`. */
export const listWorkItems = (projectId: string) =>
  request<WorkItemTree>(`/projects/${projectId}/work-items`, { cache: 'no-store' });

export const listProjectActivity = (projectId: string) =>
  request<{ items: WorkItemStatusHistoryEntry[] }>(`/projects/${projectId}/activity`, {
    cache: 'no-store',
  });

export const createWorkItem = (body: CreateWorkItemRequest) =>
  request<WorkItem>('/work-items', { method: 'POST', body: JSON.stringify(body) });

export const updateWorkItem = (id: string, body: UpdateWorkItemRequest) =>
  request<WorkItem>(`/work-items/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const changeWorkItemStatus = (id: string, body: ChangeWorkItemStatusRequest) =>
  request<WorkItem>(`/work-items/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) });

export const moveWorkItem = (id: string, body: MoveWorkItemRequest) =>
  request<WorkItem>(`/work-items/${id}/move`, { method: 'POST', body: JSON.stringify(body) });

export const listDependencies = (id: string) =>
  request<{ items: WorkItemDependency[] }>(`/work-items/${id}/dependencies`, {
    cache: 'no-store',
  });

export const addDependency = (id: string, body: AddDependencyRequest) =>
  request<WorkItemDependency>(`/work-items/${id}/dependencies`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const removeDependency = (id: string, dependencyId: string) =>
  request<void>(`/work-items/${id}/dependencies/${dependencyId}`, { method: 'DELETE' });

/* =========================================================================
   LỊCH BIỂU (P2)
   ========================================================================= */

/** Lịch trong một khoảng; `projectId` rỗng nghĩa là lịch của chính tôi. */
export const loadCalendar = (params: { from: string; to: string; projectId?: string }) => {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.projectId) query.set('projectId', params.projectId);
  return request<CalendarRangeResponse>(`/calendar?${query}`, { cache: 'no-store' });
};

export const getEvent = (id: string) =>
  request<EventMutationResponse>(`/calendar/events/${id}`, { cache: 'no-store' });

export const createEvent = (body: CreateEventRequest) =>
  request<EventMutationResponse>('/calendar/events', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateEvent = (id: string, body: UpdateEventRequest) =>
  request<EventMutationResponse>(`/calendar/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/** `scope = 'single'` cần `occurrenceDate`: buổi nào của chuỗi bị huỷ. */
export const cancelEvent = (
  id: string,
  scope: RecurrenceScope = 'all',
  occurrenceDate?: string,
) => {
  const query = new URLSearchParams({ scope });
  if (occurrenceDate) query.set('occurrenceDate', occurrenceDate);
  return request<CalendarEvent>(`/calendar/events/${id}?${query}`, { method: 'DELETE' });
};

/** Danh bạ người trong tổ chức — tên, email, đơn vị. Không có quyền đi kèm. */
export const loadDirectory = () =>
  request<DirectoryResponse>('/directory', { cache: 'no-store' });

export const respondToEvent = (id: string, body: RespondToEventRequest) =>
  request<EventParticipant>(`/calendar/events/${id}/respond`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Toàn bộ phụ thuộc của dự án; Gantt cần cả đồ thị trong một lời gọi. */
export const listProjectDependencies = (projectId: string) =>
  request<{ items: WorkItemDependency[] }>(`/projects/${projectId}/dependencies`, {
    cache: 'no-store',
  });

/* =========================================================================
   CHAT (P4)
   ========================================================================= */

/** Luồng tin của một node; node chưa ai nhắn vẫn trả luồng rỗng. */
export const loadChatThread = (entityType: ChatEntityType, entityId: string) =>
  request<ChatThread>(`/chat/${entityType}/${entityId}`, { cache: 'no-store' });

export const sendChatMessage = (body: SendChatMessageRequest) =>
  request<SendChatMessageResponse>('/chat/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const editChatMessage = (id: string, body: UpdateChatMessageRequest) =>
  request<ChatMessage>(`/chat/messages/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteChatMessage = (id: string) =>
  request<ChatMessage>(`/chat/messages/${id}`, { method: 'DELETE' });

/** Số tin chưa đọc của cả cây, một lời gọi cho mọi node. */
export const loadUnread = (projectId: string) =>
  request<UnreadSummary>(`/projects/${projectId}/unread`, { cache: 'no-store' });

/**
 * Id của người đang đăng nhập.
 *
 * Chat cần biết tin nào là của mình để canh phải và cho phép thu hồi. Guard
 * đã gắn danh tính vào mỗi request phía server, nhưng giao diện vẫn phải tự
 * hỏi một lần — không có endpoint nào của Workspace trả về nó.
 */
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

/* =========================================================================
   TÀI LIỆU (P5)
   ========================================================================= */

export const listFolders = (projectId?: string) => {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<{ items: DocumentFolder[] }>(`/folders${query}`, { cache: 'no-store' });
};

/** Gỡ một thư mục rỗng khỏi cây. Cần quyền xoá — mặc định chỉ quản trị tenant. */
export const removeFolder = (id: string) =>
  request<void>(`/folders/${id}`, { method: 'DELETE' });

export const createFolder = (body: CreateFolderRequest) =>
  request<DocumentFolder>('/folders', { method: 'POST', body: JSON.stringify(body) });

/**
 * Dọn sẵn `<thư mục gốc>/<dự án>/<công việc>` rồi trả về thư mục lá.
 *
 * Người dùng chỉ chọn thư mục gốc; các cấp còn lại server tự tạo nếu thiếu và
 * dùng lại nếu đã có.
 */
export const ensureFolderPath = (body: EnsureFolderPathRequest) =>
  request<DocumentFolder>('/folders/ensure-path', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const listDocuments = (params: {
  projectId?: string;
  folderId?: string;
  status?: string;
  search?: string;
  linkedType?: string;
  linkedId?: string;
} = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query}` : '';
  return request<{ items: DocumentSummary[] }>(`/documents${suffix}`, { cache: 'no-store' });
};

export const getDocument = (id: string) =>
  request<DocumentDetail>(`/documents/${id}`, { cache: 'no-store' });

/** Chặng 1: ghi siêu dữ liệu, nhận URL ký trước. */
export const createDocument = (body: CreateDocumentRequest) =>
  request<CreateDocumentResponse>('/documents', { method: 'POST', body: JSON.stringify(body) });

export const createDocumentVersion = (id: string, body: CreateVersionRequest) =>
  request<UploadTicket>(`/documents/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Chặng 3: báo đã `PUT` xong, để phiên bản thôi hiện "Chưa tải lên xong". */
export const completeUpload = (id: string, versionId: string, body: CompleteUploadRequest) =>
  request<DocumentVersion>(`/documents/${id}/versions/${versionId}/complete`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getDownloadTicket = (id: string, versionId?: string) => {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  return request<DownloadTicket>(`/documents/${id}/download${query}`, { cache: 'no-store' });
};

export const lockDocument = (id: string) =>
  request<WorkspaceDocument>(`/documents/${id}/lock`, { method: 'POST' });

export const unlockDocument = (id: string) =>
  request<WorkspaceDocument>(`/documents/${id}/unlock`, { method: 'POST' });

export const archiveDocument = (id: string) =>
  request<WorkspaceDocument>(`/documents/${id}`, { method: 'DELETE' });

export const linkDocument = (id: string, body: LinkDocumentRequest) =>
  request<DocumentLink>(`/documents/${id}/links`, { method: 'POST', body: JSON.stringify(body) });

export const unlinkDocument = (id: string, linkId: string) =>
  request<void>(`/documents/${id}/links/${linkId}`, { method: 'DELETE' });

/**
 * Chặng 2: đẩy tệp thẳng lên kho lưu trữ.
 *
 * KHÔNG đi qua API server và KHÔNG kèm cookie phiên — URL đã ký tự mang
 * quyền, gửi thêm cookie sang một host khác chỉ làm rò rỉ phiên.
 */
export async function uploadToStorage(
  uploadUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': contentType },
  });
  if (!response.ok) {
    throw { code: 'UPLOAD_FAILED', message: `Tải tệp lên thất bại (${response.status}).` };
  }
}

/* =========================================================================
   CÔNG VIỆC CỦA TÔI (P6)
   ========================================================================= */

/**
 * Tổng hợp của riêng người đang đăng nhập.
 *
 * Cố ý không nhận tham số nào: danh tính do guard xác định ở phía server.
 * Truyền `userId` lên cũng vô nghĩa vì không endpoint nào đọc tới nó.
 */
export const loadMyWork = () => request<MyWorkSummary>('/my-work', { cache: 'no-store' });

/**
 * Người đang đăng nhập có phải quản trị viên tenant không.
 *
 * Chỉ dùng để hiện dải giải thích trên trang "Công việc của tôi" — màn đó
 * luôn lọc theo chính người dùng, kể cả với quản trị viên, nên cần nói rõ
 * kẻo họ tưởng dữ liệu bị lọc sai. **Không** dùng cho bất kỳ quyết định
 * phân quyền nào: quyền do server xác định.
 */
export async function loadIsTenantAdmin(): Promise<boolean> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    if (!response.ok) return false;
    const principal = (await response.json()) as { roles?: string[]; systemRole?: string };
    return (
      principal.systemRole === 'tenant-admin' ||
      (principal.roles ?? []).includes('tenant-admin')
    );
  } catch {
    return false;
  }
}

/* =========================================================================
   BÁO CÁO (P7)
   ========================================================================= */

/**
 * Ba báo cáo cộng khối "Của tôi".
 *
 * `projectIds` chỉ **thu hẹp** phạm vi mà server đã suy từ vai trò, không mở
 * rộng nó. Lọc một dự án không tham gia sẽ nhận `403`.
 */
export const loadReports = (params: {
  from?: string;
  to?: string;
  projectIds?: readonly string[];
} = {}) => {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.projectIds?.length) query.set('projectIds', params.projectIds.join(','));
  const suffix = query.toString() ? `?${query}` : '';
  return request<ReportBundle>(`/reports${suffix}`, { cache: 'no-store' });
};

/* =========================================================================
   LIÊN MODULE (P8)
   ========================================================================= */

/** Mọi con trỏ của dự án; cây dùng để hiện badge "Chưa mở được quy trình". */
export const listProjectExternalReferences = (projectId: string) =>
  request<ExternalReferenceList>(`/projects/${projectId}/external-references`, {
    cache: 'no-store',
  });

export const listWorkItemLinks = (workItemId: string) =>
  request<ExternalReferenceList>(`/work-items/${workItemId}/links`, { cache: 'no-store' });

/** Bước 5: lưu con trỏ vừa nhận từ module khác. Lặp lại được. */
export const linkWorkItem = (workItemId: string, body: CreateExternalReferenceRequest) =>
  request<ExternalReference>(`/work-items/${workItemId}/links`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const unlinkWorkItem = (workItemId: string, referenceId: string) =>
  request<void>(`/work-items/${workItemId}/links/${referenceId}`, { method: 'DELETE' });

/* =========================================================================
   TÀI CHÍNH (P9)
   ========================================================================= */

/** `member` và `viewer` gọi thẳng sẽ nhận `403 FINANCE_FORBIDDEN`. */
export const getProjectFinance = (projectId: string) =>
  request<ProjectFinance>(`/projects/${projectId}/finance`, { cache: 'no-store' });

export const updateProjectFinance = (projectId: string, body: UpdateProjectFinanceRequest) =>
  request<ProjectFinance>(`/projects/${projectId}/finance`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/** Endpoint riêng cho chi phí; `PATCH /work-items/:id` không nhận số tiền. */
export const updateWorkItemCost = (workItemId: string, body: UpdateWorkItemCostRequest) =>
  request<ProjectFinance>(`/work-items/${workItemId}/costs`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/**
 * Ghi một dòng sổ chi phí thực tế. Chỉ ghi thêm — nhập sai thì ghi một dòng âm
 * kèm lý do. Trả về cả số liệu dự án đã tính lại để tab khỏi gọi thêm.
 */
export const addCostEntry = (workItemId: string, body: CreateCostEntryRequest) =>
  request<{ entry: CostEntry; finance: ProjectFinance }>(`/work-items/${workItemId}/cost-entries`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const listWorkItemCostEntries = (workItemId: string) =>
  request<CostEntryList>(`/work-items/${workItemId}/cost-entries`, { cache: 'no-store' });

export const listProjectCostEntries = (projectId: string) =>
  request<CostEntryList>(`/projects/${projectId}/cost-entries`, { cache: 'no-store' });
