import type {
  CreateStocktakeRequest,
  StocktakeLotAllocation,
  StocktakeSerialAllocation,
  StocktakeSession,
  UpdateStocktakeItemsRequest,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';
import {
  InventoryError,
  StocktakeForbiddenError,
  StocktakeNotFoundError,
  StocktakeStateError,
} from '../domain/inventory.error.js';
import {
  STOCKTAKE_MAX_QUANTITY,
  planStocktakeAdjustments,
  roundQuantity,
  stocktakeLineStatus,
} from '../domain/stocktake.domain.js';
import type { InventoryActor } from './inventory.application.js';
import type { InventoryStore, StocktakeLinePatch } from './inventory-store.port.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_TYPES = ['ALL', 'CATEGORY', 'SPECIFIC_ITEMS'];
const MATERIAL_CATEGORIES = ['SPARE_PART', 'CONSUMABLE', 'TOOL', 'ROTABLE'];
const EDITABLE = ['DRAFT', 'COUNTING'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  COUNTING: 'Đang kiểm đếm',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã huỷ',
};

function invalid(message: string): InventoryError {
  return new InventoryError('VALIDATION', message, 400);
}

function quantity(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${label} phải là số.`);
  }
  if (value < 0) throw invalid(`${label} không được âm.`);
  if (value > STOCKTAKE_MAX_QUANTITY) throw invalid(`${label} vượt quá giới hạn cho phép.`);
  return roundQuantity(value);
}

function text(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`${label} phải là chuỗi.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${label} tối đa ${max} ký tự.`);
  return trimmed || undefined;
}

function lots(value: unknown): readonly StocktakeLotAllocation[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid('Danh sách lô không hợp lệ.');
  return value.map((entry: StocktakeLotAllocation) => {
    const lotNumber = text(entry?.lotNumber, 'Số lô', 100);
    if (!lotNumber) throw invalid('Số lô không được để trống.');
    return {
      lotNumber,
      systemQty: quantity(entry.systemQty, 'Số lượng sổ sách của lô') ?? 0,
      actualQty: quantity(entry.actualQty, 'Số lượng thực đếm của lô') ?? 0,
      expiryDate: text(entry.expiryDate, 'Hạn dùng', 30),
    };
  });
}

function serials(value: unknown): readonly StocktakeSerialAllocation[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid('Danh sách sê-ri không hợp lệ.');
  return value.map((entry: StocktakeSerialAllocation) => {
    const serialNumber = text(entry?.serialNumber, 'Số sê-ri', 100);
    if (!serialNumber) throw invalid('Số sê-ri không được để trống.');
    if (!['FOUND', 'MISSING', 'EXTRA'].includes(entry.status)) {
      throw invalid('Trạng thái sê-ri không hợp lệ.');
    }
    return { serialNumber, status: entry.status };
  });
}

function parseId(id: string): string {
  if (!UUID_PATTERN.test(id ?? '')) throw new StocktakeNotFoundError();
  return id;
}

export class StocktakeService {
  constructor(private readonly store: InventoryStore) {}

  list(actor: InventoryActor): Promise<StocktakeSession[]> {
    return this.store.stocktake.list(actor.tenantId);
  }

  async get(actor: InventoryActor, id: string): Promise<StocktakeSession> {
    const session = await this.store.stocktake.get(actor.tenantId, parseId(id));
    if (!session) throw new StocktakeNotFoundError();
    return session;
  }

  async create(actor: InventoryActor, input: CreateStocktakeRequest): Promise<StocktakeSession> {
    this.requireCreator(actor);
    const title = text(input?.title, 'Tên đợt kiểm kê', 255);
    if (!title) throw invalid('Tên đợt kiểm kê không được để trống.');
    const warehouseCode = text(input?.warehouseCode, 'Mã kho', 64)?.toUpperCase();
    if (!warehouseCode) throw invalid('Phải chọn kho cần kiểm kê.');
    if (!SCOPE_TYPES.includes(input?.scopeType)) throw invalid('Phạm vi kiểm kê không hợp lệ.');

    let scopeCategories: string[] | undefined;
    let specificMaterialCodes: string[] | undefined;
    if (input.scopeType === 'CATEGORY') {
      scopeCategories = [...new Set((input.scopeCategories ?? []).map((c) => String(c).trim()))];
      if (scopeCategories.length === 0) throw invalid('Phải chọn ít nhất một nhóm vật tư.');
      const bad = scopeCategories.find((c) => !MATERIAL_CATEGORIES.includes(c));
      if (bad) throw invalid(`Nhóm vật tư ${bad} không hợp lệ.`);
    }
    if (input.scopeType === 'SPECIFIC_ITEMS') {
      specificMaterialCodes = [
        ...new Set(
          (input.specificMaterialCodes ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean),
        ),
      ];
      if (specificMaterialCodes.length === 0) throw invalid('Phải chọn ít nhất một mã vật tư.');
    }
    if (input.auditors !== undefined && !Array.isArray(input.auditors)) {
      throw invalid('Danh sách kiểm kê viên không hợp lệ.');
    }

    return this.store.stocktake.create(actor.tenantId, {
      title,
      warehouseCode,
      scopeType: input.scopeType,
      scopeCategories,
      specificMaterialCodes,
      leadAuditor: text(input.leadAuditor, 'Trưởng nhóm kiểm kê', 128),
      auditors: input.auditors?.map((a) => String(a).trim()).filter(Boolean),
      note: text(input.note, 'Ghi chú', 2000),
      createdBy: actor.userId,
    });
  }

  /** Cập nhật số đếm; chỉ khi đợt còn đang kiểm đếm. */
  async updateItems(
    actor: InventoryActor,
    id: string,
    body: UpdateStocktakeItemsRequest,
  ): Promise<StocktakeSession> {
    this.requireCreator(actor);
    parseId(id);
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw invalid('Chưa có dòng kiểm đếm nào để cập nhật.');
    }
    if (body.items.length > 5000) throw invalid('Mỗi lần chỉ cập nhật tối đa 5000 dòng.');
    const parsed = body.items.map((item) => this.parseItem(item));

    await this.store.stocktake.withSession(actor.tenantId, id, async (tx) => {
      this.requireStatus(tx.session.status, EDITABLE, 'cập nhật số đếm');
      const lines = new Map((await tx.lines()).map((line) => [line.id, line]));
      for (const item of parsed) {
        const line = lines.get(item.lineId);
        if (!line) throw invalid(`Dòng kiểm đếm ${item.lineId} không thuộc đợt này.`);
        const actual = item.actualQuantity ?? line.actualQuantity;
        const patch: StocktakeLinePatch = {
          countRound1: item.countRound1,
          countRound2: item.countRound2,
          actualQuantity: item.actualQuantity,
          reason: item.reason,
          note: item.note,
          lotAllocations: item.lotAllocations,
          serialAllocations: item.serialAllocations,
          status: stocktakeLineStatus(line.systemQuantity, actual),
          audit:
            item.actualQuantity !== undefined && item.actualQuantity !== line.actualQuantity
              ? {
                  previous: line.actualQuantity,
                  next: item.actualQuantity,
                  operator: actor.displayName,
                  reason: item.reason,
                }
              : undefined,
        };
        await tx.updateLine(item.lineId, patch);
      }
    });
    return this.get(actor, id);
  }

  async submit(actor: InventoryActor, id: string): Promise<StocktakeSession> {
    this.requireCreator(actor);
    parseId(id);
    await this.store.stocktake.withSession(actor.tenantId, id, async (tx) => {
      this.requireStatus(tx.session.status, EDITABLE, 'gửi duyệt');
      const lines = await tx.lines();
      const counted = lines.filter((l) => l.actualQuantity !== undefined && l.actualQuantity !== null);
      if (counted.length === 0) throw invalid('Chưa có vật tư nào được đếm, không thể gửi duyệt.');
      const missing = counted.find((l) => l.difference !== 0 && !l.reason?.trim());
      if (missing) {
        throw invalid(`Vật tư ${missing.materialCode} có chênh lệch nhưng chưa ghi lý do.`);
      }
      await tx.setStatus({ status: 'PENDING_APPROVAL' });
    });
    return this.get(actor, id);
  }

  async reject(actor: InventoryActor, id: string, reason?: string): Promise<StocktakeSession> {
    this.requireApprover(actor);
    parseId(id);
    const why = text(reason, 'Lý do', 500);
    await this.store.stocktake.withSession(actor.tenantId, id, async (tx) => {
      this.requireStatus(tx.session.status, ['PENDING_APPROVAL'], 'trả lại');
      await tx.setStatus({
        status: 'COUNTING',
        note: [tx.session.note, `Yêu cầu đếm lại: ${why ?? 'kiểm đếm lại số liệu'}`]
          .filter(Boolean)
          .join(' | '),
      });
    });
    return this.get(actor, id);
  }

  async cancel(actor: InventoryActor, id: string, reason?: string): Promise<StocktakeSession> {
    this.requireCreator(actor);
    parseId(id);
    const why = text(reason, 'Lý do', 500);
    await this.store.stocktake.withSession(actor.tenantId, id, async (tx) => {
      this.requireStatus(tx.session.status, ['DRAFT', 'COUNTING', 'PENDING_APPROVAL'], 'huỷ');
      await tx.setStatus({
        status: 'CANCELLED',
        note: [tx.session.note, why ? `Lý do huỷ: ${why}` : ''].filter(Boolean).join(' | '),
      });
    });
    return this.get(actor, id);
  }

  /**
   * Duyệt và ghi sổ trong MỘT transaction: đợt bị khoá dòng, trạng thái kiểm tra
   * lại sau khi khoá. Gọi lần hai (hoặc song song) thấy POSTED và bị từ chối nên
   * không thể sinh bút toán điều chỉnh lần nữa.
   */
  async approve(actor: InventoryActor, id: string): Promise<StocktakeSession> {
    this.requireApprover(actor);
    parseId(id);
    await this.store.stocktake.withSession(actor.tenantId, id, async (tx) => {
      this.requireStatus(tx.session.status, ['PENDING_APPROVAL'], 'duyệt và ghi sổ');
      const plans = planStocktakeAdjustments(await tx.lines());
      for (const plan of plans) {
        await tx.postAdjustment({ ...plan, createdBy: actor.userId });
      }
      await tx.setStatus({
        status: 'POSTED',
        approvedBy: actor.userId,
        approvedAt: new Date().toISOString(),
      });
    });
    return this.get(actor, id);
  }

  private parseItem(item: UpdateStocktakeLineInput): UpdateStocktakeLineInput {
    if (!item || !UUID_PATTERN.test(item.lineId ?? '')) {
      throw invalid('Mã dòng kiểm đếm không hợp lệ.');
    }
    return {
      lineId: item.lineId,
      countRound1: quantity(item.countRound1, 'Số đếm lần 1'),
      countRound2: quantity(item.countRound2, 'Số đếm lần 2'),
      actualQuantity: quantity(item.actualQuantity, 'Số thực đếm'),
      reason: text(item.reason, 'Lý do', 500),
      note: text(item.note, 'Ghi chú', 2000),
      lotAllocations: lots(item.lotAllocations),
      serialAllocations: serials(item.serialAllocations),
    };
  }

  private requireStatus(current: string, allowed: readonly string[], action: string): void {
    if (allowed.includes(current)) return;
    throw new StocktakeStateError(
      `Không thể ${action}: đợt kiểm kê đang ở trạng thái "${STATUS_LABEL[current] ?? current}".`,
    );
  }

  private requireCreator(actor: InventoryActor): void {
    if (!(actor.canCreateStocktake ?? actor.canManage)) {
      throw new StocktakeForbiddenError('Bạn không có quyền tạo hoặc nhập số đếm kiểm kê.');
    }
  }

  private requireApprover(actor: InventoryActor): void {
    if (!(actor.canApproveStocktake ?? actor.canManage)) {
      throw new StocktakeForbiddenError('Bạn không có quyền duyệt kiểm kê.');
    }
  }
}
