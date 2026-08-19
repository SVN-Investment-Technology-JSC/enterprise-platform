import type {
  ApplyProcedureActionRequest,
  CreateProcedureDefinitionRequest,
  CreateProcedureAttachmentRequest,
  CreateProcedureAttachmentResponse,
  CreateProcedureStepInput,
  ProcedureDefinition,
  ProcedureAttachment,
  ProcedureInstance,
  ProcedureRuntimeAction,
  ProcedureSubtaskInput,
  ProcedureWorkspace,
  SetProcedureSubtasksRequest,
  UpdateProcedureDefinitionRequest,
} from '@enterprise-platform/contracts-procedure-engine';

const API_ROOT = '/api/procedure/v1';

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
    body: JSON.stringify({ steps } satisfies UpdateProcedureDefinitionRequest),
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
      idempotencyKey: crypto.randomUUID(),
    }),
  });
}

export function applyProcedureAction(
  instanceId: string,
  action: ProcedureRuntimeAction,
  comment?: string,
): Promise<ProcedureInstance> {
  const input: ApplyProcedureActionRequest = {
    action,
    comment,
    idempotencyKey: crypto.randomUUID(),
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
export function setProcedureSubtasks(
  instanceId: string,
  items?: ProcedureSubtaskInput[],
): Promise<ProcedureInstance> {
  return request<ProcedureInstance>(`/instances/${instanceId}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ items } satisfies SetProcedureSubtasksRequest),
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
