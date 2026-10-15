import type {
  MaintenanceFleetAvailability,
  MaintenanceTransport,
  MaintenanceTransportInput,
} from '@enterprise-platform/contracts-maintenance';
import { MaintenanceError } from '../domain/maintenance.error.js';
import type { MaintenanceActor, MaintenanceStore } from './maintenance-store.port.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Một chuyến không dài hơn một tuần: chặn nhầm năm hoặc nhầm ngày làm xe bị giữ vô thời hạn. */
const MAX_TRIP_MS = 7 * 86_400_000;

/** Token Symbol: port HTTP chỉ đọc sang HRM. */
export const FLEET_AVAILABILITY_READER = Symbol('FLEET_AVAILABILITY_READER');

/**
 * Xe và tài xế còn trống kèm khoảng bận, do HRM (chủ của Lịch xe) trả lời. Maintenance không ghi lịch xe:
 * đặt xe đi bằng sự kiện, đọc lịch bận đi bằng port này để form không cho chọn trùng.
 */
export interface FleetAvailabilityReader {
  read(
    tenantId: string,
    query: { readonly from: string; readonly to: string; readonly excludeIncidentId?: string },
  ): Promise<MaintenanceFleetAvailability>;
}

/** Phương tiện đã kiểm tra hình thức; chưa gắn phiếu. */
export interface ParsedTransport {
  readonly mode: 'COMPANY_VEHICLE' | 'EXTERNAL';
  readonly detail?: string | null;
  readonly vehicleId?: string;
  readonly driverId?: string;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly destination?: string | null;
}

const invalid = (message: string) => new MaintenanceError('validation', message);

function instant(value: unknown, field: string): string {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw invalid(`${field}: thời gian không hợp lệ.`);
  return new Date(time).toISOString();
}

/** Kiểm tra hình thức khối phương tiện từ người dùng; ném lỗi nghiệp vụ nếu sai. */
export function parseTransport(input: MaintenanceTransportInput): ParsedTransport {
  if (input?.mode === 'EXTERNAL') {
    const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
    if (!detail || detail.length > 100) throw invalid('Chọn loại phương tiện ngoài.');
    return { mode: 'EXTERNAL', detail };
  }
  if (input?.mode !== 'COMPANY_VEHICLE') throw invalid('Phương tiện di chuyển không hợp lệ.');
  if (!UUID.test(String(input.vehicleId ?? ''))) throw invalid('Chọn xe công ty.');
  if (!UUID.test(String(input.driverId ?? ''))) throw invalid('Chọn tài xế.');
  const startAt = instant(input.startAt, 'Giờ đi');
  const endAt = instant(input.endAt, 'Giờ về');
  if (Date.parse(endAt) <= Date.parse(startAt)) throw invalid('Giờ về phải sau giờ đi.');
  if (Date.parse(endAt) - Date.parse(startAt) > MAX_TRIP_MS) throw invalid('Một lần đặt xe không dài quá 7 ngày.');
  const destination = typeof input.destination === 'string' ? input.destination.trim().slice(0, 255) : '';
  return {
    mode: 'COMPANY_VEHICLE',
    vehicleId: input.vehicleId,
    driverId: input.driverId,
    startAt,
    endAt,
    destination: destination || null,
  };
}

/**
 * Phương tiện của phiếu sự cố. Quyền sửa phương tiện chính là quyền xử lý phiếu (guard của API). Xe công ty không
 * được ghi lịch trực tiếp mà phát sự kiện cho HRM (xem store `fleetTransport`).
 */
export class FleetTransportService {
  constructor(
    private readonly store: MaintenanceStore,
    private readonly reader: FleetAvailabilityReader,
  ) {}

  async availability(
    actor: MaintenanceActor,
    query: { from?: string; to?: string; excludeIncidentId?: string },
  ): Promise<MaintenanceFleetAvailability> {
    const from = instant(query.from, 'from');
    const to = instant(query.to, 'to');
    if (Date.parse(to) <= Date.parse(from)) throw invalid('Khung giờ dùng xe không hợp lệ.');
    if (query.excludeIncidentId && !UUID.test(query.excludeIncidentId)) throw invalid('Mã phiếu không hợp lệ.');
    return this.reader.read(actor.tenantId, { from, to, excludeIncidentId: query.excludeIncidentId });
  }

  async find(actor: MaintenanceActor, incidentId: string): Promise<MaintenanceTransport | null> {
    if (!UUID.test(incidentId)) throw invalid('Mã phiếu không hợp lệ.');
    return (await this.store.fleetTransport.find(actor.tenantId, incidentId)) ?? null;
  }

  /** Ghi phương tiện của một phiếu đã tồn tại. `undefined`: giữ nguyên · `null`: bỏ phương tiện và trả xe. */
  async apply(
    actor: MaintenanceActor,
    incident: { id: string; label: string },
    parsed: ParsedTransport | null | undefined,
  ): Promise<void> {
    if (parsed === undefined) return;
    if (parsed === null) {
      await this.store.fleetTransport.clear(actor.tenantId, incident.id);
      return;
    }
    await this.store.fleetTransport.save(actor.tenantId, {
      ...parsed,
      incidentId: incident.id,
      sourceLabel: incident.label.slice(0, 255),
      requesterUserId: actor.userId,
    });
  }
}
