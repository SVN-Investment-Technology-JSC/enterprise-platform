import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  type CreateStockDocumentRequest,
  type InternalIssueRequest,
  type InternalReturnReceiptRequest,
  type InternalStockDocumentResult,
  type PostedStockDocument,
  type RejectStockDocumentRequest,
  type StockDocument,
  type StockDocumentLineInput,
  type StockDocumentListQuery,
  type StockDocumentPage,
  type StockDocumentType,
  type UpdateStockDocumentRequest,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError, StockDocumentNotFoundError } from '../domain/inventory.error.js';
import {
  assertSerialsUniqueAcrossLines,
  normalizeLineSerials,
  normalizeLotInput,
  normalizeLotNo,
} from '../domain/traceability-policy.js';
import {
  assertEditable,
  assertNotSelfApproval,
  assertReversible,
  assertTransition,
  isIssueType,
  resolveLineDirection,
} from '../domain/stock-document-policy.js';
import type { InventoryActor } from './inventory.application.js';
import { INVENTORY_STORE, type InventoryStore } from './inventory-store.port.js';
import { INVENTORY_SETTINGS_DEFAULTS, normalizeInventorySetting } from './inventory-settings.js';
import {
  STOCK_DOCUMENT_STORE,
  type StockDocumentLineDraft,
  type StockDocumentStore,
} from './stock-document-store.port.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 500;

/**
 * Chứng từ kho: lập, sửa nháp, gửi duyệt, duyệt, từ chối, ghi sổ, huỷ, đảo.
 *
 * Quy tắc trạng thái nằm ở `stock-document-policy`; service chỉ kiểm quyền,
 * chuẩn hoá input rồi giao cho store chạy quyết định trên bản ghi đã khoá.
 */
@Injectable()
export class StockDocumentService {
  constructor(
    @Inject(STOCK_DOCUMENT_STORE) private readonly documents: StockDocumentStore,
    @Inject(INVENTORY_STORE) private readonly inventory: InventoryStore,
  ) {}

  async list(actor: InventoryActor, query: StockDocumentListQuery): Promise<StockDocumentPage> {
    if (query.docType && !STOCK_DOCUMENT_TYPES.includes(query.docType)) {
      throw new InventoryError('VALIDATION', 'Loại chứng từ không hợp lệ.');
    }
    if (query.status && !STOCK_DOCUMENT_STATUSES.includes(query.status)) {
      throw new InventoryError('VALIDATION', 'Trạng thái chứng từ không hợp lệ.');
    }
    return this.documents.list(actor.tenantId, query);
  }

  async get(actor: InventoryActor, key: string): Promise<StockDocument> {
    const document = await this.documents.get(actor.tenantId, key);
    if (!document) throw new StockDocumentNotFoundError(key);
    return document;
  }

  async create(actor: InventoryActor, input: CreateStockDocumentRequest): Promise<StockDocument> {
    requireStockWriter(actor);
    const docType = input?.docType;
    if (!docType || !STOCK_DOCUMENT_TYPES.includes(docType)) {
      throw new InventoryError('VALIDATION', 'Loại chứng từ không hợp lệ.');
    }
    const warehouseCode = requireCode(input.warehouseCode, 'Kho không được để trống.');
    const targetWarehouseCode = input.targetWarehouseCode?.trim() || undefined;
    requireTarget(docType, warehouseCode, targetWarehouseCode);
    const sourceId = input.sourceId?.trim() || undefined;
    if (sourceId && !UUID_PATTERN.test(sourceId)) {
      throw new InventoryError('VALIDATION', 'Mã chứng từ nguồn không hợp lệ.');
    }
    return this.documents.create(actor.tenantId, {
      docType,
      warehouseCode,
      targetWarehouseCode,
      sourceType: input.sourceType?.trim() || undefined,
      sourceId,
      idempotencyKey: input.idempotencyKey?.trim() || undefined,
      documentDate: normalizeDate(input.documentDate),
      note: input.note?.trim() || undefined,
      createdBy: actor.userId,
      lines: normalizeLines(docType, input.lines),
    });
  }

