import { Inject, Injectable } from '@nestjs/common';
import type {
  ChangeQualityRequest,
  LotDetail,
  SerialHistory,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import { assertQualityChange } from '../domain/traceability-policy.js';
import type { InventoryActor } from './inventory.application.js';
import { TRACEABILITY_STORE, type TraceabilityStore } from './traceability-store.port.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đổi trạng thái chất lượng của lô, serial (INV-06, INV-07, T1-19). Quyền
 * `inventory.quality.write`, bắt buộc có lý do. Hàng chuyển sang trạng thái khác
 * Đạt cộng vào `quantity_blocked` nên không còn trong tồn khả dụng; về Đạt thì trừ ra.
 */
@Injectable()
export class QualityService {
  constructor(@Inject(TRACEABILITY_STORE) private readonly store: TraceabilityStore) {}

  async changeSerial(
    actor: InventoryActor,
    serial: string,
    input: ChangeQualityRequest,
  ): Promise<SerialHistory> {
    requireQualityWriter(actor);
    const value = serial?.trim();
    if (!value) throw new InventoryError('VALIDATION', 'Thiếu số serial.');
    return this.store.changeSerialQuality(
      actor.tenantId,
      value,
      input?.materialCode?.trim() || undefined,
      actor.userId,
      (current, subject) => assertQualityChange(current, input?.qualityStatus, input?.reason, subject),
    );
  }

  async changeLot(actor: InventoryActor, lotId: string, input: ChangeQualityRequest): Promise<LotDetail> {
    requireQualityWriter(actor);
    const id = lotId?.trim();
    if (!id || !UUID_PATTERN.test(id)) {
      throw new InventoryError('LOT_NOT_FOUND', 'Không tìm thấy lô.', 404);
    }
    return this.store.changeLotQuality(actor.tenantId, id, actor.userId, (current, subject) =>
      assertQualityChange(current, input?.qualityStatus, input?.reason, subject),
    );
  }
}

function requireQualityWriter(actor: InventoryActor): void {
  if (!(actor.canWriteQuality ?? actor.canManage)) {
    throw new InventoryError(
      'ACCESS_DENIED',
      'Bạn không có quyền đổi trạng thái chất lượng hàng.',
      403,
    );
  }
}
