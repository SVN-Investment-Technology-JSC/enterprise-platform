import type {
  ProcedureInstanceReplacer,
  ReplaceProcedureInstanceInput,
  ReplaceProcedureInstanceResult,
} from '../application/procedure-instance-replacer.port.js';

/**
 * Gọi `POST /v1/internal/workspace/work-items/:id/replace-instance` của Quy
 * trình bằng service token. Quy trình luôn trả 200 cho kết quả nghiệp vụ; mọi
 * trường hợp khác (thiếu cấu hình, 5xx, mất kết nối) là lỗi hạ tầng và ném ra,
 * không đoán là đã đổi hay chưa.
 */
export class HttpProcedureInstanceReplacer implements ProcedureInstanceReplacer {
  constructor(
    private readonly procedureApiUrl: string = process.env['PROCEDURE_API_URL'] ??
      'http://localhost:3334/api/procedure',
  ) {}

  async replace(
    tenantId: string,
    input: ReplaceProcedureInstanceInput,
  ): Promise<ReplaceProcedureInstanceResult> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) throw new Error('Chưa cấu hình kết nối tới Quy trình.');
    const { workItemId, ...body } = input;
    const response = await fetch(
      `${this.procedureApiUrl}/v1/internal/workspace/work-items/${encodeURIComponent(workItemId)}/replace-instance`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'x-service-token': token,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    if (!response.ok) {
      throw new Error(`Quy trình không trả lời yêu cầu đổi quy trình (${response.status}).`);
    }
    const result = (await response.json()) as {
      ok?: boolean;
      reason?: string;
      instance?: Extract<ReplaceProcedureInstanceResult, { ok: true }>['instance'];
      previous?: { id: string; code: string };
    };
    if (result.ok === true && result.instance && result.previous) {
      return { ok: true, instance: result.instance, previous: result.previous };
    }
    return { ok: false, reason: result.reason ?? 'Quy trình không đổi được hồ sơ.' };
  }
}
