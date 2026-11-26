import {
  PROCEDURE_FINANCE_VOUCHER_KINDS,
  type ProcedureFinanceCapabilities,
  type ProcedureFinanceVoucherKind,
} from '@enterprise-platform/contracts-procedure-engine';
import { FinanceNotEntitledError, type FinanceIntegrationResolver } from '../application/finance-integration.port.js';

/** Gọi `GET {FINANCE_API_URL}/v1/internal/integration/capabilities` bằng service token. */
export class HttpFinanceIntegrationResolver implements FinanceIntegrationResolver {
  constructor(
    private readonly financeApiUrl: string = process.env['FINANCE_API_URL'] ??
      'http://localhost:3341/api/finance',
    private readonly tenantDatabaseApiUrl: string = process.env['PLATFORM_TENANT_DATABASE_API_URL'] ??
      process.env['PLATFORM_TENANT_DATABASE_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/tenant-databases',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async capabilities(tenantId: string): Promise<ProcedureFinanceCapabilities> {
    try {
      return await this.readCapabilities(tenantId);
    } catch (error) {
      // Tài chính từ chối vì tenant chưa có module thì trả lỗi chung (503) giống lúc Platform hỏng, nên hỏi thẳng Platform
      // để phân biệt: chưa được cấp module khác hẳn với "Tài chính chưa trả lời".
      if (await this.notEntitled(tenantId)) throw new FinanceNotEntitledError();
      throw error;
    }
  }

  private async readCapabilities(tenantId: string): Promise<ProcedureFinanceCapabilities> {
    const response = await this.fetcher(`${this.financeApiUrl}/v1/internal/integration/capabilities`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Tài chính capabilities trả về ${response.status}.`);
    const body = (await response.json()) as { voucherKinds?: unknown };
    const kinds = Array.isArray(body.voucherKinds) ? body.voucherKinds : [];
    return {
      voucherKinds: kinds.filter((kind): kind is ProcedureFinanceVoucherKind =>
        PROCEDURE_FINANCE_VOUCHER_KINDS.includes(kind as ProcedureFinanceVoucherKind),
      ),
    };
  }

  /** `true` chỉ khi Platform trả đúng `403 MODULE_NOT_ENTITLED`; mọi lỗi khác (Platform không trả lời...) coi là chưa biết. */
  private async notEntitled(tenantId: string): Promise<boolean> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) return false;
    try {
      const response = await this.fetcher(`${this.tenantDatabaseApiUrl}/${encodeURIComponent(tenantId)}?moduleKey=finance`, {
        headers: { 'x-service-token': token },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 403) return false;
      const body = (await response.json().catch(() => undefined)) as { code?: unknown } | undefined;
      return body?.code === 'MODULE_NOT_ENTITLED';
    } catch {
      return false;
    }
  }
}
