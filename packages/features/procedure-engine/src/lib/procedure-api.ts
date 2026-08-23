import type {
  ApplyProcedureActionRequest,
  CreateProcedureDefinitionRequest,
  CreateProcedureAttachmentRequest,
  CreateProcedureAttachmentResponse,
  CreateProcedureStepInput,
  ProcedureDefinition,
  ProcedureAttachment,
  ProcedureCategory,
  ProcedureInstance,
  ProcedureRuntimeAction,
  PostProcedureCommentRequest,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
  ProcedureWorkspace,
  SetProcedureSubtasksRequest,
  UpdateProcedureDefinitionRequest,
} from '@enterprise-platform/contracts-procedure-engine';

const API_ROOT = '/api/procedure/v1';

/**
 * Khoá idempotency cho một thao tác.
 *
 * `crypto.randomUUID` chỉ có trong secure context (HTTPS hoặc localhost). Mở app
 * qua IP LAN bằng HTTP thuần thì nó undefined và mọi thao tác ghi đều vỡ với
 * "crypto.randomUUID is not a function". `crypto.getRandomValues` thì luôn có,
 * nên dựng UUID v4 từ đó khi cần.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  // Đánh dấu phiên bản 4 và biến thể RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function request<TValue>(
  path: string,
  init: RequestInit = {},
): Promise<TValue> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(init.method && init.method !== 'GET'
        ? { 'x-csrf-token': decodeURIComponent(cookie('ep_csrf') ?? '') }
        : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { message?: string | string[] }
      | undefined;
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : undefined;
    throw new Error(
      Array.isArray(message)
        ? message.join(', ')
        : message || `Procedure API trả về HTTP ${response.status}.`,
    );
  }
  // 204 không có body: gọi `json()` sẽ ném lỗi phân tích cú pháp, làm một thao
  // tác đã thành công trông như thất bại.
  if (response.status === 204) return undefined as TValue;
  return (await response.json()) as TValue;
}

export function loadProcedureWorkspace(): Promise<ProcedureWorkspace> {
  return request<ProcedureWorkspace>('/workspace', { cache: 'no-store' });
}

export function createProcedureDefinition(
  input: CreateProcedureDefinitionRequest,
): Promise<ProcedureDefinition> {
  return request<ProcedureDefinition>('/definitions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProcedureDefinition(
  definitionId: string,
  steps: CreateProcedureStepInput[],
): Promise<ProcedureDefinition> {
  return request<ProcedureDefinition>(`/definitions/${definitionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      steps,
    } satisfies UpdateProcedureDefinitionRequest),
  });
}

export function setProcedureCategory(
  definitionId: string,
  category?: ProcedureCategory,
): Promise<ProcedureDefinition> {
  return request<ProcedureDefinition>(`/definitions/${definitionId}/category`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  });
}

export function reviseProcedureDefinition(
  definitionId: string,
): Promise<ProcedureDefinition> {
  return request<ProcedureDefinition>(`/definitions/${definitionId}/revise`, {
    method: 'POST',
  });
}

export function publishProcedureDefinition(
  definitionId: string,
): Promise<ProcedureDefinition> {
  return request<ProcedureDefinition>(`/definitions/${definitionId}/publish`, {
    method: 'POST',
  });
}

export function startProcedureInstance(
  definitionId: string,
  title: string,
): Promise<ProcedureInstance> {
  return request<ProcedureInstance>('/instances', {
    method: 'POST',
    body: JSON.stringify({
      definitionId,
      title,
      idempotencyKey: newIdempotencyKey(),
    }),
  });
}

export function applyProcedureAction(
  instanceId: string,
  action: ProcedureRuntimeAction,
  comment?: string,
  returnToStepId?: string,
): Promise<ProcedureInstance> {
  const input: ApplyProcedureActionRequest = {
    action,
    comment,
    returnToStepId,
    idempotencyKey: newIdempotencyKey(),
  };
  return request<ProcedureInstance>(`/instances/${instanceId}/actions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Phân rã công việc của vai trò E ở bước hiện tại.
 * Bỏ trống `items` để server tự nạp từ danh sách đầu việc đã đóng băng của thiết bị.
 */
/** Danh mục vật tư của Kho, để người thiết kế chọn thay vì gõ mã tự do. */
export async function loadMaterialCatalog(): Promise<
  { code: string; name: string; unit: string }[]
> {
  try {
    return await request<{ code: string; name: string; unit: string }[]>('/material-catalog');
  } catch {
    // Kho chưa chạy thì vẫn thiết kế được quy trình, chỉ là không chọn được vật tư.
    return [];
  }
}

export async function deleteProcedureDefinition(definitionId: string): Promise<void> {
  await request<void>(`/definitions/${definitionId}`, { method: 'DELETE' });
}

/** Nút "Kiểm lại tồn kho" trên bước đang chờ vật tư. */
export function recheckStepMaterials(instanceId: string): Promise<ProcedureInstance> {
  return request<ProcedureInstance>(`/instances/${instanceId}/material-check`, {
    method: 'POST',
    body: '{}',
  });
}

export function setProcedureSubtasks(
  instanceId: string,
  items?: ProcedureSubtaskInput[],
  executionMode?: ProcedureSubtaskExecutionMode,
): Promise<ProcedureInstance> {
  return request<ProcedureInstance>(`/instances/${instanceId}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ items, executionMode } satisfies SetProcedureSubtasksRequest),
  });
}

export function completeProcedureSubtask(
  instanceId: string,
  subtaskId: string,
): Promise<ProcedureInstance> {
  return request<ProcedureInstance>(
    `/instances/${instanceId}/subtasks/${subtaskId}/complete`,
    { method: 'POST' },
  );
}

export function cancelProcedureSubtask(
  instanceId: string,
  subtaskId: string,
): Promise<ProcedureInstance> {
  return request<ProcedureInstance>(
    `/instances/${instanceId}/subtasks/${subtaskId}/cancel`,
    { method: 'POST' },
  );
}

export function loadProcedureAttachments(
  instanceId: string,
): Promise<ProcedureAttachment[]> {
  return request<ProcedureAttachment[]>(`/instances/${instanceId}/attachments`, {
    cache: 'no-store',
  });
}

/**
 * Tải bằng chứng cho một đầu việc: xin URL ký trước rồi PUT thẳng lên object
 * storage, file không đi qua API.
 */
export function postProcedureComment(
  instanceId: string,
  body: string,
  mentions: string[] = [],
): Promise<ProcedureInstance> {
  return request<ProcedureInstance>(`/instances/${instanceId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body,
      mentions,
      idempotencyKey: newIdempotencyKey(),
    } satisfies PostProcedureCommentRequest),
  });
}

export async function uploadProcedureAttachment(
  instanceId: string,
  file: File,
  subtaskId?: string,
): Promise<ProcedureAttachment> {
  const created = await request<CreateProcedureAttachmentResponse>(
    `/instances/${instanceId}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        subtaskId,
      } satisfies CreateProcedureAttachmentRequest),
    },
  );

  const upload = await fetch(created.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!upload.ok) {
    throw new Error(`Tải tệp lên thất bại (HTTP ${upload.status}).`);
  }
  return created.attachment;
}

/** Trang chủ doanh nghiệp của người đang đăng nhập, cho nút quay lại. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await fetch('/api/auth/v1/me', { credentials: 'include' });
    if (!response.ok) return '/';
    const principal = (await response.json()) as { tenantSlug?: string };
    return principal.tenantSlug ? `/t/${principal.tenantSlug}` : '/';
  } catch {
    return '/';
  }
}
