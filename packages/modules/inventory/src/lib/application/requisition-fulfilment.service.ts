import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROCEDURE_REQUISITION_SOURCE_TYPE,
  procedureRequisitionKey,
  type FulfilRequisitionRequest,
  type FulfilRequisitionResult,
  type RequisitionFulfilmentDocument,
  type RequisitionListItem,
  type RequisitionListResponse,
  type RequisitionStatusEntry,
  type RequisitionStatusResponse,
} from '@enterprise-platform/contracts-inventory';
import {
  DocumentIdempotencyConflictError,
  InsufficientAvailableStockError,
  InsufficientStockError,
  InventoryError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import { assertSerializedLine } from '../domain/stock-document-policy.js';
import { assertSerialsUniqueAcrossLines, normalizeLineSerials } from '../domain/traceability-policy.js';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import { INVENTORY_STORE, type InventoryStore } from './inventory-store.port.js';
import {
  PROCEDURE_INSTANCE_READER,
  type ProcedureInstanceReader,
} from './procedure-instance-reader.port.js';
import {
  STOCK_DOCUMENT_STORE,
  type IdempotentDocumentRef,
  type StockDocumentStore,
} from './stock-document-store.port.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mã yêu cầu là mã hồ sơ Quy trình; giới hạn để khoá con `:install:<i>/<n>` vẫn vừa 200 ký tự. */
const ORDER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/;
const MAX_LINES = 200;
const MAX_STATUS_CODES = 200;
/** Hồ sơ yêu cầu đã đóng ở Quy trình: không còn gì để cấp, không hiện cho thủ kho. */
const CLOSED_PROCEDURE_STATUSES = new Set(['cancelled', 'rejected', 'reversed']);

interface NormalizedLine {
  readonly materialCode: string;
  readonly quantity: number;
  readonly serials?: string[];
}

/** Khoá chứng từ lắp của dòng `index` (từ 0) trong yêu cầu `total` dòng. */
export function requisitionInstallKey(orderCode: string, index: number, total: number): string {
  return `${procedureRequisitionKey(orderCode)}:install:${index + 1}/${total}`;
}

/**
 * Trạng thái cấp của một yêu cầu, suy từ các chứng từ mang khoá của nó. Xuất
 * tiêu hao: một chứng từ đúng khoá gốc. Lắp thiết bị: mỗi dòng một chứng từ khoá
 * `<gốc>:install:<i>/<n>`; đủ n chứng từ đã ghi sổ mới là đã cấp.
 */
export function requisitionStatus(
  orderCode: string,
  documents: readonly IdempotentDocumentRef[],
): RequisitionStatusEntry {
  const base = procedureRequisitionKey(orderCode);
  const posted = documents.filter((document) => document.status === 'POSTED');
  const issue = posted.find((document) => document.idempotencyKey === base);
  if (issue) {
    return { orderCode, status: 'FULFILLED', documentCode: issue.code, documentCodes: [issue.code] };
  }
  const installs = posted.filter((document) => document.idempotencyKey.startsWith(`${base}:install:`));
  if (!installs.length) return { orderCode, status: 'OPEN', documentCodes: [] };
  const total = Math.max(
    ...installs.map((document) => Number(/\/(\d+)$/.exec(document.idempotencyKey)?.[1] ?? 0)),
  );
  const codes = installs.map((document) => document.code);
  return {
    orderCode,
    status: new Set(installs.map((document) => document.idempotencyKey)).size >= total ? 'FULFILLED' : 'PARTIAL',
    documentCode: codes[0],
    documentCodes: codes,
  };
}

/**
 * Cấp vật tư theo yêu cầu đã duyệt của Quy trình (ISS-BE-031).
 *
 * Thay cho việc màn Kho tự gọi `/issues` từng dòng rồi đánh dấu "đã cấp" ở
 * localStorage: server tạo MỘT chứng từ xuất nhiều dòng, khoá chống lặp theo mã
 * yêu cầu, tất cả hoặc không. Hồ sơ đã duyệt bên Quy trình là căn cứ nên ghi sổ
 * thẳng (nguồn miễn `procedure_requisition`, Q4-1), sau khi hỏi lại Quy trình qua
 * API nội bộ rằng hồ sơ còn, đúng mã và đã hoàn thành.
 */
@Injectable()
export class RequisitionFulfilmentService {
  constructor(
    @Inject(STOCK_DOCUMENT_STORE) private readonly documents: StockDocumentStore,
    @Inject(INVENTORY_STORE) private readonly store: InventoryStore,
    private readonly inventory: InventoryApplication,
    @Inject(PROCEDURE_INSTANCE_READER) private readonly procedures: ProcedureInstanceReader,
  ) {}

  async status(actor: InventoryActor, codes: readonly string[]): Promise<RequisitionStatusResponse> {
    const wanted = [...new Set(codes.map((code) => code?.trim()).filter((code): code is string => Boolean(code)))];
    if (wanted.length > MAX_STATUS_CODES) {
      throw new InventoryError('VALIDATION', `Hỏi tối đa ${MAX_STATUS_CODES} mã yêu cầu mỗi lần.`);
    }
    return { items: await this.statusesOf(actor.tenantId, wanted) };
  }

  /**
   * Mọi yêu cầu cấp vật tư còn phải xử lý, cho mọi thủ kho (người có quyền xem kho):
   * Kho đọc đơn vật tư từ Quy trình bằng service token, không qua workspace của
   * người xem (workspace chỉ trả hồ sơ người đó tham gia, nên thủ kho không thấy gì).
   * Bỏ yêu cầu đã cấp đủ, hồ sơ đã huỷ, từ chối, huỷ hiệu lực hoặc không còn.
   */
  async list(actor: InventoryActor): Promise<RequisitionListResponse> {
    const orders = (await this.procedures.listIssueOrders(actor.tenantId)).filter(
      (order) => order.instanceId && !CLOSED_PROCEDURE_STATUSES.has(order.instanceStatus ?? ''),
    );
    const statuses = new Map(
      (await this.statusesOf(actor.tenantId, orders.map((order) => order.orderCode))).map((entry) => [
        entry.orderCode,
        entry,
      ]),
    );
    const items: RequisitionListItem[] = [];
    for (const order of orders) {
      const fulfilment: RequisitionStatusEntry = statuses.get(order.orderCode) ?? {
        orderCode: order.orderCode,
        status: 'OPEN',
        documentCodes: [],
      };
      if (fulfilment.status === 'FULFILLED') continue;
      items.push({
        orderCode: order.orderCode,
        instanceId: order.instanceId,
        title: order.instanceTitle ?? `Yêu cầu cấp vật tư từ ${order.parentCode}`,
        procedureStatus: order.instanceStatus ?? 'running',
        createdAt: order.createdAt,
        parentInstanceId: order.parentInstanceId,
        parentCode: order.parentCode,
        ...(order.assetCode ? { assetCode: order.assetCode } : {}),
        lines: order.lines.map((line) => ({
          materialCode: line.materialCode,
          quantity: line.quantity,
          ...(line.materialName ? { materialName: line.materialName } : {}),
          ...(line.unit ? { unit: line.unit } : {}),
        })),
        fulfilment,
      });
    }
    return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }

  /** Trạng thái cấp theo mã, đọc từng lô `MAX_STATUS_CODES` mã. */
  private async statusesOf(tenantId: string, codes: readonly string[]): Promise<RequisitionStatusEntry[]> {
    const wanted = [...new Set(codes)];
    const valid = wanted.filter((code) => ORDER_CODE_PATTERN.test(code));
    const found: IdempotentDocumentRef[] = [];
    for (let start = 0; start < valid.length; start += MAX_STATUS_CODES) {
      found.push(
        ...(await this.documents.findByIdempotencyPrefixes(
          tenantId,
          valid.slice(start, start + MAX_STATUS_CODES).map((code) => procedureRequisitionKey(code)),
        )),
      );
    }
    return wanted.map((code) => {
      const base = procedureRequisitionKey(code);
      return requisitionStatus(
        code,
        found.filter((document) => document.idempotencyKey === base || document.idempotencyKey.startsWith(`${base}:`)),
      );
    });
  }

  async fulfil(
    actor: InventoryActor,
    orderCodeInput: string,
    input: FulfilRequisitionRequest,
  ): Promise<FulfilRequisitionResult> {
    if (!(actor.canWriteTransactions ?? actor.canManage)) {
      throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền ghi phát sinh tồn kho.', 403);
    }
    const orderCode = orderCodeInput?.trim() ?? '';
    if (!ORDER_CODE_PATTERN.test(orderCode)) {
      throw new InventoryError('VALIDATION', 'Mã yêu cầu cấp vật tư không hợp lệ.');
    }
    const request = normalizeRequest(input);
    const mode = request.assetCode ? 'INSTALL' : 'ISSUE';
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          orderCode,
          instanceId: request.instanceId,
          warehouseCode: request.warehouseCode,
          assetCode: request.assetCode ?? null,
          lines: request.lines.map((line) => [line.materialCode, line.quantity, line.serials ?? []]),
        }),
      )
      .digest('hex');
    const base = procedureRequisitionKey(orderCode);

    // Gọi lại cùng mã: kiểm nội dung trước, rồi trả chứng từ cũ mà không ghi gì thêm.
    const existing = await this.documents.findByIdempotencyPrefixes(actor.tenantId, [base]);
    const installKeys = request.lines.map((_, index) => requisitionInstallKey(orderCode, index, request.lines.length));
    if (existing.length) {
      const expectedKeys = new Set(mode === 'ISSUE' ? [base] : installKeys);
      const foreign = existing.some(
        (document) => !expectedKeys.has(document.idempotencyKey) || document.requestHash !== requestHash,
      );
      if (foreign) throw new DocumentIdempotencyConflictError(base);
      const done = requisitionStatus(orderCode, existing);
      if (done.status === 'FULFILLED') {
        return this.result(orderCode, request.instanceId, mode, existing, true);
      }
    }

    await this.assertApprovedInstance(actor, orderCode, request.instanceId);
    if (!(await this.store.warehouse.findByCode(actor.tenantId, request.warehouseCode))) {
      throw new WarehouseNotFoundError(request.warehouseCode);
    }
    await this.assertSerials(actor, request.lines);
    const postedKeys = new Set(
      existing.filter((document) => document.status === 'POSTED').map((document) => document.idempotencyKey),
    );
    // Kiểm đủ tồn mọi dòng (còn phải cấp) trước khi ghi dòng nào: một dòng thiếu là không ghi gì.
    await this.assertEnoughStock(
      actor,
      request.warehouseCode,
      request.lines.filter((_, index) => mode === 'ISSUE' || !postedKeys.has(installKeys[index])),
    );

    if (mode === 'ISSUE') {
      const note = request.note ?? `Xuất cấp vật tư theo yêu cầu ${orderCode} của Quy trình.`;
      try {
        await this.documents.createAndPost(
          actor.tenantId,
          {
            docType: 'ISSUE_PROJECT',
            warehouseCode: request.warehouseCode,
            sourceType: PROCEDURE_REQUISITION_SOURCE_TYPE,
            sourceId: request.instanceId,
            idempotencyKey: base,
            requestHash,
            note,
            createdBy: actor.userId,
            lines: request.lines.map((line) => ({
              materialCode: line.materialCode,
              quantity: line.quantity,
              direction: 'OUT' as const,
              unitCost: 0,
              ...(line.serials ? { serials: line.serials } : {}),
            })),
          },
          actor.userId,
          { origin: 'procedure_requisition' },
        );
      } catch (error) {
        if (error instanceof InsufficientAvailableStockError) {
          throw new InsufficientStockError(error.materialCode, error.requested, error.available, error.warehouseCode);
        }
        throw error;
      }
    } else {
      // Lắp vào thiết bị đi qua luồng lắp sẵn có (mỗi dòng một đơn vị lắp trên cây
      // tài sản), cùng tiền tố khoá; dòng đã lắp thì bỏ qua, gọi lại để cấp nốt.
      for (const [index, line] of request.lines.entries()) {
        if (postedKeys.has(installKeys[index])) continue;
        await this.inventory.installItemForRequisition(
          actor,
          line.materialCode,
          {
            warehouseCode: request.warehouseCode,
            parentCode: request.assetCode,
            quantity: line.quantity,
            serials: line.serials,
            note: request.note ?? `Lắp ${line.materialCode} vào ${request.assetCode} theo yêu cầu ${orderCode} của Quy trình.`,
          },
          { key: installKeys[index], requestHash },
        );
      }
    }

    const after = await this.documents.findByIdempotencyPrefixes(actor.tenantId, [base]);
    return this.result(orderCode, request.instanceId, mode, after, false);
  }

  private result(
    orderCode: string,
    instanceId: string,
    mode: 'ISSUE' | 'INSTALL',
    found: readonly IdempotentDocumentRef[],
    replayed: boolean,
  ): FulfilRequisitionResult {
    const status = requisitionStatus(orderCode, found);
    const documents: RequisitionFulfilmentDocument[] = found.map((document) => ({
      id: document.id,
      code: document.code,
      status: document.status,
    }));
    return {
      orderCode,
      instanceId,
      mode,
      status: status.status,
      documentCode: status.documentCode ?? documents[0]?.code ?? '',
      documents,
      replayed,
    };
  }

  /** Hồ sơ Quy trình phải còn, đúng mã yêu cầu và đã duyệt xong (hoàn thành). */
  private async assertApprovedInstance(actor: InventoryActor, orderCode: string, instanceId: string): Promise<void> {
    const state = await this.procedures.instanceState(actor.tenantId, instanceId);
    if (!state) {
      throw new InventoryError('PROCEDURE_INSTANCE_NOT_FOUND', `Không tìm thấy hồ sơ Quy trình của yêu cầu ${orderCode}.`, 404);
    }
    if (state.instanceCode !== orderCode) {
      throw new InventoryError(
        'PROCEDURE_INSTANCE_MISMATCH',
        `Hồ sơ Quy trình đã chọn không phải yêu cầu ${orderCode}.`,
        409,
      );
    }
    if (state.status === 'completed') return;
    const reason: Record<string, string> = {
      running: `Yêu cầu ${orderCode} chưa được duyệt xong ở Quy trình nên chưa cấp vật tư được.`,
      cancelled: `Yêu cầu ${orderCode} đã bị huỷ ở Quy trình nên không cấp vật tư được.`,
      rejected: `Yêu cầu ${orderCode} đã bị từ chối ở Quy trình nên không cấp vật tư được.`,
      reversed: `Yêu cầu ${orderCode} đã bị huỷ hiệu lực ở Quy trình nên không cấp vật tư được.`,
    };
    throw new InventoryError(
      state.status === 'running' ? 'PROCEDURE_NOT_APPROVED' : 'PROCEDURE_CLOSED',
      reason[state.status] ?? `Yêu cầu ${orderCode} không ở trạng thái đã duyệt nên không cấp vật tư được.`,
      409,
    );
  }

  /** Hàng theo dõi serial phải gửi đủ serial (ISS-BE-005); báo sớm trước khi ghi gì. */
  private async assertSerials(actor: InventoryActor, lines: readonly NormalizedLine[]): Promise<void> {
    for (const [index, line] of lines.entries()) {
      const material = await this.store.material.findAnyByCode(actor.tenantId, line.materialCode);
      if (!material) throw new MaterialNotFoundError(line.materialCode);
      if (material.isSerialized) {
        assertSerializedLine(
          { lineNo: index + 1, materialCode: line.materialCode, quantity: line.quantity },
          line.serials?.length ?? 0,
          'request',
        );
      } else if (line.serials) {
        throw new InventoryError(
          'VALIDATION',
          `Dòng ${index + 1}: ${line.materialCode} không theo dõi theo serial; bỏ danh sách serial.`,
        );
      }
    }
  }

  private async assertEnoughStock(
    actor: InventoryActor,
    warehouseCode: string,
    lines: readonly NormalizedLine[],
  ): Promise<void> {
    const needed = new Map<string, number>();
    for (const line of lines) needed.set(line.materialCode, (needed.get(line.materialCode) ?? 0) + line.quantity);
    const shortages: { materialCode: string; requested: number; available: number }[] = [];
    for (const [materialCode, requested] of needed) {
      const row = await this.store.inventory.findByMaterialAndWarehouse(actor.tenantId, materialCode, warehouseCode);
      const available = row?.available ?? 0;
      if (available < requested) shortages.push({ materialCode, requested, available });
    }
    if (!shortages.length) return;
    throw new InventoryError(
      'INSUFFICIENT_STOCK',
      `Kho ${warehouseCode} không đủ hàng để cấp yêu cầu, chưa ghi dòng nào: ${shortages
        .map((item) => `${item.materialCode} còn ${item.available}, cần ${item.requested}`)
        .join('; ')}.`,
      400,
      { shortages },
    );
  }
}

