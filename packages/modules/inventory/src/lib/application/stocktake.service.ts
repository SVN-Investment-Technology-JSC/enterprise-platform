import type {
  CreateStocktakeRequest,
  StocktakeLine,
  StocktakeLineAudit,
  StocktakeLinesResult,
  StocktakeListQuery,
  StocktakePage,
  StocktakePostResult,
  StocktakeScopeType,
  StocktakeSession,
  StocktakeStatus,
  UpdateStocktakeLineInput,
  UpdateStocktakeLinesRequest,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError, StocktakeNotFoundError } from '../domain/inventory.error.js';
import {
  assertStocktakeNotSelfApproved,
  assertStocktakeTransition,
  buildAdjustmentLines,
  linesMissingReason,
  requireCountedQuantity,
  round3,
} from '../domain/stocktake-policy.js';
import type { InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import { INVENTORY_SETTINGS_DEFAULTS, normalizeInventorySetting } from './inventory-settings.js';
import type { StockDocumentLineDraft, StockDocumentStore } from './stock-document-store.port.js';
import type { NewStocktakeInput, StocktakeLineFilter, StocktakeStore } from './stocktake-store.port.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCOPE_TYPES: readonly StocktakeScopeType[] = ['ALL', 'CATEGORY', 'SPECIFIC_ITEMS'];
const STATUSES: readonly StocktakeStatus[] = [
  'DRAFT',
  'COUNTING',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'CANCELLED',
];
const LINE_STATUSES: readonly StocktakeLine['status'][] = ['UNCOUNTED', 'MATCHED', 'SURPLUS', 'DEFICIT'];
const SERIAL_STATUSES = ['FOUND', 'MISSING', 'EXTRA'] as const;
const MAX_UPDATES = 500;
const MAX_SCOPE_ITEMS = 2000;

/**
 * Kiểm kê kho: lập đợt, chụp snapshot, ghi số đếm, gửi duyệt, duyệt, ghi sổ cân
 * kho. Quy tắc trạng thái và dựng dòng điều chỉnh nằm ở `stocktake-policy`;
 * service kiểm quyền, chuẩn hoá input rồi giao cho store chạy trên đợt đã khoá.
 *
 * Ghi sổ không cập nhật tồn trực tiếp: tạo một chứng từ điều chỉnh (ADJUSTMENT,
 * nguồn `stocktake`) qua đúng đường ghi sổ của chứng từ kho, nên giá vốn, lô,
 * serial, sự kiện và sổ kho đều theo một luật.
 *
 * Không dùng decorator của Nest ở tầng application: module dựng service bằng
 * `useFactory` (xem `inventory.module.ts`).
 */
export class StocktakeService {
  constructor(
    private readonly stocktakes: StocktakeStore,
    private readonly documents: StockDocumentStore,
    private readonly inventory: InventoryStore,
  ) {}

  async list(actor: InventoryActor, query: StocktakeListQuery): Promise<StocktakePage> {
    if (query.status && !STATUSES.includes(query.status)) {
      throw new InventoryError('VALIDATION', 'Trạng thái kiểm kê không hợp lệ.');
    }
    return this.stocktakes.list(actor.tenantId, {
      warehouseCode: query.warehouseCode?.trim() || undefined,
      status: query.status || undefined,
      search: query.search?.trim() || undefined,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async get(actor: InventoryActor, key: string): Promise<StocktakeSession> {
    const session = await this.stocktakes.get(actor.tenantId, key);
    if (!session) throw new StocktakeNotFoundError(key);
    return session;
  }

  async lines(
    actor: InventoryActor,
    key: string,
    filter: StocktakeLineFilter = {},
  ): Promise<StocktakeLine[]> {
    if (filter.status && !LINE_STATUSES.includes(filter.status)) {
      throw new InventoryError('VALIDATION', 'Trạng thái dòng kiểm kê không hợp lệ.');
    }
    await this.get(actor, key);
    return this.stocktakes.lines(actor.tenantId, key, {
      status: filter.status || undefined,
      search: filter.search?.trim() || undefined,
      hasDiffOnly: filter.hasDiffOnly || undefined,
    });
  }

  async audits(actor: InventoryActor, key: string): Promise<StocktakeLineAudit[]> {
    await this.get(actor, key);
    return this.stocktakes.audits(actor.tenantId, key);
  }

  async create(actor: InventoryActor, input: CreateStocktakeRequest): Promise<StocktakeSession> {
    requireCreator(actor);
    const title = input?.title?.trim();
    if (!title) throw new InventoryError('VALIDATION', 'Tên đợt kiểm kê không được để trống.');
    if (title.length > 255) throw new InventoryError('VALIDATION', 'Tên đợt kiểm kê tối đa 255 ký tự.');
    const warehouseCode = input.warehouseCode?.trim();
    if (!warehouseCode) throw new InventoryError('VALIDATION', 'Phải chọn kho cần kiểm kê.');
    if (!SCOPE_TYPES.includes(input.scopeType)) {
      throw new InventoryError('VALIDATION', 'Phạm vi kiểm kê không hợp lệ.');
    }
    const scopeCategories = cleanList(input.scopeCategories, MAX_SCOPE_ITEMS);
    const scopeMaterialCodes = cleanList(input.specificMaterialCodes, MAX_SCOPE_ITEMS);
    if (input.scopeType === 'CATEGORY' && scopeCategories.length === 0) {
      throw new InventoryError('VALIDATION', 'Phạm vi theo nhóm phải chọn ít nhất một phân loại.');
    }
    if (input.scopeType === 'SPECIFIC_ITEMS' && scopeMaterialCodes.length === 0) {
      throw new InventoryError('VALIDATION', 'Phạm vi chỉ định phải chọn ít nhất một mã vật tư.');
    }
    const stocktakeDate = input.stocktakeDate?.trim() || undefined;
    if (stocktakeDate && !DATE_PATTERN.test(stocktakeDate)) {
      throw new InventoryError('VALIDATION', 'Ngày kiểm kê phải có dạng YYYY-MM-DD.');
    }
    const leadAuditor = input.leadAuditor?.trim() || undefined;
    if (leadAuditor && leadAuditor.length > 100) {
      throw new InventoryError('VALIDATION', 'Tên trưởng nhóm kiểm kê tối đa 100 ký tự.');
    }
    const payload: NewStocktakeInput = {
      title,
      warehouseCode,
      stocktakeDate,
      scopeType: input.scopeType,
      scopeCategories: input.scopeType === 'CATEGORY' ? scopeCategories : undefined,
      scopeMaterialCodes: input.scopeType === 'SPECIFIC_ITEMS' ? scopeMaterialCodes : undefined,
      leadAuditor,
      auditors: cleanList(input.auditors, 100),
      note: input.note?.trim() || undefined,
      createdBy: actor.userId,
    };
    return this.stocktakes.create(actor.tenantId, payload);
  }

  /** Chụp snapshot tồn sổ sách và bắt đầu kiểm đếm. */
  async start(actor: InventoryActor, key: string): Promise<StocktakeLinesResult> {
    requireCreator(actor);
    return this.stocktakes.start(actor.tenantId, key, actor.userId, (current) =>
      assertStocktakeTransition(current, 'start'),
    );
  }

  async saveLines(
    actor: InventoryActor,
    key: string,
    input: UpdateStocktakeLinesRequest,
  ): Promise<StocktakeLinesResult> {
    requireCreator(actor);
    const updates = normalizeUpdates(input?.lines);
    return this.stocktakes.saveLines(
      actor.tenantId,
      key,
      { id: actor.userId, name: actor.displayName.slice(0, 100) },
      updates,
      (current) => assertStocktakeTransition(current, 'count'),
    );
  }

  /** Gửi duyệt: khoá số đếm. Dòng chênh lệch phải có lý do; dòng chưa đếm giữ nguyên số sổ sách. */
  async submit(actor: InventoryActor, key: string): Promise<StocktakeSession> {
    requireCreator(actor);
    return this.stocktakes.transition(
      actor.tenantId,
      key,
      { to: 'PENDING_APPROVAL', actorId: actor.userId },
      (current, lines) => {
        assertStocktakeTransition(current, 'submit');
        const missing = linesMissingReason(lines);
        if (missing.length) {
          const codes = missing.slice(0, 5).map((line) => line.materialCode).join(', ');
          throw new InventoryError(
            'STOCKTAKE_REASON_REQUIRED',
            `${missing.length} dòng chênh lệch chưa có lý do (${codes}${missing.length > 5 ? ', ...' : ''}). Nhập lý do trước khi gửi duyệt.`,
            409,
          );
        }
      },
    );
  }

  /** Trả về đếm lại: mở khoá số đếm, bắt buộc có lý do. */
  async reject(actor: InventoryActor, key: string, reason: string | undefined): Promise<StocktakeSession> {
    requireApprover(actor);
    const trimmed = reason?.trim();
    if (!trimmed) throw new InventoryError('VALIDATION', 'Phải ghi lý do yêu cầu đếm lại.');
    return this.stocktakes.transition(
      actor.tenantId,
      key,
      { to: 'COUNTING', actorId: actor.userId, reason: trimmed },
      (current) => assertStocktakeTransition(current, 'reject'),
    );
  }

  async approve(actor: InventoryActor, key: string): Promise<StocktakeSession> {
    requireApprover(actor);
    const allowSelfApproval = await this.allowSelfApproval(actor.tenantId);
    return this.stocktakes.transition(
      actor.tenantId,
      key,
      { to: 'APPROVED', actorId: actor.userId },
      (current) => {
        assertStocktakeTransition(current, 'approve');
        assertStocktakeNotSelfApproved(current, actor.userId, allowSelfApproval);
      },
    );
  }

  async cancel(actor: InventoryActor, key: string, reason: string | undefined): Promise<StocktakeSession> {
    requireCreator(actor);
    const trimmed = reason?.trim();
    if (!trimmed) throw new InventoryError('VALIDATION', 'Phải ghi lý do huỷ đợt kiểm kê.');
    return this.stocktakes.transition(
      actor.tenantId,
      key,
      { to: 'CANCELLED', actorId: actor.userId, reason: trimmed },
      (current) => assertStocktakeTransition(current, 'cancel'),
    );
  }

  /**
   * Ghi sổ cân kho: tạo và ghi sổ một chứng từ điều chỉnh cho các dòng chênh
   * lệch rồi đánh dấu đợt Đã ghi sổ. Gọi lại an toàn: chứng từ có khoá chống lặp
   * theo đợt nên không bao giờ điều chỉnh hai lần; đợt đã ghi sổ trả kết quả cũ.
   */
  async post(actor: InventoryActor, key: string): Promise<StocktakePostResult> {
    requireApprover(actor);
    const session = await this.get(actor, key);
    if (session.status === 'POSTED') {
      const document = session.documentId
        ? await this.documents.get(actor.tenantId, session.documentId)
        : null;
      return { session, document: document ?? undefined };
    }
    assertStocktakeTransition(session, 'post');

    const lines = await this.stocktakes.lines(actor.tenantId, session.id);
    const adjustments = buildAdjustmentLines(session.code, lines);

    let documentId: string | undefined;
    let document: StocktakePostResult['document'];
    if (adjustments.length > 0) {
      const drafts: StockDocumentLineDraft[] = adjustments.map((line) => ({
        materialCode: line.materialCode,
        quantity: line.quantity,
        direction: line.direction,
        unitCost: line.unitCost,
        lot: line.lotNo ? { lotNo: line.lotNo } : undefined,
        serials: line.serials,
        note: line.note,
      }));
      const posted = await this.documents.createAndPost(
        actor.tenantId,
        {
          docType: 'ADJUSTMENT',
          warehouseCode: session.warehouseCode,
          sourceType: 'stocktake',
          sourceId: session.id,
          idempotencyKey: `stocktake:${session.id}`,
          note: `Cân kho đợt kiểm kê ${session.code}`,
          createdBy: actor.userId,
          lines: drafts,
        },
        actor.userId,
      );
      document = posted.document;
      documentId = posted.document.id;
    }

    const updated = await this.stocktakes.markPosted(
      actor.tenantId,
      session.id,
      { documentId, actorId: actor.userId },
      (current) => {
        // Hai người ghi sổ cùng lúc: người sau thấy đợt đã Đã ghi sổ thì trả kết quả, không báo lỗi.
        if (current.status !== 'POSTED') assertStocktakeTransition(current, 'post');
      },
    );
    return { session: updated, document };
  }

  private async allowSelfApproval(tenantId: string): Promise<boolean> {
    const stored = await this.inventory.settings.get(tenantId, 'documents.approval');
    const value = stored
      ? normalizeInventorySetting('documents.approval', stored.value)
      : INVENTORY_SETTINGS_DEFAULTS['documents.approval'];
    return value.allowSelfApproval;
  }
}

function requireCreator(actor: InventoryActor): void {
  if (!(actor.canCreateStocktake ?? actor.canManage)) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền lập và kiểm đếm đợt kiểm kê.', 403);
  }
}

function requireApprover(actor: InventoryActor): void {
  if (!(actor.canApproveStocktake ?? actor.canManage)) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền duyệt và ghi sổ kiểm kê kho.', 403);
  }
}

function cleanList(values: readonly string[] | undefined, max: number): string[] {
  if (!values) return [];
  const cleaned = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (cleaned.length > max) {
    throw new InventoryError('VALIDATION', `Danh sách tối đa ${max} mục.`);
  }
  return cleaned;
}

function normalizeUpdates(input: readonly UpdateStocktakeLineInput[] | undefined): UpdateStocktakeLineInput[] {
  // Array.isArray làm mất kiểu phần tử (thành any), nên ép lại ngay sau khi kiểm.
  const lines: readonly UpdateStocktakeLineInput[] = Array.isArray(input) ? input : [];
  if (lines.length === 0) {
    throw new InventoryError('VALIDATION', 'Chưa có dòng kiểm kê nào để lưu.');
  }
  if (lines.length > MAX_UPDATES) {
    throw new InventoryError('VALIDATION', `Mỗi lần lưu tối đa ${MAX_UPDATES} dòng.`);
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const label = `Dòng ${index + 1}`;
    if (!line?.lineId || !UUID_PATTERN.test(line.lineId)) {
      throw new InventoryError('VALIDATION', `${label}: mã dòng kiểm kê không hợp lệ.`);
    }
    if (seen.has(line.lineId)) {
      throw new InventoryError('VALIDATION', `${label}: dòng kiểm kê bị lặp.`);
    }
    seen.add(line.lineId);

    const lotAllocations = line.lotAllocations?.map((lot) => {
      const lotNumber = String(lot?.lotNumber ?? '').trim();
      if (!lotNumber) throw new InventoryError('VALIDATION', `${label}: số lô không được để trống.`);
      return {
        lotNumber,
        systemQty: requireCountedQuantity(Number(lot.systemQty), `${label}, lô ${lotNumber}`),
        actualQty: requireCountedQuantity(Number(lot.actualQty), `${label}, lô ${lotNumber}`),
        expiryDate: lot.expiryDate || undefined,
      };
    });
    const serialAllocations = line.serialAllocations?.map((serial) => {
      const serialNumber = String(serial?.serialNumber ?? '').trim();
      if (!serialNumber) throw new InventoryError('VALIDATION', `${label}: số serial không được để trống.`);
      if (!SERIAL_STATUSES.includes(serial.status)) {
        throw new InventoryError('VALIDATION', `${label}, serial ${serialNumber}: trạng thái không hợp lệ.`);
      }
      return { serialNumber, status: serial.status };
    });

    // Số đếm chốt suy từ chi tiết lô, serial khi dòng không gửi sẵn (ngăn kiểm kê Lô/Serial).
    let actualQuantity =
      line.actualQuantity === undefined || line.actualQuantity === null
        ? undefined
        : requireCountedQuantity(line.actualQuantity, label);
    if (actualQuantity === undefined && lotAllocations?.length) {
      actualQuantity = round3(lotAllocations.reduce((sum, lot) => sum + lot.actualQty, 0));
    }
    if (actualQuantity === undefined && serialAllocations?.length) {
      actualQuantity = serialAllocations.filter((item) => item.status !== 'MISSING').length;
    }

    const reason = line.reason?.trim();
    if (reason && reason.length > 1000) {
      throw new InventoryError('VALIDATION', `${label}: lý do tối đa 1000 ký tự.`);
    }
    return {
      lineId: line.lineId,
      countRound1: optionalCount(line.countRound1, `${label}, đếm lần 1`),
      countRound2: optionalCount(line.countRound2, `${label}, đếm lần 2`),
      actualQuantity,
      reason: line.reason === undefined ? undefined : (reason ?? ''),
      note: line.note === undefined ? undefined : line.note.trim(),
      lotAllocations,
      serialAllocations,
    };
  });
}

function optionalCount(value: number | undefined, label: string): number | undefined {
  return value === undefined || value === null ? undefined : requireCountedQuantity(value, label);
}
