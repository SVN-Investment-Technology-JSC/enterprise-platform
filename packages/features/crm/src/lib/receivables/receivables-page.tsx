'use client';

import {
  ADJUSTMENT_DIRECTION_LABELS,
  ADJUSTMENT_STATUS_LABELS,
  CREDIT_LIMIT_MODE_LABELS,
  RECEIPT_METHOD_LABELS,
  RECEIPT_STATUS_LABELS,
  type AdjustmentStatus,
  type CreditLimitMode,
  type CustomerAgingRow,
  type ReceiptStatus,
  type ReceiptSummary,
  type ReceivableAdjustment,
  type ReceivableSettings,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { useKeysetPage } from '../components/use-keyset-page';
import {
  adjustmentAction,
  errorMessage,
  listAdjustments,
  listReceipts,
  loadAging,
  loadReceivableSettings,
  saveReceivableSettings,
} from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { formatDay } from '../fulfillment.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { ADJUSTMENT_STATUS_TONE, RECEIPT_STATUS_TONE, adjustmentActions } from './receivables.model';

type ReceivablesTab = 'aging' | 'receipts' | 'adjustments' | 'settings';

const TABS: readonly { id: ReceivablesTab; label: string }[] = [
  { id: 'aging', label: 'Tuổi nợ theo khách' },
  { id: 'receipts', label: 'Lần thu tiền' },
  { id: 'adjustments', label: 'Điều chỉnh công nợ' },
  { id: 'settings', label: 'Cấu hình' },
];

/**
 * Công nợ (T5-12): tuổi nợ theo khách (0–30, 31–60, 61–90, trên 90 ngày), lần
 * thu tiền và trạng thái phiếu thu Tài chính, điều chỉnh chờ duyệt, cấu hình
 * (quản trị bán hàng). Mở một khách để xem sổ công nợ, thu tiền và phân bổ.
 */
export function ReceivablesPage({ onOpenCustomer }: { onOpenCustomer: (customerId: string) => void }) {
  const { capabilities } = useCrm();
  const [tab, setTab] = useState<ReceivablesTab>('aging');
  const tabs = TABS.filter((item) => item.id !== 'settings' || capabilities.isTenantAdmin || capabilities.canManage);
  return (
    <div className={styles.page}>
      <nav className={styles.tabs} role="tablist" aria-label="Công nợ">
        {tabs.map((item) => (
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
      {tab === 'aging' ? (
        <AgingTable onOpenCustomer={onOpenCustomer} />
      ) : tab === 'receipts' ? (
        <ReceiptsTable onOpenCustomer={onOpenCustomer} />
      ) : tab === 'adjustments' ? (
        <AdjustmentsTable onOpenCustomer={onOpenCustomer} />
      ) : (
        <ReceivableSettingsPanel />
      )}
    </div>
  );
}

function AgingTable({ onOpenCustomer }: { onOpenCustomer: (customerId: string) => void }) {
  const { people } = useCrm();
  const [search, setSearch] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [rows, setRows] = useState<readonly CustomerAgingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const q = useDebounced(search.trim(), 350);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadAging({ q, ownerUserId, overdue: overdue || undefined, limit: 500 })
      .then((page) => {
        if (!active) return;
        setRows(page.items);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được tuổi nợ.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q, ownerUserId, overdue]);

  const money = (value: number) => (value ? formatMoney(value) : '');
  const columns = useMemo<ColumnsType<CustomerAgingRow>>(
    () => [
      {
        title: 'Khách hàng',
        key: 'customer',
        width: 260,
        ellipsis: true,
        render: (_: unknown, row) => (
          <span className={styles.cellWithPill}>
            <span>
              <span className={styles.mono}>{row.customerCode}</span> {row.customerName}
            </span>
            {row.creditExceeded ? <StatusPill tone="danger">Vượt hạn mức</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Hạn mức', dataIndex: 'creditLimit', width: 140, align: 'right', render: (value: number | null) => (value === null ? 'Không giới hạn' : formatMoney(value)) },
      { title: 'Dư nợ', dataIndex: 'balance', width: 140, align: 'right', render: (value: number) => <strong>{formatMoney(value)}</strong> },
      { title: 'Chưa đến hạn', key: 'notDue', width: 130, align: 'right', render: (_: unknown, row) => money(row.buckets.NOT_DUE) },
      { title: '0–30 ngày', key: 'd30', width: 120, align: 'right', render: (_: unknown, row) => money(row.buckets.D0_30) },
      { title: '31–60 ngày', key: 'd60', width: 120, align: 'right', render: (_: unknown, row) => money(row.buckets.D31_60) },
      { title: '61–90 ngày', key: 'd90', width: 120, align: 'right', render: (_: unknown, row) => money(row.buckets.D61_90) },
      {
        title: 'Trên 90 ngày',
        key: 'd90plus',
        width: 120,
        align: 'right',
        render: (_: unknown, row) => <span className={row.buckets.D90_PLUS ? styles.overdue : undefined}>{money(row.buckets.D90_PLUS)}</span>,
      },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 90,
        fixed: 'right',
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpenCustomer(row.customerId)}>
            Sổ nợ
          </button>
        ),
      },
    ],
    [people, onOpenCustomer],
  );

  const total = rows.reduce((sum, row) => sum + row.balance, 0);
  return (
    <section className={styles.tableCard} aria-label="Tuổi nợ theo khách">
      <div className={styles.toolbar}>
        <input
          className={`${styles.input} ${styles.search}`}
          type="search"
          placeholder="Tìm theo mã, tên khách…"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
        <label className={styles.checkbox}>
          <input type="checkbox" checked={overdue} onChange={(event) => setOverdue(event.target.checked)} />
          Chỉ khách có nợ đến hạn, quá hạn
        </label>
        <span className={styles.muted}>Tổng dư nợ: {formatMoney(total)}</span>
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<CustomerAgingRow>
        size="small"
        rowKey="customerId"
        loading={loading}
        columns={columns}
        dataSource={[...rows]}
        pagination={false}
        scroll={{ x: 1450 }}
        onRow={(row) => ({ onDoubleClick: () => onOpenCustomer(row.customerId) })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Chưa có công nợ nào.' }}
      />
    </section>
  );
}

function ReceiptsTable({ onOpenCustomer }: { onOpenCustomer: (customerId: string) => void }) {
  const { people } = useCrm();
  const [status, setStatus] = useState('');
  const list = useKeysetPage(status, (cursor) => listReceipts({ status: (status || undefined) as ReceiptStatus | undefined, cursor, limit: 30 }));
  const columns = useMemo<ColumnsType<ReceiptSummary>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Khách hàng', key: 'customer', ellipsis: true, render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}` },
      { title: 'Ngày thu', dataIndex: 'receiptDate', width: 110, render: (value: string) => formatDay(value) },
      { title: 'Hình thức', dataIndex: 'method', width: 120, render: (value: ReceiptSummary['method']) => RECEIPT_METHOD_LABELS[value] },
      { title: 'Số tiền', dataIndex: 'amount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'Đã phân bổ', dataIndex: 'allocatedAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 190,
        render: (value: ReceiptStatus) => <StatusPill tone={RECEIPT_STATUS_TONE[value]}>{RECEIPT_STATUS_LABELS[value]}</StatusPill>,
      },
      { title: 'Phiếu Tài chính', dataIndex: 'financeVoucherCode', width: 140, render: (value: string | null) => value ?? <span className={styles.muted}>Chưa có</span> },
      { title: 'Người thu', dataIndex: 'createdBy', width: 150, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 80,
        fixed: 'right',
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpenCustomer(row.customerId)}>
            Mở
          </button>
        ),
      },
    ],
    [people, onOpenCustomer],
  );
  return (
    <section className={styles.tableCard} aria-label="Lần thu tiền">
      <div className={styles.toolbar}>
        <SearchableSelect className={styles.filter} options={labelOptions(RECEIPT_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<ReceiptSummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1400 }}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có lần thu nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="lần thu" onPrevious={list.previous} onNext={list.next} />
    </section>
  );
}

/** Bảng điều chỉnh công nợ; dùng ở trang công nợ (mọi khách) và sổ nợ của một khách. */
export function AdjustmentsTable({ customerId, onOpenCustomer, onChanged }: { customerId?: string; onOpenCustomer?: (customerId: string) => void; onChanged?: () => void }) {
  const { people, capabilities, currentUserId } = useCrm();
  const [status, setStatus] = useState('');
  const [acting, setActing] = useState<{ adjustment: ReceivableAdjustment; action: 'approve' | 'cancel' }>();
  const list = useKeysetPage(`${customerId ?? ''}|${status}`, (cursor) =>
    listAdjustments({ customerId, status: (status || undefined) as AdjustmentStatus | undefined, cursor, limit: 30 }),
  );
  const columns: ColumnsType<ReceivableAdjustment> = [
    { title: 'Mã', dataIndex: 'code', width: 120, render: (value: string) => <span className={styles.mono}>{value}</span> },
    ...(customerId ? [] : [{ title: 'Khách hàng', key: 'customer', ellipsis: true, render: (_: unknown, row: ReceivableAdjustment) => `${row.customerCode} - ${row.customerName}` }]),
    { title: 'Loại', dataIndex: 'direction', width: 150, render: (value: ReceivableAdjustment['direction']) => ADJUSTMENT_DIRECTION_LABELS[value] },
    { title: 'Số tiền', dataIndex: 'amount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Đơn', dataIndex: 'orderCode', width: 120, render: (value: string | null) => value ?? '' },
    { title: 'Lý do', dataIndex: 'reason', ellipsis: true },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (value: AdjustmentStatus) => <StatusPill tone={ADJUSTMENT_STATUS_TONE[value]}>{ADJUSTMENT_STATUS_LABELS[value]}</StatusPill>,
    },
    { title: 'Người lập', dataIndex: 'createdBy', width: 140, ellipsis: true, render: (value: string) => personName(people, value) },
    { title: 'Người duyệt', dataIndex: 'approvedBy', width: 140, ellipsis: true, render: (value: string | null) => (value ? personName(people, value) : '') },
    {
      title: '',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_: unknown, row) => (
        <span className={styles.rowActions}>
          {adjustmentActions(row, capabilities, currentUserId).map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'approve' ? styles.rowActionPrimary : styles.rowActionDanger}
              onClick={() => setActing({ adjustment: row, action })}
            >
              {action === 'approve' ? 'Duyệt' : 'Huỷ'}
            </button>
          ))}
          {onOpenCustomer ? (
            <button type="button" className={styles.rowAction} onClick={() => onOpenCustomer(row.customerId)}>
              Mở
            </button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <section className={styles.tableCard} aria-label="Điều chỉnh công nợ">
      <div className={styles.toolbar}>
        <SearchableSelect className={styles.filter} options={labelOptions(ADJUSTMENT_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<ReceivableAdjustment>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1300 }}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có điều chỉnh nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="điều chỉnh" onPrevious={list.previous} onNext={list.next} />
      {acting ? (
        <AdjustmentActionDialog
          adjustment={acting.adjustment}
          action={acting.action}
          onClose={() => setActing(undefined)}
          onDone={() => {
            setActing(undefined);
            list.reload();
            onChanged?.();
          }}
        />
      ) : null}
    </section>
  );
}

