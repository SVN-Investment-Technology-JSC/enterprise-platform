'use client';

import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  PAYMENT_TERM_CONDITION_LABELS,
  PAYMENT_TERM_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  SALES_ORDER_STATUS_LABELS,
  type ContractDetail as ContractDetailData,
  type ContractLine,
  type ContractOrderRef,
  type PaymentTerm,
  type PaymentTermCondition,
  type SalesOrderStatus,
  type SavePaymentTermRequest,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { MaterialPickerDialog } from '../components/material-picker';
import {
  contractAction,
  errorMessage,
  getContract,
  savePaymentTerms,
  triggerPaymentTerm,
  updateContract,
  type ContractAction,
} from '../crm-api';
import { labelOptions, useCrm } from '../crm-context';
import {
  CONTRACT_STATUS_TONE,
  FULFILLMENT_ACTION_LABELS,
  ORDER_STATUS_TONE,
  canTriggerPaymentTerm,
  paymentTermTriggerLabels,
  contractActions,
  formatDay,
  formatQuantity,
  paymentTermTotals,
} from '../fulfillment.model';
import { formatPercent, parseNumber } from '../pricing/pricing.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { ContractFormDialog } from './contracts-page';

const ACTION_DONE: Readonly<Record<ContractAction, string>> = {
  confirm: 'Đã xác nhận hợp đồng.',
  cancel: 'Đã huỷ hợp đồng.',
  complete: 'Đã chuyển hợp đồng sang Hoàn thành.',
  liquidate: 'Đã thanh lý hợp đồng.',
};

/** Dòng lưới đợt thanh toán đang sửa (chuỗi như người dùng gõ). */
interface TermDraft {
  readonly key: string;
  name: string;
  mode: 'percent' | 'amount';
  value: string;
  condition: PaymentTermCondition;
  dueDate: string;
  dueDays: string;
  note: string;
}

const termDraft = (term: PaymentTerm): TermDraft => ({
  key: term.id,
  name: term.name,
  mode: term.percent === null ? 'amount' : 'percent',
  value: String(term.percent ?? term.amount),
  condition: term.condition,
  dueDate: term.dueDate ?? '',
  dueDays: term.dueDays === null ? '' : String(term.dueDays),
  note: term.note ?? '',
});

/**
 * Chi tiết hợp đồng (T4-15): dòng giá khung, lưới đợt thanh toán (tổng phải
 * bằng 100% giá trị), phần giữ hàng, đơn gắn hợp đồng, nhật ký; xác nhận (giữ
 * hàng ở Kho), huỷ, hoàn thành, thanh lý.
 */