function normalizeRequest(input: FulfilRequisitionRequest | undefined): {
  instanceId: string;
  warehouseCode: string;
  assetCode?: string;
  note?: string;
  lines: NormalizedLine[];
} {
  const instanceId = input?.instanceId?.trim() ?? '';
  if (!input || !UUID_PATTERN.test(instanceId)) {
    throw new InventoryError('VALIDATION', 'Thiếu hoặc sai mã hồ sơ Quy trình của yêu cầu.');
  }
  const warehouseCode = input.warehouseCode?.trim();
  if (!warehouseCode) throw new InventoryError('VALIDATION', 'Phải chọn kho xuất hàng.');
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new InventoryError('VALIDATION', 'Yêu cầu phải có ít nhất một dòng vật tư cần cấp.');
  }
  if (input.lines.length > MAX_LINES) {
    throw new InventoryError('VALIDATION', `Một yêu cầu cấp tối đa ${MAX_LINES} dòng.`);
  }
  const lines = input.lines.map((line, index) => {
    const lineNo = index + 1;
    const materialCode = line?.materialCode?.trim();
    if (!materialCode) throw new InventoryError('VALIDATION', `Dòng ${lineNo}: thiếu mã vật tư.`);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: số lượng phải là số dương.`);
    }
    const serials = normalizeLineSerials(line.serials, quantity, lineNo);
    return { materialCode, quantity, ...(serials ? { serials } : {}) };
  });
  assertSerialsUniqueAcrossLines(lines);
  return {
    instanceId,
    warehouseCode,
    assetCode: input.assetCode?.trim() || undefined,
    note: input.note?.trim() || undefined,
    lines,
  };
}
