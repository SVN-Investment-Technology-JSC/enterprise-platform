import type {
  ProcedureReversalCheck,
  ProcedureReversalChecker,
} from '../application/procedure-reversal-check.port.js';

/**
 * Gọi `GET .../reversal-check` của Quy trình (hồ sơ) hoặc HRM (đơn không chạy
 * qua Quy trình) bằng service token. Endpoint chỉ trả lời được/không kèm lý do, không lộ nội dung
 * hồ sơ, nên không cần đọc dưới danh nghĩa người dùng. Fail closed.
 */
export class HttpProcedureReversalChecker implements ProcedureReversalChecker {
  constructor(
    private readonly procedureApiUrl: string = process.env['PROCEDURE_API_URL'] ??
      'http://localhost:3334/api/procedure',
    private readonly hrmApiUrl: string = process.env['HRM_API_URL'] ??
      'http://localhost:3339/api/hrm',
  ) {}

  check(tenantId: string, instanceId: string): Promise<ProcedureReversalCheck> {
    return this.ask(
      tenantId,
      `${this.procedureApiUrl}/v1/internal/instances/${encodeURIComponent(instanceId)}/reversal-check`,
      'Quy trình',
    );
  }

  checkHrmRequest(
    tenantId: string,
    requestKind: string,
    requestId: string,
  ): Promise<ProcedureReversalCheck> {
    return this.ask(
      tenantId,
      `${this.hrmApiUrl}/v1/internal/requests/${encodeURIComponent(requestKind)}/${encodeURIComponent(requestId)}/reversal-check`,
      'HRM',
    );
  }

  private async ask(tenantId: string, url: string, module: string): Promise<ProcedureReversalCheck> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) return { allowed: false, reason: `Chưa cấu hình kết nối tới ${module}.` };
    try {
      const response = await fetch(url, {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) {
        return { allowed: false, reason: `${module} không trả lời kiểm tra huỷ hiệu lực (${response.status}).` };
      }
      const body = (await response.json()) as Partial<ProcedureReversalCheck>;
      return {
        allowed: body.allowed === true,
        reason: body.reason,
        approverUserIds: Array.isArray(body.approverUserIds) ? body.approverUserIds : [],
      };
    } catch {
      return { allowed: false, reason: `Không kết nối được ${module} để kiểm tra huỷ hiệu lực.` };
    }
  }
}