export function ContractDetail({
  contractId,
  onBack,
  onOpenCustomer,
  onOpenOrder,
  onOpenQuote,
}: {
  contractId: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenQuote: (id: string) => void;
}) {
  const { capabilities, people } = useCrm();
  const [detail, setDetail] = useState<ContractDetailData>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [reasonFor, setReasonFor] = useState<Exclude<ContractAction, 'confirm'>>();
  const [terms, setTerms] = useState<TermDraft[]>([]);
  const [triggering, setTriggering] = useState<PaymentTerm>();
  const [triggerDate, setTriggerDate] = useState('');

  const load = useCallback(
    () =>
      getContract(contractId)
        .then((next) => {
          setDetail(next);
          setTerms(next.paymentTerms.map(termDraft));
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được hợp đồng.'))),
    [contractId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<ContractDetailData>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      const next = await work();
      setDetail(next);
      setTerms(next.paymentTerms.map(termDraft));
      if (success) toast.success(success);
      return true;
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thực hiện được thao tác.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách hợp đồng
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!detail) return null;

  const actions = contractActions(detail, capabilities);
  const editable = actions.includes('edit');
  const act = (action: ContractAction, reason?: string) =>
    run(() => contractAction(detail.id, action, { revision: detail.revision, reason }), ACTION_DONE[action]);
  const replaceLines = (lines: readonly ContractLine[]) =>
    updateContract(detail.id, {
      revision: detail.revision,
      lines: lines.map((line) => ({
        materialId: line.materialId,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        note: line.note,
      })),
    });

  const lineColumns: ColumnsType<ContractLine> = [
    { title: '#', dataIndex: 'lineNo', width: 44, align: 'right' },
    {
      title: 'Mặt hàng',
      key: 'material',
      render: (_: unknown, row) => (
        <span>
          <span className={styles.mono}>{row.materialCode}</span> {row.materialName}
          {row.materialKind === 'SERVICE' ? (
            <>
              {' '}
              <StatusPill tone="neutral">Dịch vụ</StatusPill>
            </>
          ) : null}
        </span>
      ),
    },
    { title: 'SL', key: 'quantity', width: 110, align: 'right', render: (_: unknown, row) => (row.quantity === null ? 'Theo đơn' : `${formatQuantity(row.quantity)} ${row.unit}`) },
    { title: 'Giá khung', dataIndex: 'unitPrice', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'VAT', dataIndex: 'vatRate', width: 70, align: 'right', render: (value: number) => formatPercent(value) },
    { title: 'Thành tiền', dataIndex: 'lineAmount', width: 140, align: 'right', render: (value: number | null) => (value === null ? '' : formatMoney(value)) },
    {
      title: '',
      key: 'actions',
      width: 70,
      render: (_: unknown, row) =>
        editable ? (
          <Popconfirm
            title="Bỏ dòng này?"
            okText="Bỏ"
            cancelText="Huỷ"
            okType="danger"
            onConfirm={() => run(() => replaceLines(detail.lines.filter((line) => line.id !== row.id)), 'Đã bỏ dòng.').then(() => undefined)}
          >
            <button type="button" className={styles.rowActionDanger}>
              Bỏ
            </button>
          </Popconfirm>
        ) : null,
    },
  ];

  const orderColumns: ColumnsType<ContractOrderRef> = [
    {
      title: 'Mã đơn',
      dataIndex: 'code',
      width: 140,
      render: (value: string, row) => (
        <button type="button" className={styles.linkButton} onClick={() => onOpenOrder(row.id)}>
          {value}
        </button>
      ),
    },
    { title: 'Ngày đơn', dataIndex: 'orderDate', width: 120, render: (value: string) => formatDay(value) },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 160,
      render: (value: SalesOrderStatus) => <StatusPill tone={ORDER_STATUS_TONE[value]}>{SALES_ORDER_STATUS_LABELS[value]}</StatusPill>,
    },
    { title: 'Tổng cộng', dataIndex: 'totalAmount', align: 'right', render: (value: number) => formatMoney(value) },
  ];

  const parsedTerms = terms.map((term) => {
    const number = parseNumber(term.value);
    return term.mode === 'percent' ? { percent: number ?? null, amount: null } : { percent: null, amount: number ?? null };
  });
  const totals = paymentTermTotals(parsedTerms, detail.value);
  const termsDirty = JSON.stringify(terms) !== JSON.stringify(detail.paymentTerms.map(termDraft));

  function updateTerm(index: number, patch: Partial<TermDraft>) {
    setTerms((current) => current.map((term, position) => (position === index ? { ...term, ...patch } : term)));
  }

  const current = detail;
  function saveTerms() {
    const body: SavePaymentTermRequest[] = terms.map((term, index) => ({
      name: term.name.trim() || `Đợt ${index + 1}`,
      percent: term.mode === 'percent' ? (parseNumber(term.value) ?? Number.NaN) : null,
      amount: term.mode === 'amount' ? (parseNumber(term.value) ?? Number.NaN) : null,
      condition: term.condition,
      dueDate: term.dueDate || null,
      dueDays: term.dueDays.trim() ? Number(term.dueDays) : null,
      note: term.note.trim() || null,
    }));
    return run(() => savePaymentTerms(current.id, { revision: current.revision, terms: body }), 'Đã lưu đợt thanh toán.');
  }

  return (
    <div className={styles.page}>
      <div className={styles.detailHead}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách hợp đồng
        </button>
        <h2 className={styles.detailTitle}>
          Hợp đồng <span className={styles.mono}>{detail.code}</span>
        </h2>
        <StatusPill tone={CONTRACT_STATUS_TONE[detail.status]}>{CONTRACT_STATUS_LABELS[detail.status]}</StatusPill>
      </div>

      <section className={styles.panel} aria-label="Thông tin hợp đồng">
        <dl className={styles.facts}>
          <dt>Tên hợp đồng</dt>
          <dd>{detail.title}</dd>
          <dt>Loại</dt>
          <dd>{CONTRACT_TYPE_LABELS[detail.type]}</dd>
          <dt>Khách hàng</dt>
          <dd>
            <button type="button" className={styles.linkButton} onClick={() => onOpenCustomer(detail.customerId)}>
              {detail.customerCode} - {detail.customerName}
            </button>
          </dd>
          {detail.quoteId ? (
            <>
              <dt>Báo giá gốc</dt>
              <dd>
                <button type="button" className={styles.linkButton} onClick={() => onOpenQuote(detail.quoteId as string)}>
                  {detail.quoteCode}
                </button>
              </dd>
            </>
          ) : null}
          <dt>Hiệu lực</dt>
          <dd>
            {formatDay(detail.validFrom)} - {detail.validTo ? formatDay(detail.validTo) : 'không thời hạn'}
          </dd>
          {detail.signedDate ? (
            <>
              <dt>Ngày ký</dt>
              <dd>{formatDay(detail.signedDate)}</dd>
            </>
          ) : null}
          <dt>Giá trị</dt>
          <dd>{formatMoney(detail.value)}</dd>
          {detail.warrantyMonths !== null ? (
            <>
              <dt>Bảo hành</dt>
              <dd>{detail.warrantyMonths} tháng</dd>
            </>
          ) : null}
          <dt>Kho giữ hàng</dt>
          <dd>{detail.warehouseCode ?? <span className={styles.muted}>Chưa chọn</span>}</dd>
          <dt>Giữ hàng ở Kho</dt>
          <dd>
            {detail.reservation ? (
              <>
                <span className={styles.mono}>{detail.reservation.reservationCode}</span> ·{' '}
                {RESERVATION_STATUS_LABELS[detail.reservation.status]}
                {detail.reservation.expiresAt ? ` · hạn ${formatDateTime(detail.reservation.expiresAt)}` : ''}
              </>
            ) : (
              <span className={styles.muted}>Chưa giữ (giữ khi xác nhận các dòng hàng tồn kho có số lượng)</span>
            )}
          </dd>
          <dt>Người phụ trách</dt>
          <dd>{personName(people, detail.ownerUserId)}</dd>
          {detail.note ? (
            <>
              <dt>Ghi chú</dt>
              <dd>{detail.note}</dd>
            </>
          ) : null}
        </dl>
        {actions.length ? (
          <div className={styles.toolbar}>
            {editable ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setEditing(true)}>
                Sửa thông tin
              </button>
            ) : null}
            {actions.includes('confirm') ? (
              <Popconfirm
                title="Xác nhận hợp đồng?"
                description="Hợp đồng chuyển Hiệu lực. Các dòng hàng tồn kho có số lượng được giữ ở Kho; thiếu tồn thì không giữ dòng nào."
                okText="Xác nhận"
                cancelText="Huỷ"
                onConfirm={() => act('confirm').then(() => undefined)}
              >
                <button type="button" className={styles.buttonPrimary} disabled={busy || termsDirty}>
                  Xác nhận hợp đồng
                </button>
              </Popconfirm>
            ) : null}
            {actions.includes('complete') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setReasonFor('complete')}>
                Hoàn thành
              </button>
            ) : null}
            {actions.includes('liquidate') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setReasonFor('liquidate')}>
                Thanh lý
              </button>
            ) : null}
            {actions.includes('cancel') ? (
              <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setReasonFor('cancel')}>
                Huỷ hợp đồng
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.tableCard} aria-label="Dòng giá khung">
        <div className={styles.toolbar}>
          <h3 className={styles.sectionTitle}>Dòng giá khung</h3>
          {editable ? (
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setPicking(true)}>
              <Plus size={14} /> Thêm dòng
            </button>
          ) : null}
        </div>
        <Table<ContractLine>
          size="small"
          rowKey="id"
          columns={lineColumns}
          dataSource={[...detail.lines]}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: 'Chưa có dòng nào.' }}
        />
      </section>

      <section className={styles.tableCard} aria-label="Đợt thanh toán">
        <div className={styles.toolbar}>
          <h3 className={styles.sectionTitle}>Đợt thanh toán</h3>
          {editable ? (
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy}
              onClick={() =>
                setTerms((current) => [
                  ...current,
                  { key: `new-${Date.now()}`, name: `Đợt ${current.length + 1}`, mode: 'percent', value: '', condition: 'SIGN', dueDate: '', dueDays: '', note: '' },
                ])
              }
            >
              <Plus size={14} /> Thêm đợt
            </button>
          ) : null}
        </div>
        <Table<TermDraft>
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={terms}
          scroll={{ x: 1100 }}
          locale={{ emptyText: 'Chưa có đợt thanh toán (công nợ ghi theo xuất kho).' }}
          columns={[
            { title: '#', key: 'seq', width: 44, align: 'right', render: (_: unknown, _row, index) => index + 1 },
            {
              title: 'Tên đợt',
              key: 'name',
              width: 180,
              render: (_: unknown, row, index) =>
                editable ? (
                  <input className={styles.input} maxLength={200} value={row.name} onChange={(event) => updateTerm(index, { name: event.target.value })} />
                ) : (
                  row.name
                ),
            },
            {
              title: 'Nhập theo',
              key: 'mode',
              width: 140,
              render: (_: unknown, row, index) =>
                editable ? (
                  <SearchableSelect
                    options={[
                      { value: 'percent', label: 'Phần trăm' },
                      { value: 'amount', label: 'Số tiền' },
                    ]}
                    value={row.mode}
                    onChange={(value) => updateTerm(index, { mode: value as TermDraft['mode'] })}
                  />
                ) : row.mode === 'percent' ? (
                  'Phần trăm'
                ) : (
                  'Số tiền'
                ),
            },
            {
              title: 'Giá trị',
              key: 'value',
              width: 150,
              align: 'right',
              render: (_: unknown, row, index) =>
                editable ? (
                  <input className={styles.input} inputMode="decimal" value={row.value} onChange={(event) => updateTerm(index, { value: event.target.value })} />
                ) : row.mode === 'percent' ? (
                  `${row.value}%`
                ) : (
                  formatMoney(Number(row.value))
                ),
            },
            {
              title: 'Số tiền',
              key: 'amount',
              width: 140,
              align: 'right',
              render: (_: unknown, _row, index) => {
                const parsed = parsedTerms[index];
                const amount = parsed.percent !== null ? Math.round((detail.value * parsed.percent) / 100) : parsed.amount;
                return amount === null ? '' : formatMoney(amount);
              },
            },
            {
              title: 'Điều kiện',
              key: 'condition',
              width: 170,
              render: (_: unknown, row, index) =>
                editable ? (
                  <SearchableSelect
                    options={labelOptions(PAYMENT_TERM_CONDITION_LABELS)}
                    value={row.condition}
                    onChange={(value) => updateTerm(index, { condition: value as PaymentTermCondition })}
                  />
                ) : (
                  PAYMENT_TERM_CONDITION_LABELS[row.condition]
                ),
            },
            {
              title: 'Hạn thanh toán',
              key: 'dueDate',
              width: 160,
              render: (_: unknown, row, index) =>
                editable ? (
                  <DatePickerInput value={row.dueDate || undefined} onChange={(value) => updateTerm(index, { dueDate: value })} height={34} aria-label="Hạn thanh toán" />
                ) : (
                  formatDay(row.dueDate)
                ),
            },
            {
              title: 'Số ngày sau điều kiện',
              key: 'dueDays',
              width: 120,
              render: (_: unknown, row, index) =>
                editable ? (
                  <input className={styles.input} inputMode="numeric" value={row.dueDays} onChange={(event) => updateTerm(index, { dueDays: event.target.value.replace(/[^\d]/g, '') })} />
                ) : (
                  row.dueDays
                ),
            },
            {
              title: 'Trạng thái',
              key: 'status',
              width: 120,
              render: (_: unknown, row) => {
                const saved = detail.paymentTerms.find((term) => term.id === row.key);
                return saved ? PAYMENT_TERM_STATUS_LABELS[saved.status] : <span className={styles.muted}>Chưa lưu</span>;
              },
            },
            {
              title: '',
              key: 'trigger',
              width: 150,
              render: (_: unknown, row) => {
                const saved = detail.paymentTerms.find((term) => term.id === row.key);
                return !editable && saved && canTriggerPaymentTerm(detail, saved, capabilities) ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={busy}
                    onClick={() => {
                      setTriggerDate('');
                      setTriggering(saved);
                    }}
                  >
                    {paymentTermTriggerLabels(saved).action}
                  </button>
                ) : null;
              },
            },
            {
              title: '',
              key: 'remove',
              width: 60,
              render: (_: unknown, _row, index) =>
                editable ? (
                  <button type="button" className={styles.rowActionDanger} onClick={() => setTerms((current) => current.filter((_term, position) => position !== index))}>
                    Bỏ
                  </button>
                ) : null,
            },
          ]}
        />
        <p className={totals.balanced ? styles.muted : styles.warning} role="status">
          Tổng: {formatPercent(totals.percent)} · {formatMoney(totals.amount)} / {formatMoney(detail.value)}
          {totals.balanced ? '' : '. Tổng các đợt phải bằng 100% giá trị hợp đồng.'}
        </p>
        {editable && termsDirty ? (
          <div className={styles.toolbar}>
            <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void saveTerms()}>
              Lưu đợt thanh toán
            </button>
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setTerms(detail.paymentTerms.map(termDraft))}>
              Bỏ thay đổi
            </button>
          </div>
        ) : null}
      </section>

      <section className={styles.tableCard} aria-label="Đơn bán của hợp đồng">
        <h3 className={styles.sectionTitle}>Đơn bán</h3>
        <Table<ContractOrderRef>
          size="small"
          rowKey="id"
          columns={orderColumns}
          dataSource={[...detail.orders]}
          pagination={false}
          locale={{ emptyText: 'Chưa có đơn nào từ hợp đồng này.' }}
        />
      </section>

      <section className={styles.panel} aria-label="Nhật ký">
        <h3 className={styles.sectionTitle}>Nhật ký</h3>
        <ol className={styles.timeline}>
          {detail.history.map((entry) => (
            <li key={entry.id} className={styles.timelineItem}>
              <div>
                <div className={styles.timelineTitle}>
                  {FULFILLMENT_ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.toStatus && entry.toStatus in CONTRACT_STATUS_LABELS
                    ? `: ${CONTRACT_STATUS_LABELS[entry.toStatus as keyof typeof CONTRACT_STATUS_LABELS]}`
                    : ''}
                </div>
                {entry.reason ? <div className={styles.muted}>{entry.reason}</div> : null}
                <div className={styles.timelineMeta}>
                  {formatDateTime(entry.at)} · {entry.actorId ? personName(people, entry.actorId) : 'Hệ thống'}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {triggering ? (
        <CrmDialog
          open
          title={paymentTermTriggerLabels(triggering).action}
          subtitle={`${triggering.name} · ${formatMoney(triggering.amount)}`}
          submitLabel="Ghi nhận"
          submitting={busy}
          onClose={() => setTriggering(undefined)}
          onSubmit={() =>
            void run(async () => {
              await triggerPaymentTerm(current.id, triggering.id, triggerDate || undefined);
              return getContract(current.id);
            }, 'Đã ghi nhận đợt thanh toán đến hạn.').then((done) => {
              if (done) setTriggering(undefined);
            })
          }
        >
          <Field label={paymentTermTriggerLabels(triggering).dateLabel} hint="Để trống là hôm nay; hạn thanh toán tính từ ngày này">
            <DatePickerInput
              value={triggerDate || undefined}
              onChange={(value) => setTriggerDate(value)}
              height={34}
              aria-label={paymentTermTriggerLabels(triggering).dateLabel}
            />
          </Field>
        </CrmDialog>
      ) : null}
      {editing ? (
        <ContractFormDialog
          contract={detail}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            setDetail(next);
            setTerms(next.paymentTerms.map(termDraft));
          }}
        />
      ) : null}
      {picking ? (
        <MaterialPickerDialog
          title="Thêm dòng giá khung"
          withPrice
          quantityOptional={detail.type !== 'SALE'}
          onClose={() => setPicking(false)}
          onPick={async (picked) => {
            const done = await run(() =>
              updateContract(detail.id, {
                revision: detail.revision,
                lines: [
                  ...detail.lines.map((line) => ({
                    materialId: line.materialId,
                    quantity: line.quantity,
                    unit: line.unit,
                    unitPrice: line.unitPrice,
                    vatRate: line.vatRate,
                    note: line.note,
                  })),
                  { materialId: picked.material.id, quantity: picked.quantity, unitPrice: picked.unitPrice ?? 0, vatRate: picked.vatRate },
                ],
              }),
              'Đã thêm dòng.',
            );
            if (done) setPicking(false);
          }}
        />
      ) : null}
      {reasonFor ? (
        <ContractReasonDialog
          action={reasonFor}
          onClose={() => setReasonFor(undefined)}
          onConfirm={async (reason) => {
            if (await act(reasonFor, reason)) setReasonFor(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

const REASON_TITLES: Readonly<Record<Exclude<ContractAction, 'confirm'>, { title: string; label: string; danger: boolean }>> = {
  cancel: { title: 'Huỷ hợp đồng', label: 'Lý do huỷ', danger: true },
  complete: { title: 'Hoàn thành hợp đồng', label: 'Lý do (đã giao và thu đủ)', danger: false },
  liquidate: { title: 'Thanh lý hợp đồng', label: 'Nội dung xác nhận thanh lý', danger: false },
};

function ContractReasonDialog({
  action,
  onClose,
  onConfirm,
}: {
  action: Exclude<ContractAction, 'confirm'>;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const meta = REASON_TITLES[action];
  async function save() {
    if (!reason.trim()) return setError('Vui lòng ghi lý do.');
    setSaving(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog open danger={meta.danger} title={meta.title} submitLabel="Xác nhận" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <Field label={meta.label} required wide>
        <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
