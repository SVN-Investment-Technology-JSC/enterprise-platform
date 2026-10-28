import type {
  InventoryClient,
  IssueRequestInput,
  IssueRequestResult,
  ReserveStockRequest,
  ReservedStock,
} from '../application/fulfillment.port.js';
import { CrmError } from '../domain/crm.error.js';

/** Kho không trả lời: không đoán kết quả giữ hàng, xuất kho. */
export const inventoryWriteUnavailable = () =>
  new CrmError('INVENTORY_UNAVAILABLE', 'Không kết nối được Kho. Vui lòng thử lại sau.', 503);

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  shortages?: unknown;
}

/**
 * Lệnh ghi sang Kho qua API nội bộ (`x-service-token`, `x-tenant-id`), không
 * ghi `inventory_schema`:
 *
 * - `POST /v1/internal/reservations` giữ nhiều dòng, tất cả hoặc không;
 * - `POST /v1/internal/reservations/:code/release` nhả phần chưa xuất;
 * - `POST /v1/internal/issue-requests` tạo chứng từ xuất nháp cho đợt giao.
 *
 * Lỗi mạng, token, 5xx, 401, 403, 429 thành 503 `INVENTORY_UNAVAILABLE`. Kho
 * từ chối (4xx khác) thì giữ nguyên mã, thông điệp tiếng Việt và `shortages`
 * của Kho để người dùng thấy lý do thật.
 */
export class HttpInventoryClient implements InventoryClient {
  constructor(
    protected readonly baseUrl: string = process.env['INVENTORY_API_URL'] ?? 'http://localhost:3336/api/inventory',
    protected readonly token: () => string | undefined = () => process.env['INTERNAL_SERVICE_TOKEN'],
  ) {}

  async reserve(tenantId: string, request: ReserveStockRequest): Promise<ReservedStock> {
    const body = await this.post<{ id?: unknown; reservationCode?: unknown; status?: unknown; expiresAt?: unknown }>(
      tenantId,
      '/v1/internal/reservations',
      {
        idempotencyKey: request.idempotencyKey,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        expiresAt: request.expiresAt,
        notes: request.notes,
        items: request.lines.map((line) => ({
          materialCode: line.materialCode,
          warehouseCode: line.warehouseCode,
          quantityReserved: line.quantity,
        })),
      },
    );
    if (typeof body.id !== 'string' || typeof body.reservationCode !== 'string') throw inventoryWriteUnavailable();
    return {
      reservationId: body.id,
      reservationCode: body.reservationCode,
      status: typeof body.status === 'string' ? body.status : 'RESERVED',
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    };
  }

  async release(tenantId: string, reservationCode: string): Promise<void> {
    await this.post(tenantId, `/v1/internal/reservations/${encodeURIComponent(reservationCode)}/release`, {});
  }

  async createIssueRequest(tenantId: string, request: IssueRequestInput): Promise<IssueRequestResult> {
    const body = await this.post<{ documentId?: unknown; documentCode?: unknown; status?: unknown }>(
      tenantId,
      '/v1/internal/issue-requests',
      { ...request, docType: 'ISSUE_SALES' },
    );
    if (typeof body.documentId !== 'string' || typeof body.documentCode !== 'string') throw inventoryWriteUnavailable();
    return { documentId: body.documentId, documentCode: body.documentCode, status: typeof body.status === 'string' ? body.status : 'DRAFT' };
  }

  protected async post<T>(tenantId: string, path: string, payload: unknown): Promise<T> {
    const token = this.token();
    if (!token) throw inventoryWriteUnavailable();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw inventoryWriteUnavailable();
    }
    if (!response.ok) {
      if ([401, 403, 408, 429].includes(response.status) || response.status >= 500) throw inventoryWriteUnavailable();
      const body = (await response.json().catch(() => ({}))) as ErrorBody;
      const message = Array.isArray(body.message) ? body.message.join('; ') : typeof body.message === 'string' ? body.message : '';
      throw new CrmError(
        typeof body.code === 'string' ? body.code : 'INVENTORY_REJECTED',
        (message || `Kho từ chối yêu cầu (mã ${response.status}).`).slice(0, 2000),
        response.status === 409 ? 409 : 422,
        Array.isArray(body.shortages) ? { shortages: body.shortages } : undefined,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw inventoryWriteUnavailable();
    }
  }
}
