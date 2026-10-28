import type {
  FinanceClient,
  FinanceReceiptVoucherRequest,
  FinanceVoucherState,
} from '../application/receivable-store.port.js';
import { CrmError } from '../domain/crm.error.js';

/** Tài chính không trả lời: lệnh tạo phiếu được thử lại theo khoá chống lặp. */
export const financeUnavailable = (message = 'Không kết nối được Tài chính. Vui lòng thử lại sau.') =>
  new CrmError('FINANCE_UNAVAILABLE', message, 503);

interface StateBody {
  voucherId?: unknown;
  voucherCode?: unknown;
  status?: unknown;
  sourceStatus?: unknown;
}

/**
 * Phiếu thu có nguồn ở Tài chính qua API nội bộ (`x-service-token`,
 * `x-tenant-id`), không đọc `finance_schema` (D2, Q10):
 *
 * - `POST /v1/internal/voucher-sources`: tạo phiếu thu nháp INHERITED; cùng khoá
 *   cùng nội dung trả lại phiếu cũ; bản ghi nguồn bị trả lại thì mở lại phiếu;
 * - `GET /v1/internal/voucher-sources/:sourceRef?sourceModule=crm`: trạng thái.
 *
 * Lỗi mạng, token, 5xx, 401, 403, 408, 429 thành 503 `FINANCE_UNAVAILABLE` (thử
 * lại); Tài chính từ chối (409 khác nội dung, 422 dữ liệu sai) giữ mã, thông
 * điệp tiếng Việt của Tài chính.
 */
export class HttpFinanceClient implements FinanceClient {
  constructor(
    private readonly baseUrl: string = process.env['FINANCE_API_URL'] ?? 'http://localhost:3341/api/finance',
    private readonly token: () => string | undefined = () => process.env['INTERNAL_SERVICE_TOKEN'],
  ) {}

  async createReceiptVoucher(tenantId: string, request: FinanceReceiptVoucherRequest): Promise<FinanceVoucherState> {
    const response = await this.call(tenantId, '/v1/internal/voucher-sources', {
      method: 'POST',
      body: JSON.stringify({ ...request, sourceModule: 'crm', kind: 'RECEIPT' }),
    });
    if (!response.ok) throw await rejection(response);
    return stateOf((await response.json().catch(() => ({}))) as StateBody);
  }

  async voucherState(tenantId: string, sourceRef: string): Promise<FinanceVoucherState | null> {
    const response = await this.call(tenantId, `/v1/internal/voucher-sources/${encodeURIComponent(sourceRef)}?sourceModule=crm`, {
      method: 'GET',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await rejection(response);
    return stateOf((await response.json().catch(() => ({}))) as StateBody);
  }

  private async call(tenantId: string, path: string, init: { method: string; body?: string }): Promise<Response> {
    const token = this.token();
    if (!token) throw financeUnavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN.');
    try {
      return await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token, 'content-type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw financeUnavailable();
    }
  }
}

function stateOf(body: StateBody): FinanceVoucherState {
  if (typeof body.voucherId !== 'string' || !body.voucherId) throw financeUnavailable('Tài chính không trả mã phiếu.');
  return {
    voucherId: body.voucherId,
    voucherCode: typeof body.voucherCode === 'string' ? body.voucherCode : '',
    status: typeof body.status === 'string' ? body.status : 'DRAFT',
    sourceStatus: typeof body.sourceStatus === 'string' ? body.sourceStatus : 'OPEN',
  };
}

async function rejection(response: Response): Promise<CrmError> {
  if ([401, 403, 408, 429].includes(response.status) || response.status >= 500) return financeUnavailable();
  const body = (await response.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
  const message = Array.isArray(body.message) ? body.message.join('; ') : typeof body.message === 'string' ? body.message : '';
  return new CrmError(
    typeof body.code === 'string' ? body.code : 'FINANCE_REJECTED',
    (message || `Tài chính từ chối yêu cầu (mã ${response.status}).`).slice(0, 2000),
    response.status === 409 ? 409 : 422,
  );
}
