'use client';

import {
  CONVERSION_STAGE_LABELS,
  SALES_ALERT_KIND_LABELS,
  SALES_REPORT_DIMENSION_LABELS,
  type ConversionReport,
  type ConversionStep,
  type OverdueOrderRow,
  type ReceivableReport,
  type ReceivableReportCustomerRow,
  type SalesAlert,
  type SalesAlertKind,
  type SalesAlertList,
  type SalesReport,
  type SalesReportDimension,
  type SalesReportRow,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { errorMessage, loadConversionReport, loadReceivableReport, loadSalesAlerts, loadSalesReport } from '../crm-api';
import { groupOptions, labelOptions, peopleOptions, useCrm } from '../crm-context';
import { formatQuantity } from '../fulfillment.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import report from './reports.module.scss';
import {
  REPORT_TABS,
  alertsSheet,
  barPercent,
  conversionSheet,
  exportFileName,
  periodPresets,
  receivableSheets,
  salesRowLabel,
  salesSheet,
  vietnamToday,
  type ReportTab,
  type Sheet,
} from './reports.model';

/** Bộ lọc chung của các tab; mỗi tab dùng phần của mình. */
interface Filters {
  readonly from: string;
  readonly to: string;
  readonly ownerUserId: string;
  readonly customerGroupId: string;
  readonly region: string;
}

/** Ghi file Excel từ đúng dữ liệu đang hiện (đã lọc phạm vi ở server). Tải thư viện khi bấm. */
async function downloadWorkbook(fileName: string, sheets: readonly Sheet[]): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows.map((row) => [...row])), sheet.name);
  }
  XLSX.writeFile(workbook, fileName);
}

/**
 * Tải dữ liệu một báo cáo; bộ lọc đổi (so theo JSON) thì tải lại và bỏ kết quả
 * cũ đang chờ. `loader` là hàm cố định của `crm-api`.
 */
function useReport<Q extends object, T>(query: Q, loader: (query: Q) => Promise<T>, fallback: string) {
  const key = JSON.stringify(query);
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    loader(JSON.parse(key) as Q)
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, fallback)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [key, loader, fallback]);
  return { data, loading, error };
}

/**
 * Báo cáo Bán hàng (T7-08): doanh thu, sản lượng, lợi nhuận theo chiều; tỷ lệ
 * chuyển đổi; cảnh báo; công nợ phải thu. Mọi số liệu trong phạm vi dữ liệu của
 * người xem; xuất Excel đúng bảng đang xem.
 */
