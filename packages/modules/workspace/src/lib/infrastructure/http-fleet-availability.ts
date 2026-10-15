import type { FleetAvailabilityView } from '@enterprise-platform/contracts-workspace';
import { WorkspaceError } from '../domain/workspace.error.js';
import type { FleetAvailabilityReader } from '../application/fleet-availability.port.js';

/**
 * Gọi `GET /v1/internal/fleet/availability` của HRM bằng service token. Endpoint chỉ đọc: HRM trả danh sách xe,
 * tài xế đang hoạt động và các khoảng bận, không lộ nội dung đơn. Không trả lời được thì báo lỗi rõ ràng
 * (503) để người dùng chọn lại phương tiện, không đoán là xe còn trống.
 */
export class HttpFleetAvailabilityClient implements FleetAvailabilityReader {
  constructor(
    private readonly hrmApiUrl: string = process.env['HRM_API_URL'] ?? 'http://localhost:3339/api/hrm',
  ) {}

  async read(
    tenantId: string,
    query: Parameters<FleetAvailabilityReader['read']>[1],
  ): Promise<FleetAvailabilityView> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) throw unavailable('Chưa cấu hình kết nối tới HRM.');
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.exclude) {
      params.set('excludeSourceType', query.exclude.sourceType);
      params.set('excludeSourceId', query.exclude.sourceId);
    }
    try {
      const response = await fetch(`${this.hrmApiUrl}/v1/internal/fleet/availability?${params}`, {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (response.status === 400) throw new WorkspaceError('VALIDATION', 'Khung giờ dùng xe không hợp lệ.', 400);
      if (!response.ok) throw unavailable(`HRM không trả lời danh sách xe (${response.status}).`);
      const body = (await response.json()) as { data?: FleetAvailabilityView };
      return {
        vehicles: body.data?.vehicles ?? [],
        drivers: body.data?.drivers ?? [],
      };
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw unavailable('Không kết nối được HRM để lấy danh sách xe.');
    }
  }
}

function unavailable(message: string): WorkspaceError {
  return new WorkspaceError('FLEET_UNAVAILABLE', message, 503);
}
