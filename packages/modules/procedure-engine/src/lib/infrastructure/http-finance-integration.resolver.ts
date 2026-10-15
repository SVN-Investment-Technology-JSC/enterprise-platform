import {
  PROCEDURE_FINANCE_VOUCHER_KINDS,
  type ProcedureFinanceCapabilities,
  type ProcedureFinanceVoucherKind,
} from '@enterprise-platform/contracts-procedure-engine';
import type { FinanceIntegrationResolver } from '../application/finance-integration.port.js';

/** Gọi `GET {FINANCE_API_URL}/v1/internal/integration/capabilities` bằng service token. */
export class HttpFinanceIntegrationResolver implements FinanceIntegrationResolver {
  constructor(
    private readonly financeApiUrl: string = process.env['FINANCE_API_URL'] ??
      'http://localhost:3341/api/finance',
  ) {}

  async capabilities(tenantId: string): Promise<ProcedureFinanceCapabilities> {
    const response = await fetch(`${this.financeApiUrl}/v1/internal/integration/capabilities`, {
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
}
