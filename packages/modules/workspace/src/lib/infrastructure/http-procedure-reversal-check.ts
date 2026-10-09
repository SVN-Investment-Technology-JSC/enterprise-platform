import type {
  ProcedureReversalCheck,
  ProcedureReversalChecker,
} from '../application/procedure-reversal-check.port.js';

/**
 * Gọi `GET /v1/internal/instances/:id/reversal-check` của Quy trình bằng
 * service token. Endpoint chỉ trả lời được/không kèm lý do, không lộ nội dung
 * hồ sơ, nên không cần đọc dưới danh nghĩa người dùng. Fail closed.
 */
export class HttpProcedureReversalChecker implements ProcedureReversalChecker {
  constructor(
    private readonly procedureApiUrl: string = process.env['PROCEDURE_API_URL'] ??
      'http://localhost:3334/api/procedure',
  ) {}

  async check(tenantId: string, instanceId: string): Promise<ProcedureReversalCheck> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) return { allowed: false, reason: 'Chưa cấu hình kết nối tới Quy trình.' };
    try {
      const response = await fetch(
        `${this.procedureApiUrl}/v1/internal/instances/${encodeURIComponent(instanceId)}/reversal-check`,
        {
          headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        },
      );
      if (!response.ok) {
        return { allowed: false, reason: `Quy trình không trả lời kiểm tra huỷ hiệu lực (${response.status}).` };
      }
      const body = (await response.json()) as Partial<ProcedureReversalCheck>;
      return { allowed: body.allowed === true, reason: body.reason };
    } catch {
      return { allowed: false, reason: 'Không kết nối được Quy trình để kiểm tra huỷ hiệu lực.' };
    }
  }
}
