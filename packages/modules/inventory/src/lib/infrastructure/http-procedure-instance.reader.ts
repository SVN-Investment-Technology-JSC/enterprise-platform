import type {
  ProcedureInstanceReader,
  ProcedureInstanceState,
  ProcedureIssueOrder,
} from '../application/procedure-instance-reader.port.js';
import { InventoryError } from '../domain/inventory.error.js';

const unavailable = (message = 'Quy trình đang không khả dụng. Vui lòng thử lại sau.') =>
  new InventoryError('PROCEDURE_UNAVAILABLE', message, 503);

/**
 * Hỏi Quy trình trạng thái hồ sơ (`POST /v1/internal/instances/status`) và danh sách
 * đơn vật tư xuất kho (`GET /v1/internal/material-orders`) bằng token dịch vụ
 * (`x-service-token`, `x-tenant-id`), cùng mẫu với Bán hàng
 * (`crm/.../http-procedure-client.ts`). Không đọc `procedure_schema`.
 */
export class HttpProcedureInstanceReader implements ProcedureInstanceReader {
  constructor(
    private readonly baseUrl: string = process.env['PROCEDURE_API_URL'] ?? 'http://localhost:3334/api/procedure',
    private readonly token: () => string | undefined = () => process.env['INTERNAL_SERVICE_TOKEN'],
  ) {}

  async instanceState(tenantId: string, instanceId: string): Promise<ProcedureInstanceState | null> {
    const token = this.token();
    if (!token) throw unavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN để hỏi Quy trình.');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/internal/instances/status`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-service-token': token },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ ids: [instanceId] }),
      });
    } catch {
      throw unavailable();
    }
    if (!response.ok) throw unavailable(`Quy trình trả mã ${response.status} khi kiểm hồ sơ.`);
    const body = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw unavailable('Quy trình trả dữ liệu hồ sơ không hợp lệ.');
    const entry = body.find(
      (item: { instanceId?: unknown }) => item && typeof item === 'object' && item.instanceId === instanceId,
    ) as { instanceId: string; instanceCode?: unknown; status?: unknown } | undefined;
    if (!entry) return null;
    return {
      instanceId: entry.instanceId,
      instanceCode: typeof entry.instanceCode === 'string' ? entry.instanceCode : null,
      status: typeof entry.status === 'string' ? entry.status : '',
    };
  }

  async listIssueOrders(tenantId: string): Promise<ProcedureIssueOrder[]> {
    const token = this.token();
    if (!token) throw unavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN để hỏi Quy trình.');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/internal/material-orders`, {
        method: 'GET',
        redirect: 'error',
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw unavailable();
    }
    if (!response.ok) throw unavailable(`Quy trình trả mã ${response.status} khi đọc yêu cầu cấp vật tư.`);
    const body = (await response.json().catch(() => null)) as { items?: unknown } | null;
    if (!body || !Array.isArray(body.items)) throw unavailable('Quy trình trả danh sách yêu cầu không hợp lệ.');
    return body.items.filter(isIssueOrder);
  }
}

function isIssueOrder(value: unknown): value is ProcedureIssueOrder {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item['orderCode'] === 'string' &&
    typeof item['parentInstanceId'] === 'string' &&
    typeof item['parentCode'] === 'string' &&
    Array.isArray(item['lines'])
  );
}
