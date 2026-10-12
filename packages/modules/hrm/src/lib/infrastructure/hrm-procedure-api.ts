import { ConflictException } from '@nestjs/common';
import {
  buildFlowIndex,
  firstFlowStepId,
  type ProcedureDefinition,
  type ProcedureInstanceProgress,
  type ProcedureInstanceStatusEntry,
} from '@enterprise-platform/contracts-procedure-engine';
import { procedureFetch } from './hrm-procedure-fetch.js';

export const PROCEDURE_UNAVAILABLE_CODE = 'PROCEDURE_UNAVAILABLE';

/** 409 mã PROCEDURE_UNAVAILABLE: Procedure Engine tắt entitlement hoặc không trả lời. */
export function procedureUnavailable(
  message = 'Procedure Engine đang không khả dụng; chuyển cấu hình sang duyệt trực tiếp hoặc thử lại sau',
) {
  return new ConflictException({
    code: PROCEDURE_UNAVAILABLE_CODE,
    message,
  });
}

function baseUrl() {
  return (
    process.env.PROCEDURE_API_URL || 'http://localhost:3334/api/procedure'
  ).replace(/\/$/, '');
}

function serviceHeaders(tenantId: string): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw procedureUnavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN');
  return { 'x-tenant-id': tenantId, 'x-service-token': token };
}

async function internalGet(
  tenantId: string,
  path: string,
  timeoutMs: number,
): Promise<Response> {
  const headers = serviceHeaders(tenantId);
  let response: Response;
  try {
    response = await procedureFetch(`${baseUrl()}${path}`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw procedureUnavailable();
  }
  // 401/403 (tắt entitlement hoặc sai token), 5xx: Procedure không phục vụ được.
  if ([401, 403].includes(response.status) || response.status >= 500)
    throw procedureUnavailable();
  return response;
}

/** Đọc định nghĩa đã công bố qua API nội bộ của Procedure (không đọc DB của Procedure). */
export async function fetchPublishedProcedureDefinition(
  tenantId: string,
  definitionId: string,
): Promise<ProcedureDefinition> {
  const response = await internalGet(
    tenantId,
    `/v1/internal/definitions/${encodeURIComponent(definitionId)}`,
    8000,
  );
  if (response.status === 404)
    throw new ConflictException('Quy trình chưa có phiên bản công bố');
  if (!response.ok) throw procedureUnavailable();
  const definition = (await response.json()) as ProcedureDefinition;
  if (!definition?.id || !Array.isArray(definition.steps))
    throw new ConflictException('Quy trình chưa có phiên bản công bố');
  return definition;
}

/** Tiến độ một hồ sơ qua API nội bộ của Procedure; null khi hồ sơ không tồn tại. */
export async function fetchProcedureProgress(
  tenantId: string,
  instanceId: string,
  actorUserId?: string,
): Promise<ProcedureInstanceProgress | null> {
  const query = actorUserId
    ? `?actorUserId=${encodeURIComponent(actorUserId)}`
    : '';
  const response = await internalGet(
    tenantId,
    `/v1/internal/instances/${encodeURIComponent(instanceId)}/progress${query}`,
    8000,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw procedureUnavailable();
  return (await response.json()) as ProcedureInstanceProgress;
}

/** Đối soát hàng loạt (tối đa 100 hồ sơ mỗi lần gọi): trạng thái và bước hiện tại. */
export async function fetchProcedureStatuses(
  tenantId: string,
  instanceIds: readonly string[],
): Promise<ProcedureInstanceStatusEntry[]> {
  if (!instanceIds.length) return [];
  const headers = serviceHeaders(tenantId);
  let response: Response;
  try {
    response = await procedureFetch(`${baseUrl()}/v1/internal/instances/status`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ ids: instanceIds.slice(0, 100) }),
    });
  } catch {
    throw procedureUnavailable();
  }
  if (!response.ok) throw procedureUnavailable();
  const body = (await response.json()) as ProcedureInstanceStatusEntry[];
  return Array.isArray(body) ? body : [];
}

/** true khi Procedure trả lời và entitlement của tenant còn hiệu lực (guard của Procedure kiểm tra). */
export async function isProcedureReachable(tenantId: string): Promise<boolean> {
  try {
    const response = await internalGet(tenantId, '/v1/internal/status', 3000);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Cảnh báo cấu hình khi gán quy trình cho loại đơn (không chặn lưu).
 *
 * HRM tự hoàn thành bước S của người nộp khi gửi đơn (FIX-E-01); việc này chỉ
 * xảy ra khi bước đầu của định nghĩa chỉ có vai S. Có R/E/C/A ở bước đầu hoặc
 * không có vai S thì đơn dừng chờ người nộp mở Procedure xử lý.
 */
export function procedureStartStepWarnings(definition: ProcedureDefinition): string[] {
  const steps = definition.steps ?? [];
  const firstId = steps.length
    ? firstFlowStepId(buildFlowIndex(steps, definition.gateways))
    : null;
  const first = steps.find((step) => step.id === firstId);
  if (!first) return ['Quy trình chưa có bước nào; đơn sẽ không chạy được.'];
  const roles = new Set((first.assignments ?? []).map((assignment) => assignment.role));
  if (roles.size === 1 && roles.has('S')) return [];
  return [
    'Bước đầu không phải bước S của người nộp (bước ' +
      '“' + first.name + '” ' +
      (roles.has('S') ? 'có thêm vai khác ngoài S' : 'không có vai S') +
      '), đơn sẽ dừng chờ người nộp.',
  ];
}

/**
 * Hỏi Procedure (chỉ đọc) xem hồ sơ của đơn có huỷ hiệu lực được không, trước
 * khi HRM tự huỷ đơn — để hai module không lệch nhau. Không trả lời được thì
 * coi như không cho huỷ.
 */
export async function fetchProcedureReversalCheck(
  tenantId: string,
  instanceId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const response = await internalGet(
    tenantId,
    `/v1/internal/instances/${encodeURIComponent(instanceId)}/reversal-check`,
    8000,
  );
  if (!response.ok) return { allowed: false, reason: 'Procedure không trả lời kiểm tra huỷ hiệu lực.' };
  const body = (await response.json()) as { allowed?: unknown; reason?: unknown; status?: unknown };
  return {
    allowed: body.allowed === true,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  };
}