  async update(
    actor: InventoryActor,
    key: string,
    input: UpdateStockDocumentRequest,
  ): Promise<StockDocument> {
    requireStockWriter(actor);
    const result = await this.documents.change(actor.tenantId, key, (current) => {
      assertEditable(current);
      const warehouseCode = input?.warehouseCode?.trim() || undefined;
      const targetWarehouseCode =
        input?.targetWarehouseCode !== undefined
          ? input.targetWarehouseCode.trim()
          : undefined;
      requireTarget(
        current.docType,
        warehouseCode ?? current.warehouseCode,
        targetWarehouseCode !== undefined
          ? targetWarehouseCode || undefined
          : current.targetWarehouseCode,
      );
      return {
        kind: 'update',
        patch: {
          warehouseCode,
          targetWarehouseCode,
          documentDate: normalizeDate(input?.documentDate),
          note: input?.note !== undefined ? input.note.trim() : undefined,
          lines: input?.lines ? normalizeLines(current.docType, input.lines) : undefined,
        },
      };
    });
    return result.document;
  }

  async submit(actor: InventoryActor, key: string): Promise<StockDocument> {
    requireStockWriter(actor);
    const result = await this.documents.change(actor.tenantId, key, (current) => {
      assertTransition(current, 'PENDING');
      return { kind: 'transition', to: 'PENDING', actorId: actor.userId };
    });
    return result.document;
  }

  async approve(actor: InventoryActor, key: string): Promise<StockDocument> {
    requireApprover(actor);
    const allowSelfApproval = await this.allowSelfApproval(actor.tenantId);
    const result = await this.documents.change(actor.tenantId, key, (current) => {
      assertTransition(current, 'APPROVED');
      assertNotSelfApproval(current, actor.userId, allowSelfApproval);
      return { kind: 'transition', to: 'APPROVED', actorId: actor.userId };
    });
    return result.document;
  }

  async reject(
    actor: InventoryActor,
    key: string,
    input: RejectStockDocumentRequest,
  ): Promise<StockDocument> {
    requireApprover(actor);
    const reason = input?.reason?.trim();
    if (!reason) throw new InventoryError('VALIDATION', 'Phải ghi lý do từ chối.');
    const result = await this.documents.change(actor.tenantId, key, (current) => {
      assertTransition(current, 'REJECTED');
      return { kind: 'transition', to: 'REJECTED', actorId: actor.userId, reason };
    });
    return result.document;
  }

  async post(actor: InventoryActor, key: string): Promise<PostedStockDocument> {
    requireStockWriter(actor);
    return this.documents.change(actor.tenantId, key, (current) => {
      assertTransition(current, 'POSTED');
      return { kind: 'post', actorId: actor.userId };
    });
  }

  async cancel(actor: InventoryActor, key: string): Promise<StockDocument> {
    requireStockWriter(actor);
    const result = await this.documents.change(actor.tenantId, key, (current) => {
      assertTransition(current, 'CANCELLED');
      return { kind: 'transition', to: 'CANCELLED', actorId: actor.userId };
    });
    return result.document;
  }

  /** Sửa sai chứng từ đã ghi sổ: chứng từ đảo tham chiếu gốc, ghi sổ ngay; gốc giữ nguyên. */
  async reverse(actor: InventoryActor, key: string): Promise<PostedStockDocument> {
    requireStockWriter(actor);
    return this.documents.reverse(actor.tenantId, key, actor.userId, assertReversible);
  }

  /**
   * Yêu cầu xuất từ đợt giao hàng hoặc bảo hành (T1-25): chứng từ NHÁP, dòng gắn
   * giữ hàng, nguồn là đơn bán hoặc yêu cầu bảo hành. Thủ kho chọn serial, lô rồi
   * ghi sổ. Cùng khoá cùng nội dung trả chứng từ đã tạo (trạng thái hiện tại),
   * khác nội dung thì 409.
   */
  async createIssueRequest(
    actor: InventoryActor,
    input: InternalIssueRequest,
  ): Promise<InternalStockDocumentResult> {
    requireStockWriter(actor);
    const docType = input?.docType ?? 'ISSUE_SALES';
    if (docType !== 'ISSUE_SALES' && docType !== 'ISSUE_WARRANTY') {
      throw new InventoryError('VALIDATION', 'Yêu cầu xuất chỉ nhận loại xuất bán hoặc xuất bảo hành.');
    }
    const header = normalizeInternalHeader(input);
    const lines = normalizeLines(
      docType,
      (input.lines ?? []).map((line) => ({
        materialCode: line?.materialCode,
        quantity: line?.quantity,
        reservationId: line?.reservationId,
        serials: line?.serials,
        lot: line?.lotNo ? { lotNo: line.lotNo } : undefined,
        note: line?.note,
      })),
    );
    const requestHash = internalRequestHash([docType, header, lines]);
    const document = await this.documents.create(actor.tenantId, {
      docType,
      ...header,
      requestHash,
      createdBy: actor.userId,
      lines,
    });
    return internalResult(document);
  }

