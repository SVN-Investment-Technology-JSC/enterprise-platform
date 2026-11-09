'use client';

import {
  QUOTE_STATUS_LABELS,
  type CrmCatalogMaterial,
  type CustomerDetail,
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
import { ArrowLeft, Eye, Plus } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import {
  addQuoteLines,
  convertQuote,
  errorMessage,
  getCustomer,
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
import { buildQuoteLayoutData, emptyQuoteLayoutData, quoteExportFileName } from '../quote-layout/quote-layout.data';
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
  lineErrorsHint,
  lineErrorsOf,
  setPicked,
  setPickedQuantity,
  type PickedMap,
} from './quote-line-picker.model';
import { QuoteLinesTable } from './quote-lines-table';
import { QuotePreviewPane, previewLayoutChoice } from './quote-preview-pane';
import { QUOTE_STATUS_TONE, quoteActions } from './quote.model';
import { QuoteActionBar, QuoteWorkspace, WorkspaceSection, draftedDetail, generalPatch, sameGeneral, savedGeneral } from './quote-workspace';
import workspaceStyles from './quote-workspace.module.scss';

/** Người chỉ có quyền xem mở báo giá: nói rõ vì sao không có ô nhập và nút thao tác. */
export const QUOTE_READ_ONLY_NOTE = 'Bạn chỉ có quyền xem báo giá này. Cần quyền lập báo giá để sửa.';

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

/** Màn lập mới vừa tạo báo giá bằng nút +: mở chọn mặt hàng ngay khi màn báo giá tải xong (plan 9.5 bước 3). */
let pickerAfterOpen: { quoteId: string; search: string } | undefined;
export function openPickerAfterLoad(quoteId: string, search = ''): void {
  pickerAfterOpen = { quoteId, search };
}

/** Đích của hộp chọn mặt hàng: thêm cuối, hoặc chèn trước một dòng (`beforeLineNo`, D3-12). */
interface PickTarget {
  readonly search: string;
  readonly beforeLineNo?: number;
}

/**
 * Màn báo giá (T3-15, T3-16): dòng hàng lấy từ danh mục Kho kèm tồn khả dụng,
 * chính sách đã áp từng dòng, giá vốn ước tính và biên; cảnh báo cần duyệt kèm
 * lý do; gửi duyệt, duyệt, gửi khách, khách chấp nhận hoặc từ chối; xem phiên
 * bản cũ (chỉ đọc), so sánh hai phiên bản, lịch sử duyệt.
 *
 * Phase 3 (plan 9.4): bọc trong `QuoteWorkspace` 2 cột; thông tin chung sửa ngay ở cột trái, xem trước theo bố cục mẫu
 * ở cột phải, nút Huỷ / Lưu / Trình duyệt / Báo giá dưới xem trước.
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
  const [picking, setPicking] = useState<PickTarget>();
  const [editingLine, setEditingLine] = useState<QuoteLine>();
  const [viewingLine, setViewingLine] = useState<QuoteLine>();
  const [editingHeader, setEditingHeader] = useState<false | 'all' | 'orderDiscount'>(false);
  const [reasonFor, setReasonFor] = useState<ReasonAction>();
  const [comparing, setComparing] = useState(false);
  /** Thông tin chung đang sửa ở cột trái; rỗng là chưa sửa (hiện bản đã lưu). */
  const [draft, setDraft] = useState<GeneralState | null>(null);
  const [generalError, setGeneralError] = useState<string>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
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

  // Đổi phiên bản đang xem thì bỏ phần đang sửa (phiên bản cũ chỉ đọc).
  useEffect(() => {
    setDraft(null);
    setGeneralError(undefined);
  }, [viewing]);

  const loadedId = detail?.id;
  useEffect(() => {
    if (!loadedId || pickerAfterOpen?.quoteId !== loadedId) return;
    setPicking({ search: pickerAfterOpen.search });
    pickerAfterOpen = undefined;
  }, [loadedId]);

  // Chi tiết khách cho biến `customer.*` của bố cục in; đọc lỗi thì dùng mã, tên trên báo giá.
  const customerId = detail?.customerId;
  useEffect(() => {
    if (!customerId) return undefined;
    let active = true;
    getCustomer(customerId)
      .then((next) => active && setCustomer(next))
      .catch(() => active && setCustomer(null));
    return () => {
      active = false;
    };
  }, [customerId]);

  const saved = useMemo(() => (detail ? savedGeneral(detail) : undefined), [detail]);
  const shownGeneral = draft ?? saved;
  const dirty = Boolean(draft && saved && !sameGeneral(draft, saved));
  // Xem trước dựng lại sau khi ngừng gõ 300 ms; riêng mẫu thì đổi ngay (bố cục lấy theo `shownGeneral.templateId`).
  const previewGeneral = useDebounced(shownGeneral, 300);
  const { templates, types, fields } = lookups;
  const previewData = useMemo(() => {
    if (!detail || !previewGeneral) return undefined;
    return buildQuoteLayoutData({
      detail: draftedDetail(detail, previewGeneral, { templates, types }),
      customer,
      people,
      customFields: fields,
    });
  }, [detail, previewGeneral, templates, types, fields, customer, people]);

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
  const canWrite = capabilities.isTenantAdmin || capabilities.canWriteQuote;
  const act = (action: QuoteAction, reason?: string) =>
    detail && version
      ? run(() => quoteAction(detail.id, version.versionNo, action, { revision: version.revision, reason }), ACTION_DONE[action])
      : Promise.resolve(false);

  /**
   * Lưu thông tin chung đang sửa (`PATCH` phiên bản, kiểm như hộp thoại cập nhật thông tin). Trả báo giá sau khi lưu
   * (không có gì để lưu thì trả bản hiện tại) để thao tác kế tiếp dùng đúng `revision`; lỗi thì trả rỗng.
   */
  async function saveGeneral(): Promise<QuoteDetail | undefined> {
    if (!detail || !version) return undefined;
    if (!draft || !dirty) return detail;
    const invalid = generalInfoError({ name: draft.name, code: draft.code, requireCode: true });
    const absent = invalid ? [] : missingRequiredFields(lookups.fields, customFieldTexts(version.form.customFields));
    const problem = invalid ?? (absent.length ? requiredFieldsMessage(absent) : undefined);
    setGeneralError(invalid && invalid.includes('tên') ? invalid : undefined);
    if (problem) {
      toast.error(problem);
      return undefined;
    }
    setBusy(true);
    try {
      const next = await updateQuoteVersion(detail.id, version.versionNo, generalPatch(detail, draft));
      setViewing(undefined);
      setDetail(next);
      setDraft(null);
      toast.success('Đã lưu báo giá.');
      return next;
    } catch (cause) {
      toast.error(quoteFormErrorMessage(cause, 'Không lưu được báo giá.'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  /** Trình duyệt hoặc gửi khách; có thay đổi chưa lưu thì lưu trước, lưu lỗi thì dừng (plan 9.4). */
  async function saveThen(action: 'submit' | 'send') {
    const current = await saveGeneral();
    if (!current) return;
    const target = current.version;
    await run(
      () => quoteAction(current.id, target.versionNo, action, { revision: target.revision }),
      ACTION_DONE[action],
    );
  }

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
  if (!detail || !version || !shownGeneral) return null;

  const isCurrent = version.versionNo === detail.currentVersion;
  const totals = version.totals;
  const form = version.form;
  const approvalHistory = detail.history.filter((entry) => ['submit', 'approve', 'reject'].includes(entry.action));
  const selectedTemplate = lookups.templates.find((item) => item.id === shownGeneral.templateId);
  const toolbarActions = actions.filter((action) => action !== 'submit' && action !== 'send');

  const header = (
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
  );

  const left = (
    <>
      <section className={styles.panel} aria-label="Thông tin báo giá">
        <h3 className={styles.sectionTitle}>Thông tin chung</h3>
        {canWrite ? null : (
          <p className={workspaceStyles.readOnlyNote} role="note">
            <Eye size={15} aria-hidden="true" /> {QUOTE_READ_ONLY_NOTE}
          </p>
        )}
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
          {editable ? null : (
            <>
              <dt>Tên báo giá</dt>
              <dd>{version.form.quoteName || <span className={styles.muted}>Chưa đặt tên</span>}</dd>
              <dt>Ngày báo giá</dt>
              <dd>{formatDate(version.form.quoteDate)}</dd>
              <dt>Mẫu báo giá</dt>
              <dd>{version.form.templateName ?? <span className={styles.muted}>Chưa chọn mẫu</span>}</dd>
              <dt>Loại báo giá</dt>
              <dd>{version.form.quoteTypeName ?? <span className={styles.muted}>Chưa chọn loại</span>}</dd>
            </>
          )}
          <dt>Người phụ trách</dt>
          <dd>{personName(people, detail.ownerUserId)}</dd>
          {editable ? null : (
            <>
              <dt>Hiệu lực đến</dt>
              <dd>{formatDate(version.validUntil)}</dd>
            </>
          )}
          <dt>Ngày tính giá</dt>
          <dd>{formatDate(version.priceDate ?? version.pricedOn) || 'Hôm nay'}</dd>
          {version.decisionReason ? (
            <>
              <dt>Lý do</dt>
              <dd>{version.decisionReason}</dd>
            </>
          ) : null}
        </dl>
        {editable ? (
          <>
            <GeneralFields
              value={shownGeneral}
              onChange={(next) => {
                setDraft(next);
                setGeneralError(undefined);
              }}
              templates={lookups.templates}
              types={lookups.types}
              codeEditable
              generateCode={false}
              nameError={generalError}
            />
            <div className={styles.toolbar}>
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setEditingHeader('all')}>
                <Plus size={14} /> Cập nhật thông tin báo giá
              </button>
              <span className={styles.muted}>
                Thêm tuỳ chọn: ngày tính giá, phí, vận chuyển, chiết khấu và thuế tổng đơn, mô tả, trường tuỳ biến.
              </span>
            </div>
          </>
        ) : null}
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
        {toolbarActions.length ? (
          <div className={styles.toolbar}>
            {actions.includes('edit') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void act('recalculate')}>
                Tính lại giá
              </button>
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

      <QuoteLinesTable
        title={`Dòng hàng · phiên bản ${version.versionNo}`}
        lines={version.lines}
        costHidden={Boolean(version.costHidden)}
        editable={editable}
        busy={busy}
        emptyText={editable ? 'Chưa có dòng nào. Bấm + để chọn mặt hàng từ danh mục Kho.' : 'Không có dòng nào.'}
        discount={{
          enabled: form.discountMode === 'ORDER',
          hint:
            form.discountMode === 'ORDER'
              ? 'Nhập chiết khấu một lần cho cả báo giá.'
              : 'Mẫu báo giá này tính chiết khấu theo dòng; chọn mẫu tính theo tổng đơn để nhập chiết khấu tổng đơn.',
          onOpen: () => setEditingHeader('orderDiscount'),
        }}
        onAdd={(search) => setPicking({ search })}
        onInsert={(line) => setPicking({ search: '', beforeLineNo: line.lineNo })}
        onEdit={setEditingLine}
        onView={setViewingLine}
        onRemove={(row) => run(() => removeQuoteLine(detail.id, version.versionNo, row.id, version.revision), 'Đã bỏ dòng.')}
      >
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
          {version.costHidden ? null : (
            <>
              <dt>Giá vốn ước tính (gồm vận chuyển bên bán chịu)</dt>
              <dd>{formatMoney(totals.estCost)}</dd>
              <dt>Lợi nhuận ước tính</dt>
              <dd>
                {formatMoney(totals.profit)}
                {totals.marginPercent === null ? '' : ` (biên ${formatPercent(totals.marginPercent)})`}
              </dd>
            </>
          )}
        </dl>
      </QuoteLinesTable>

      <WorkspaceSection title="Phương án kinh doanh (PAKD)">
        <BusinessPlanPanel detail={detail} onChanged={() => void load(viewing)} />
      </WorkspaceSection>

      <WorkspaceSection title="Khuyến mãi">
        <QuotePromotionsPanel
          quoteId={detail.id}
          opportunityId={detail.opportunityId}
          versionNo={version.versionNo}
          revision={version.revision}
          applied={version.promotions ?? []}
          editable={canEditQuotePromotions(version.status, isCurrent, capabilities.isTenantAdmin || capabilities.canWriteQuote)}
          onSaved={() => void load(viewing)}
        />
      </WorkspaceSection>

      <WorkspaceSection title="Tài liệu">
        <DocumentsPanel entityType="quote" entityId={detail.id} showTitle />
        <QuoteDocumentReferences quoteId={detail.id} canWrite={capabilities.isTenantAdmin || capabilities.canWriteDocument} />
      </WorkspaceSection>

      <WorkspaceSection title="Mô tả và trường tuỳ biến">
        <section className={styles.panel} aria-label="Mô tả">
          <h3 className={styles.sectionTitle}>Mô tả</h3>
          {version.note ? <p>{version.note}</p> : <p className={styles.muted}>Chưa có mô tả.</p>}
        </section>
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
      </WorkspaceSection>

      <WorkspaceSection title="Liên quan">
        <section className={styles.panel} aria-label="Người theo dõi">
          <h3 className={styles.sectionTitle}>Người theo dõi</h3>
          <FollowersPanel quoteId={detail.id} editable={isCurrent && (capabilities.isTenantAdmin || capabilities.canWriteQuote)} />
        </section>
        <section className={styles.panel} aria-label="Đối tượng liên quan">
          <h3 className={styles.sectionTitle}>Đối tượng liên quan</h3>
          <LinksPanel quoteId={detail.id} editable={isCurrent && (capabilities.isTenantAdmin || capabilities.canWriteQuote)} />
        </section>
      </WorkspaceSection>

      <WorkspaceSection title="Lịch sử">
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
      </WorkspaceSection>
    </>
  );

  return (
    <>
      <QuoteWorkspace
        header={header}
        left={left}
        preview={
          <QuotePreviewPane
            choice={previewLayoutChoice(version)}
            templateId={shownGeneral.templateId || null}
            templateName={selectedTemplate?.name ?? form.templateName}
            templateHasLayout={selectedTemplate?.hasLayout}
            data={previewData ?? emptyQuoteLayoutData()}
            fileName={quoteExportFileName(detail.code, version.versionNo)}
          />
        }
        actions={
          canWrite && isCurrent ? (
            <QuoteActionBar
              dirty={dirty}
              busy={busy}
              canSave={editable && dirty}
              canSubmit={actions.includes('submit') && version.lines.length > 0}
              submitHint={actions.includes('submit') ? 'Báo giá chưa có dòng hàng.' : undefined}
              canSend={actions.includes('send')}
              onCancel={() => {
                setDraft(null);
                setGeneralError(undefined);
              }}
              onSave={() => void saveGeneral()}
              onSubmit={() => void saveThen('submit')}
              onSend={() => void saveThen('send')}
            />
          ) : undefined
        }
      />

      {picking ? (
        <MaterialPicker
          existingMaterialIds={new Set(version.lines.map((line) => line.materialId))}
          initialSearch={picking.search}
          beforeLineNo={picking.beforeLineNo}
          onClose={() => setPicking(undefined)}
          onAdd={async (lines) => {
            setBusy(true);
            try {
              const next = await addQuoteLines(detail.id, version.versionNo, {
                revision: version.revision,
                lines,
                ...(picking.beforeLineNo ? { beforeLineNo: picking.beforeLineNo } : {}),
              });
              setViewing(undefined);
              setDetail(next);
              toast.success(
                picking.beforeLineNo
                  ? `Đã chèn ${lines.length} dòng trước dòng ${picking.beforeLineNo}.`
                  : `Đã thêm ${lines.length} dòng vào báo giá.`,
              );
              setPicking(undefined);
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
      {viewingLine ? <LineDialog line={viewingLine} readOnly onClose={() => setViewingLine(undefined)} onSave={async () => undefined} /> : null}
      {editingHeader ? (
        <HeaderDialog
          detail={detail}
          lookups={lookups}
          initialGeneral={draft ?? undefined}
          only={editingHeader === 'orderDiscount' ? 'orderDiscount' : undefined}
          onClose={() => setEditingHeader(false)}
          onSave={async (patch) => {
            // Lỗi từ server ném lên để hộp thoại hiện đúng lời; thành công thì cập nhật chi tiết.
            const next = await updateQuoteVersion(detail.id, version.versionNo, patch);
            setViewing(undefined);
            setDetail(next);
            setDraft(null);
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
    </>
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
  initialSearch = '',
  beforeLineNo,
  onClose,
  onAdd,
}: {
  existingMaterialIds: ReadonlySet<string>;
  /** Chữ đã gõ ở ô tìm của bảng dòng hàng. */
  initialSearch?: string;
  /** Chèn trước dòng này (menu "Chèn"); rỗng là thêm cuối. */
  beforeLineNo?: number;
  onClose: () => void;
  onAdd: (lines: QuoteLineInput[]) => Promise<AddFailure | undefined>;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [items, setItems] = useState<readonly CrmCatalogMaterial[]>([]);
  const [picked, setPickedState] = useState<PickedMap>(new Map());
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [confirmingDuplicates, setConfirmingDuplicates] = useState(false);
  const [invalidIds, setInvalidIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [lineErrors, setLineErrors] = useState<readonly string[]>([]);
  const [lineHint, setLineHint] = useState<string>();
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
    setLineHint(undefined);
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
      title: 'Giá vốn bình quân',
      dataIndex: 'avgCost',
      width: 150,
      align: 'right',
      render: (value: number | null) => (value === null ? '' : formatMoney(value)),
    },
    {
      title: 'Giá bán đề xuất (Kho)',
      dataIndex: 'salePrice',
      width: 150,
      align: 'right',
      render: (value: number | null | undefined) => (value === null || value === undefined ? '' : formatMoney(value)),
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
        setLineHint(lineErrorsHint(failure.lineErrors));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={beforeLineNo ? `Chèn dòng trước dòng ${beforeLineNo}` : 'Thêm dòng báo giá'}
      subtitle="Chọn một hoặc nhiều mặt hàng từ danh mục Kho"
      submitLabel={addLinesLabel(picked.size, confirmingDuplicates)}
      submitting={saving}
      error={error}
      notice={
        confirmingDuplicates && duplicates.length ? (
          <p role="alert">{duplicateWarning(duplicates)}</p>
        ) : lineErrors.length ? (
          <>
            <ul role="alert">
              {lineErrors.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            {lineHint ? <p className={styles.muted}>{lineHint}</p> : null}
          </>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <input
        className={styles.input}
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
  readOnly = false,
  onClose,
  onSave,
}: {
  line: QuoteLine;
  /** Mẫu chiết khấu theo tổng đơn: không ghi đè % chiết khấu theo dòng. */
  lockDiscountOverride?: boolean;
  /** Báo giá không còn Nháp: chỉ xem, không lưu. */
  readOnly?: boolean;
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
    if (readOnly) return onClose();
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
      subtitle={readOnly ? `${line.materialName} (chỉ xem)` : line.materialName}
      submitLabel={readOnly ? 'Đóng' : undefined}
      hideCancel={readOnly}
      submitting={saving}
      error={error}
      notice={
        !readOnly && (price.trim() || (!lockDiscountOverride && discount.trim())) ? (
          <p className={styles.warning}>Ghi đè giá hoặc chiết khấu: báo giá phải được duyệt trước khi gửi khách.</p>
        ) : null
      }
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Số lượng" required>
          <input className={styles.input} inputMode="decimal" value={quantity} disabled={readOnly} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="Đơn vị tính" required>
          <input className={styles.input} maxLength={50} value={unit} disabled={readOnly} onChange={(event) => setUnit(event.target.value)} />
        </Field>
        <Field label="Ghi đè đơn giá sau CK" hint={`Đơn giá gốc ${formatMoney(line.listPrice)}`}>
          <input className={styles.input} inputMode="decimal" value={price} disabled={readOnly} onChange={(event) => setPrice(event.target.value)} />
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
            disabled={lockDiscountOverride || readOnly}
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
  initialGeneral,
  only,
  onClose,
  onSave,
}: {
  detail: QuoteDetail;
  lookups: ReturnType<typeof useQuoteFormLookups>;
  /** Thông tin chung đang sửa dở ở cột trái (chưa lưu); rỗng thì lấy bản đã lưu. */
  initialGeneral?: GeneralState;
  /** `orderDiscount`: chỉ hiện phần chiết khấu tổng đơn (nút "Chiết khấu" của bảng dòng hàng). */
  only?: 'orderDiscount';
  onClose: () => void;
  onSave: (patch: UpdateQuoteVersionRequest) => Promise<void>;
}) {
  const version = detail.version;
  const form = version.form;
  const [general, setGeneral] = useState<GeneralState>(
    initialGeneral ?? {
      code: detail.code,
      name: form.quoteName ?? '',
      quoteDate: form.quoteDate ?? '',
      validUntil: version.validUntil ?? '',
      templateId: form.templateId ?? '',
      typeId: form.quoteTypeId ?? '',
    },
  );
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
      title={only === 'orderDiscount' ? 'Chiết khấu tổng đơn' : 'Cập nhật thông tin báo giá'}
      subtitle={`Báo giá ${detail.code} · phiên bản ${version.versionNo}`}
      submitLabel="Cập nhật"
      cancelLabel="Huỷ bỏ"
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      {only === 'orderDiscount' ? (
        <OrderAmountField
          label="Chiết khấu"
          value={discount}
          allowed={orderDiscountOn}
          lineHint="mẫu báo giá này tính chiết khấu theo dòng (chính sách và ghi đè trên từng dòng hàng). Chọn mẫu tính theo tổng đơn để nhập một lần cho cả báo giá."
          onChange={setDiscount}
        />
      ) : (
        <>
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
        </>
      )}
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
