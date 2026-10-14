import type {
  ApplyProcedureActionRequest,
  CreateProcedureInstanceRequest,
  ProcedureDefinition,
  ProcedureInstanceProgress,
} from '@enterprise-platform/contracts-procedure-engine';
import { FinanceError } from '../domain/finance.error.js';

/**
 * Client gọi Procedure Engine qua API của nó (không đọc procedure_schema).
 * Lỗi mạng, tắt entitlement hoặc sai token đều quy về một lỗi "Procedure không khả dụng" có mã ổn định.
 */
export const PROCEDURE_UNAVAILABLE_CODE = 'FINANCE_PROCEDURE_UNAVAILABLE';

export const procedureUnavailable = (message = 'Procedure Engine đang không khả dụng; chuyển cấu hình sang duyệt trực tiếp hoặc thử lại sau.') =>
  new FinanceError(PROCEDURE_UNAVAILABLE_CODE, message, 409);

const baseUrl = () => (process.env.PROCEDURE_API_URL || 'http://localhost:3334/api/procedure').replace(/\/$/, '');

function serviceHeaders(tenantId: string): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw procedureUnavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN.');
  return { 'x-tenant-id': tenantId, 'x-service-token': token };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { redirect: 'error', ...init });
  } catch {
    throw procedureUnavailable();
  }
}

async function serviceGet(tenantId: string, path: string, timeoutMs: number): Promise<Response> {
  const response = await call(`${baseUrl()}${path}`, { headers: serviceHeaders(tenantId), signal: AbortSignal.timeout(timeoutMs) });
  if ([401, 403].includes(response.status) || response.status >= 500) throw procedureUnavailable();
  return response;
}

/** Thông điệp lỗi do Procedure trả về, để người dùng thấy lý do thật (ví dụ thiếu thuộc tính bắt buộc). */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (body.message) return (Array.isArray(body.message) ? body.message.join('; ') : body.message).slice(0, 2000);
  } catch {
    /* giữ thông điệp mặc định */
  }
  return fallback;
}

/** true khi Procedure trả lời và entitlement của tenant còn hiệu lực. */
export async function isProcedureReachable(tenantId: string): Promise<boolean> {
  try {
    return (await serviceGet(tenantId, '/v1/internal/status', 3000)).ok;
  } catch {
    return false;
  }
}

export async function fetchPublishedProcedureDefinition(tenantId: string, definitionId: string): Promise<ProcedureDefinition> {
  const response = await serviceGet(tenantId, `/v1/internal/definitions/${encodeURIComponent(definitionId)}`, 8000);
  if (response.status === 404) throw new FinanceError('FINANCE_PROCEDURE_NOT_PUBLISHED', 'Quy trình chưa có phiên bản công bố.', 409);
  if (!response.ok) throw procedureUnavailable();
  const definition = (await response.json()) as ProcedureDefinition;
  if (!definition?.id || !Array.isArray(definition.steps)) throw new FinanceError('FINANCE_PROCEDURE_NOT_PUBLISHED', 'Quy trình chưa có phiên bản công bố.', 409);
  return definition;
}

/** Tiến độ một hồ sơ; null khi hồ sơ không tồn tại. */
export async function fetchProcedureProgress(tenantId: string, instanceId: string, actorUserId?: string): Promise<ProcedureInstanceProgress | null> {
  const query = actorUserId ? `?actorUserId=${encodeURIComponent(actorUserId)}` : '';
  const response = await serviceGet(tenantId, `/v1/internal/instances/${encodeURIComponent(instanceId)}/progress${query}`, 8000);
  if (response.status === 404) return null;
  if (!response.ok) throw procedureUnavailable();
  return (await response.json()) as ProcedureInstanceProgress;
}

export interface StartedInstance {
  id: string;
  code?: string;
  currentStepName?: string;
  currentAssigneeName?: string;
  warnings?: string[];
}

/** Tạo hồ sơ quy trình; idempotencyKey bảo đảm gọi lại sau lỗi mạng không sinh hồ sơ thứ hai. */
export async function startProcedureInstance(tenantId: string, body: CreateProcedureInstanceRequest): Promise<StartedInstance> {
  const response = await call(`${baseUrl()}/v1/internal/instances`, {
    method: 'POST',
    headers: { ...serviceHeaders(tenantId), 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status) || response.status >= 500) throw procedureUnavailable(await errorMessage(response, 'Procedure không khởi tạo được hồ sơ.'));
    throw new FinanceError('FINANCE_PROCEDURE_REJECTED', await errorMessage(response, `Procedure trả mã ${response.status}`), 422);
  }
  const instance = (await response.json()) as StartedInstance;
  if (!instance?.id) throw procedureUnavailable('Procedure không trả mã hồ sơ.');
  return instance;
}

export interface ForwardedSession {
  cookie?: string;
  authorization?: string;
  csrf?: string;
}

function userHeaders(session: ForwardedSession): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session.cookie) headers['cookie'] = session.cookie;
  if (session.authorization) headers['authorization'] = session.authorization;
  if (session.csrf) headers['x-csrf-token'] = session.csrf;
  return headers;
}

/** Các quy trình đã công bố của tenant, theo quyền của chính người đang cấu hình. */
export async function listPublishedProcedures(session: ForwardedSession, tenantId: string): Promise<{ id: string; code: string; name: string }[]> {
  const response = await call(`${baseUrl()}/v1/workspace`, { headers: userHeaders(session), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new FinanceError('FINANCE_PROCEDURE_FORBIDDEN', 'Cần quyền truy cập Procedure để chọn quy trình.', 403);
  const workspace = (await response.json()) as { tenantId?: string; definitions?: { id: string; code: string; name: string; status: string }[] };
  if (workspace.tenantId !== tenantId || !Array.isArray(workspace.definitions)) throw new FinanceError('FINANCE_PROCEDURE_FORBIDDEN', 'Quy trình không khớp tenant.', 403);
  return workspace.definitions.filter((definition) => definition.status === 'published').map(({ id, code, name }) => ({ id, code, name }));
}

/**
 * Thao tác trên hồ sơ bằng phiên của chính người dùng: chỉ Procedure quyết định người này có được duyệt bước hiện tại hay không.
 */
export async function applyProcedureAction(session: ForwardedSession, instanceId: string, body: ApplyProcedureActionRequest): Promise<void> {
  const response = await call(`${baseUrl()}/v1/instances/${encodeURIComponent(instanceId)}/actions`, {
    method: 'POST',
    headers: userHeaders(session),
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await errorMessage(response, `Procedure trả mã ${response.status}`);
    throw new FinanceError('FINANCE_PROCEDURE_ACTION_FAILED', message, response.status === 403 ? 403 : response.status === 404 ? 404 : response.status === 409 ? 409 : 422);
  }
}
