'use client';

import {
  WARRANTY_CAUSE_LABELS,
  WARRANTY_DISPOSITION_LABELS,
  WARRANTY_DOCUMENT_KIND_LABELS,
  WARRANTY_DOCUMENT_STATUS_LABELS,
  WARRANTY_INSPECTION_LABELS,
  WARRANTY_REMEDY_LABELS,
  WARRANTY_SOURCE_LABELS,
  WARRANTY_STATUS_LABELS,
  type WarrantyCaseDetail,
  type WarrantyCaseLine,
  type WarrantyDisposition,
  type WarrantyDocument,
  type WarrantyInspectionResult,
  type WarrantyRemedy,
  type WarrantySerialHistory,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import {
  errorMessage,
  getWarrantyCase,
  inspectWarrantyLine,
  loadSerialHistory,
  resolveWarrantyLine,
  warrantyAction,
} from '../crm-api';
import { labelOptions, useCrm } from '../crm-context';
import { formatDay, formatQuantity } from '../fulfillment.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import {
  SERIAL_MOVEMENT_LABELS,
  WARRANTY_ACTION_LABELS,
  WARRANTY_DOCUMENT_TONE,
  WARRANTY_STATUS_TONE,
  coverageLabel,
  dispositionsFor,
  warrantyActions,
} from './warranty.model';

/**
 * Chi tiết yêu cầu bảo hành (T6-08): dòng (serial, hạn bảo hành, kiểm định,
 * hướng xử lý, hàng thay thế), chứng từ ở Kho và sổ công nợ, nhật ký trạng
 * thái; nhận hàng về kho cách ly, kiểm định, xử lý, gửi lại chứng từ, đóng.
 */
