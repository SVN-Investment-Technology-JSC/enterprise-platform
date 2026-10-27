import { Inject, Injectable } from '@nestjs/common';
import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  type CreateStockDocumentRequest,
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
  return lines.map((line, index) => {
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
    return {
      materialCode,
      quantity,
      direction: resolveLineDirection(docType, line.direction, lineNo),
      unitCost,
      reservationId,
      note: line.note?.trim() || undefined,
    };
  });
}
