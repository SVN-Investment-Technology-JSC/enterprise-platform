/**
 * Cổng ghi phân công chức danh sang Core. HRM giữ quyết định nhưng KHÔNG ghi
 * `core_schema.organization_node_assignments`: mọi thay đổi đi qua endpoint nội
 * bộ của Core, `decisionId` là khóa idempotent cho lần thử lại.
 */
export interface HrmAppointmentCommand {
  readonly decisionId: string;
  readonly action: 'ASSIGN' | 'END';
  readonly userId: string;
  readonly nodeId?: string | null;
  readonly effectiveDate: string;
  readonly isPrimary?: boolean;
  readonly endCurrent?: boolean;
  readonly note?: string | null;
}

export interface HrmAppointmentResult {
  readonly assignmentId: string | null;
  readonly endedAssignmentIds: readonly string[];
  readonly replayed: boolean;
}

export interface HrmOrgAppointmentPort {
  apply(
    tenantId: string,
    command: HrmAppointmentCommand,
  ): Promise<HrmAppointmentResult>;
}

/** Lỗi từ Core mang thông điệp nghiệp vụ để lưu vào `apply_error` và hiện cho HR. */
export class HrmOrgAppointmentError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class HttpHrmOrgAppointmentPort implements HrmOrgAppointmentPort {
  constructor(
    private readonly baseUrl: string = process.env[
      'TENANT_CORE_ORGANIZATION_CONTEXT_URL'
    ] ?? 'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly timeoutMs = 10_000,
  ) {}

  async apply(
    tenantId: string,
    command: HrmAppointmentCommand,
  ): Promise<HrmAppointmentResult> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/${encodeURIComponent(tenantId)}/appointments`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
          },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new HrmOrgAppointmentError(
        'Không kết nối được Core để cập nhật chức danh. Thử lại sau.',
        true,
      );
    }
    if (!response.ok) {
      let message = `Core từ chối cập nhật chức danh (HTTP ${response.status}).`;
      try {
        const body = (await response.json()) as { message?: string | string[] };
        const text = Array.isArray(body.message) ? body.message.join('; ') : body.message;
        if (text) message = text;
      } catch {
        // giữ thông điệp mặc định
      }
      // 4xx là lỗi dữ liệu cần HR sửa quyết định; 5xx có thể thử lại nguyên trạng.
      throw new HrmOrgAppointmentError(message, response.status >= 500);
    }
    return (await response.json()) as HrmAppointmentResult;
  }
}

let defaultPort: HrmOrgAppointmentPort | undefined;
export function defaultOrgAppointmentPort(): HrmOrgAppointmentPort {
  defaultPort ??= new HttpHrmOrgAppointmentPort();
  return defaultPort;
}