  /**
   * Nhập trả hàng bán vào kho cách ly (T1-26): tạo và ghi sổ ngay chứng từ
   * RECEIPT_SALES_RETURN. Hàng nhận về Chờ kiểm định, không tính khả dụng:
   * serial nhận trạng thái Chờ kiểm định; dòng không serial vào một lô mới riêng
   * của lần trả (`TH-...`, chép hạn dùng của lô gốc nếu có) ở trạng thái Chờ kiểm
   * định, để người kiểm định đổi trạng thái bằng API chất lượng lô sẵn có.
   */
  async receiveReturn(
    actor: InventoryActor,
    input: InternalReturnReceiptRequest,
  ): Promise<InternalStockDocumentResult> {
    requireStockWriter(actor);
    const header = normalizeInternalHeader(input);
    const rawLines = (input.lines ?? []).map((line) => {
      const sourceLineId = line?.sourceLineId?.trim() || undefined;
      return {
        materialCode: line?.materialCode,
        quantity: line?.quantity,
        serials: line?.serials,
        sourceLineId,
        note: line?.note,
        originalLotNo: line?.lotNo ? normalizeLotNo(line.lotNo) : undefined,
      };
    });
    const normalized = normalizeLines('RECEIPT_SALES_RETURN', rawLines);
    const requestHash = internalRequestHash([
      'RECEIPT_SALES_RETURN',
      header,
      normalized,
      rawLines.map((line) => line.originalLotNo ?? null),
    ]);
    const lines = normalized.map((line, index) => {
      if (line.serials?.length) return line;
      const originalLotNo = rawLines[index].originalLotNo;
      return {
        ...line,
        lot: { lotNo: `TH-${requestHash.slice(0, 10).toUpperCase()}-${index + 1}` },
        newLotQuality: 'PENDING_INSPECTION' as const,
        copyLotFrom: originalLotNo,
      };
    });
    const posted = await this.documents.createAndPost(
      actor.tenantId,
      {
        docType: 'RECEIPT_SALES_RETURN',
        ...header,
        requestHash,
        createdBy: actor.userId,
        lines,
      },
      actor.userId,
      { inboundQuality: 'PENDING_INSPECTION' },
    );
    return internalResult(posted.document);
  }

  private async allowSelfApproval(tenantId: string): Promise<boolean> {
    const stored = await this.inventory.settings.get(tenantId, 'documents.approval');
    const value = stored
      ? normalizeInventorySetting('documents.approval', stored.value)
      : INVENTORY_SETTINGS_DEFAULTS['documents.approval'];
    return value.allowSelfApproval;
  }
}

function requireStockWriter(actor: InventoryActor): void {
  if (!(actor.canWriteTransactions ?? actor.canManage)) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền ghi phát sinh tồn kho.', 403);
  }
}

function requireApprover(actor: InventoryActor): void {
  if (!(actor.canApproveDocuments ?? actor.canManage)) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền duyệt chứng từ kho.', 403);
  }
}

function requireCode(value: string | undefined, message: string): string {
  const code = value?.trim();
  if (!code) throw new InventoryError('VALIDATION', message);
  return code;
}

function requireTarget(
  docType: StockDocumentType,
  warehouseCode: string,
  targetWarehouseCode: string | undefined,
): void {
  if (docType !== 'TRANSFER') return;
  if (!targetWarehouseCode) {
    throw new InventoryError('VALIDATION', 'Chứng từ điều chuyển phải có kho đến.');
  }
  if (targetWarehouseCode === warehouseCode) {
    throw new InventoryError('VALIDATION', 'Kho nguồn và kho đích phải khác nhau.');
  }
}

