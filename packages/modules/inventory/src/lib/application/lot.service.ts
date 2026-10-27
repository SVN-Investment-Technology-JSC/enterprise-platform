import { Inject, Injectable } from '@nestjs/common';
import type { Lot, LotDetail, LotSuggestion } from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import { suggestLotsFefo, todayInVietnam } from '../domain/traceability-policy.js';
import type { InventoryActor } from './inventory.application.js';
import { TRACEABILITY_STORE, type TraceabilityStore } from './traceability-store.port.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lô và gợi ý chọn lô theo FEFO (INV-04, INV-09, T1-17). Lô được tạo và cộng trừ
 * qua chứng từ kho; service này chỉ đọc.
 */
@Injectable()
export class LotService {
  constructor(
    @Inject(TRACEABILITY_STORE) private readonly store: TraceabilityStore,
    private readonly today: () => string = () => todayInVietnam(),
  ) {}

  async list(actor: InventoryActor, materialCode: string | undefined): Promise<Lot[]> {
    return this.store.listLots(actor.tenantId, requireCode(materialCode, 'Thiếu mã vật tư.'));
  }

  async get(actor: InventoryActor, lotId: string): Promise<LotDetail> {
    const id = lotId?.trim();
    const lot = id && UUID_PATTERN.test(id) ? await this.store.getLot(actor.tenantId, id) : null;
    if (!lot) throw new InventoryError('LOT_NOT_FOUND', 'Không tìm thấy lô.', 404);
    return lot;
  }

  /** Lô dùng được tại kho theo hạn dùng gần nhất trước; bỏ lô hết hạn và lô không Đạt. */
  async suggest(
    actor: InventoryActor,
    query: { materialCode?: string; warehouseCode?: string; quantity?: string | number },
  ): Promise<LotSuggestion> {
    const materialCode = requireCode(query.materialCode, 'Thiếu mã vật tư.');
    const warehouseCode = requireCode(query.warehouseCode, 'Thiếu mã kho.');
    const quantity = Number(query.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InventoryError('VALIDATION', 'Số lượng cần xuất phải là số dương.');
    }
    const candidates = await this.store.lotCandidates(actor.tenantId, materialCode, warehouseCode);
    const allocation = suggestLotsFefo(candidates, quantity, this.today());
    return {
      materialCode,
      warehouseCode,
      requested: quantity,
      allocated: allocation.allocated,
      shortage: allocation.shortage,
      lines: allocation.lines.map((line) => ({
        lotId: line.lotId,
        lotNo: line.lotNo,
        expiresOn: line.expiresOn,
        manufacturedOn: line.manufacturedOn,
        available: line.available,
        quantity: line.quantity,
      })),
    };
  }
}

function requireCode(value: string | undefined, message: string): string {
  const code = value?.trim();
  if (!code) throw new InventoryError('VALIDATION', message);
  return code;
}
