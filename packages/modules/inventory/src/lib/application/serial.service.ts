import { Inject, Injectable } from '@nestjs/common';
import type { SerialHistory } from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import type { InventoryActor } from './inventory.application.js';
import { TRACEABILITY_STORE, type TraceabilityStore } from './traceability-store.port.js';

/**
 * Tra cứu serial (T1-15): mặt hàng, kho, trạng thái, lần xuất gần nhất và lịch sử.
 * Bảo hành của Bán hàng gọi qua route nội bộ; màn Kho gọi qua route người dùng.
 */
@Injectable()
export class SerialService {
  constructor(@Inject(TRACEABILITY_STORE) private readonly store: TraceabilityStore) {}

  async history(
    actor: InventoryActor,
    serial: string,
    materialCode?: string,
  ): Promise<SerialHistory> {
    const value = serial?.trim();
    if (!value) throw new InventoryError('VALIDATION', 'Thiếu số serial.');
    const found = await this.store.serialHistory(actor.tenantId, value, materialCode?.trim() || undefined);
    if (!found) throw new InventoryError('SERIAL_NOT_FOUND', `Serial ${value} không tồn tại.`, 404);
    return found;
  }
}
