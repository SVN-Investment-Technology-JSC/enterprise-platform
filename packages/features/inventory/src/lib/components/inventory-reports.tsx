'use client';

import {
  STOCK_MOVEMENT_CATEGORIES,
  type MaterialCategory,
  type QualityStatus,
  type SerialStockState,
  type StockApprovalReport,
  type StockApprovalReportRow,
  type StockDocumentStatus,
  type StockDocumentType,
  type StockMovementBreakdownRow,
  type StockMovementCategory,
  type StockMovementLine,
  type StockMovementReport,
  type StockMovementSummaryRow,
  type StockReport,
  type StockReportGroupBy,
  type StockReportLotRow,
  type StockReportSerialRow,
  type StockReportWarehouseRow,
  type Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { Table, type TableColumnsType } from 'antd';
import { FileSpreadsheet, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadApprovalReport, loadMovementReport, loadStockReport } from '../inventory-api';
import { MATERIAL_CATEGORY_LABEL, QUALITY_STATUS_LABEL, formatDateTime, formatNumber } from '../inventory-labels';
import {
  MAX_EXPORT_ROWS,
  MOVEMENT_CATEGORY_LABEL,
  SERIAL_STOCK_STATE_LABEL,
  STOCK_QUANTITY_LABEL,
  approvalReportSheet,
  downloadReportSheets,
  loadAllPages,
  movementReportSheets,
  stockReportSheet,
  todayInVietnam,
} from '../inventory-reports.model';
import { STOCK_DOCUMENT_STATUS_LABEL, STOCK_DOCUMENT_TYPE_LABEL } from '../stock-document.model';
import { DocumentStatusBadge, errorMessage } from './stock-document-parts';
import styles from '../inventory.module.scss';

type ReportView = 'WAREHOUSE' | 'LOT' | 'SERIAL' | 'MOVEMENTS' | 'APPROVALS';

const VIEWS: readonly { id: ReportView; label: string }[] = [
  { id: 'WAREHOUSE', label: 'Tồn theo kho' },
  { id: 'LOT', label: 'Tồn theo lô' },
  { id: 'SERIAL', label: 'Tồn theo serial' },
  { id: 'MOVEMENTS', label: 'Nhập xuất' },
  { id: 'APPROVALS', label: 'Lịch sử duyệt' },
];

const PAGE_SIZES = [20, 50, 100, 200];

const CATEGORY_OPTIONS = [
  { value: '', label: 'Mọi nhóm vật tư' },
  ...(Object.keys(MATERIAL_CATEGORY_LABEL) as MaterialCategory[]).map((value) => ({
    value,
    label: MATERIAL_CATEGORY_LABEL[value],
  })),
];

const QUALITY_OPTIONS = [
  { value: '', label: 'Mọi chất lượng' },
  ...(Object.keys(QUALITY_STATUS_LABEL) as QualityStatus[]).map((value) => ({
    value,
    label: QUALITY_STATUS_LABEL[value],
  })),
];

const EXPIRY_OPTIONS = [
  { value: '', label: 'Mọi hạn dùng' },
  { value: '0', label: 'Đã hết hạn' },
  { value: '30', label: 'Hết hạn trong 30 ngày' },
  { value: '60', label: 'Hết hạn trong 60 ngày' },
  { value: '90', label: 'Hết hạn trong 90 ngày' },
  { value: '180', label: 'Hết hạn trong 180 ngày' },
];

const STOCK_STATE_OPTIONS = [
  { value: 'ALL', label: 'Mọi trạng thái kho' },
  ...(Object.keys(SERIAL_STOCK_STATE_LABEL) as SerialStockState[]).map((value) => ({
    value,
    label: SERIAL_STOCK_STATE_LABEL[value],
  })),
];

const MOVEMENT_CATEGORY_OPTIONS = [
  { value: '', label: 'Mọi nhóm nhập xuất' },
  ...STOCK_MOVEMENT_CATEGORIES.map((value) => ({ value, label: MOVEMENT_CATEGORY_LABEL[value] })),
];

const DOC_TYPE_OPTIONS = [
  { value: '', label: 'Mọi loại chứng từ' },
  ...(Object.keys(STOCK_DOCUMENT_TYPE_LABEL) as StockDocumentType[]).map((value) => ({
    value,
    label: STOCK_DOCUMENT_TYPE_LABEL[value],
  })),
];

/** Ba loại chứng từ phải qua người duyệt. */
const APPROVAL_DOC_TYPES: readonly StockDocumentType[] = ['ADJUSTMENT', 'RECEIPT_OTHER', 'ISSUE_OTHER'];
const APPROVAL_TYPE_OPTIONS = [
  { value: '', label: 'Điều chỉnh, nhập khác, xuất khác' },
  ...APPROVAL_DOC_TYPES.map((value) => ({ value, label: STOCK_DOCUMENT_TYPE_LABEL[value] })),
];
const STATUS_OPTIONS = [
  { value: '', label: 'Mọi trạng thái' },
  ...(Object.keys(STOCK_DOCUMENT_STATUS_LABEL) as StockDocumentStatus[]).map((value) => ({
    value,
    label: STOCK_DOCUMENT_STATUS_LABEL[value],
  })),
];

/** Giá trị trễ một nhịp gõ, để ô tìm không gọi API theo từng ký tự. */
function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function warehouseOptions(warehouses: readonly Warehouse[]) {
  return [
    { value: '', label: 'Mọi kho' },
    ...warehouses.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` })),
  ];
}

/** Người thực hiện: chỉ có id người dùng, hiện 8 ký tự đầu như chi tiết chứng từ. */
function Actor({ id, at }: { id?: string; at?: string }) {
  if (!id && !at) return <>—</>;
  return (
    <>
      {at ? formatDateTime(at) : '—'}
      {id ? (
        <span className={styles.sub} title={id}>
          {id.slice(0, 8)}
        </span>
      ) : null}
    </>
  );
}

const quantityColumn = <TRow extends object>(
  title: string,
  key: keyof TRow & string,
): TableColumnsType<TRow>[number] => ({
  title,
  dataIndex: key,
  key,
  align: 'right',
  width: 110,
  render: (value: number) => <span className={styles.numeric}>{formatNumber(value)}</span>,
});

/**
 * Báo cáo kho (T7-09): tồn theo kho, lô, serial với bốn loại tồn; nhập xuất theo
 * kỳ; lịch sử chứng từ phải duyệt. Mỗi bảng xuất được Excel toàn bộ tập đã lọc.
 */
export function InventoryReports({ warehouses }: { warehouses: readonly Warehouse[] }) {
  const [view, setView] = useState<ReportView>('WAREHOUSE');
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Báo cáo kho</h2>
          <span className={styles.countHint}>
            Tồn thực tế, đã giữ, chờ kiểm định hoặc không đạt, khả dụng; nhập xuất theo kỳ
          </span>
        </div>
      </div>
      <div className={styles.tabs} style={{ margin: '0 0 0.85rem 0' }} role="tablist">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            className={`${styles.tab} ${view === item.id ? styles.tabActive : ''}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {view === 'MOVEMENTS' ? (
        <MovementReportView warehouses={warehouses} />
      ) : view === 'APPROVALS' ? (
        <ApprovalReportView warehouses={warehouses} />
      ) : (
        <StockReportView key={view} groupBy={view} warehouses={warehouses} />
      )}
    </section>
  );
}

function ExportButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.btnSecondary} onClick={onClick} disabled={busy}>
      <FileSpreadsheet size={15} /> {busy ? 'Đang xuất...' : 'Xuất Excel'}
    </button>
  );
}

function ReloadButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.btnSecondary} onClick={onClick} disabled={busy}>
      <RotateCw size={15} /> Tải lại
    </button>
  );
}

interface StockFilters {
  search: string;
  category: string;
  warehouseCode: string;
  expiringWithinDays: string;
  qualityStatus: string;
  stockState: string;
  includeZero: boolean;
}

const INITIAL_STOCK_FILTERS: StockFilters = {
  search: '',
  category: '',
  warehouseCode: '',
  expiringWithinDays: '',
  qualityStatus: '',
  stockState: 'IN_STOCK',
  includeZero: false,
};

function StockReportView({ groupBy, warehouses }: { groupBy: StockReportGroupBy; warehouses: readonly Warehouse[] }) {
  const [filters, setFilters] = useState<StockFilters>(INITIAL_STOCK_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [report, setReport] = useState<StockReport>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const search = useDebounced(filters.search);

  const query = useMemo(
    () => ({
      groupBy,
      search: search.trim() || undefined,
      category: (filters.category || undefined) as MaterialCategory | undefined,
      warehouseCode: filters.warehouseCode || undefined,
      expiringWithinDays:
        groupBy === 'LOT' && filters.expiringWithinDays ? Number(filters.expiringWithinDays) : undefined,
      qualityStatus: groupBy !== 'WAREHOUSE' ? ((filters.qualityStatus || undefined) as QualityStatus | undefined) : undefined,
      stockState: groupBy === 'SERIAL' ? (filters.stockState as SerialStockState | 'ALL') : undefined,
      includeZero: groupBy !== 'SERIAL' ? filters.includeZero : undefined,
    }),
    [groupBy, search, filters],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loadStockReport({ ...query, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Không tải được báo cáo tồn.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, page, pageSize, reloadKey]);

  const update = (patch: Partial<StockFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const exportExcel = async () => {
    setExporting(true);
    setError(undefined);
    try {
      let last: StockReport | undefined;
      const all = await loadAllPages<StockReport['rows'][number]>(async (paging) => {
        const page = await loadStockReport({ ...query, ...paging });
        last = page;
        return { rows: page.rows as readonly StockReport['rows'][number][], total: page.total };
      });
      if (!last) return;
      const intro = [
        `Báo cáo ${VIEWS.find((item) => item.id === groupBy)?.label.toLowerCase()} lúc ${formatDateTime(last.asOf)}`,
        ...(all.truncated ? [`Chỉ xuất ${MAX_EXPORT_ROWS} dòng đầu trên tổng ${all.total} dòng.`] : []),
      ];
      downloadReportSheets(
        `bao-cao-ton-${groupBy.toLowerCase()}-${todayInVietnam()}.xlsx`,
        [stockReportSheet(last, all.rows as StockReport['rows'], intro)],
      );
    } catch (cause) {
      setError(errorMessage(cause, 'Không xuất được Excel.'));
    } finally {
      setExporting(false);
    }
  };

  const pagination = {
    current: page,
    pageSize,
    total: report?.total ?? 0,
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZES,
    showTotal: (total: number) => `${formatNumber(total)} dòng`,
    onChange: (nextPage: number, nextSize: number) => {
      setPage(nextSize === pageSize ? nextPage : 1);
      setPageSize(nextSize);
    },
  };

  return (
    <>
      <div className={styles.docFilterRow}>
        <label className={styles.docField}>
          <span>Tìm</span>
          <input
            value={filters.search}
            placeholder={groupBy === 'SERIAL' ? 'Mã, tên vật tư hoặc serial' : groupBy === 'LOT' ? 'Mã, tên vật tư hoặc số lô' : 'Mã hoặc tên vật tư'}
            onChange={(event) => update({ search: event.target.value })}
          />
        </label>
        <label className={styles.docField}>
          <span>Nhóm vật tư</span>
          <SearchableSelect options={CATEGORY_OPTIONS} value={filters.category} height={36} onChange={(value) => update({ category: value })} />
        </label>
        <label className={styles.docField}>
          <span>Kho</span>
          <SearchableSelect
            options={warehouseOptions(warehouses)}
            value={filters.warehouseCode}
            height={36}
            onChange={(value) => update({ warehouseCode: value })}
          />
        </label>
        {groupBy === 'LOT' ? (
          <label className={styles.docField}>
            <span>Hạn dùng</span>
            <SearchableSelect
              options={EXPIRY_OPTIONS}
              value={filters.expiringWithinDays}
              height={36}
              onChange={(value) => update({ expiringWithinDays: value })}
            />
          </label>
        ) : null}
        {groupBy === 'SERIAL' ? (
          <label className={styles.docField}>
            <span>Trạng thái kho</span>
            <SearchableSelect
              options={STOCK_STATE_OPTIONS}
              value={filters.stockState}
              height={36}
              clearable={false}
              onChange={(value) => update({ stockState: value || 'IN_STOCK' })}
            />
          </label>
        ) : null}
        {groupBy !== 'WAREHOUSE' ? (
          <label className={styles.docField}>
            <span>Chất lượng</span>
            <SearchableSelect
              options={QUALITY_OPTIONS}
              value={filters.qualityStatus}
              height={36}
              onChange={(value) => update({ qualityStatus: value })}
            />
          </label>
        ) : null}
        {groupBy !== 'SERIAL' ? (
          <label className={styles.docField} style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
            <input
              type="checkbox"
              checked={filters.includeZero}
              onChange={(event) => update({ includeZero: event.target.checked })}
            />
            <span>Hiện dòng tồn bằng 0</span>
          </label>
        ) : null}
        <ReloadButton busy={loading} onClick={() => setReloadKey((key) => key + 1)} />
        <ExportButton busy={exporting} onClick={() => void exportExcel()} />
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {report ? <StockTotals report={report} /> : null}
      {groupBy === 'WAREHOUSE' ? (
        <Table<StockReportWarehouseRow>
          rowKey={(row) => `${row.warehouseId}:${row.materialId}`}
          size="small"
          loading={loading}
          columns={WAREHOUSE_COLUMNS}
          dataSource={report?.groupBy === 'WAREHOUSE' ? [...report.rows] : []}
          pagination={pagination}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Không có dòng tồn nào khớp bộ lọc.' }}
        />
      ) : groupBy === 'LOT' ? (
        <Table<StockReportLotRow>
          rowKey={(row) => `${row.lotId}:${row.warehouseId}`}
          size="small"
          loading={loading}
          columns={LOT_COLUMNS}
          dataSource={report?.groupBy === 'LOT' ? [...report.rows] : []}
          pagination={pagination}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Không có lô nào khớp bộ lọc.' }}
        />
      ) : (
        <Table<StockReportSerialRow>
          rowKey="serialId"
          size="small"
          loading={loading}
          columns={SERIAL_COLUMNS}
          dataSource={report?.groupBy === 'SERIAL' ? [...report.rows] : []}
          pagination={pagination}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Không có serial nào khớp bộ lọc.' }}
        />
      )}
    </>
  );
}

function StockTotals({ report }: { report: StockReport }) {
  if (report.groupBy === 'SERIAL') {
    const totals = report.totals;
    return (
      <div className={styles.statStrip}>
        <span>Serial <strong>{formatNumber(totals.serials)}</strong></span>
        <span>Trong kho <strong>{formatNumber(totals.inStock)}</strong></span>
        <span className={totals.blocked ? styles.statWarn : undefined}>
          {STOCK_QUANTITY_LABEL.blocked} <strong>{formatNumber(totals.blocked)}</strong>
        </span>
        <span>{STOCK_QUANTITY_LABEL.available} <strong>{formatNumber(totals.available)}</strong></span>
      </div>
    );
  }
  const totals = report.totals;
  return (
    <div className={styles.statStrip}>
      <span>{STOCK_QUANTITY_LABEL.onHand} <strong>{formatNumber(totals.onHand)}</strong></span>
      <span>{STOCK_QUANTITY_LABEL.reserved} <strong>{formatNumber(totals.reserved)}</strong></span>
      <span className={totals.blocked ? styles.statWarn : undefined}>
        {STOCK_QUANTITY_LABEL.blocked} <strong>{formatNumber(totals.blocked)}</strong>
      </span>
      <span>{STOCK_QUANTITY_LABEL.available} <strong>{formatNumber(totals.available)}</strong></span>
      {totals.stockValue !== undefined ? (
        <span>Giá trị tồn <strong>{formatNumber(totals.stockValue)}</strong></span>
      ) : null}
    </div>
  );
}

const materialColumn = <TRow extends { materialCode: string; materialName: string }>(): TableColumnsType<TRow>[number] => ({
  title: 'Vật tư',
  key: 'material',
  render: (_value, row) => (
    <>
      <strong className={styles.code}>{row.materialCode}</strong>
      <span className={styles.sub}>{row.materialName}</span>
    </>
  ),
});

const WAREHOUSE_COLUMNS: TableColumnsType<StockReportWarehouseRow> = [
  {
    title: 'Kho',
    key: 'warehouse',
    width: 150,
    render: (_value, row) => (
      <>
        {row.warehouseCode}
        <span className={styles.sub}>{row.warehouseName}</span>
      </>
    ),
  },
  materialColumn<StockReportWarehouseRow>(),
  {
    title: 'Nhóm',
    dataIndex: 'category',
    key: 'category',
    width: 140,
    render: (value?: MaterialCategory) => (value ? MATERIAL_CATEGORY_LABEL[value] : '—'),
  },
  { title: 'Đơn vị', dataIndex: 'unit', key: 'unit', width: 80 },
  quantityColumn<StockReportWarehouseRow>(STOCK_QUANTITY_LABEL.onHand, 'onHand'),
  quantityColumn<StockReportWarehouseRow>(STOCK_QUANTITY_LABEL.reserved, 'reserved'),
  quantityColumn<StockReportWarehouseRow>(STOCK_QUANTITY_LABEL.blocked, 'blocked'),
  quantityColumn<StockReportWarehouseRow>(STOCK_QUANTITY_LABEL.available, 'available'),
  quantityColumn<StockReportWarehouseRow>('Giá bình quân', 'avgCost'),
  quantityColumn<StockReportWarehouseRow>('Giá trị tồn', 'stockValue'),
];

const LOT_COLUMNS: TableColumnsType<StockReportLotRow> = [
  materialColumn<StockReportLotRow>(),
  { title: 'Số lô', dataIndex: 'lotNo', key: 'lotNo', width: 120 },
  { title: 'Kho', dataIndex: 'warehouseCode', key: 'warehouse', width: 110 },
  {
    title: 'Hạn dùng',
    key: 'expiry',
    width: 140,
    render: (_value, row) =>
      row.expiresOn ? (
        <>
          {formatDate(row.expiresOn)}
          <span className={styles.sub}>
            {row.daysToExpiry === undefined
              ? ''
              : row.daysToExpiry < 0
                ? `Đã hết hạn ${-row.daysToExpiry} ngày`
                : `Còn ${row.daysToExpiry} ngày`}
          </span>
        </>
      ) : (
        '—'
      ),
  },
  {
    title: 'Chất lượng',
    dataIndex: 'qualityStatus',
    key: 'quality',
    width: 130,
    render: (value: QualityStatus) => QUALITY_STATUS_LABEL[value],
  },
  quantityColumn<StockReportLotRow>(STOCK_QUANTITY_LABEL.onHand, 'onHand'),
  quantityColumn<StockReportLotRow>(STOCK_QUANTITY_LABEL.reserved, 'reserved'),
  quantityColumn<StockReportLotRow>(STOCK_QUANTITY_LABEL.blocked, 'blocked'),
  quantityColumn<StockReportLotRow>(STOCK_QUANTITY_LABEL.available, 'available'),
];

const SERIAL_COLUMNS: TableColumnsType<StockReportSerialRow> = [
  materialColumn<StockReportSerialRow>(),
  { title: 'Serial', dataIndex: 'serialNumber', key: 'serial', width: 180 },
  { title: 'Kho', dataIndex: 'warehouseCode', key: 'warehouse', width: 110, render: (value?: string) => value ?? '—' },
  {
    title: 'Trạng thái kho',
    dataIndex: 'stockState',
    key: 'stockState',
    width: 140,
    render: (value?: SerialStockState) => (value ? SERIAL_STOCK_STATE_LABEL[value] : '—'),
  },
  {
    title: 'Chất lượng',
    dataIndex: 'qualityStatus',
    key: 'quality',
    width: 140,
    render: (value: QualityStatus) => QUALITY_STATUS_LABEL[value],
  },
  {
    title: 'Cập nhật',
    dataIndex: 'updatedAt',
    key: 'updatedAt',
    width: 160,
    render: (value: string) => formatDateTime(value),
  },
];

interface PeriodFilters {
  fromDate: string;
  toDate: string;
  warehouseCode: string;
}

function initialPeriod(): PeriodFilters {
  const today = todayInVietnam();
  return { fromDate: `${today.slice(0, 8)}01`, toDate: today, warehouseCode: '' };
}

function PeriodFields({
  value,
  warehouses,
  onChange,
}: {
  value: PeriodFilters;
  warehouses: readonly Warehouse[];
  onChange: (patch: Partial<PeriodFilters>) => void;
}) {
  return (
    <>
      <label className={styles.docField}>
        <span>Từ ngày</span>
        <input type="date" value={value.fromDate} max={value.toDate} onChange={(event) => onChange({ fromDate: event.target.value })} />
      </label>
      <label className={styles.docField}>
        <span>Đến ngày</span>
        <input type="date" value={value.toDate} min={value.fromDate} onChange={(event) => onChange({ toDate: event.target.value })} />
      </label>
      <label className={styles.docField}>
        <span>Kho</span>
        <SearchableSelect
          options={warehouseOptions(warehouses)}
          value={value.warehouseCode}
          height={36}
          onChange={(code) => onChange({ warehouseCode: code })}
        />
      </label>
    </>
  );
}

const amountColumns = <TRow extends object>(): TableColumnsType<TRow> => [
  quantityColumn<TRow>('SL nhập', 'quantityIn' as keyof TRow & string),
  quantityColumn<TRow>('SL xuất', 'quantityOut' as keyof TRow & string),
  quantityColumn<TRow>('Giá trị nhập', 'valueIn' as keyof TRow & string),
  quantityColumn<TRow>('Giá trị xuất', 'valueOut' as keyof TRow & string),
  quantityColumn<TRow>('Số bút toán', 'entries' as keyof TRow & string),
];

const SUMMARY_COLUMNS: TableColumnsType<StockMovementSummaryRow> = [
  {
    title: 'Nhóm',
    dataIndex: 'category',
    key: 'category',
    render: (value: StockMovementCategory) => MOVEMENT_CATEGORY_LABEL[value],
  },
  ...amountColumns<StockMovementSummaryRow>(),
];

const BREAKDOWN_COLUMNS: TableColumnsType<StockMovementBreakdownRow> = [
  {
    title: 'Nhóm',
    dataIndex: 'category',
    key: 'category',
    width: 150,
    render: (value: StockMovementCategory) => MOVEMENT_CATEGORY_LABEL[value],
  },
  {
    title: 'Loại chứng từ',
    dataIndex: 'docType',
    key: 'docType',
    width: 170,
    render: (value?: StockDocumentType) => (value ? STOCK_DOCUMENT_TYPE_LABEL[value] : 'Không có chứng từ'),
  },
  { title: 'Kho', dataIndex: 'warehouseCode', key: 'warehouse', width: 110 },
  ...amountColumns<StockMovementBreakdownRow>(),
];

const LINE_COLUMNS: TableColumnsType<StockMovementLine> = [
  {
    title: 'Ghi sổ',
    dataIndex: 'postedAt',
    key: 'postedAt',
    width: 150,
    render: (value: string) => formatDateTime(value),
  },
  {
    title: 'Chứng từ',
    key: 'document',
    width: 190,
    render: (_value, line) => (
      <>
        <strong className={styles.code}>{line.documentCode ?? line.transactionCode}</strong>
        <span className={styles.sub}>
          {line.docType ? STOCK_DOCUMENT_TYPE_LABEL[line.docType] : 'Không có chứng từ'}
          {line.reversesDocumentCode ? ` · đảo ${line.reversesDocumentCode}` : ''}
        </span>
      </>
    ),
  },
  {
    title: 'Nhóm',
    dataIndex: 'category',
    key: 'category',
    width: 140,
    render: (value: StockMovementCategory) => MOVEMENT_CATEGORY_LABEL[value],
  },
  { title: 'Kho', dataIndex: 'warehouseCode', key: 'warehouse', width: 100 },
  materialColumn<StockMovementLine>(),
  {
    title: 'Số lượng',
    dataIndex: 'quantity',
    key: 'quantity',
    align: 'right',
    width: 100,
    render: (value: number) => (
      <span className={`${styles.numeric} ${value < 0 ? styles.negative : styles.positive}`}>
        {value > 0 ? '+' : ''}
        {formatNumber(value)}
      </span>
    ),
  },
  quantityColumn<StockMovementLine>('Đơn giá', 'unitCost'),
  quantityColumn<StockMovementLine>('Giá trị', 'value'),
];

function MovementReportView({ warehouses }: { warehouses: readonly Warehouse[] }) {
  const [period, setPeriod] = useState<PeriodFilters>(initialPeriod);
  const [category, setCategory] = useState('');
  const [docType, setDocType] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [report, setReport] = useState<StockMovementReport>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(
    () => ({
      fromDate: period.fromDate || undefined,
      toDate: period.toDate || undefined,
      warehouseCode: period.warehouseCode || undefined,
      category: (category || undefined) as StockMovementCategory | undefined,
      docType: (docType || undefined) as StockDocumentType | undefined,
      search: search.trim() || undefined,
    }),
    [period, category, docType, search],
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loadMovementReport({ ...query, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Không tải được báo cáo nhập xuất.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, page, pageSize, reloadKey]);

  const exportExcel = async () => {
    setExporting(true);
    setError(undefined);
    try {
      let last: StockMovementReport | undefined;
      const all = await loadAllPages(async (paging) => {
        last = await loadMovementReport({ ...query, ...paging });
        return { rows: last.lines, total: last.total };
      });
      if (!last) return;
      const intro = [
        `Báo cáo nhập xuất từ ${formatDate(last.fromDate)} đến ${formatDate(last.toDate)}${query.warehouseCode ? `, kho ${query.warehouseCode}` : ''}`,
        ...(all.truncated ? [`Chỉ xuất ${MAX_EXPORT_ROWS} bút toán đầu trên tổng ${all.total}.`] : []),
      ];
      downloadReportSheets(`bao-cao-nhap-xuat-${last.fromDate}-${last.toDate}.xlsx`, movementReportSheets(last, all.rows, intro));
    } catch (cause) {
      setError(errorMessage(cause, 'Không xuất được Excel.'));
    } finally {
      setExporting(false);
    }
  };

  const totals = report?.totals;
  return (
    <>
      <div className={styles.docFilterRow}>
        <PeriodFields value={period} warehouses={warehouses} onChange={(patch) => setPeriod((current) => ({ ...current, ...patch }))} />
        <label className={styles.docField}>
          <span>Nhóm</span>
          <SearchableSelect options={MOVEMENT_CATEGORY_OPTIONS} value={category} height={36} onChange={setCategory} />
        </label>
        <label className={styles.docField}>
          <span>Loại chứng từ</span>
          <SearchableSelect options={DOC_TYPE_OPTIONS} value={docType} height={36} onChange={setDocType} />
        </label>
        <label className={styles.docField}>
          <span>Tìm</span>
          <input value={searchText} placeholder="Mã, tên vật tư hoặc mã chứng từ" onChange={(event) => setSearchText(event.target.value)} />
        </label>
        <ReloadButton busy={loading} onClick={() => setReloadKey((key) => key + 1)} />
        <ExportButton busy={exporting} onClick={() => void exportExcel()} />
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {totals ? (
        <div className={styles.statStrip}>
          <span>SL nhập <strong>{formatNumber(totals.quantityIn)}</strong></span>
          <span>SL xuất <strong>{formatNumber(totals.quantityOut)}</strong></span>
          <span>Giá trị nhập <strong>{formatNumber(totals.valueIn)}</strong></span>
          <span>Giá trị xuất <strong>{formatNumber(totals.valueOut)}</strong></span>
          <span>Bút toán <strong>{formatNumber(totals.entries)}</strong></span>
        </div>
      ) : null}
      <h3 className={styles.countHint}>Tổng theo nhóm</h3>
      <Table<StockMovementSummaryRow>
        rowKey="category"
        size="small"
        loading={loading}
        columns={SUMMARY_COLUMNS}
        dataSource={report ? [...report.summary] : []}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
      <h3 className={styles.countHint}>Theo loại chứng từ và kho</h3>
      <Table<StockMovementBreakdownRow>
        rowKey={(row) => `${row.category}:${row.docType ?? ''}:${row.warehouseCode}`}
        size="small"
        loading={loading}
        columns={BREAKDOWN_COLUMNS}
        dataSource={report ? [...report.breakdown] : []}
        pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'Không có phát sinh trong kỳ.' }}
      />
      <h3 className={styles.countHint}>Bút toán chi tiết</h3>
      <Table<StockMovementLine>
        rowKey="transactionId"
        size="small"
        loading={loading}
        columns={LINE_COLUMNS}
        dataSource={report ? [...report.lines] : []}
        pagination={{
          current: page,
          pageSize,
          total: report?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES,
          showTotal: (total: number) => `${formatNumber(total)} bút toán`,
          onChange: (nextPage: number, nextSize: number) => {
            setPage(nextSize === pageSize ? nextPage : 1);
            setPageSize(nextSize);
          },
        }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'Không có bút toán trong kỳ.' }}
      />
    </>
  );
}

const APPROVAL_COLUMNS: TableColumnsType<StockApprovalReportRow> = [
  {
    title: 'Chứng từ',
    key: 'document',
    width: 190,
    render: (_value, row) => (
      <>
        <strong className={styles.code}>{row.documentCode}</strong>
        <span className={styles.sub}>
          {STOCK_DOCUMENT_TYPE_LABEL[row.docType]} · {formatDate(row.documentDate)}
        </span>
      </>
    ),
  },
  { title: 'Kho', dataIndex: 'warehouseCode', key: 'warehouse', width: 100 },
  {
    title: 'Trạng thái',
    dataIndex: 'status',
    key: 'status',
    width: 120,
    render: (value: StockDocumentStatus) => <DocumentStatusBadge status={value} />,
  },
  {
    title: 'Lý do',
    key: 'reason',
    width: 240,
    render: (_value, row) => (
      <>
        {row.reason ?? '—'}
        {row.rejectReason ? <span className={styles.sub}>Từ chối: {row.rejectReason}</span> : null}
      </>
    ),
  },
  { title: 'Lập', key: 'created', width: 150, render: (_value, row) => <Actor id={row.createdBy} at={row.createdAt} /> },
  {
    title: 'Duyệt hoặc từ chối',
    key: 'decision',
    width: 160,
    render: (_value, row) =>
      row.rejectedAt ? <Actor id={row.rejectedBy} at={row.rejectedAt} /> : <Actor id={row.approvedBy} at={row.approvedAt} />,
  },
  { title: 'Ghi sổ', key: 'posted', width: 150, render: (_value, row) => <Actor id={row.postedBy} at={row.postedAt} /> },
  quantityColumn<StockApprovalReportRow>('SL tăng', 'quantityIn'),
  quantityColumn<StockApprovalReportRow>('SL giảm', 'quantityOut'),
  quantityColumn<StockApprovalReportRow>('Giá trị', 'value'),
];

function ApprovalReportView({ warehouses }: { warehouses: readonly Warehouse[] }) {
  const [period, setPeriod] = useState<PeriodFilters>(initialPeriod);
  const [docType, setDocType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [report, setReport] = useState<StockApprovalReport>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(
    () => ({
      fromDate: period.fromDate || undefined,
      toDate: period.toDate || undefined,
      warehouseCode: period.warehouseCode || undefined,
      docType: (docType || undefined) as StockDocumentType | undefined,
      status: (status || undefined) as StockDocumentStatus | undefined,
    }),
    [period, docType, status],
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  const load = useCallback(
    (paging: { limit: number; offset: number }) => loadApprovalReport({ ...query, ...paging }),
    [query],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    load({ limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Không tải được lịch sử duyệt.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, page, pageSize, reloadKey]);

  const exportExcel = async () => {
    setExporting(true);
    setError(undefined);
    try {
      const all = await loadAllPages(load);
      const intro = [
        `Lịch sử chứng từ phải duyệt từ ${formatDate(query.fromDate ?? '')} đến ${formatDate(query.toDate ?? '')}`,
        'Người thực hiện ghi theo mã người dùng.',
      ];
      downloadReportSheets(
        `lich-su-duyet-kho-${query.fromDate ?? ''}-${query.toDate ?? ''}.xlsx`,
        [approvalReportSheet(all.rows, intro)],
      );
    } catch (cause) {
      setError(errorMessage(cause, 'Không xuất được Excel.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className={styles.docFilterRow}>
        <PeriodFields value={period} warehouses={warehouses} onChange={(patch) => setPeriod((current) => ({ ...current, ...patch }))} />
        <label className={styles.docField}>
          <span>Loại chứng từ</span>
          <SearchableSelect options={APPROVAL_TYPE_OPTIONS} value={docType} height={36} onChange={setDocType} />
        </label>
        <label className={styles.docField}>
          <span>Trạng thái</span>
          <SearchableSelect options={STATUS_OPTIONS} value={status} height={36} onChange={setStatus} />
        </label>
        <ReloadButton busy={loading} onClick={() => setReloadKey((key) => key + 1)} />
        <ExportButton busy={exporting} onClick={() => void exportExcel()} />
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <Table<StockApprovalReportRow>
        rowKey="documentId"
        size="small"
        loading={loading}
        columns={APPROVAL_COLUMNS}
        dataSource={report ? [...report.rows] : []}
        pagination={{
          current: page,
          pageSize,
          total: report?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES,
          showTotal: (total: number) => `${formatNumber(total)} chứng từ`,
          onChange: (nextPage: number, nextSize: number) => {
            setPage(nextSize === pageSize ? nextPage : 1);
            setPageSize(nextSize);
          },
        }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'Không có chứng từ phải duyệt trong kỳ.' }}
      />
    </>
  );
}
