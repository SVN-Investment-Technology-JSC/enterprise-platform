import type { ProcedureDefinitionOption } from '@enterprise-platform/contracts-crm';
import type { ForwardedSession, ProcedureClient, StartProcedureInstance } from '../application/quote-store.port.js';
import { CrmConflictError, CrmError, CrmForbiddenError } from '../domain/crm.error.js';

export const PROCEDURE_UNAVAILABLE = 'PROCEDURE_UNAVAILABLE';
export const PROCEDURE_REJECTED = 'PROCEDURE_REJECTED';

/** Trạng thái một hồ sơ khi đối soát. */
export interface ProcedureInstanceState {
  readonly instanceId: string;
  readonly instanceCode: string | null;
  /** `running`, `completed`, `rejected`, `cancelled`, `reversed`. */
  readonly status: string;
  readonly lastActorId: string | null;
}

export const procedureUnavailable = (message = 'Quy trình đang không khả dụng. Vui lòng thử lại sau.') =>
  new CrmError(PROCEDURE_UNAVAILABLE, message, 503);

/** Thông điệp lỗi Quy trình trả về, để người dùng thấy lý do thật. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (body.message) return (Array.isArray(body.message) ? body.message.join('; ') : body.message).slice(0, 2000);
  } catch {
    /* giữ thông điệp mặc định */
  }
  return fallback;
}

/**
 * Client Quy trình qua API (mẫu `finance/.../procedure-api.ts`): route nội bộ
 * dùng `x-service-token`, `x-tenant-id`; danh sách quy trình để chọn dùng phiên
 * của chính người cấu hình. Không đọc `procedure_schema`.
 */
export class HttpProcedureClient implements ProcedureClient {
  constructor(
    private readonly baseUrl: string = process.env['PROCEDURE_API_URL'] ?? 'http://localhost:3334/api/procedure',
    private readonly token: () => string | undefined = () => process.env['INTERNAL_SERVICE_TOKEN'],
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private serviceHeaders(tenantId: string): Record<string, string> {
    const token = this.token();
    if (!token) throw procedureUnavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN.');
    return { 'x-tenant-id': tenantId, 'x-service-token': token };
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { redirect: 'error', ...init });
    } catch {
      throw procedureUnavailable();
    }
  }

  async startInstance(tenantId: string, request: StartProcedureInstance): Promise<{ id: string; code: string | null }> {
    const response = await this.call(this.url('/v1/internal/instances'), {
      method: 'POST',
      headers: { ...this.serviceHeaders(tenantId), 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const message = await errorMessage(response, `Quy trình trả mã ${response.status}.`);
      if ([401, 403, 408, 429].includes(response.status) || response.status >= 500) throw procedureUnavailable(message);
      throw new CrmError(PROCEDURE_REJECTED, message, 422);
    }
    const body = (await response.json().catch(() => ({}))) as { id?: unknown; code?: unknown };
    if (typeof body.id !== 'string' || !body.id) throw procedureUnavailable('Quy trình không trả mã hồ sơ.');
    return { id: body.id, code: typeof body.code === 'string' ? body.code : null };
  }

  /**
   * Đối soát hàng loạt (tối đa 100 hồ sơ): trạng thái và người làm gần nhất, qua
   * `POST /v1/internal/instances/status` (T3-20). Hồ sơ không còn thì vắng.
   */
  async instanceStatuses(tenantId: string, ids: readonly string[]): Promise<ProcedureInstanceState[]> {
    if (!ids.length) return [];
    const response = await this.call(this.url('/v1/internal/instances/status'), {
      method: 'POST',
      headers: { ...this.serviceHeaders(tenantId), 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ ids: ids.slice(0, 100) }),
    });
    if (!response.ok) throw procedureUnavailable(await errorMessage(response, `Quy trình trả mã ${response.status}.`));
    const body = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw procedureUnavailable('Quy trình trả dữ liệu đối soát không hợp lệ.');
    return body
      .map((entry: { instanceId?: unknown; instanceCode?: unknown; status?: unknown; lastActorId?: unknown }) => ({
        instanceId: typeof entry?.instanceId === 'string' ? entry.instanceId : '',
        instanceCode: typeof entry?.instanceCode === 'string' ? entry.instanceCode : null,
        status: typeof entry?.status === 'string' ? entry.status : '',
        lastActorId: typeof entry?.lastActorId === 'string' ? entry.lastActorId : null,
      }))
      .filter((entry) => entry.instanceId && entry.status);
  }

  async publishedDefinition(tenantId: string, definitionId: string): Promise<ProcedureDefinitionOption> {
    const response = await this.call(this.url(`/v1/internal/definitions/${encodeURIComponent(definitionId)}`), {
      headers: this.serviceHeaders(tenantId),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404 || response.status === 400) {
      throw new CrmConflictError('PROCEDURE_NOT_PUBLISHED', 'Quy trình không tồn tại hoặc chưa có phiên bản công bố.');
    }
    if (!response.ok) throw procedureUnavailable();
    const body = (await response.json().catch(() => ({}))) as { id?: unknown; code?: unknown; name?: unknown };
    if (typeof body.id !== 'string') {
      throw new CrmConflictError('PROCEDURE_NOT_PUBLISHED', 'Quy trình không tồn tại hoặc chưa có phiên bản công bố.');
    }
    return { id: body.id, code: typeof body.code === 'string' ? body.code : '', name: typeof body.name === 'string' ? body.name : '' };
  }

  async listPublished(session: ForwardedSession, tenantId: string): Promise<ProcedureDefinitionOption[]> {
    const headers: Record<string, string> = {};
    if (session.cookie) headers['cookie'] = session.cookie;
    if (session.authorization) headers['authorization'] = session.authorization;
    const response = await this.call(this.url('/v1/workspace'), { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new CrmForbiddenError('Cần quyền truy cập Quy trình để chọn quy trình duyệt.');
    const workspace = (await response.json().catch(() => ({}))) as {
      tenantId?: string;
      definitions?: { id: string; code: string; name: string; status: string }[];
    };
    if (workspace.tenantId !== tenantId || !Array.isArray(workspace.definitions)) {
      throw new CrmForbiddenError('Danh sách quy trình không khớp công ty đang đăng nhập.');
    }
    return workspace.definitions
      .filter((definition) => definition.status === 'published')
      .map(({ id, code, name }) => ({ id, code, name }));
  }
}
