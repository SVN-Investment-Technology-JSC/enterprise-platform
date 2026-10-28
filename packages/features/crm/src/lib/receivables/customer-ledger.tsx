'use client';

import {
  ADJUSTMENT_DIRECTION_LABELS,
  AGING_BUCKET_LABELS,
  AGING_BUCKETS,
  RECEIPT_METHOD_LABELS,
  RECEIPT_STATUS_LABELS,
  RECEIVABLE_ENTRY_KIND_LABELS,
  type AdjustmentDirection,
  type CustomerLedger as Ledger,
  type ReceiptDetail,
  type ReceiptMethod,
  type ReceiptStatus,
  type ReceiptSummary,
  type ReceivableEntry,
  type ReceivableOpenItem,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useKeysetPage } from '../components/use-keyset-page';
import {
  cancelReceipt,
  createAdjustment,
  createReceipt,
  errorMessage,
  getReceipt,
  listReceipts,
  loadLedger,
  resendReceipt,
} from '../crm-api';
import { labelOptions, useCrm } from '../crm-context';
import { formatDay } from '../fulfillment.model';
import { parseNumber } from '../pricing/pricing.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { AdjustmentsTable } from './receivables-page';
import {
  AGING_BUCKET_TONE,
  ENTRY_KIND_TONE,
  RECEIPT_STATUS_TONE,
  allocationError,
  allocationRequests,
  autoAllocate,
  canWriteReceivable,
  receiptActions,
} from './receivables.model';

/**
 * Sổ công nợ của một khách (T5-12): hạn mức, dư nợ, tuổi nợ; khoản nợ còn mở
 * (đang được lần thu giữ chỗ); lần thu và trạng thái phiếu thu Tài chính; điều
 * chỉnh; dòng sổ chỉ ghi thêm. Thu tiền phân bổ vào một hay nhiều khoản.
 */
