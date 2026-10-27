'use client';

import {
  PRICE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  type CrmCatalogMaterial,
  type QuoteDetail,
  type QuoteLine,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import {
  addQuoteLine,
  errorMessage,
  getQuote,
  quoteAction,
  removeQuoteLine,
  searchCatalog,
  updateQuoteLine,
  updateQuoteVersion,
  type QuoteAction,
} from '../crm-api';
import { useCrm } from '../crm-context';
import { formatPercent, parseNumber } from '../pricing/pricing.model';
import local from '../pricing/pricing.module.scss';
import { QUOTE_ACTION_LABELS, formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { QuoteCompare } from './quote-compare';
import { QUOTE_STATUS_TONE, quoteActions } from './quote.model';

/** Thông báo khi thao tác xong. */
const ACTION_DONE: Readonly<Record<QuoteAction, string>> = {
  recalculate: 'Đã tính lại theo bảng giá, chính sách và giá vốn hiện tại.',
  revise: 'Đã tạo phiên bản mới ở Nháp.',
  submit: 'Đã gửi duyệt.',
  approve: 'Đã duyệt báo giá.',
  reject: 'Đã từ chối duyệt báo giá.',
  send: 'Đã đánh dấu gửi khách.',
  accept: 'Đã ghi nhận khách chấp nhận.',
  decline: 'Đã ghi nhận khách từ chối.',
};

const formatDate = (value: string | null | undefined) => (value ? value.split('-').reverse().join('/') : '');
const quantityText = (value: number | null) => (value === null ? '' : value.toLocaleString('vi-VN', { maximumFractionDigits: 3 }));

/** Thao tác cần lý do: hộp thoại nhập lý do trước khi gọi API. */
type ReasonAction = 'reject' | 'decline';

/**
 * Màn báo giá (T3-15, T3-16): dòng hàng lấy từ danh mục Kho kèm tồn khả dụng,
 * chính sách đã áp từng dòng, giá vốn ước tính và biên; cảnh báo cần duyệt kèm
 * lý do; gửi duyệt, duyệt, gửi khách, khách chấp nhận hoặc từ chối; xem phiên
 * bản cũ (chỉ đọc), so sánh hai phiên bản, lịch sử duyệt.
 */
export function QuoteEditor({
  quoteId,
  onBack,
  onOpenCustomer,
  onOpenOpportunity,
}: {
  quoteId: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenOpportunity: (id: string) => void;
}) {
  const { capabilities, people, currentUserId } = useCrm();
  const [detail, setDetail] = useState<QuoteDetail>();
  const [viewing, setViewing] = useState<number>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editingLine, setEditingLine] = useState<QuoteLine>();
  const [editingHeader, setEditingHeader] = useState(false);
  const [reasonFor, setReasonFor] = useState<ReasonAction>();
  const [comparing, setComparing] = useState(false);

  const load = useCallback(
    (versionNo?: number) =>
      getQuote(quoteId, versionNo)
        .then((next) => {
          setDetail(next);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được báo giá.'))),
    [quoteId],
  );

  useEffect(() => {
    void load(viewing);
  }, [load, viewing]);

  /** Chạy một thao tác trả về báo giá mới; sau khi sửa luôn về phiên bản hiện tại. */
  async function run(work: () => Promise<QuoteDetail>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      const next = await work();
      setViewing(undefined);
      setDetail(next);
      if (success) toast.success(success);
      return true;
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thực hiện được thao tác.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const version = detail?.version;
  const actions = detail ? quoteActions(detail, capabilities, currentUserId) : [];
  const editable = actions.includes('edit');
  const act = (action: QuoteAction, reason?: string) =>
    detail && version
      ? run(() => quoteAction(detail.id, version.versionNo, action, { revision: version.revision, reason }), ACTION_DONE[action])
      : Promise.resolve(false);

  const columns: ColumnsType<QuoteLine> = [
      { title: '#', dataIndex: 'lineNo', width: 44, align: 'right' },
      {
        title: 'Mặt hàng',
        key: 'material',
        width: 240,
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
      { title: 'SL', key: 'quantity', width: 100, align: 'right', render: (_: unknown, row) => `${quantityText(row.quantity)} ${row.unit}` },
      {
        title: 'Tồn khả dụng',
        key: 'stock',
        width: 110,
        align: 'right',
        render: (_: unknown, row) =>
          row.materialKind === 'SERVICE' ? (
            <span className={styles.muted}>Không quản lý</span>
          ) : row.availableStock === null ? (
            <span className={styles.muted}>Không rõ</span>
          ) : (
            <span className={row.availableStock < row.quantity ? styles.overdue : undefined}>{quantityText(row.availableStock)}</span>
          ),
      },
      { title: 'Đơn giá gốc', dataIndex: 'listPrice', width: 120, align: 'right', render: (value: number) => formatMoney(value) },
      {
        title: 'Nguồn giá',
        key: 'source',
        width: 150,
        render: (_: unknown, row) => `${PRICE_SOURCE_LABELS[row.priceSource]}${row.priceReferenceCode ? ` ${row.priceReferenceCode}` : ''}`,
      },
      {
        title: 'Chính sách đã áp',
        key: 'policies',
        width: 200,
        render: (_: unknown, row) =>
          row.appliedPolicies.length ? (
            row.appliedPolicies.map((policy) => (
              <span key={policy.policyId} className={local.policyTag}>
                {policy.code}: {formatPercent(policy.percent)}
              </span>
            ))
          ) : (
            <span className={styles.muted}>Không có</span>
          ),
      },
      {
        title: 'Chiết khấu',
        key: 'discount',
        width: 150,
        align: 'right',
        render: (_: unknown, row) => (
          <span className={styles.cellWithPill}>
            {formatPercent(row.discountPercent)}
            {row.cappedAt !== null ? <StatusPill tone="warning">Chạm trần</StatusPill> : null}
            {row.overridden ? <StatusPill tone="warning">Ghi đè</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Đơn giá sau CK', dataIndex: 'unitPrice', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'Thành tiền', dataIndex: 'lineAmount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'VAT', key: 'vat', width: 120, align: 'right', render: (_: unknown, row) => `${formatMoney(row.vatAmount)} (${formatPercent(row.vatRate)})` },
      {
        title: 'Giá vốn ước tính',
        key: 'cost',
        width: 140,
        align: 'right',
        render: (_: unknown, row) =>
          row.estUnitCost === null && row.materialKind !== 'SERVICE' ? <span className={styles.muted}>Chưa có</span> : formatMoney(row.estCost),
      },
      { title: 'Biên', dataIndex: 'margin', width: 90, align: 'right', render: (value: number | null) => (value === null ? '' : formatPercent(value)) },
      {
        title: '',
        key: 'actions',
        width: 120,
        fixed: 'right',
        render: (_: unknown, row) =>
          editable ? (
            <span className={styles.rowActions}>
              <button type="button" className={styles.rowAction} onClick={() => setEditingLine(row)}>
                Sửa
              </button>
              <Popconfirm
                title="Bỏ dòng này?"
                okText="Bỏ"
                cancelText="Huỷ"
                okType="danger"
                onConfirm={() =>
                  detail && version
                    ? run(() => removeQuoteLine(detail.id, version.versionNo, row.id, version.revision), 'Đã bỏ dòng.').then(() => undefined)
                    : undefined
                }
              >
                <button type="button" className={styles.rowActionDanger}>
                  Bỏ
                </button>
              </Popconfirm>
            </span>
          ) : null,
      },
  ];

  if (error && !detail) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách báo giá
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!detail || !version) return null;

  const isCurrent = version.versionNo === detail.currentVersion;
  const totals = version.totals;
  const approvalHistory = detail.history.filter((entry) => ['submit', 'approve', 'reject'].includes(entry.action));

  return (
    <div className={styles.page}>
      <div className={styles.detailHead}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách báo giá
        </button>
        <h2 className={styles.detailTitle}>
          Báo giá <span className={styles.mono}>{detail.code}</span>
        </h2>
        <StatusPill tone={QUOTE_STATUS_TONE[version.status]}>{QUOTE_STATUS_LABELS[version.status]}</StatusPill>
        <SearchableSelect
          className={styles.filter}
          options={detail.versions.map((entry) => ({
            value: String(entry.versionNo),
            label: `Phiên bản ${entry.versionNo}`,
            description: `${QUOTE_STATUS_LABELS[entry.status]} · ${formatMoney(entry.totalAmount)}`,
          }))}
          value={String(version.versionNo)}
          onChange={(value) => {
            const number = Number(value);
            setViewing(number === detail.currentVersion ? undefined : number);
          }}
        />
        {detail.versions.length > 1 ? (
          <button type="button" className={styles.buttonGhost} onClick={() => setComparing((value) => !value)}>
            {comparing ? 'Ẩn so sánh' : 'So sánh phiên bản'}
          </button>
        ) : null}
      </div>

      <section className={styles.panel} aria-label="Thông tin báo giá">
        {!isCurrent ? (
          <p className={styles.warning}>Đang xem phiên bản cũ (chỉ đọc). Phiên bản hiện tại là v{detail.currentVersion}.</p>
        ) : null}
        <dl className={styles.facts}>
          <dt>Khách hàng</dt>
          <dd>
            <button type="button" className={styles.linkButton} onClick={() => onOpenCustomer(detail.customerId)}>
              {detail.customerCode} - {detail.customerName}
            </button>
          </dd>
          {detail.opportunityId ? (
            <>
              <dt>Cơ hội</dt>
              <dd>
                <button type="button" className={styles.linkButton} onClick={() => onOpenOpportunity(detail.opportunityId as string)}>
                  {detail.opportunityName}
                </button>
              </dd>
            </>
          ) : null}
          <dt>Người phụ trách</dt>
          <dd>{personName(people, detail.ownerUserId)}</dd>
          <dt>Hiệu lực đến</dt>
          <dd>{formatDate(version.validUntil)}</dd>
          <dt>Ngày tính giá</dt>
          <dd>{formatDate(version.priceDate ?? version.pricedOn) || 'Hôm nay'}</dd>
          {version.note ? (
            <>
              <dt>Ghi chú</dt>
              <dd>{version.note}</dd>
            </>
          ) : null}
          {version.decisionReason ? (
            <>
              <dt>Lý do</dt>
              <dd>{version.decisionReason}</dd>
            </>
          ) : null}
        </dl>
        <ApprovalNotice detail={detail} />
        {actions.length ? (
          <div className={styles.toolbar}>
            {actions.includes('edit') ? (
              <>
                <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setPicking(true)}>
                  <Plus size={14} /> Thêm dòng
                </button>
                <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setEditingHeader(true)}>
                  Hiệu lực, vận chuyển
                </button>
                <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void act('recalculate')}>
                  Tính lại giá
                </button>
                <button type="button" className={styles.buttonPrimary} disabled={busy || !version.lines.length} onClick={() => void act('submit')}>
                  Gửi duyệt
                </button>
              </>
            ) : null}
            {actions.includes('revise') ? (
              <Popconfirm
                title="Sửa báo giá?"
                description={`Phiên bản ${version.versionNo} chuyển "Đã thay thế" và giữ nguyên để đối chiếu; sửa trên phiên bản mới ở Nháp, phải duyệt lại nếu vượt ngưỡng.`}
                okText="Tạo phiên bản mới"
                cancelText="Huỷ"
                onConfirm={() => act('revise').then(() => undefined)}
              >
                <button type="button" className={styles.buttonGhost} disabled={busy}>
                  Sửa (tạo phiên bản mới)
                </button>
              </Popconfirm>
            ) : null}
            {actions.includes('approve') ? (
              <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void act('approve')}>
                Duyệt
              </button>
            ) : null}
            {actions.includes('reject') ? (
              <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setReasonFor('reject')}>
                Từ chối duyệt
              </button>
            ) : null}
            {actions.includes('send') ? (
              <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void act('send')}>
                Đánh dấu đã gửi khách
              </button>
            ) : null}
            {actions.includes('accept') ? (
              <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void act('accept')}>
                Khách chấp nhận
              </button>
            ) : null}
            {actions.includes('decline') ? (
              <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setReasonFor('decline')}>
                Khách từ chối
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {comparing ? <QuoteCompare detail={detail} /> : null}

      <section className={styles.tableCard} aria-label="Dòng báo giá">
        <h3 className={styles.sectionTitle}>Dòng hàng · phiên bản {version.versionNo}</h3>
        <Table<QuoteLine>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={[...version.lines]}
          pagination={false}
          scroll={{ x: 1900 }}
          locale={{ emptyText: editable ? 'Chưa có dòng nào. Bấm "Thêm dòng" để chọn mặt hàng từ danh mục Kho.' : 'Không có dòng nào.' }}
        />
        <dl className={local.totals}>
          <dt>Tiền hàng theo giá gốc</dt>
          <dd>{formatMoney(totals.grossAmount)}</dd>
          <dt>Chiết khấu ({formatPercent(totals.discountPercent)})</dt>
          <dd>{formatMoney(totals.discountAmount)}</dd>
          <dt>Tiền hàng sau chiết khấu</dt>
          <dd>{formatMoney(totals.netAmount)}</dd>
          {totals.shippingAmount ? (
            <>
              <dt>Phí vận chuyển (VAT {formatPercent(version.shipping.vatRate)})</dt>
              <dd>{formatMoney(totals.shippingAmount)}</dd>
            </>
          ) : null}
          <dt>Tiền thuế VAT</dt>
          <dd>{formatMoney(totals.vatAmount)}</dd>
          <dt className={local.grandTotal}>Tổng cộng</dt>
          <dd className={local.grandTotal}>{formatMoney(totals.totalAmount)}</dd>
          <dt>Giá vốn ước tính (gồm vận chuyển bên bán chịu)</dt>
          <dd>{formatMoney(totals.estCost)}</dd>
          <dt>Lợi nhuận ước tính</dt>
          <dd>
            {formatMoney(totals.profit)}
            {totals.marginPercent === null ? '' : ` (biên ${formatPercent(totals.marginPercent)})`}
          </dd>
        </dl>
      </section>

      <section className={styles.panel} aria-label="Lịch sử">
        <h3 className={styles.sectionTitle}>Lịch sử duyệt</h3>
        {approvalHistory.length ? (
          <ol className={styles.timeline}>
            {approvalHistory.map((entry) => (
              <li key={entry.id} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    {QUOTE_ACTION_LABELS[entry.action] ?? entry.action}
                    {entry.versionNo ? ` v${entry.versionNo}` : ''}
                    {entry.toStatus && entry.toStatus in QUOTE_STATUS_LABELS
                      ? `: ${QUOTE_STATUS_LABELS[entry.toStatus as keyof typeof QUOTE_STATUS_LABELS]}`
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
        ) : (
          <p className={styles.muted}>Chưa gửi duyệt.</p>
        )}
        <h3 className={styles.sectionTitle}>Nhật ký</h3>
        <ol className={styles.timeline}>
          {detail.history.map((entry) => (
            <li key={entry.id} className={styles.timelineItem}>
              <div>
                <div className={styles.timelineTitle}>
                  {QUOTE_ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.versionNo ? ` v${entry.versionNo}` : ''}
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

      {picking ? (
        <MaterialPicker
          onClose={() => setPicking(false)}
          onPick={async (material, quantity) => {
            const done = await run(() =>
              addQuoteLine(detail.id, version.versionNo, { revision: version.revision, materialId: material.id, quantity }),
            );
            if (done) setPicking(false);
          }}
        />
      ) : null}
      {editingLine ? (
        <LineDialog
          line={editingLine}
          onClose={() => setEditingLine(undefined)}
          onSave={async (patch) => {
            const done = await run(() =>
              updateQuoteLine(detail.id, version.versionNo, editingLine.id, {
                revision: version.revision,
                materialId: editingLine.materialId,
                ...patch,
              }),
            );
            if (done) setEditingLine(undefined);
          }}
        />
      ) : null}
      {editingHeader ? (
        <HeaderDialog
          detail={detail}
          onClose={() => setEditingHeader(false)}
          onSave={async (patch) => {
            const done = await run(() => updateQuoteVersion(detail.id, version.versionNo, { revision: version.revision, ...patch }), 'Đã lưu.');
            if (done) setEditingHeader(false);
          }}
        />
      ) : null}
      {reasonFor ? (
        <ReasonDialog
          title={reasonFor === 'reject' ? 'Từ chối duyệt báo giá' : 'Khách từ chối báo giá'}
          onClose={() => setReasonFor(undefined)}
          onConfirm={async (reason) => {
            const done = await act(reasonFor, reason);
            if (done) setReasonFor(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

/** Cảnh báo cần duyệt (trước khi gửi) hoặc tình trạng duyệt (sau khi gửi). */
function ApprovalNotice({ detail }: { detail: QuoteDetail }) {
  const version = detail.version;
  const link = detail.procedure;
  if (version.status === 'DRAFT' && detail.approvalCheck) {
    return detail.approvalCheck.length ? (
      <div className={styles.warning} role="status">
        <strong>Báo giá này cần duyệt khi gửi:</strong>
        <ul>
          {detail.approvalCheck.map((reason) => (
            <li key={`${reason.code}-${reason.message}`}>{reason.message}</li>
          ))}
        </ul>
      </div>
    ) : (
      <p className={styles.muted}>Không vượt ngưỡng duyệt: gửi duyệt sẽ được duyệt ngay.</p>
    );
  }
  if (!version.approvalReasons.length && !link) return null;
  return (
    <div className={version.status === 'PENDING' ? styles.warning : styles.muted} role="status">
      {version.approvalReasons.length ? (
        <>
          <strong>Lý do cần duyệt:</strong>
          <ul>
            {version.approvalReasons.map((reason) => (
              <li key={`${reason.code}-${reason.message}`}>{reason.message}</li>
            ))}
          </ul>
        </>
      ) : null}
      {link ? (
        <p>
          Duyệt qua Quy trình
          {link.instanceCode ? ` (hồ sơ ${link.instanceCode})` : ''}:{' '}
          {link.status === 'START_PENDING'
            ? 'đang tạo hồ sơ.'
            : link.status === 'FAILED'
              ? `chưa tạo được hồ sơ, hệ thống đang thử lại${link.lastError ? ` (${link.lastError})` : ''}.`
              : link.status === 'RUNNING'
                ? 'đang chờ người duyệt trên Quy trình.'
                : 'đã có kết quả.'}
        </p>
      ) : version.status === 'PENDING' ? (
        <p>Chờ người có quyền duyệt báo giá duyệt trực tiếp.</p>
      ) : null}
    </div>
  );
}

/** Chọn mặt hàng từ danh mục Kho (`GET /catalog/materials`), kèm tồn khả dụng và giá vốn bình quân. */
function MaterialPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (material: CrmCatalogMaterial, quantity: number) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<readonly CrmCatalogMaterial[]>([]);
  const [selected, setSelected] = useState<CrmCatalogMaterial>();
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const q = useDebounced(search.trim(), 300);

  useEffect(() => {
    let active = true;
    setLoading(true);
    searchCatalog(q)
      .then((result) => {
        if (!active) return;
        setItems(result);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh mục Kho.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q]);

  const columns: ColumnsType<CrmCatalogMaterial> = [
    { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
    { title: 'Tên', dataIndex: 'name', ellipsis: true },
    { title: 'ĐVT', dataIndex: 'unit', width: 70 },
    {
      title: 'Tồn khả dụng',
      dataIndex: 'totalAvailable',
      width: 110,
      align: 'right',
      render: (value: number | null, row) => (row.kind === 'SERVICE' ? <span className={styles.muted}>Dịch vụ</span> : quantityText(value ?? 0)),
    },
    {
      title: 'Giá vốn BQ',
      dataIndex: 'avgCost',
      width: 120,
      align: 'right',
      render: (value: number | null) => (value === null ? '' : formatMoney(value)),
    },
  ];

  async function save() {
    if (!selected) return setError('Vui lòng chọn một mặt hàng.');
    const amount = parseNumber(quantity);
    if (amount === undefined || amount <= 0) return setError('Số lượng phải lớn hơn 0.');
    setSaving(true);
    try {
      await onPick(selected, amount);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open wide title="Thêm dòng báo giá" subtitle="Mặt hàng lấy từ danh mục Kho" submitLabel="Thêm dòng" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <input
        className={`${styles.input} ${styles.search}`}
        type="search"
        placeholder="Tìm theo mã hoặc tên mặt hàng…"
        maxLength={100}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Table<CrmCatalogMaterial>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={[...items]}
        pagination={false}
        scroll={{ y: 280 }}
        rowSelection={{ type: 'radio', selectedRowKeys: selected ? [selected.id] : [], onChange: (_keys, rows) => setSelected(rows[0]) }}
        onRow={(row) => ({ onClick: () => setSelected(row) })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có mặt hàng nào.' }}
      />
      <div className={styles.fieldGrid}>
        <Field label="Số lượng" required hint={selected?.unit ? `Đơn vị: ${selected.unit}` : undefined}>
          <input className={styles.input} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

/** Sửa số lượng, đơn vị, ghi đè đơn giá hoặc chiết khấu (ghi đè luôn cần duyệt). */
function LineDialog({
  line,
  onClose,
  onSave,
}: {
  line: QuoteLine;
  onClose: () => void;
  onSave: (patch: { quantity: number; unit: string; overrideUnitPrice: number | null; overrideDiscountPercent: number | null }) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unit, setUnit] = useState(line.unit);
  const [price, setPrice] = useState(line.overrideUnitPrice === null ? '' : String(line.overrideUnitPrice));
  const [discount, setDiscount] = useState(line.overrideDiscountPercent === null ? '' : String(line.overrideDiscountPercent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const amount = parseNumber(quantity);
    if (amount === undefined || amount <= 0) return setError('Số lượng phải lớn hơn 0.');
    if (price.trim() && discount.trim()) return setError('Chỉ ghi đè đơn giá hoặc chiết khấu, không ghi đè cả hai.');
    setSaving(true);
    try {
      await onSave({
        quantity: amount,
        unit: unit.trim(),
        overrideUnitPrice: price.trim() ? (parseNumber(price) ?? Number.NaN) : null,
        overrideDiscountPercent: discount.trim() ? (parseNumber(discount) ?? Number.NaN) : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      title={`Dòng ${line.lineNo}: ${line.materialCode}`}
      subtitle={line.materialName}
      submitting={saving}
      error={error}
      notice={
        price.trim() || discount.trim() ? (
          <p className={styles.warning}>Ghi đè giá hoặc chiết khấu: báo giá phải được duyệt trước khi gửi khách.</p>
        ) : null
      }
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Số lượng" required>
          <input className={styles.input} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="Đơn vị tính" required>
          <input className={styles.input} maxLength={50} value={unit} onChange={(event) => setUnit(event.target.value)} />
        </Field>
        <Field label="Ghi đè đơn giá sau CK" hint={`Đơn giá gốc ${formatMoney(line.listPrice)}`}>
          <input className={styles.input} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="Ghi đè chiết khấu (%)" hint={`Chính sách đề xuất ${formatPercent(line.policyPercent)}`}>
          <input className={styles.input} inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

/** Hạn hiệu lực, ngày tính giá, phí vận chuyển, ghi chú của phiên bản Nháp. */
function HeaderDialog({
  detail,
  onClose,
  onSave,
}: {
  detail: QuoteDetail;
  onClose: () => void;
  onSave: (patch: {
    validUntil: string | null;
    priceDate: string | null;
    note: string | null;
    shipping: { amount: number; vatRate: number | null; cost: number | null } | null;
  }) => Promise<void>;
}) {
  const version = detail.version;
  const [validUntil, setValidUntil] = useState(version.validUntil ?? '');
  const [priceDate, setPriceDate] = useState(version.priceDate ?? '');
  const [note, setNote] = useState(version.note ?? '');
  const [shipping, setShipping] = useState(version.shipping.amount ? String(version.shipping.amount) : '');
  const [shippingVat, setShippingVat] = useState(String(version.shipping.vatRate));
  const [shippingCost, setShippingCost] = useState(version.shipping.amount || version.shipping.cost ? String(version.shipping.cost) : '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const amount = shipping.trim() ? (parseNumber(shipping) ?? Number.NaN) : 0;
      const cost = shippingCost.trim() ? (parseNumber(shippingCost) ?? Number.NaN) : null;
      await onSave({
        validUntil: validUntil || null,
        priceDate: priceDate || null,
        note: note.trim() || null,
        shipping: amount || cost ? { amount, vatRate: parseNumber(shippingVat) ?? null, cost } : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open title="Hiệu lực và vận chuyển" submitting={saving} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Hiệu lực đến">
          <DatePickerInput value={validUntil || undefined} onChange={setValidUntil} height={38} aria-label="Hiệu lực đến" />
        </Field>
        <Field label="Ngày tính giá" hint="Bỏ trống: tính theo ngày hôm nay">
          <DatePickerInput value={priceDate || undefined} onChange={setPriceDate} height={38} placeholder="Hôm nay" aria-label="Ngày tính giá" />
        </Field>
        <Field label="Phí vận chuyển thu khách (VND)">
          <input className={styles.input} inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} />
        </Field>
        <Field label="Thuế suất vận chuyển (%)">
          <input className={styles.input} inputMode="decimal" value={shippingVat} onChange={(event) => setShippingVat(event.target.value)} />
        </Field>
        <Field label="Chi phí vận chuyển bên bán chịu (VND)" hint="Trừ vào lợi nhuận; bỏ trống là bằng phí thu khách">
          <input className={styles.input} inputMode="decimal" value={shippingCost} onChange={(event) => setShippingCost(event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function ReasonDialog({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
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
    <CrmDialog open danger title={title} submitLabel="Xác nhận" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <Field label="Lý do" required wide>
        <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
