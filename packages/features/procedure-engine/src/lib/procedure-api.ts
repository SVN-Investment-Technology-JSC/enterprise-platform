import type {
  ApplyProcedureActionRequest,
  CreateProcedureDefinitionRequest,
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureRuntimeAction,
  ProcedureWorkspace,
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
