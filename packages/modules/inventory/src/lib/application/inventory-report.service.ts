import { Inject, Injectable } from '@nestjs/common';
import {
  QUALITY_STATUSES,
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  STOCK_REPORT_GROUPS,
  type QualityStatus,
  type SerialStockState,
  type StockApprovalReport,
  type StockApprovalReportQuery,
  type StockDocumentStatus,
  type StockDocumentType,
  type StockMovementReport,
  type StockMovementReportQuery,
  type StockReport,
  type StockReportGroupBy,
  type StockReportQuery,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import {
  classifyMovement,
  foldMovementGroups,
  isMovementCategory,
  resolveExpiringWithinDays,
  resolveReportPaging,
  resolveReportPeriod,
} from '../domain/inventory-report.js';
import { requiresApproval, requiresApprovalWithoutSource } from '../domain/stock-document-policy.js';
import { todayInVietnam } from '../domain/traceability-policy.js';
import type { InventoryActor } from './inventory.application.js';
import {
  INVENTORY_REPORT_STORE,
  type InventoryReportStore,
  type StockReportFilter,
} from './inventory-report-store.port.js';

const SERIAL_STOCK_STATES: readonly SerialStockState[] = ['IN_STOCK', 'ISSUED', 'IN_TRANSIT', 'SCRAPPED'];
/** Loại chứng từ luôn phải qua người duyệt. */
const APPROVAL_DOC_TYPES = STOCK_DOCUMENT_TYPES.filter((docType) => requiresApproval(docType));
/** Nhập mua, xuất dự án không có chứng từ nguồn cũng phải duyệt (ISS-BE-006). */
const SOURCE_LESS_APPROVAL_DOC_TYPES = STOCK_DOCUMENT_TYPES.filter((docType) => requiresApprovalWithoutSource(docType));
/** Nguồn của lịch sử duyệt: mọi loại có thể phải qua người duyệt. */
const REPORTABLE_APPROVAL_DOC_TYPES = [...APPROVAL_DOC_TYPES, ...SOURCE_LESS_APPROVAL_DOC_TYPES];

/** Query string trả chuỗi; bỏ khoảng trắng, rỗng coi như không lọc. */
function text(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : undefined;
  return trimmed || undefined;
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  message: string,
): T | undefined {
  const trimmed = text(value);
  if (trimmed === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(trimmed)) throw new InventoryError('VALIDATION', message);
  return trimmed as T;
}

/**
 * Báo cáo kho (RPT-04, RPT-05; T7-06, T7-07). Chỉ đọc: ai có `inventory.read`
 * (guard của inventory-api) đều xem được, như màn tồn kho.
 */
@Injectable()
export class InventoryReportService {
  constructor(
    @Inject(INVENTORY_REPORT_STORE) private readonly store: InventoryReportStore,
    private readonly today: () => string = () => todayInVietnam(),
  ) {}

  /** Tồn theo kho, lô hoặc serial với bốn loại tồn và tổng của cả tập đã lọc. */
  async stock(actor: InventoryActor, query: StockReportQuery): Promise<StockReport> {
    const groupBy =
      oneOf<StockReportGroupBy>(query.groupBy, STOCK_REPORT_GROUPS, 'Kiểu báo cáo tồn không hợp lệ.') ??
      'WAREHOUSE';
    const expiringWithinDays = resolveExpiringWithinDays(query.expiringWithinDays);
    if (expiringWithinDays !== undefined && groupBy !== 'LOT') {
      throw new InventoryError('VALIDATION', 'Lọc theo hạn dùng chỉ áp dụng cho báo cáo theo lô.');
    }
    const qualityStatus = oneOf<QualityStatus>(
      query.qualityStatus,
      QUALITY_STATUSES,
      'Trạng thái chất lượng không hợp lệ.',
    );
    if (qualityStatus && groupBy === 'WAREHOUSE') {
      throw new InventoryError('VALIDATION', 'Lọc theo chất lượng chỉ áp dụng cho báo cáo theo lô hoặc serial.');
    }
    const stockState = text(query.stockState);
    const filter: StockReportFilter = {
      search: text(query.search),
      materialCode: text(query.materialCode),
      category: text(query.category),
      warehouseCode: text(query.warehouseCode),
      expiringWithinDays,
      qualityStatus,
      stockState:
        stockState === 'ALL'
          ? null
          : (oneOf(stockState, SERIAL_STOCK_STATES, 'Trạng thái serial không hợp lệ.') ?? 'IN_STOCK'),
      includeZero: String(query.includeZero) === 'true',
      today: this.today(),
    };
    const paging = resolveReportPaging(query.limit, query.offset);
    const base = { ...paging, asOf: new Date().toISOString() };
    if (groupBy === 'LOT') {
      const page = await this.store.stockByLot(actor.tenantId, filter, paging);
      return { groupBy, ...base, rows: page.rows, total: page.total, totals: page.totals };
    }
    if (groupBy === 'SERIAL') {
      const page = await this.store.stockBySerial(actor.tenantId, filter, paging);
      return { groupBy, ...base, rows: page.rows, total: page.total, totals: page.totals };
    }
    const page = await this.store.stockByWarehouse(actor.tenantId, filter, paging);
    return { groupBy, ...base, rows: page.rows, total: page.total, totals: page.totals };
  }

  /**
   * Nhập, xuất, điều chuyển, nhập trả, điều chỉnh, chứng từ đảo trong kỳ: tổng
   * theo nhóm, chi tiết theo loại chứng từ và kho, và một trang bút toán.
   */
  async movements(actor: InventoryActor, query: StockMovementReportQuery): Promise<StockMovementReport> {
    const period = resolveReportPeriod(query.fromDate, query.toDate, this.today());
    const category = text(query.category);
    if (category !== undefined && !isMovementCategory(category)) {
      throw new InventoryError('VALIDATION', 'Nhóm nhập xuất không hợp lệ.');
    }
    const filter = {
      ...period,
      warehouseCode: text(query.warehouseCode),
      docType: oneOf<StockDocumentType>(query.docType, STOCK_DOCUMENT_TYPES, 'Loại chứng từ không hợp lệ.'),
      category,
      search: text(query.search),
    };
    const paging = resolveReportPaging(query.limit, query.offset);
    const [groups, lines] = await Promise.all([
      this.store.movementGroups(actor.tenantId, filter),
      this.store.movementLines(actor.tenantId, filter, paging),
    ]);
    const folded = foldMovementGroups(
      category ? groups.filter((group) => classifyMovement(group) === category) : groups,
    );
    return {
      ...period,
      ...folded,
      lines: lines.rows.map(({ isReversal, ...line }) => ({
        ...line,
        category: classifyMovement({ docType: line.docType, isReversal, ledgerType: line.ledgerType }),
      })),
      total: lines.total,
      ...paging,
    };
  }

  /**
   * Lịch sử chứng từ phải duyệt: điều chỉnh, nhập khác, xuất khác, và nhập mua,
   * xuất dự án không có chứng từ nguồn (ISS-BE-006). Ai lập, ai duyệt, lúc nào, lý do.
   */
  async approvals(actor: InventoryActor, query: StockApprovalReportQuery): Promise<StockApprovalReport> {
    const period = resolveReportPeriod(query.fromDate, query.toDate, this.today());
    const docType = oneOf<StockDocumentType>(
      query.docType,
      REPORTABLE_APPROVAL_DOC_TYPES,
      'Loại chứng từ không phải loại cần duyệt.',
    );
    const paging = resolveReportPaging(query.limit, query.offset);
    const page = await this.store.approvals(
      actor.tenantId,
      {
        ...period,
        warehouseCode: text(query.warehouseCode),
        docTypes: docType ? APPROVAL_DOC_TYPES.filter((item) => item === docType) : APPROVAL_DOC_TYPES,
        sourceLessDocTypes: docType
          ? SOURCE_LESS_APPROVAL_DOC_TYPES.filter((item) => item === docType)
          : SOURCE_LESS_APPROVAL_DOC_TYPES,
        status: oneOf<StockDocumentStatus>(query.status, STOCK_DOCUMENT_STATUSES, 'Trạng thái chứng từ không hợp lệ.'),
      },
      paging,
    );
    return { ...period, rows: page.rows, total: page.total, ...paging };
  }
}