function AdjustmentActionDialog({
  adjustment,
  action,
  onClose,
  onDone,
}: {
  adjustment: ReceivableAdjustment;
  action: 'approve' | 'cancel';
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (action === 'cancel' && !reason.trim()) return setError('Vui lòng ghi lý do huỷ.');
    setSaving(true);
    setError(undefined);
    try {
      await adjustmentAction(adjustment.id, action, { revision: adjustment.revision, reason: reason.trim() || null });
      toast.success(action === 'approve' ? `Đã duyệt điều chỉnh ${adjustment.code}; sổ công nợ có dòng điều chỉnh mới.` : `Đã huỷ điều chỉnh ${adjustment.code}.`);
      onDone();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thực hiện được thao tác.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog
      open
      title={action === 'approve' ? `Duyệt điều chỉnh ${adjustment.code}` : `Huỷ điều chỉnh ${adjustment.code}`}
      subtitle={`${ADJUSTMENT_DIRECTION_LABELS[adjustment.direction]} ${formatMoney(adjustment.amount)} · ${adjustment.reason}`}
      submitLabel={action === 'approve' ? 'Duyệt' : 'Huỷ điều chỉnh'}
      danger={action === 'cancel'}
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {action === 'cancel' ? (
        <Field label="Lý do huỷ" required wide>
          <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      ) : (
        <p className={styles.muted}>Duyệt xong, sổ công nợ ghi dòng điều chỉnh; dòng gốc không đổi.</p>
      )}
    </CrmDialog>
  );
}

function ReceivableSettingsPanel() {
  const { people } = useCrm();
  const [settings, setSettings] = useState<ReceivableSettings>();
  const [mode, setMode] = useState<CreditLimitMode>('APPROVAL');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadReceivableSettings()
      .then((next) => {
        setSettings(next);
        setMode(next.creditLimitMode);
        setUserIds([...next.alertUserIds]);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được cấu hình công nợ.')));
  }, []);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const next = await saveReceivableSettings({ creditLimitMode: mode, alertUserIds: userIds });
      setSettings(next);
      toast.success('Đã lưu cấu hình công nợ.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cấu hình công nợ.'));
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return error ? <p className={styles.alert}>{error}</p> : null;
  return (
    <section className={styles.panel} aria-label="Cấu hình công nợ">
      <h3 className={styles.sectionTitle}>Cấu hình công nợ</h3>
      <div className={styles.fieldGrid}>
        <Field label="Ghi nhận nợ" hint="Hợp đồng có đợt thanh toán thì ghi nợ theo đợt">
          <input className={styles.input} value="Khi chứng từ xuất giao hàng được ghi sổ" disabled readOnly />
        </Field>
        <Field label="Vượt hạn mức công nợ khi xác nhận đơn" hint="Cách duyệt (trực tiếp hay qua Quy trình) chọn ở Cấu hình, Duyệt báo giá, loại hạn mức công nợ">
          <SearchableSelect options={labelOptions(CREDIT_LIMIT_MODE_LABELS)} value={mode} onChange={(value) => setMode((value || 'APPROVAL') as CreditLimitMode)} />
        </Field>
        <Field label="Người nhận thêm cảnh báo quá hạn, vượt hạn mức" hint="Ngoài người phụ trách khách hàng và đơn, ví dụ kế toán công nợ" wide>
          <SearchableSelect
            options={peopleOptions(people).filter((option) => !userIds.includes(option.value))}
            value=""
            placeholder="Thêm người nhận"
            onChange={(value) => value && setUserIds((current) => [...new Set([...current, value])])}
          />
        </Field>
      </div>
      {userIds.length ? (
        <ul className={styles.toolbar}>
          {userIds.map((id) => (
            <li key={id}>
              <StatusPill tone="info">
                {personName(people, id)}{' '}
                <button type="button" className={styles.iconButton} aria-label={`Bỏ ${personName(people, id)}`} onClick={() => setUserIds((current) => current.filter((value) => value !== id))}>
                  <X size={12} />
                </button>
              </StatusPill>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className={styles.alert}>{error}</p> : null}
      <div className={styles.formActions}>
        <button type="button" className={styles.buttonPrimary} disabled={saving} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </button>
      </div>
    </section>
  );
}