export function CustomerLedger({
  customerId,
  onBack,
  onOpenCustomer,
  onOpenOrder,
}: {
  customerId: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenOrder: (id: string) => void;
}) {
  const { capabilities } = useCrm();
  const [ledger, setLedger] = useState<Ledger>();
  const [error, setError] = useState<string>();
  const [receiving, setReceiving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [openReceipt, setOpenReceipt] = useState<string>();
  const [version, setVersion] = useState(0);
  const canWrite = canWriteReceivable(capabilities);

  const load = useCallback(
    () =>
      loadLedger(customerId)
        .then((next) => {
          setLedger(next);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được sổ công nợ.'))),
    [customerId],
  );
  useEffect(() => {
    void load();
  }, [load, version]);
  const refresh = () => setVersion((value) => value + 1);

  if (error && !ledger) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Công nợ
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!ledger) return null;

  const openColumns: ColumnsType<ReceivableOpenItem> = [
    {
      title: 'Khoản nợ',
      key: 'item',
      ellipsis: true,
      render: (_: unknown, row) =>
        row.orderId ? (
          <button type="button" className={styles.linkButton} onClick={() => onOpenOrder(row.orderId as string)}>
            {row.description ?? `Đơn ${row.orderCode}`}
          </button>
        ) : (
          (row.description ?? RECEIVABLE_ENTRY_KIND_LABELS[row.kind])
        ),
    },
    { title: 'Ngày', dataIndex: 'entryDate', width: 100, render: (value: string) => formatDay(value) },
    { title: 'Hạn', dataIndex: 'dueDate', width: 100, render: (value: string | null) => formatDay(value) },
    { title: 'Phát sinh', dataIndex: 'amount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Còn nợ', dataIndex: 'openAmount', width: 130, align: 'right', render: (value: number) => <strong>{formatMoney(value)}</strong> },
    { title: 'Đang chờ ghi sổ', dataIndex: 'pendingAmount', width: 130, align: 'right', render: (value: number) => (value ? formatMoney(value) : '') },
    {
      title: 'Tuổi nợ',
      key: 'bucket',
      width: 170,
      render: (_: unknown, row) => (
        <StatusPill tone={AGING_BUCKET_TONE[row.bucket]}>
          {AGING_BUCKET_LABELS[row.bucket]}
          {row.daysOverdue !== null && row.daysOverdue > 0 ? ` · quá ${row.daysOverdue} ngày` : ''}
        </StatusPill>
      ),
    },
  ];

  const entryColumns: ColumnsType<ReceivableEntry> = [
    { title: 'Ngày', dataIndex: 'entryDate', width: 100, render: (value: string) => formatDay(value) },
    {
      title: 'Loại',
      dataIndex: 'kind',
      width: 130,
      render: (value: ReceivableEntry['kind']) => <StatusPill tone={ENTRY_KIND_TONE[value]}>{RECEIVABLE_ENTRY_KIND_LABELS[value]}</StatusPill>,
    },
    { title: 'Diễn giải', dataIndex: 'description', ellipsis: true },
    {
      title: 'Chứng từ',
      key: 'ref',
      width: 160,
      render: (_: unknown, row) => row.receiptCode ?? row.adjustmentCode ?? row.contractCode ?? row.orderCode ?? '',
    },
    { title: 'Hạn', dataIndex: 'dueDate', width: 100, render: (value: string | null) => formatDay(value) },
    { title: 'Tăng nợ', key: 'debit', width: 130, align: 'right', render: (_: unknown, row) => (row.amount > 0 ? formatMoney(row.amount) : '') },
    { title: 'Giảm nợ', key: 'credit', width: 130, align: 'right', render: (_: unknown, row) => (row.amount < 0 ? formatMoney(-row.amount) : '') },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.detailHead}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Công nợ
        </button>
        <h2 className={styles.detailTitle}>
          Sổ công nợ{' '}
          <button type="button" className={styles.linkButton} onClick={() => onOpenCustomer(ledger.customerId)}>
            {ledger.customerCode} - {ledger.customerName}
          </button>
        </h2>
        {ledger.creditExceeded ? <StatusPill tone="danger">Vượt hạn mức</StatusPill> : null}
      </div>

      <section className={styles.panel} aria-label="Tổng hợp công nợ">
        <dl className={styles.facts}>
          <dt>Dư nợ</dt>
          <dd>
            <strong>{formatMoney(ledger.balance)}</strong>
          </dd>
          <dt>Hạn mức</dt>
          <dd>{ledger.creditLimit === null ? 'Không giới hạn' : formatMoney(ledger.creditLimit)}</dd>
          <dt>Thời hạn thanh toán</dt>
          <dd>{ledger.paymentTermDays === null ? 'Chưa đặt' : `${ledger.paymentTermDays} ngày`}</dd>
          <dt>Đến hạn và quá hạn</dt>
          <dd className={ledger.overdueAmount ? styles.overdue : undefined}>{formatMoney(ledger.overdueAmount)}</dd>
          {ledger.unappliedAmount ? (
            <>
              <dt>Thu chưa phân bổ</dt>
              <dd>{formatMoney(ledger.unappliedAmount)}</dd>
            </>
          ) : null}
          {AGING_BUCKETS.map((bucket) => (
            <span key={bucket} style={{ display: 'contents' }}>
              <dt>{AGING_BUCKET_LABELS[bucket]}</dt>
              <dd>{formatMoney(ledger.buckets[bucket])}</dd>
            </span>
          ))}
        </dl>
        {canWrite ? (
          <div className={styles.toolbar}>
            <button type="button" className={styles.buttonPrimary} onClick={() => setReceiving(true)}>
              <Plus size={14} /> Ghi nhận thu tiền
            </button>
            <button type="button" className={styles.buttonGhost} onClick={() => setAdjusting(true)}>
              Điều chỉnh công nợ
            </button>
          </div>
        ) : null}
      </section>

      <section className={styles.tableCard} aria-label="Khoản nợ còn mở">
        <h3 className={styles.sectionTitle}>Khoản nợ còn mở</h3>
        <Table<ReceivableOpenItem>
          size="small"
          rowKey="entryId"
          columns={openColumns}
          dataSource={[...ledger.openItems]}
          pagination={false}
          scroll={{ x: 1000 }}
          locale={{ emptyText: 'Không còn khoản nợ nào.' }}
        />
      </section>

      <CustomerReceipts customerId={customerId} version={version} onOpen={setOpenReceipt} />

      <AdjustmentsTable customerId={customerId} onChanged={refresh} key={`adjustments-${version}`} />

      <section className={styles.tableCard} aria-label="Sổ công nợ">
        <h3 className={styles.sectionTitle}>Sổ công nợ (chỉ ghi thêm)</h3>
        <Table<ReceivableEntry>
          size="small"
          rowKey="id"
          columns={entryColumns}
          dataSource={[...ledger.entries]}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 1000 }}
          locale={{ emptyText: 'Chưa có phát sinh.' }}
        />
      </section>

      {receiving ? (
        <ReceiptDialog
          ledger={ledger}
          onClose={() => setReceiving(false)}
          onSaved={() => {
            setReceiving(false);
            refresh();
          }}
        />
      ) : null}
      {adjusting ? (
        <AdjustmentDialog
          ledger={ledger}
          onClose={() => setAdjusting(false)}
          onSaved={() => {
            setAdjusting(false);
            refresh();
          }}
        />
      ) : null}
      {openReceipt ? (
        <ReceiptDetailDialog
          receiptId={openReceipt}
          ledger={ledger}
          onClose={() => setOpenReceipt(undefined)}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}

function CustomerReceipts({ customerId, version, onOpen }: { customerId: string; version: number; onOpen: (id: string) => void }) {
  const { people } = useCrm();
  const list = useKeysetPage(`${customerId}|${version}`, (cursor) => listReceipts({ customerId, cursor, limit: 20 }));
  const columns: ColumnsType<ReceiptSummary> = [
    { title: 'Mã', dataIndex: 'code', width: 120, render: (value: string) => <span className={styles.mono}>{value}</span> },
    { title: 'Ngày thu', dataIndex: 'receiptDate', width: 110, render: (value: string) => formatDay(value) },
    { title: 'Hình thức', dataIndex: 'method', width: 120, render: (value: ReceiptMethod) => RECEIPT_METHOD_LABELS[value] },
    { title: 'Số tiền', dataIndex: 'amount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Đã phân bổ', dataIndex: 'allocatedAmount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 190,
      render: (value: ReceiptStatus) => <StatusPill tone={RECEIPT_STATUS_TONE[value]}>{RECEIPT_STATUS_LABELS[value]}</StatusPill>,
    },
    { title: 'Phiếu Tài chính', dataIndex: 'financeVoucherCode', width: 140, render: (value: string | null) => value ?? '' },
    { title: 'Người thu', dataIndex: 'createdBy', width: 150, ellipsis: true, render: (value: string) => personName(people, value) },
    {
      title: '',
      key: 'actions',
      width: 70,
      render: (_: unknown, row) => (
        <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
          Mở
        </button>
      ),
    },
  ];
  return (
    <section className={styles.tableCard} aria-label="Lần thu tiền của khách">
      <h3 className={styles.sectionTitle}>Lần thu tiền</h3>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<ReceiptSummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1100 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có lần thu nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="lần thu" onPrevious={list.previous} onNext={list.next} />
    </section>
  );
}

/** Bảng nhập phân bổ: mỗi khoản nợ còn mở một ô số tiền. */
function AllocationTable({
  items,
  allocations,
  onChange,
}: {
  items: readonly ReceivableOpenItem[];
  allocations: Readonly<Record<string, number>>;
  onChange: (next: Record<string, number>) => void;
}) {
  const columns: ColumnsType<ReceivableOpenItem> = [
    { title: 'Khoản nợ', key: 'item', ellipsis: true, render: (_: unknown, row) => row.description ?? (row.orderCode ? `Đơn ${row.orderCode}` : 'Khoản nợ') },
    { title: 'Hạn', dataIndex: 'dueDate', width: 100, render: (value: string | null) => formatDay(value) },
    { title: 'Còn phân bổ được', dataIndex: 'allocatableAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
    {
      title: 'Phân bổ',
      key: 'allocate',
      width: 160,
      render: (_: unknown, row) => (
        <input
          className={styles.input}
          inputMode="numeric"
          aria-label={`Phân bổ vào ${row.description ?? 'khoản nợ'}`}
          value={allocations[row.entryId] ? String(allocations[row.entryId]) : ''}
          onChange={(event) => onChange({ ...allocations, [row.entryId]: parseNumber(event.target.value) ?? 0 })}
        />
      ),
    },
  ];
  return (
    <Table<ReceivableOpenItem>
      size="small"
      rowKey="entryId"
      columns={columns}
      dataSource={items.filter((item) => item.allocatableAmount > 0 || allocations[item.entryId])}
      pagination={false}
      scroll={{ x: 600, y: 280 }}
      locale={{ emptyText: 'Không còn khoản nợ nào để phân bổ; số thu ghi nhận là tiền trả trước.' }}
    />
  );
}

function ReceiptDialog({ ledger, onClose, onSaved }: { ledger: Ledger; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('BANK_TRANSFER');
  const [receiptDate, setReceiptDate] = useState('');
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const value = parseNumber(amount) ?? 0;
  const allocated = Object.values(allocations).reduce((sum, item) => sum + (item || 0), 0);

  async function save() {
    const problem = allocationError(value, allocations, ledger.openItems);
    if (problem) return setError(problem);
    setSaving(true);
    setError(undefined);
    try {
      const created = await createReceipt({
        customerId: ledger.customerId,
        amount: value,
        method,
        receiptDate: receiptDate || null,
        note: note.trim() || null,
        allocations: allocationRequests(allocations),
      });
      toast.success(
        created.status === 'VOUCHER_DRAFT'
          ? `Đã ghi nhận lần thu ${created.code}; Tài chính đã có phiếu thu nháp ${created.financeVoucherCode ?? ''}, chờ kế toán ghi sổ.`
          : `Đã ghi nhận lần thu ${created.code}; đang chờ Tài chính tạo phiếu thu.`,
      );
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không ghi nhận được lần thu.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title="Ghi nhận thu tiền"
      subtitle={`${ledger.customerCode} - ${ledger.customerName}. Phân bổ có hiệu lực khi kế toán ghi sổ phiếu thu bên Tài chính.`}
      submitLabel="Ghi nhận"
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Số tiền thu" required>
          <input className={styles.input} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="Hình thức">
          <SearchableSelect options={labelOptions(RECEIPT_METHOD_LABELS)} value={method} onChange={(next) => setMethod((next || 'BANK_TRANSFER') as ReceiptMethod)} />
        </Field>
        <Field label="Ngày thu" hint="Bỏ trống: hôm nay">
          <DatePickerInput value={receiptDate || undefined} onChange={setReceiptDate} height={38} aria-label="Ngày thu" />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.buttonGhost} disabled={!value} onClick={() => setAllocations(autoAllocate(ledger.openItems, value))}>
          Phân bổ theo hạn sớm trước
        </button>
        <span className={styles.muted}>
          Đã phân bổ {formatMoney(allocated)} / {formatMoney(value)}
          {value > allocated ? ` · chưa phân bổ ${formatMoney(value - allocated)} (trả trước)` : ''}
        </span>
      </div>
      <AllocationTable items={ledger.openItems} allocations={allocations} onChange={setAllocations} />
    </CrmDialog>
  );
}

function ReceiptDetailDialog({
  receiptId,
  ledger,
  onClose,
  onChanged,
}: {
  receiptId: string;
  ledger: Ledger;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { capabilities, people } = useCrm();
  const [receipt, setReceipt] = useState<ReceiptDetail>();
  const [mode, setMode] = useState<'view' | 'resend' | 'cancel'>('view');
  const [amount, setAmount] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    getReceipt(receiptId)
      .then((next) => {
        setReceipt(next);
        setAmount(String(next.amount));
        setAllocations(Object.fromEntries(next.allocations.map((line) => [line.entryId, line.amount])));
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được lần thu.')));
  }, [receiptId]);

  if (!receipt) {
    return error ? (
      <CrmDialog open title="Lần thu" submitLabel="Đóng" error={error} onClose={onClose} onSubmit={onClose}>
        <span />
      </CrmDialog>
    ) : null;
  }
  const actions = receiptActions(receipt, capabilities);
  // Khoản nợ khi sửa: phần đang giữ của chính lần thu này được cộng lại vào số phân bổ được.
  const editable = ledger.openItems.map((item) => {
    const own = receipt.allocations.find((line) => line.entryId === item.entryId)?.amount ?? 0;
    return { ...item, allocatableAmount: item.allocatableAmount + own };
  });
  const value = parseNumber(amount) ?? 0;

  async function submit() {
    if (!receipt) return;
    if (mode === 'view') return onClose();
    setSaving(true);
    setError(undefined);
    try {
      if (mode === 'resend') {
        const problem = allocationError(value, allocations, editable);
        if (problem) {
          setError(problem);
          return;
        }
        await resendReceipt(receipt.id, { revision: receipt.revision, amount: value, allocations: allocationRequests(allocations) });
        toast.success(`Đã gửi lại lần thu ${receipt.code} sang Tài chính.`);
      } else {
        if (!reason.trim()) {
          setError('Vui lòng ghi lý do huỷ.');
          return;
        }
        await cancelReceipt(receipt.id, { revision: receipt.revision, reason: reason.trim() });
        toast.success(`Đã huỷ lần thu ${receipt.code}.`);
      }
      onChanged();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thực hiện được thao tác.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={`Lần thu ${receipt.code}`}
      subtitle={`${RECEIPT_STATUS_LABELS[receipt.status]}${receipt.financeVoucherCode ? ` · phiếu ${receipt.financeVoucherCode}` : ''}`}
      submitLabel={mode === 'resend' ? 'Gửi lại Tài chính' : mode === 'cancel' ? 'Huỷ lần thu' : 'Đóng'}
      danger={mode === 'cancel'}
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <dl className={styles.facts}>
        <dt>Số tiền</dt>
        <dd>{formatMoney(receipt.amount)}</dd>
        <dt>Hình thức</dt>
        <dd>{RECEIPT_METHOD_LABELS[receipt.method]}</dd>
        <dt>Ngày thu</dt>
        <dd>{formatDay(receipt.receiptDate)}</dd>
        <dt>Người thu</dt>
        <dd>{personName(people, receipt.createdBy)}</dd>
        {receipt.returnReason ? (
          <>
            <dt>Lý do trả lại</dt>
            <dd className={styles.overdue}>{receipt.returnReason}</dd>
          </>
        ) : null}
        {receipt.voucherError ? (
          <>
            <dt>Tài chính từ chối</dt>
            <dd className={styles.overdue}>{receipt.voucherError}</dd>
          </>
        ) : null}
        {receipt.note ? (
          <>
            <dt>Ghi chú</dt>
            <dd>{receipt.note}</dd>
          </>
        ) : null}
      </dl>
      {mode === 'resend' ? (
        <>
          <Field label="Số tiền thu" required>
            <input className={styles.input} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <AllocationTable items={editable} allocations={allocations} onChange={setAllocations} />
        </>
      ) : mode === 'cancel' ? (
        <Field label="Lý do huỷ" required wide>
          <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      ) : (
        <Table
          size="small"
          rowKey="id"
          columns={[
            { title: 'Khoản nợ', key: 'item', render: (_: unknown, row: ReceiptDetail['allocations'][number]) => row.entryDescription ?? row.orderCode ?? '' },
            { title: 'Hạn', dataIndex: 'dueDate', width: 100, render: (value: string | null) => formatDay(value) },
            { title: 'Phân bổ', dataIndex: 'amount', width: 130, align: 'right' as const, render: (value: number) => formatMoney(value) },
            {
              title: 'Hiệu lực',
              dataIndex: 'effective',
              width: 140,
              render: (value: boolean) => <StatusPill tone={value ? 'success' : 'neutral'}>{value ? 'Đã ghi sổ' : 'Chờ ghi sổ'}</StatusPill>,
            },
          ]}
          dataSource={[...receipt.allocations]}
          pagination={false}
          locale={{ emptyText: 'Lần thu không phân bổ vào khoản nào (trả trước).' }}
        />
      )}
      {mode === 'view' && actions.length ? (
        <div className={styles.toolbar}>
          {actions.includes('resend') ? (
            <button type="button" className={styles.buttonPrimary} onClick={() => setMode('resend')}>
              Sửa và gửi lại
            </button>
          ) : null}
          {actions.includes('cancel') ? (
            <button type="button" className={styles.buttonDangerGhost} onClick={() => setMode('cancel')}>
              Huỷ lần thu
            </button>
          ) : null}
        </div>
      ) : null}
    </CrmDialog>
  );
}

function AdjustmentDialog({ ledger, onClose, onSaved }: { ledger: Ledger; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<AdjustmentDirection>('DECREASE');
  const [entryId, setEntryId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const value = parseNumber(amount) ?? 0;
    if (!(value > 0)) return setError('Số tiền điều chỉnh phải lớn hơn 0.');
    if (!reason.trim()) return setError('Vui lòng ghi lý do điều chỉnh.');
    setSaving(true);
    setError(undefined);
    try {
      const item = ledger.openItems.find((candidate) => candidate.entryId === entryId);
      const created = await createAdjustment({
        customerId: ledger.customerId,
        direction,
        amount: value,
        reason: reason.trim(),
        entryId: direction === 'DECREASE' && entryId ? entryId : null,
        orderId: item?.orderId ?? null,
      });
      toast.success(`Đã lập điều chỉnh ${created.code}; chờ quản lý duyệt.`);
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lập được điều chỉnh.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      title="Điều chỉnh công nợ"
      subtitle="Giảm trừ do trả hàng, chiết khấu thanh toán; người khác người lập duyệt rồi mới vào sổ."
      submitLabel="Lập điều chỉnh"
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Loại điều chỉnh" required>
          <SearchableSelect
            options={labelOptions(ADJUSTMENT_DIRECTION_LABELS)}
            value={direction}
            onChange={(next) => setDirection((next || 'DECREASE') as AdjustmentDirection)}
          />
        </Field>
        <Field label="Số tiền" required>
          <input className={styles.input} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        {direction === 'DECREASE' ? (
          <Field label="Khoản nợ" hint="Bỏ trống: trừ vào các khoản theo hạn sớm trước" wide>
            <SearchableSelect
              options={ledger.openItems
                .filter((item) => item.openAmount > 0)
                .map((item) => ({
                  value: item.entryId,
                  label: item.description ?? (item.orderCode ? `Đơn ${item.orderCode}` : 'Khoản nợ'),
                  badge: formatMoney(item.openAmount),
                  description: item.dueDate ? `Hạn ${formatDay(item.dueDate)}` : undefined,
                }))}
              value={entryId}
              placeholder="Mọi khoản còn nợ"
              clearable
              onChange={setEntryId}
            />
          </Field>
        ) : null}
        <Field label="Lý do" required wide>
          <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