export function ReportsPage({
  onOpenCustomer,
  onOpenAlert,
  onOpenOrder,
}: {
  onOpenCustomer: (customerId: string) => void;
  onOpenAlert: (alert: SalesAlert) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { people, groups } = useCrm();
  const today = useMemo(() => vietnamToday(), []);
  const presets = useMemo(() => periodPresets(today), [today]);
  const [tab, setTab] = useState<ReportTab>('sales');
  const [filters, setFilters] = useState<Filters>({ from: presets[0].from, to: today, ownerUserId: '', customerGroupId: '', region: '' });
  const [regionText, setRegionText] = useState('');
  const region = useDebounced(regionText.trim(), 400);
  const effective = useMemo(() => ({ ...filters, region }), [filters, region]);
  const nameOf = useCallback((userId: string) => personName(people, userId), [people]);
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const preset = presets.find((item) => item.from === filters.from && item.to === filters.to)?.id ?? '';
  const periodTab = tab === 'sales' || tab === 'conversion';
  const groupTab = tab === 'sales' || tab === 'receivables';

  return (
    <div className={styles.page}>
      <nav className={styles.tabs} role="tablist" aria-label="Báo cáo">
        {REPORT_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? styles.tabActive : styles.tab}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={report.filters}>
        {periodTab ? (
          <>
            <SearchableSelect
              className={styles.filter}
              options={presets.map((item) => ({ value: item.id, label: item.label }))}
              value={preset}
              placeholder="Kỳ tuỳ chọn"
              onChange={(id) => {
                const picked = presets.find((item) => item.id === id);
                if (picked) set({ from: picked.from, to: picked.to });
              }}
            />
            <span className={report.date}>
              <DatePickerInput value={filters.from} max={filters.to} onChange={(from) => from && set({ from })} height={38} aria-label="Từ ngày" />
            </span>
            <span className={report.date}>
              <DatePickerInput value={filters.to} min={filters.from} onChange={(to) => to && set({ to })} height={38} aria-label="Đến ngày" />
            </span>
          </>
        ) : null}
        <SearchableSelect
          className={styles.filter}
          options={peopleOptions(people)}
          value={filters.ownerUserId}
          placeholder="Mọi nhân viên"
          clearable
          onChange={(ownerUserId) => set({ ownerUserId })}
        />
        {groupTab ? (
          <>
            <SearchableSelect
              className={styles.filter}
              options={groupOptions(groups)}
              value={filters.customerGroupId}
              placeholder="Mọi nhóm khách"
              clearable
              onChange={(customerGroupId) => set({ customerGroupId })}
            />
            <input
              className={`${styles.input} ${styles.filter}`}
              placeholder="Khu vực (đúng tên)"
              maxLength={100}
              value={regionText}
              onChange={(event) => setRegionText(event.target.value)}
              aria-label="Khu vực"
            />
          </>
        ) : null}
      </div>
      {tab === 'sales' ? (
        <SalesTab filters={effective} nameOf={nameOf} today={today} />
      ) : tab === 'conversion' ? (
        <ConversionTab filters={effective} nameOf={nameOf} today={today} />
      ) : tab === 'alerts' ? (
        <AlertsTab ownerUserId={filters.ownerUserId} nameOf={nameOf} today={today} onOpen={onOpenAlert} />
      ) : (
        <ReceivablesTab filters={effective} nameOf={nameOf} today={today} onOpenCustomer={onOpenCustomer} onOpenOrder={onOpenOrder} />
      )}
    </div>
  );
}

function ExportButton({ disabled, onExport }: { disabled: boolean; onExport: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={styles.buttonGhost}
      disabled={disabled || busy}
      onClick={() => {
        setBusy(true);
        onExport()
          .catch(() => toast.error('Không xuất được file Excel.'))
          .finally(() => setBusy(false));
      }}
    >
      <Download size={14} /> Xuất Excel
    </button>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={report.stat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const money = (value: number) => <span className={`${report.number} ${value < 0 ? report.negative : ''}`}>{formatMoney(value)}</span>;
const percent = (value: number | null) => (value === null ? 'Không xác định' : `${value.toLocaleString('vi-VN')}%`);

function SalesTab({ filters, nameOf, today }: { filters: Filters; nameOf: (userId: string) => string; today: string }) {
  const [groupBy, setGroupBy] = useState<SalesReportDimension>('owner');
  const query = { ...filters, groupBy };
  const { data, loading, error } = useReport(query, loadSalesReport, 'Không tải được báo cáo doanh thu.');
  const maxRevenue = Math.max(0, ...(data?.rows ?? []).map((row) => row.revenue));
  const columns = useMemo<ColumnsType<SalesReportRow>>(
    () => [
      {
        title: SALES_REPORT_DIMENSION_LABELS[data?.groupBy ?? groupBy],
        key: 'label',
        width: 260,
        ellipsis: true,
        render: (_: unknown, row) => (
          <span>
            {row.code ? <span className={styles.mono}>{row.code} </span> : null}
            {salesRowLabel(data?.groupBy ?? groupBy, row, nameOf)}
          </span>
        ),
      },
      { title: 'Sản lượng', dataIndex: 'quantity', width: 110, align: 'right', render: (value: number) => formatQuantity(value) },
      {
        title: 'Doanh thu (chưa VAT)',
        dataIndex: 'revenue',
        width: 230,
        sorter: (a, b) => a.revenue - b.revenue,
        render: (value: number) => (
          <span className={report.barCell}>
            <span className={report.barTrack} aria-hidden>
              <span className={report.bar} style={{ width: `${barPercent(value, maxRevenue)}%`, display: 'block' }} />
            </span>
            {money(value)}
          </span>
        ),
      },
      { title: 'Giá vốn thực tế', dataIndex: 'costAmount', width: 150, align: 'right', render: money },
      { title: 'Lợi nhuận gộp', dataIndex: 'profit', width: 150, align: 'right', sorter: (a, b) => a.profit - b.profit, render: money },
      { title: 'Biên', dataIndex: 'marginPercent', width: 110, align: 'right', render: percent },
      { title: 'Số đơn', dataIndex: 'orderCount', width: 90, align: 'right' },
    ],
    [data?.groupBy, groupBy, maxRevenue, nameOf],
  );
  return (
    <section className={styles.tableCard} aria-label="Doanh thu, lợi nhuận">
      <div className={styles.toolbar}>
        <SearchableSelect
          className={styles.filter}
          options={labelOptions(SALES_REPORT_DIMENSION_LABELS)}
          value={groupBy}
          placeholder="Nhóm theo"
          onChange={(value) => value && setGroupBy(value as SalesReportDimension)}
        />
        <span className={styles.muted}>Doanh thu sau chiết khấu, chưa VAT, theo ngày giao; lợi nhuận dùng giá vốn thực tế khi xuất kho.</span>
        <ExportButton disabled={!data} onExport={() => downloadWorkbook(exportFileName('bao-cao-doanh-thu', today), [salesSheet(data as SalesReport, nameOf)])} />
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {data ? (
        <div className={report.stats}>
          <Stat label="Doanh thu" value={formatMoney(data.totals.revenue)} />
          <Stat label="Giá vốn thực tế" value={formatMoney(data.totals.costAmount)} />
          <Stat label="Lợi nhuận gộp" value={formatMoney(data.totals.profit)} />
          <Stat label="Biên lợi nhuận" value={percent(data.totals.marginPercent)} />
          <Stat label="Sản lượng" value={formatQuantity(data.totals.quantity)} />
          <Stat label="Số đơn" value={data.totals.orderCount} />
        </div>
      ) : null}
      {data?.truncated ? <p className={styles.muted}>Chỉ hiện các nhóm doanh thu cao nhất; tổng cộng vẫn tính đủ.</p> : null}
      <Table<SalesReportRow>
        size="small"
        rowKey={(row) => row.key ?? '(trống)'}
        loading={loading}
        columns={columns}
        dataSource={[...(data?.rows ?? [])]}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 1100 }}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có dòng giao nào trong kỳ.' }}
      />
    </section>
  );
}

function ConversionTab({ filters, nameOf, today }: { filters: Filters; nameOf: (userId: string) => string; today: string }) {
  const query = { from: filters.from, to: filters.to, ownerUserId: filters.ownerUserId };
  const { data, loading, error } = useReport(query, loadConversionReport, 'Không tải được tỷ lệ chuyển đổi.');
  const opportunities = data?.steps[0]?.count ?? 0;
  const stepCell = (step: ConversionStep | undefined) =>
    step ? (
      <span className={report.number}>
        {step.count}
        {step.stepPercent === null ? '' : ` (${percent(step.stepPercent)})`}
      </span>
    ) : null;
  const columns: ColumnsType<ConversionReport['byOwner'][number]> = [
    { title: 'Nhân viên', dataIndex: 'ownerUserId', width: 220, ellipsis: true, render: (value: string) => nameOf(value) },
    ...(['OPPORTUNITY', 'QUOTE', 'CONTRACT', 'ORDER'] as const).map((stage, index) => ({
      title: CONVERSION_STAGE_LABELS[stage],
      key: stage,
      width: 140,
      align: 'right' as const,
      render: (_: unknown, row: ConversionReport['byOwner'][number]) => stepCell(row.steps[index]),
    })),
    {
      title: 'Tổng',
      key: 'overall',
      width: 110,
      align: 'right',
      render: (_: unknown, row) => percent(row.steps[row.steps.length - 1]?.overallPercent ?? null),
    },
  ];
  return (
    <section className={styles.tableCard} aria-label="Tỷ lệ chuyển đổi">
      <div className={styles.toolbar}>
        <span className={styles.muted}>
          Đếm cơ hội, báo giá, hợp đồng, đơn bán tạo trong kỳ (trừ hợp đồng, đơn đã huỷ); tỷ lệ so với bước trước.
        </span>
        <ExportButton disabled={!data} onExport={() => downloadWorkbook(exportFileName('ty-le-chuyen-doi', today), [conversionSheet(data as ConversionReport, nameOf)])} />
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {data ? (
        <div className={report.funnel}>
          {data.steps.map((step) => (
            <div key={step.stage} className={report.funnelRow}>
              <strong>{CONVERSION_STAGE_LABELS[step.stage]}</strong>
              <span className={report.barTrack} style={{ height: 22, borderRadius: 6 }}>
                <span className={report.funnelBar} style={{ width: `${Math.max(barPercent(step.count, opportunities), step.count ? 4 : 0)}%`, display: 'block' }}>
                  {step.count}
                </span>
              </span>
              <span className={styles.muted}>
                {step.stepPercent === null ? 'Bước đầu' : `${percent(step.stepPercent)} so với bước trước`}
                {step.stage !== 'OPPORTUNITY' ? ` · ${percent(step.overallPercent)} tổng` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <Table
        size="small"
        rowKey="ownerUserId"
        loading={loading}
        columns={columns}
        dataSource={[...(data?.byOwner ?? [])]}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có cơ hội, báo giá, hợp đồng, đơn nào trong kỳ.' }}
      />
    </section>
  );
}

const ALERT_TONE: Readonly<Record<SalesAlertKind, 'warning' | 'info' | 'danger'>> = {
  QUOTE_PENDING: 'warning',
  CONTRACT_EXPIRING: 'info',
  DELIVERY_LATE: 'danger',
};

function AlertsTab({
  ownerUserId,
  nameOf,
  today,
  onOpen,
}: {
  ownerUserId: string;
  nameOf: (userId: string) => string;
  today: string;
  onOpen: (alert: SalesAlert) => void;
}) {
  const [kind, setKind] = useState('');
  const query = { ownerUserId, kind: (kind || undefined) as SalesAlertKind | undefined };
  const { data, loading, error } = useReport(query, loadSalesAlerts, 'Không tải được danh sách cảnh báo.');
  const columns: ColumnsType<SalesAlert> = [
    {
      title: 'Loại',
      dataIndex: 'kind',
      width: 190,
      render: (value: SalesAlertKind) => <StatusPill tone={ALERT_TONE[value]}>{SALES_ALERT_KIND_LABELS[value]}</StatusPill>,
    },
    { title: 'Mã', dataIndex: 'code', width: 140, render: (value: string) => <span className={styles.mono}>{value}</span> },
    { title: 'Nội dung', dataIndex: 'summary', ellipsis: true },
    { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 170, ellipsis: true, render: (value: string) => nameOf(value) },
    {
      title: '',
      key: 'open',
      width: 80,
      fixed: 'right',
      render: (_: unknown, row) => (
        <button type="button" className={styles.rowAction} onClick={() => onOpen(row)}>
          Mở
        </button>
      ),
    },
  ];
  return (
    <section className={styles.tableCard} aria-label="Cảnh báo">
      <div className={styles.toolbar}>
        <SearchableSelect
          className={styles.filter}
          options={labelOptions(SALES_ALERT_KIND_LABELS)}
          value={kind}
          placeholder="Mọi loại cảnh báo"
          clearable
          onChange={setKind}
        />
        {data ? <span className={styles.muted}>Hợp đồng sắp hết hạn: còn tối đa {data.contractExpiringDays} ngày.</span> : null}
        <ExportButton disabled={!data} onExport={() => downloadWorkbook(exportFileName('canh-bao-ban-hang', today), [alertsSheet(data as SalesAlertList, nameOf)])} />
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<SalesAlert>
        size="small"
        rowKey={(row) => `${row.kind}:${row.id}`}
        loading={loading}
        columns={columns}
        dataSource={[...(data?.items ?? [])]}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 1000 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row) })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có cảnh báo nào.' }}
      />
    </section>
  );
}

function ReceivablesTab({
  filters,
  nameOf,
  today,
  onOpenCustomer,
  onOpenOrder,
}: {
  filters: Filters;
  nameOf: (userId: string) => string;
  today: string;
  onOpenCustomer: (customerId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const query = { ownerUserId: filters.ownerUserId, customerGroupId: filters.customerGroupId, region: filters.region };
  const { data, loading, error } = useReport(query, loadReceivableReport, 'Không tải được báo cáo công nợ.');
  const day = (value: string | null) => (value ? value.split('-').reverse().join('/') : '');
  const customerColumns: ColumnsType<ReceivableReportCustomerRow> = [
    {
      title: 'Khách hàng',
      key: 'customer',
      width: 250,
      ellipsis: true,
      render: (_: unknown, row) => (
        <span>
          <span className={styles.mono}>{row.customerCode}</span> {row.customerName}
        </span>
      ),
    },
    { title: 'Doanh thu ghi nợ', dataIndex: 'revenue', width: 150, align: 'right', render: money },
    { title: 'Đã thu', dataIndex: 'collected', width: 140, align: 'right', render: money },
    { title: 'Doanh thu chưa thu', dataIndex: 'uncollectedRevenue', width: 160, align: 'right', render: money },
    { title: 'Dư nợ', dataIndex: 'balance', width: 140, align: 'right', render: (value: number) => <strong>{money(value)}</strong> },
    {
      title: 'Đến hạn, quá hạn',
      dataIndex: 'overdueAmount',
      width: 150,
      align: 'right',
      render: (value: number) => (value ? <span className={styles.overdue}>{formatMoney(value)}</span> : ''),
    },
    { title: 'Hạn kế tiếp', dataIndex: 'nextDueDate', width: 110, render: day },
    { title: 'Đơn quá hạn', dataIndex: 'overdueOrderCount', width: 100, align: 'right', render: (value: number) => value || '' },
    { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => nameOf(value) },
    {
      title: '',
      key: 'open',
      width: 90,
      fixed: 'right',
      render: (_: unknown, row) => (
        <button type="button" className={styles.rowAction} onClick={() => onOpenCustomer(row.customerId)}>
          Sổ nợ
        </button>
      ),
    },
  ];
  const orderColumns: ColumnsType<OverdueOrderRow> = [
    { title: 'Đơn', dataIndex: 'orderCode', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
    {
      title: 'Khách hàng',
      key: 'customer',
      width: 250,
      ellipsis: true,
      render: (_: unknown, row) => (
        <span>
          <span className={styles.mono}>{row.customerCode}</span> {row.customerName}
        </span>
      ),
    },
    { title: 'Hạn thanh toán', dataIndex: 'dueDate', width: 120, render: day },
    { title: 'Quá hạn', dataIndex: 'daysOverdue', width: 100, align: 'right', render: (value: number) => `${value} ngày` },
    { title: 'Số tiền quá hạn', dataIndex: 'overdueAmount', width: 150, align: 'right', render: money },
    { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => nameOf(value) },
    {
      title: '',
      key: 'open',
      width: 80,
      fixed: 'right',
      render: (_: unknown, row) => (
        <button type="button" className={styles.rowAction} onClick={() => onOpenOrder(row.orderId)}>
          Mở
        </button>
      ),
    },
  ];
  return (
    <section className={styles.tableCard} aria-label="Công nợ phải thu">
      <div className={styles.toolbar}>
        <span className={styles.muted}>
          Đến ngày {day(data?.asOf ?? today)}. Doanh thu chưa thu = doanh thu ghi nợ − tiền thu đã phân bổ vào khoản nợ.
        </span>
        <ExportButton disabled={!data} onExport={() => downloadWorkbook(exportFileName('cong-no-phai-thu', today), receivableSheets(data as ReceivableReport, nameOf))} />
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {data ? (
        <div className={report.stats}>
          <Stat label="Doanh thu ghi nợ" value={formatMoney(data.totals.revenue)} />
          <Stat label="Đã thu" value={formatMoney(data.totals.collected)} />
          <Stat label="Doanh thu chưa thu" value={formatMoney(data.totals.uncollectedRevenue)} />
          <Stat label="Dư nợ" value={formatMoney(data.totals.balance)} />
          <Stat label="Đến hạn, quá hạn" value={formatMoney(data.totals.overdueAmount)} />
        </div>
      ) : null}
      <Table<ReceivableReportCustomerRow>
        size="small"
        rowKey="customerId"
        loading={loading}
        columns={customerColumns}
        dataSource={[...(data?.customers ?? [])]}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 1500 }}
        onRow={(row) => ({ onDoubleClick: () => onOpenCustomer(row.customerId) })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Chưa có công nợ nào.' }}
      />
      <h3 className={styles.sectionTitle}>Đơn quá hạn thanh toán</h3>
      <Table<OverdueOrderRow>
        size="small"
        rowKey="orderId"
        loading={loading}
        columns={orderColumns}
        dataSource={[...(data?.overdueOrders ?? [])]}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 1000 }}
        onRow={(row) => ({ onDoubleClick: () => onOpenOrder(row.orderId) })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có đơn quá hạn.' }}
      />
    </section>
  );
}