function normalizeDate(value: string | undefined): string | undefined {
  const date = value?.trim();
  if (!date) return undefined;
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    throw new InventoryError('VALIDATION', 'Ngày chứng từ phải có dạng YYYY-MM-DD.');
  }
  return date;
}

/** Phần đầu chung của hai API nội bộ: khoá chống lặp, kho, nguồn bắt buộc. */
function normalizeInternalHeader(input: {
  readonly idempotencyKey?: string;
  readonly warehouseCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly documentDate?: string;
  readonly note?: string;
}) {
  const idempotencyKey = input?.idempotencyKey?.trim();
  if (!idempotencyKey) throw new InventoryError('VALIDATION', 'Thiếu khoá chống lặp (idempotencyKey).');
  if (idempotencyKey.length > 200) {
    throw new InventoryError('VALIDATION', 'Khoá chống lặp dài tối đa 200 ký tự.');
  }
  const sourceType = input.sourceType?.trim();
  if (!sourceType) throw new InventoryError('VALIDATION', 'Thiếu loại chứng từ nguồn (sourceType).');
  const sourceId = input.sourceId?.trim();
  if (!sourceId || !UUID_PATTERN.test(sourceId)) {
    throw new InventoryError('VALIDATION', 'Mã chứng từ nguồn không hợp lệ.');
  }
  return {
    idempotencyKey,
    warehouseCode: requireCode(input.warehouseCode, 'Kho không được để trống.'),
    sourceType,
    sourceId,
    documentDate: normalizeDate(input.documentDate),
    note: input.note?.trim() || undefined,
  };
}

function internalRequestHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function internalResult(document: StockDocument): InternalStockDocumentResult {
  return {
    documentId: document.id,
    documentCode: document.code,
    docType: document.docType,
    status: document.status,
    document,
  };
}

function normalizeLines(
  docType: StockDocumentType,
  lines: readonly StockDocumentLineInput[] | undefined,
): StockDocumentLineDraft[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new InventoryError('VALIDATION', 'Chứng từ phải có ít nhất một dòng.');
  }
  if (lines.length > MAX_LINES) {
    throw new InventoryError('VALIDATION', `Chứng từ có tối đa ${MAX_LINES} dòng.`);
  }
  const normalized = lines.map((line, index) => {
    const lineNo = index + 1;
    const materialCode = requireCode(line?.materialCode, `Dòng ${lineNo}: thiếu mã vật tư.`);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: số lượng phải là số dương.`);
    }
    const unitCost = line.unitCost === undefined || line.unitCost === null ? 0 : Number(line.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: đơn giá không hợp lệ.`);
    }
    const reservationId = line.reservationId?.trim() || undefined;
    if (reservationId && !UUID_PATTERN.test(reservationId)) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: mã giữ hàng không hợp lệ.`);
    }
    if (reservationId && !isIssueType(docType)) {
      throw new InventoryError(
        'VALIDATION',
        `Dòng ${lineNo}: chỉ dòng của chứng từ xuất mới trừ vào giữ hàng.`,
      );
    }
    const direction = resolveLineDirection(docType, line.direction, lineNo);
    const serials = normalizeLineSerials(line.serials, quantity, lineNo);
    const lot = normalizeLotInput(line.lot, direction, lineNo);
    if (serials && lot) {
      throw new InventoryError(
        'VALIDATION',
        `Dòng ${lineNo}: một dòng chỉ ghi lô hoặc serial, không ghi cả hai.`,
      );
    }
    const sourceLineId = line.sourceLineId?.trim() || undefined;
    if (sourceLineId && !UUID_PATTERN.test(sourceLineId)) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: mã dòng xuất gốc không hợp lệ.`);
    }
    if (sourceLineId && docType !== 'RECEIPT_SALES_RETURN') {
      throw new InventoryError(
        'VALIDATION',
        `Dòng ${lineNo}: chỉ dòng nhập trả hàng bán mới tham chiếu dòng xuất gốc.`,
      );
    }
    return {
      materialCode,
      quantity,
      direction,
      unitCost,
      reservationId,
      serials,
      lot,
      sourceLineId,
      note: line.note?.trim() || undefined,
    };
  });
  assertSerialsUniqueAcrossLines(normalized);
  return normalized;
}
