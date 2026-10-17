import type {
  FleetAvailabilityView,
  SourceTransport,
  TransportInput,
  TransportSourceType,
} from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from '../domain/workspace.error.js';
import type { FleetAvailabilityReader } from './fleet-availability.port.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { SaveSourceTransport, WorkspaceStore } from './workspace-store.port.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_TYPES: readonly TransportSourceType[] = ['WORK_ITEM', 'CALENDAR_EVENT'];
/** Một chuyến không dài hơn một tuần: chặn nhầm năm hoặc nhầm ngày làm xe bị giữ vô thời hạn. */
const MAX_TRIP_MS = 7 * 86_400_000;

/** Phương tiện đã kiểm tra hình thức; chưa gắn nguồn. */
export interface ParsedTransport {
  readonly mode: 'COMPANY_VEHICLE' | 'EXTERNAL';
  readonly detail?: string | null;
  readonly vehicleId?: string;
  readonly driverId?: string;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly destination?: string | null;
}

function instant(value: unknown, field: string): string {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new WorkspaceValidationError(`${field}: thời gian không hợp lệ.`);
  return new Date(time).toISOString();
}

/** Kiểm tra hình thức khối phương tiện từ người dùng; ném lỗi nghiệp vụ nếu sai. */
export function parseTransport(input: TransportInput): ParsedTransport {
  if (input?.mode === 'EXTERNAL') {
    const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
    if (!detail || detail.length > 100) throw new WorkspaceValidationError('Chọn loại phương tiện ngoài.');
    return { mode: 'EXTERNAL', detail };
  }
  if (input?.mode !== 'COMPANY_VEHICLE') throw new WorkspaceValidationError('Phương tiện di chuyển không hợp lệ.');
  if (!UUID.test(String(input.vehicleId ?? ''))) throw new WorkspaceValidationError('Chọn xe công ty.');
  if (!UUID.test(String(input.driverId ?? ''))) throw new WorkspaceValidationError('Chọn tài xế.');
  const startAt = instant(input.startAt, 'Giờ đi');
  const endAt = instant(input.endAt, 'Giờ về');
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new WorkspaceValidationError('Giờ về phải sau giờ đi.');
  if (Date.parse(endAt) - Date.parse(startAt) > MAX_TRIP_MS) {
    throw new WorkspaceValidationError('Một lần đặt xe không dài quá 7 ngày.');
  }
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
 * Phương tiện của công việc và lịch họp. Quyền sửa phương tiện chính là quyền sửa nguồn: dịch vụ nguồn kiểm quyền
 * rồi mới gọi vào đây. Xe công ty không được ghi lịch trực tiếp mà phát sự kiện cho HRM (xem store `fleetTransport`).
 */
export class FleetTransportService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly reader: FleetAvailabilityReader,
  ) {}

  async availability(
    actor: WorkspaceActor,
    query: { from?: string; to?: string; excludeSourceType?: string; excludeSourceId?: string },
  ): Promise<FleetAvailabilityView> {
    const from = instant(query.from, 'from');
    const to = instant(query.to, 'to');
    if (Date.parse(to) <= Date.parse(from)) throw new WorkspaceValidationError('Khung giờ dùng xe không hợp lệ.');
    const exclude =
      query.excludeSourceType && query.excludeSourceId
        ? {
            sourceType: pickSource(query.excludeSourceType),
            sourceId: requireUuid(query.excludeSourceId),
          }
        : undefined;
    return this.reader.read(actor.tenantId, { from, to, exclude });
  }

  async find(
    actor: WorkspaceActor,
    sourceType: string,
    sourceId: string,
  ): Promise<SourceTransport | null> {
    return (
      (await this.store.fleetTransport.find(actor.tenantId, pickSource(sourceType), requireUuid(sourceId))) ?? null
    );
  }

  /**
   * Ghi phương tiện của một nguồn đã tồn tại. `undefined`: giữ nguyên · `null`: bỏ phương tiện.
   * Gọi SAU khi nguồn đã lưu; hình thức đã được kiểm bằng `parseTransport` trước khi lưu nguồn.
   */
  async apply(
    actor: WorkspaceActor,
    source: { sourceType: TransportSourceType; sourceId: string; label: string },
    parsed: ParsedTransport | null | undefined,
  ): Promise<void> {
    if (parsed === undefined) return;
    if (parsed === null) {
      await this.store.fleetTransport.clear(actor.tenantId, source.sourceType, source.sourceId);
      return;
    }
    const save: SaveSourceTransport = {
      ...parsed,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLabel: source.label.slice(0, 255),
      requesterUserId: actor.userId,
    };
    await this.store.fleetTransport.save(actor.tenantId, save);
  }

  /** Nguồn bị huỷ hoặc xoá: trả xe nếu đang giữ. */
  async release(tenantId: string, sourceType: TransportSourceType, sourceId: string): Promise<void> {
    await this.store.fleetTransport.clear(tenantId, sourceType, sourceId);
  }
}

function pickSource(value: string): TransportSourceType {
  const found = SOURCE_TYPES.find((type) => type === value);
  if (!found) throw new WorkspaceValidationError('Loại nguồn phương tiện không hợp lệ.');
  return found;
}

function requireUuid(value: string): string {
  if (!UUID.test(String(value))) throw new WorkspaceValidationError('Mã không hợp lệ.');
  return value;
}