export function WarrantyDetail({
  caseId,
  onBack,
  onOpenCustomer,
  onOpenOrder,
}: {
  caseId: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenOrder: (id: string) => void;
}) {
  const { capabilities, people } = useCrm();
  const [detail, setDetail] = useState<WarrantyCaseDetail>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState<WarrantyCaseLine>();
  const [resolving, setResolving] = useState<WarrantyCaseLine>();
  const [rejecting, setRejecting] = useState(false);
  const [history, setHistory] = useState<string>();

  const load = useCallback(
    () =>
      getWarrantyCase(caseId)
        .then((next) => {
          setDetail(next);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được yêu cầu bảo hành.'))),
    [caseId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<WarrantyCaseDetail>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      setDetail(await work());
      if (success) toast.success(success);
      return true;
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thực hiện được thao tác.'));
      // Có thể một phần đã ghi (chứng từ "chưa gửi được"): tải lại để thấy trạng thái thật.
      void load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách bảo hành
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!detail) return null;

  const actions = warrantyActions(detail, capabilities);
  const revision = detail.revision;

  const lineColumns: ColumnsType<WarrantyCaseLine> = [
    { title: '#', dataIndex: 'lineNo', width: 44, align: 'right' },
    {
      title: 'Serial, mặt hàng',
      key: 'material',
      width: 240,
      render: (_: unknown, row) => (
        <span>
          {row.serial ? (
            <button type="button" className={styles.linkButton} onClick={() => setHistory(row.serial as string)}>
              <span className={styles.mono}>{row.serial}</span>
            </button>
          ) : (
            `${formatQuantity(row.quantity)} ${row.unit}`
          )}{' '}
          {row.materialCode} {row.materialName}
        </span>
      ),
    },
    {
      title: 'Hạn bảo hành',
      key: 'coverage',
      width: 250,
      render: (_: unknown, row) => (
        <span className={styles.cellWithPill}>
          <StatusPill tone={row.coverage.expired ? 'danger' : 'success'}>{coverageLabel(row.coverage)}</StatusPill>
          <span className={styles.muted}>
            {WARRANTY_SOURCE_LABELS[row.coverage.source]}, giao {formatDay(row.coverage.deliveredOn) || 'chưa rõ'}
          </span>
        </span>
      ),
    },
    { title: 'Đã nhận', dataIndex: 'receivedAt', width: 140, render: (value: string | null) => (value ? formatDateTime(value) : '') },
    {
      title: 'Kiểm định',
      key: 'inspection',
      width: 160,
      render: (_: unknown, row) =>
        row.inspectionResult ? (
          <span>
            <StatusPill tone={row.inspectionResult === 'PASSED' ? 'success' : 'danger'}>{WARRANTY_INSPECTION_LABELS[row.inspectionResult]}</StatusPill>
            {row.inspectionNote ? <span className={styles.muted}> {row.inspectionNote}</span> : null}
          </span>
        ) : (
          ''
        ),
    },
    {
      title: 'Hướng xử lý',
      key: 'resolution',
      width: 230,
      render: (_: unknown, row) =>
        row.disposition ? (
          <span>
            {WARRANTY_DISPOSITION_LABELS[row.disposition]}
            {row.remedy && row.remedy !== 'NONE' ? ` · ${WARRANTY_REMEDY_LABELS[row.remedy]}` : ''}
            {row.creditAmount ? ` · ${formatMoney(row.creditAmount)}` : ''}
          </span>
        ) : (
          ''
        ),
    },
    {
      title: 'Hàng thay thế',
      key: 'replacement',
      width: 200,
      render: (_: unknown, row) =>
        row.replacementSerials.length ? (
          <span>
            <span className={styles.mono}>{row.replacementSerials.join(', ')}</span>
            {row.replacementWarrantyUntil ? <span className={styles.muted}> bảo hành đến {formatDay(row.replacementWarrantyUntil)}</span> : null}
          </span>
        ) : row.remedy === 'REPLACE' ? (
          <span className={styles.muted}>Chờ thủ kho xuất</span>
        ) : (
          ''
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_: unknown, row) =>
        actions.includes('inspect') ? (
          <button type="button" className={styles.rowActionPrimary} disabled={busy} onClick={() => setInspecting(row)}>
            Kiểm định
          </button>
        ) : actions.includes('resolve') && !row.disposition ? (
          <button type="button" className={styles.rowActionPrimary} disabled={busy} onClick={() => setResolving(row)}>
            Xử lý
          </button>
        ) : null,
    },
  ];

  const documentColumns: ColumnsType<WarrantyDocument> = [
    { title: 'Chứng từ', dataIndex: 'kind', width: 230, render: (value: WarrantyDocument['kind']) => WARRANTY_DOCUMENT_KIND_LABELS[value] },
    {
      title: 'Dòng',
      dataIndex: 'lineId',
      width: 120,
      render: (value: string | null) => {
        const line = detail.lines.find((item) => item.id === value);
        return line ? (line.serial ?? `Dòng ${line.lineNo}`) : 'Cả yêu cầu';
      },
    },
    { title: 'Số chứng từ', dataIndex: 'documentCode', width: 150, render: (value: string | null) => <span className={styles.mono}>{value ?? ''}</span> },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 170,
      render: (value: WarrantyDocument['status']) => <StatusPill tone={WARRANTY_DOCUMENT_TONE[value]}>{WARRANTY_DOCUMENT_STATUS_LABELS[value]}</StatusPill>,
    },
    { title: 'Số tiền', dataIndex: 'amount', width: 130, align: 'right', render: (value: number | null) => (value ? formatMoney(value) : '') },
    { title: 'Lỗi', dataIndex: 'lastError', ellipsis: true, render: (value: string | null) => <span className={styles.overdue}>{value ?? ''}</span> },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.detailHead}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách bảo hành
        </button>
        <h2 className={styles.detailTitle}>
          Yêu cầu bảo hành <span className={styles.mono}>{detail.code}</span>
        </h2>
        {detail.chargeable ? <StatusPill tone="warning">Có phí</StatusPill> : null}
        <StatusPill tone={WARRANTY_STATUS_TONE[detail.status]}>{WARRANTY_STATUS_LABELS[detail.status]}</StatusPill>
      </div>

      <section className={styles.panel} aria-label="Thông tin yêu cầu">
        <dl className={styles.facts}>
          <dt>Khách hàng</dt>
          <dd>
            <button type="button" className={styles.linkButton} onClick={() => onOpenCustomer(detail.customerId)}>
              {detail.customerCode} - {detail.customerName}
            </button>
          </dd>
          <dt>Đơn bán</dt>
          <dd>
            {detail.orderId ? (
              <button type="button" className={styles.linkButton} onClick={() => onOpenOrder(detail.orderId as string)}>
                {detail.orderCode}
              </button>
            ) : (
              'Nhiều đơn'
            )}
          </dd>
          <dt>Nguyên nhân</dt>
          <dd>{WARRANTY_CAUSE_LABELS[detail.cause]}</dd>
          {detail.description ? (
            <>
              <dt>Mô tả</dt>
              <dd>{detail.description}</dd>
            </>
          ) : null}
          <dt>Kho cách ly</dt>
          <dd>{detail.quarantineWarehouseCode ?? 'Chưa gửi nhập trả'}</dd>
          <dt>Người phụ trách đơn</dt>
          <dd>{personName(people, detail.ownerUserId)}</dd>
          <dt>Người xử lý</dt>
          <dd>{detail.assigneeUserId ? personName(people, detail.assigneeUserId) : ''}</dd>
          {detail.rejectReason ? (
            <>
              <dt>Lý do từ chối</dt>
              <dd>{detail.rejectReason}</dd>
            </>
          ) : null}
        </dl>
        {actions.some((action) => ['receive', 'reject', 'sync', 'close'].includes(action)) ? (
          <div className={styles.toolbar}>
            {actions.includes('receive') ? (
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={busy}
                onClick={() =>
                  run(
                    () => warrantyAction(detail.id, 'receive', { revision }),
                    'Đã gửi nhập trả về kho cách ly; yêu cầu sang Đang kiểm định khi Kho ghi nhận.',
                  )
                }
              >
                Nhận hàng về kho cách ly
              </button>
            ) : null}
            {actions.includes('sync') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => run(() => warrantyAction(detail.id, 'sync-documents', { revision }), 'Đã gửi lại chứng từ.')}>
                Gửi lại chứng từ
              </button>
            ) : null}
            {actions.includes('close') ? (
              <Popconfirm
                title="Đóng yêu cầu bảo hành?"
                description="Chỉ đóng được khi mọi dòng đã xử lý và mọi chứng từ đã ghi sổ."
                okText="Đóng"
                cancelText="Huỷ"
                onConfirm={() => run(() => warrantyAction(detail.id, 'close', { revision }), 'Đã đóng yêu cầu.').then(() => undefined)}
              >
                <button type="button" className={styles.buttonGhost} disabled={busy}>
                  Đóng yêu cầu
                </button>
              </Popconfirm>
            ) : null}
            {actions.includes('reject') ? (
              <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setRejecting(true)}>
                Từ chối
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.tableCard} aria-label="Dòng yêu cầu">
        <h3 className={styles.sectionTitle}>Hàng bảo hành</h3>
        <Table<WarrantyCaseLine> size="small" rowKey="id" columns={lineColumns} dataSource={[...detail.lines]} pagination={false} scroll={{ x: 1500 }} />
      </section>

      <section className={styles.tableCard} aria-label="Chứng từ">
        <h3 className={styles.sectionTitle}>Chứng từ</h3>
        <Table<WarrantyDocument>
          size="small"
          rowKey="id"
          columns={documentColumns}
          dataSource={[...detail.documents]}
          pagination={false}
          scroll={{ x: 1000 }}
          locale={{ emptyText: 'Chưa có chứng từ nào.' }}
        />
      </section>

      <section className={styles.panel} aria-label="Nhật ký">
        <h3 className={styles.sectionTitle}>Nhật ký</h3>
        <ol className={styles.timeline}>
          {detail.history.map((entry) => (
            <li key={entry.id} className={styles.timelineItem}>
              <div>
                <div className={styles.timelineTitle}>
                  {WARRANTY_ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.toStatus && entry.toStatus !== entry.fromStatus && entry.toStatus in WARRANTY_STATUS_LABELS
                    ? `: ${WARRANTY_STATUS_LABELS[entry.toStatus as keyof typeof WARRANTY_STATUS_LABELS]}`
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

      {inspecting ? (
        <InspectDialog
          line={inspecting}
          onClose={() => setInspecting(undefined)}
          onSave={async (result, note) => {
            if (await run(() => inspectWarrantyLine(detail.id, inspecting.id, { revision, result, note }), 'Đã ghi kết quả kiểm định.')) {
              setInspecting(undefined);
            }
          }}
        />
      ) : null}
      {resolving ? (
        <ResolveDialog
          line={resolving}
          onClose={() => setResolving(undefined)}
          onSave={async (input) => {
            if (await run(() => resolveWarrantyLine(detail.id, resolving.id, { revision, ...input }), 'Đã sinh chứng từ xử lý.')) {
              setResolving(undefined);
            }
          }}
        />
      ) : null}
      {rejecting ? (
        <RejectDialog
          onClose={() => setRejecting(false)}
          onConfirm={async (reason) => {
            if (await run(() => warrantyAction(detail.id, 'reject', { revision, reason }), 'Đã từ chối yêu cầu.')) setRejecting(false);
          }}
        />
      ) : null}
      {history ? <SerialHistoryDialog serial={history} onClose={() => setHistory(undefined)} /> : null}
    </div>
  );
}

function InspectDialog({
  line,
  onClose,
  onSave,
}: {
  line: WarrantyCaseLine;
  onClose: () => void;
  onSave: (result: WarrantyInspectionResult, note: string | null) => Promise<void>;
}) {
  const [result, setResult] = useState<string>(line.inspectionResult ?? '');
  const [note, setNote] = useState(line.inspectionNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    if (!result) return setError('Vui lòng chọn kết quả kiểm định.');
    setSaving(true);
    try {
      await onSave(result as WarrantyInspectionResult, note.trim() || null);
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog open title="Kết quả kiểm định" subtitle={line.serial ?? line.materialCode} submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Kết quả" required>
          <SearchableSelect options={labelOptions(WARRANTY_INSPECTION_LABELS)} value={result} placeholder="Đạt hoặc Lỗi" onChange={setResult} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function ResolveDialog({
  line,
  onClose,
  onSave,
}: {
  line: WarrantyCaseLine;
  onClose: () => void;
  onSave: (input: {
    disposition: WarrantyDisposition;
    remedy: WarrantyRemedy;
    replacementWarehouseCode: string | null;
    note: string | null;
  }) => Promise<void>;
}) {
  const allowed = dispositionsFor(line.inspectionResult);
  const [disposition, setDisposition] = useState<string>(allowed.length === 1 ? allowed[0] : '');
  const [remedy, setRemedy] = useState<string>('NONE');
  const [warehouse, setWarehouse] = useState(line.deliveryWarehouseCode ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const remedies = (Object.keys(WARRANTY_REMEDY_LABELS) as WarrantyRemedy[]).filter(
    (value) => line.orderLineId || (value !== 'REFUND' && value !== 'CREDIT'),
  );
  async function save() {
    if (!disposition) return setError('Vui lòng chọn hướng xử lý hàng nhận về.');
    if (remedy === 'REPLACE' && !warehouse.trim()) return setError('Vui lòng nhập kho xuất hàng thay thế.');
    setSaving(true);
    try {
      await onSave({
        disposition: disposition as WarrantyDisposition,
        remedy: remedy as WarrantyRemedy,
        replacementWarehouseCode: remedy === 'REPLACE' ? warehouse.trim() : null,
        note: note.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog
      open
      title="Hướng xử lý"
      subtitle={`${line.serial ?? line.materialCode} · kiểm định ${line.inspectionResult ? WARRANTY_INSPECTION_LABELS[line.inspectionResult] : ''}`}
      submitLabel="Sinh chứng từ"
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Hàng nhận về" required>
          <SearchableSelect
            options={allowed.map((value) => ({ value, label: WARRANTY_DISPOSITION_LABELS[value] }))}
            value={disposition}
            placeholder="Chọn hướng xử lý"
            onChange={setDisposition}
          />
        </Field>
        <Field label="Xử lý cho khách" hint={line.orderLineId ? 'Hoàn tiền, giảm trừ theo giá trị dòng đơn' : undefined}>
          <SearchableSelect options={remedies.map((value) => ({ value, label: WARRANTY_REMEDY_LABELS[value] }))} value={remedy} onChange={setRemedy} />
        </Field>
        {remedy === 'REPLACE' ? (
          <Field label="Kho xuất hàng thay thế" required hint="Thủ kho chọn serial thay thế; serial mới kế thừa hạn còn lại">
            <input className={styles.input} maxLength={50} value={warehouse} onChange={(event) => setWarehouse(event.target.value.toUpperCase())} />
          </Field>
        ) : null}
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function RejectDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
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
    <CrmDialog open danger title="Từ chối yêu cầu bảo hành" submitLabel="Từ chối" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <Field label="Lý do không đủ điều kiện" required wide>
        <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}

/** Lịch sử serial (T6-07): bước kho từ Kho và các yêu cầu bảo hành có serial. */
function SerialHistoryDialog({ serial, onClose }: { serial: string; onClose: () => void }) {
  const [history, setHistory] = useState<WarrantySerialHistory>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    loadSerialHistory(serial)
      .then(setHistory)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được lịch sử serial.')));
  }, [serial]);
  return (
    <CrmDialog open wide title={`Lịch sử serial ${serial}`} submitLabel="Đóng" error={error} onClose={onClose} onSubmit={onClose}>
      {history ? (
        <>
          {!history.inventoryAvailable ? <p className={styles.alert}>Không kết nối được Kho; chỉ hiện các yêu cầu bảo hành.</p> : null}
          <ol className={styles.timeline}>
            {history.movements.map((movement, index) => (
              <li key={`${movement.occurredAt}-${index}`} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    {SERIAL_MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}
                    {movement.documentCode ? ` · ${movement.documentCode}` : ''}
                    {movement.toWarehouseCode ? ` · kho ${movement.toWarehouseCode}` : movement.fromWarehouseCode ? ` · từ kho ${movement.fromWarehouseCode}` : ''}
                  </div>
                  {movement.reason ? <div className={styles.muted}>{movement.reason}</div> : null}
                  <div className={styles.timelineMeta}>{formatDateTime(movement.occurredAt)}</div>
                </div>
              </li>
            ))}
            {history.cases.map((item) => (
              <li key={`${item.caseId}-${item.role}`} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    Bảo hành {item.caseCode} ({item.role === 'ORIGINAL' ? 'serial đem bảo hành' : 'serial thay thế'}): {WARRANTY_STATUS_LABELS[item.status]}
                  </div>
                  <div className={styles.timelineMeta}>{formatDateTime(item.at)}</div>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </CrmDialog>
  );
}
