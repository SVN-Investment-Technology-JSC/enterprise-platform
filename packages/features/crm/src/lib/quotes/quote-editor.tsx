'use client';

import {
  PRICE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  type CrmCatalogMaterial,
  type QuoteLineError,
  type QuoteLineInput,
  type QuoteDetail,
  type UpdateQuoteVersionRequest,
  type QuoteLine,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import {
  addQuoteLines,
  convertQuote,
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
import { BusinessPlanPanel } from './business-plan-panel';
import { QuoteCompare } from './quote-compare';
import {
  CustomFieldsEditor,
  FeesEditor,
  FollowersPanel,
  GeneralFields,
  LinksPanel,
  OrderAmountField,
  useQuoteFormLookups,
  type GeneralState,
} from './quote-form-parts';
import {
  activeFields,
  buildCustomFields,
  buildFees,
  buildOrderAmount,
  customFieldTexts,
  feeRowsOf,
  generalInfoError,
  missingRequiredFields,
  orderAmountText,
  quoteFormErrorMessage,
  requiredFieldsMessage,
  templateModes,
  type CustomFieldTexts,
  type FeeRow,
  type OrderAmountText,
} from './quote-form-edit.model';
import { DocumentsPanel } from '../documents';
import { canEditQuotePromotions } from '../promotions.model';
import { QuoteDocumentReferences } from './quote-document-references';
import { QuotePromotionsPanel } from './quote-promotions-panel';
import {
  addLinesLabel,
  buildLines,
  describeLineErrors,
  duplicatePicks,
  duplicateWarning,
  lineErrorsOf,
  setPicked,
  setPickedQuantity,
  type PickedMap,
} from './quote-line-picker.model';
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
  onOpenOrder,
}: {
  quoteId: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenOpportunity: (id: string) => void;
  /** Mở đơn sinh khi chuyển báo giá khách chấp nhận (T4-06). */
  onOpenOrder?: (id: string) => void;
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
  const lookups = useQuoteFormLookups();

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
      toast.error(quoteFormErrorMessage(cause, 'Không thực hiện được thao tác.'));
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

  const canConvert =
    !!detail && detail.status === 'ACCEPTED' && (capabilities.isTenantAdmin || capabilities.canWriteOrder) && !!onOpenOrder;
  /** Chuyển thành hợp đồng, đơn, kế hoạch giao; đã chuyển thì trả đúng đơn lần đầu. */
  async function convert() {
    if (!detail || !onOpenOrder) return;
    setBusy(true);
    try {
      const result = await convertQuote(detail.id);
      toast.success(
        result.created
          ? `Đã tạo hợp đồng ${result.contractCode} và đơn ${result.orderCode}.`
          : `Báo giá đã chuyển thành hợp đồng ${result.contractCode} và đơn ${result.orderCode}.`,
      );
      onOpenOrder(result.orderId);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không chuyển được báo giá.'));
    } finally {
      setBusy(false);
    }
  }

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
  const form = version.form;
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
              <dt>Dự án bán hàng</dt>
              <dd>
                <button type="button" className={styles.linkButton} onClick={() => onOpenOpportunity(detail.opportunityId as string)}>
                  {detail.opportunityName}
                </button>
              </dd>
            </>
          ) : null}
          <dt>Tên báo giá</dt>
          <dd>{version.form.quoteName || <span className={styles.muted}>Chưa đặt tên</span>}</dd>
          <dt>Ngày báo giá</dt>
          <dd>{formatDate(version.form.quoteDate)}</dd>
          <dt>Mẫu báo giá</dt>
          <dd>{version.form.templateName ?? <span className={styles.muted}>Chưa chọn mẫu</span>}</dd>
          <dt>Loại báo giá</dt>
          <dd>{version.form.quoteTypeName ?? <span className={styles.muted}>Chưa chọn loại</span>}</dd>
          <dt>Người phụ trách</dt>
          <dd>{personName(people, detail.ownerUserId)}</dd>
          <dt>Hiệu lực đến</dt>
          <dd>{formatDate(version.validUntil)}</dd>
          <dt>Ngày tính giá</dt>
          <dd>{formatDate(version.priceDate ?? version.pricedOn) || 'Hôm nay'}</dd>
          {version.decisionReason ? (
            <>
              <dt>Lý do</dt>
              <dd>{version.decisionReason}</dd>
            </>
          ) : null}
        </dl>
        <ApprovalNotice detail={detail} />
        {canConvert ? (
          <div className={styles.toolbar}>
            {detail.convertedAt ? (
              <>
                <span className={styles.muted}>Đã chuyển thành hợp đồng và đơn bán ngày {formatDateTime(detail.convertedAt)}.</span>
                <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void convert()}>
                  Mở đơn bán
                </button>
              </>
            ) : (
              <Popconfirm
                title="Chuyển thành hợp đồng và đơn?"
                description="Tạo hợp đồng mua bán, đơn bán (Nháp) cùng dòng, giá của phiên bản khách chấp nhận và một đợt giao mặc định. Mỗi báo giá chỉ chuyển một lần."
                okText="Chuyển"
                cancelText="Huỷ"
                onConfirm={() => convert()}
              >
                <button type="button" className={styles.buttonPrimary} disabled={busy}>
                  Chuyển thành hợp đồng, đơn
                </button>
              </Popconfirm>
            )}
          </div>
        ) : null}
        {actions.length ? (
          <div className={styles.toolbar}>
            {actions.includes('edit') ? (
              <>
                <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setPicking(true)}>
                  <Plus size={14} /> Thêm dòng
                </button>
                <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setEditingHeader(true)}>
                  Cập nhật thông tin báo giá
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
        {form.discountMode === 'ORDER' || form.taxMode === 'ORDER' ? (
          <p className={styles.muted}>
            Mẫu {form.templateName ?? ''}: {form.discountMode === 'ORDER' ? 'chiết khấu tính theo tổng đơn' : 'chiết khấu tính theo dòng'},{' '}
            {form.taxMode === 'ORDER' ? 'thuế tính theo tổng đơn' : 'thuế tính theo dòng'}.
          </p>
        ) : null}
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
          {form.discountMode === 'ORDER' && form.orderDiscount.inputKind ? (
            <>
              <dt>Chiết khấu tổng đơn ({formatPercent(form.orderDiscount.percent)})</dt>
              <dd>{formatMoney(form.orderDiscount.amount)}</dd>
            </>
          ) : null}
          {form.taxMode === 'ORDER' && form.orderTax.inputKind ? (
            <>
              <dt>Thuế tổng đơn ({formatPercent(form.orderTax.percent)})</dt>
              <dd>{formatMoney(form.orderTax.amount)}</dd>
            </>
          ) : null}
          {form.fees.map((fee, index) => (
            <Fragment key={`${fee.feeType}-${index}`}>
              <dt>Phí: {fee.feeType || 'Khoản phí'}</dt>
              <dd>{formatMoney(fee.amount)}</dd>
            </Fragment>
          ))}
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

      <BusinessPlanPanel detail={detail} onChanged={() => void load(viewing)} />

      <section className={styles.panel} aria-label="Mô tả">
        <h3 className={styles.sectionTitle}>Mô tả</h3>
        {version.note ? <p>{version.note}</p> : <p className={styles.muted}>Chưa có mô tả.</p>}
      </section>

      <DocumentsPanel entityType="quote" entityId={detail.id} showTitle />
      <QuoteDocumentReferences quoteId={detail.id} canWrite={capabilities.isTenantAdmin || capabilities.canWriteDocument} />

      <section className={styles.panel} aria-label="Trường tuỳ biến">
        <h3 className={styles.sectionTitle}>Trường tuỳ biến</h3>
        {activeFields(lookups.fields).length ? (
          <dl className={styles.facts}>
            {activeFields(lookups.fields).map((field) => (
              <Fragment key={field.id}>
                <dt>{field.name}</dt>
                <dd>{form.customFields[field.id] === undefined ? <span className={styles.muted}>Chưa nhập</span> : String(form.customFields[field.id])}</dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className={styles.muted}>Chưa có trường tuỳ biến nào.</p>
        )}
      </section>

      <section className={styles.panel} aria-label="Người theo dõi">
        <h3 className={styles.sectionTitle}>Người theo dõi</h3>
        <FollowersPanel quoteId={detail.id} editable={isCurrent && (capabilities.isTenantAdmin || capabilities.canWriteQuote)} />
      </section>

      <section className={styles.panel} aria-label="Đối tượng liên quan">
        <h3 className={styles.sectionTitle}>Đối tượng liên quan</h3>
        <LinksPanel quoteId={detail.id} editable={isCurrent && (capabilities.isTenantAdmin || capabilities.canWriteQuote)} />
      </section>

      <QuotePromotionsPanel
        quoteId={detail.id}
        opportunityId={detail.opportunityId}
        versionNo={version.versionNo}
        revision={version.revision}
        applied={version.promotions ?? []}
        editable={canEditQuotePromotions(version.status, isCurrent, capabilities.isTenantAdmin || capabilities.canWriteQuote)}
        onSaved={() => void load(viewing)}
      />

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
          existingMaterialIds={new Set(version.lines.map((line) => line.materialId))}
          onClose={() => setPicking(false)}
          onAdd={async (lines) => {
            setBusy(true);
            try {
              const next = await addQuoteLines(detail.id, version.versionNo, { revision: version.revision, lines });
              setViewing(undefined);
              setDetail(next);
              toast.success(`Đã thêm ${lines.length} dòng vào báo giá.`);
              setPicking(false);
              return undefined;
            } catch (cause) {
              return { message: errorMessage(cause, 'Không thêm được các dòng.'), lineErrors: lineErrorsOf(cause) };
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {editingLine ? (
        <LineDialog
          line={editingLine}
          lockDiscountOverride={form.discountMode === 'ORDER'}
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
          lookups={lookups}
          onClose={() => setEditingHeader(false)}
          onSave={async (patch) => {
            // Lỗi từ server ném lên để hộp thoại hiện đúng lời; thành công thì cập nhật chi tiết.
            const next = await updateQuoteVersion(detail.id, version.versionNo, patch);
            setViewing(undefined);
            setDetail(next);
            toast.success('Đã cập nhật báo giá.');
            setEditingHeader(false);
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

/** Kết quả thêm lô thất bại: câu chung và lỗi theo dòng (nếu có). */
interface AddFailure {
  readonly message: string;
  readonly lineErrors: readonly QuoteLineError[];
}

/**
 * Chọn nhiều mặt hàng từ danh mục Kho (`GET /catalog/materials`) rồi thêm một lần
 * (`POST .../lines/batch`, tất cả hoặc không). Tập đã chọn giữ khi đổi từ khoá tìm.
 */
function MaterialPicker({
  existingMaterialIds,
  onClose,
  onAdd,
}: {
  existingMaterialIds: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (lines: QuoteLineInput[]) => Promise<AddFailure | undefined>;
}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<readonly CrmCatalogMaterial[]>([]);
  const [picked, setPickedState] = useState<PickedMap>(new Map());
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [confirmingDuplicates, setConfirmingDuplicates] = useState(false);
  const [invalidIds, setInvalidIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [lineErrors, setLineErrors] = useState<readonly string[]>([]);
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

  const update = (next: PickedMap) => {
    setPickedState(next);
    setConfirmingDuplicates(false);
    setInvalidIds([]);
    setLineErrors([]);
    setError(undefined);
  };
  const duplicates = duplicatePicks(picked, existingMaterialIds);
  const rows = onlyPicked ? [...picked.values()].map((entry) => entry.material) : [...items];

  const columns: ColumnsType<CrmCatalogMaterial> = [
    {
      title: 'Mã',
      dataIndex: 'code',
      width: 150,
      render: (value: string, row) => (
        <span>
          <span className={styles.mono}>{value}</span>
          {existingMaterialIds.has(row.id) ? <div className={styles.muted}>Đã có trong báo giá</div> : null}
        </span>
      ),
    },
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
    {
      title: 'Số lượng',
      key: 'quantity',
      width: 110,
      render: (_: unknown, row) => {
        const entry = picked.get(row.id);
        if (!entry) return null;
        return (
          <input
            className={styles.input}
            inputMode="decimal"
            aria-label={`Số lượng ${row.code}`}
            aria-invalid={invalidIds.includes(row.id) || undefined}
            value={entry.quantity}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => update(setPickedQuantity(picked, row.id, event.target.value))}
          />
        );
      },
    },
  ];

  async function save() {
    const built = buildLines(picked);
    if (!built.ok) {
      setInvalidIds(built.invalidIds);
      return setError(built.error);
    }
    if (duplicates.length && !confirmingDuplicates) {
      setConfirmingDuplicates(true);
      return;
    }
    setSaving(true);
    try {
      const failure = await onAdd(built.lines);
      if (failure) {
        setError(failure.message);
        setLineErrors(describeLineErrors(failure.lineErrors, picked));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title="Thêm dòng báo giá"
      subtitle="Chọn một hoặc nhiều mặt hàng từ danh mục Kho"
      submitLabel={addLinesLabel(picked.size, confirmingDuplicates)}
      submitting={saving}
      error={error}
      notice={
        confirmingDuplicates && duplicates.length ? (
          <p role="alert">{duplicateWarning(duplicates)}</p>
        ) : lineErrors.length ? (
          <ul role="alert">
            {lineErrors.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <input
        className={`${styles.input} ${styles.search}`}
        type="search"
        placeholder="Tìm theo mã hoặc tên mặt hàng…"
        maxLength={100}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className={styles.muted}>
        Đã chọn {picked.size} mặt hàng
        {picked.size ? (
          <>
            {' · '}
            <button type="button" className={styles.linkButton} onClick={() => setOnlyPicked((value) => !value)}>
              {onlyPicked ? 'Hiện kết quả tìm' : 'Chỉ hiện đã chọn'}
            </button>
            {' · '}
            <button type="button" className={styles.linkButton} onClick={() => update(new Map())}>
              Bỏ chọn tất cả
            </button>
          </>
        ) : null}
      </div>
      <Table<CrmCatalogMaterial>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ y: 280 }}
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys: [...picked.keys()],
          onSelect: (row, on) => update(setPicked(picked, [row], on)),
          onSelectAll: (on, _selected, changed) => update(setPicked(picked, changed, on)),
        }}
        onRow={(row) => ({ onClick: () => update(setPicked(picked, [row], !picked.has(row.id))) })}
        locale={{ emptyText: loading ? 'Đang tải…' : onlyPicked ? 'Chưa chọn mặt hàng nào.' : 'Không có mặt hàng nào.' }}
      />
    </CrmDialog>
  );
}

/** Sửa số lượng, đơn vị, ghi đè đơn giá hoặc chiết khấu (ghi đè luôn cần duyệt). */
function LineDialog({
  line,
  lockDiscountOverride = false,
  onClose,
  onSave,
}: {
  line: QuoteLine;
  /** Mẫu chiết khấu theo tổng đơn: không ghi đè % chiết khấu theo dòng. */
  lockDiscountOverride?: boolean;
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
    if (!lockDiscountOverride && price.trim() && discount.trim()) return setError('Chỉ ghi đè đơn giá hoặc chiết khấu, không ghi đè cả hai.');
    setSaving(true);
    try {
      await onSave({
        quantity: amount,
        unit: unit.trim(),
        overrideUnitPrice: price.trim() ? (parseNumber(price) ?? Number.NaN) : null,
        overrideDiscountPercent: !lockDiscountOverride && discount.trim() ? (parseNumber(discount) ?? Number.NaN) : null,
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
        price.trim() || (!lockDiscountOverride && discount.trim()) ? (
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
        <Field
          label="Ghi đè chiết khấu (%)"
          hint={
            lockDiscountOverride
              ? 'Mẫu báo giá tính chiết khấu theo tổng đơn: nhập chiết khấu ở phần cập nhật thông tin báo giá.'
              : `Chính sách đề xuất ${formatPercent(line.policyPercent)}`
          }
        >
          <input
            className={styles.input}
            inputMode="decimal"
            value={lockDiscountOverride ? '' : discount}
            disabled={lockDiscountOverride}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </Field>
      </div>
    </CrmDialog>
  );
}

/**
 * Cập nhật thông tin báo giá Nháp theo mẫu: thông tin chung, chiết khấu và thuế tổng đơn (theo mẫu), phí trên hợp
 * đồng, vận chuyển, mô tả, trường tuỳ biến. Lưu bằng một lần `PATCH` phiên bản.
 */
function HeaderDialog({
  detail,
  lookups,
  onClose,
  onSave,
}: {
  detail: QuoteDetail;
  lookups: ReturnType<typeof useQuoteFormLookups>;
  onClose: () => void;
  onSave: (patch: UpdateQuoteVersionRequest) => Promise<void>;
}) {
  const version = detail.version;
  const form = version.form;
  const [general, setGeneral] = useState<GeneralState>({
    code: detail.code,
    name: form.quoteName ?? '',
    quoteDate: form.quoteDate ?? '',
    validUntil: version.validUntil ?? '',
    templateId: form.templateId ?? '',
    typeId: form.quoteTypeId ?? '',
  });
  const [priceDate, setPriceDate] = useState(version.priceDate ?? '');
  const [note, setNote] = useState(version.note ?? '');
  const [shipping, setShipping] = useState(version.shipping.amount ? String(version.shipping.amount) : '');
  const [shippingVat, setShippingVat] = useState(String(version.shipping.vatRate));
  const [shippingCost, setShippingCost] = useState(version.shipping.amount || version.shipping.cost ? String(version.shipping.cost) : '');
  const [discount, setDiscount] = useState<OrderAmountText>(orderAmountText(form.orderDiscount));
  const [tax, setTax] = useState<OrderAmountText>(orderAmountText(form.orderTax));
  const [fees, setFees] = useState<FeeRow[]>(feeRowsOf(form.fees));
  const [custom, setCustom] = useState<CustomFieldTexts>(customFieldTexts(form.customFields));
  const [missing, setMissing] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const template = lookups.templates.find((item) => item.id === general.templateId);
  // Báo giá cũ chưa có mẫu: giữ chế độ theo dòng của engine phase 1.
  const modes = general.templateId ? templateModes(template) : templateModes(undefined);
  const orderDiscountOn = modes.discount === 'ORDER';
  const orderTaxOn = modes.tax === 'ORDER';

  async function save() {
    setError(undefined);
    setMissing([]);
    const invalid = generalInfoError({ name: general.name, code: general.code, requireCode: true });
    setNameError(invalid && invalid.includes('tên') ? invalid : undefined);
    if (invalid) return setError(invalid);
    const absent = missingRequiredFields(lookups.fields, custom);
    if (absent.length) {
      setMissing(absent);
      return setError(requiredFieldsMessage(absent));
    }
    const builtCustom = buildCustomFields(lookups.fields, custom);
    if (!builtCustom.ok) return setError(builtCustom.error);
    const builtFees = buildFees(fees);
    if (!builtFees.ok) return setError(builtFees.error);
    const builtDiscount = orderDiscountOn ? buildOrderAmount(discount, 'chiết khấu') : undefined;
    if (builtDiscount && !builtDiscount.ok) return setError(builtDiscount.error);
    const builtTax = orderTaxOn ? buildOrderAmount(tax, 'thuế') : undefined;
    if (builtTax && !builtTax.ok) return setError(builtTax.error);

    setSaving(true);
    try {
      const amount = shipping.trim() ? (parseNumber(shipping) ?? Number.NaN) : 0;
      const cost = shippingCost.trim() ? (parseNumber(shippingCost) ?? Number.NaN) : null;
      await onSave({
        revision: version.revision,
        code: general.code.trim() !== detail.code ? general.code.trim() : undefined,
        quoteName: general.name.trim(),
        quoteDate: general.quoteDate || null,
        templateId: general.templateId || undefined,
        quoteTypeId: general.typeId || undefined,
        validUntil: general.validUntil || null,
        priceDate: priceDate || null,
        note: note.trim() || null,
        shipping: amount || cost ? { amount, vatRate: parseNumber(shippingVat) ?? null, cost } : null,
        orderDiscount: builtDiscount?.ok ? builtDiscount.value : undefined,
        orderTax: builtTax?.ok ? builtTax.value : undefined,
        fees: builtFees.fees,
        customFields: builtCustom.values,
      });
    } catch (cause) {
      setError(quoteFormErrorMessage(cause, 'Không cập nhật được báo giá.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title="Cập nhật thông tin báo giá"
      subtitle={`Báo giá ${detail.code} · phiên bản ${version.versionNo}`}
      submitLabel="Cập nhật"
      cancelLabel="Huỷ bỏ"
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <h4 className={styles.sectionTitle}>Thông tin chung</h4>
      <GeneralFields
        value={general}
        onChange={setGeneral}
        templates={lookups.templates}
        types={lookups.types}
        codeEditable
        generateCode={false}
        nameError={nameError}
      />
      <h4 className={styles.sectionTitle}>Nội dung báo giá</h4>
      <div className={styles.fieldGrid}>
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
      </div>
      <OrderAmountField
        label="Chiết khấu"
        value={discount}
        allowed={orderDiscountOn}
        lineHint="mẫu báo giá này tính chiết khấu theo dòng (chính sách và ghi đè trên từng dòng hàng). Chọn mẫu tính theo tổng đơn để nhập một lần cho cả báo giá."
        onChange={setDiscount}
      />
      <OrderAmountField
        label="Thuế"
        value={tax}
        allowed={orderTaxOn}
        lineHint="mẫu báo giá này tính thuế theo dòng (VAT của từng mặt hàng). Chọn mẫu tính theo tổng đơn để nhập một lần cho cả báo giá."
        onChange={setTax}
      />
      <FeesEditor rows={fees} onChange={setFees} />
      <h4 className={styles.sectionTitle}>Mô tả</h4>
      <Field label="Mô tả" wide>
        <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <h4 className={styles.sectionTitle}>Trường tuỳ biến</h4>
      <CustomFieldsEditor definitions={lookups.fields} texts={custom} missing={missing} onChange={setCustom} />
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
