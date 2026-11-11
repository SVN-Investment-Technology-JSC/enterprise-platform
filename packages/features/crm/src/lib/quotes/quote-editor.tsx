'use client';

import {
  QUOTE_STATUS_LABELS,
  type CrmCatalogMaterial,
  type CustomerDetail,
  type QuoteLineError,
  type QuoteLineInput,
  type QuoteDetail,
  type QuoteLine,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Eye, Trash2 } from 'lucide-react';
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
  deleteQuote,
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
  FollowersPanel,
  GeneralFields,
  TemplatePicker,
  LinksPanel,
  useQuoteFormLookups,
  type GeneralState,
} from './quote-form-parts';
import {
  buildQuoteDetailsPatch,
  customFieldTexts,
  generalInfoError,
  missingRequiredFields,
  quoteDetailsOf,
  quoteFormErrorMessage,
  requiredFieldsMessage,
  sameQuoteDetails,
  templateModes,
  type QuoteDetailsState,
} from './quote-form-edit.model';
import { ORDER_DISCOUNT_ANCHOR, QuoteDetailsBlock } from './quote-details-block';
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
import { QUOTE_STATUS_TONE, canDeleteQuote, quoteActions } from './quote.model';
import { QuoteActionBar, QuoteWorkspace, WorkspaceSection, draftedDetail, generalPatch, sameGeneral, savedGeneral } from './quote-workspace';
import { QuoteSellerSection } from './quote-seller-section';
import {
  sameSeller,
  savedSeller,
  sellerErrors,
  sellerFieldErrorsOf,
  sellerPatch,
  withSellerDraft,
  type SellerField,
  type SellerState,
  organizationIdOf,
} from './quote-seller.model';
import { useSalesOrganization, useSalesOrganizations } from './use-sales-organizations';
import workspaceStyles from './quote-workspace.module.scss';
import { AwaitingApprovalNotice, BUSINESS_PLAN_SECTION_ID, openBusinessPlanSection } from './awaiting-approval-notice';
import { BACK_TO_TASKS_LABEL, type QuotePanel } from '../tasks/tasks.model';

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
  openPanel,
  onBack,
  onBackToTasks,
  onOpenCustomer,
  onOpenOpportunity,
  onOpenOrder,
}: {
  quoteId: string;
  /** Khối mở sẵn khi vào (mở từ việc PAKD ở trang Việc cần xử lý). */
  openPanel?: QuotePanel;
  onBack: () => void;
  /** Mở từ trang Việc cần xử lý: thêm nút quay về trang đó. */
  onBackToTasks?: () => void;
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
  const [reasonFor, setReasonFor] = useState<ReasonAction>();
  const [comparing, setComparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Thông tin chung đang sửa ở cột trái; rỗng là chưa sửa (hiện bản đã lưu). */
  const [draft, setDraft] = useState<GeneralState | null>(null);
  const [generalError, setGeneralError] = useState<string>();
  /** Tổ chức báo giá đang sửa (plan 16.4); rỗng là chưa sửa. */
  const [sellerDraft, setSellerDraft] = useState<SellerState | null>(null);
  /**
   * Khối "Cập nhật thông tin báo giá" đang sửa (ngày tính giá, vận chuyển, chiết khấu và thuế tổng đơn, phí, ghi chú,
   * trường tuỳ biến), lưu chung bằng nút Lưu; rỗng là chưa sửa.
   */
  const [detailsDraft, setDetailsDraft] = useState<QuoteDetailsState | null>(null);
  const [detailsMissing, setDetailsMissing] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sellerFieldErrors, setSellerFieldErrors] = useState<Partial<Record<SellerField, string>>>({});
  const { organizations } = useSalesOrganizations();
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
    setSellerDraft(null);
    setSellerFieldErrors({});
    setDetailsDraft(null);
    setDetailsMissing([]);
  }, [viewing]);

  const loadedId = detail?.id;
  // Mở từ việc PAKD: cuộn tới khối PAKD (đã mở sẵn) khi báo giá tải xong.
  useEffect(() => {
    if (loadedId && openPanel === 'business-plan') openBusinessPlanSection();
  }, [loadedId, openPanel]);

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
  const generalDirty = Boolean(draft && saved && !sameGeneral(draft, saved));
  const savedSellerState = useMemo(() => (detail ? savedSeller(detail) : undefined), [detail]);
  const shownSeller = sellerDraft ?? savedSellerState;
  const sellerDirty = Boolean(sellerDraft && savedSellerState && !sameSeller(sellerDraft, savedSellerState));
  const savedDetails = useMemo(() => (detail ? quoteDetailsOf(detail.version) : undefined), [detail]);
  const shownDetails = detailsDraft ?? savedDetails;
  const detailsDirty = Boolean(detailsDraft && savedDetails && !sameQuoteDetails(detailsDraft, savedDetails));
  const dirty = generalDirty || sellerDirty || detailsDirty;
  /** Chế độ chiết khấu, thuế của mẫu đang chọn trên màn (đổi mẫu chưa lưu cũng tính). */
  const shownModes = (() => {
    const templateId = (draft ?? saved)?.templateId;
    if (!templateId) return templateModes(detail ? { discountMode: detail.version.form.discountMode, taxMode: detail.version.form.taxMode } : undefined);
    const chosen = lookups.templates.find((item) => item.id === templateId);
    return chosen ? templateModes(chosen) : templateModes(detail ? { discountMode: detail.version.form.discountMode, taxMode: detail.version.form.taxMode } : undefined);
  })();
  // Xem trước dựng lại sau khi ngừng gõ 300 ms; riêng mẫu thì đổi ngay (bố cục lấy theo `shownGeneral.templateId`).
  const previewGeneral = useDebounced(shownGeneral, 300);
  const previewSeller = useDebounced(shownSeller, 300);
  // Logo của tổ chức vừa chọn (chưa lưu) cho xem trước; tổ chức đã lưu thì dùng `sellerLogo` của server.
  const chosenOrganization = useSalesOrganization(previewSeller ? organizationIdOf(previewSeller) : null);
  const { templates, types, fields } = lookups;
  const previewData = useMemo(() => {
    if (!detail || !previewGeneral) return undefined;
    const drafted = draftedDetail(detail, previewGeneral, { templates, types });
    return buildQuoteLayoutData({
      detail: previewSeller ? withSellerDraft(drafted, previewSeller, chosenOrganization) : drafted,
      customer,
      people,
      customFields: fields,
    });
  }, [detail, previewGeneral, previewSeller, chosenOrganization, templates, types, fields, customer, people]);

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
    if (!detail || !version || !saved) return undefined;
    if (!dirty) return detail;
    const general = draft ?? saved;
    const details = detailsDraft ?? savedDetails;
    const invalid = generalInfoError({ name: general.name, code: general.code, requireCode: true });
    const absent = invalid ? [] : missingRequiredFields(lookups.fields, details?.custom ?? customFieldTexts(version.form.customFields));
    const builtDetails = detailsDirty && details ? buildQuoteDetailsPatch(details, lookups.fields, shownModes) : undefined;
    const problem =
      invalid ?? (absent.length ? requiredFieldsMessage(absent) : builtDetails && !builtDetails.ok ? builtDetails.error : undefined);
    setGeneralError(invalid && invalid.includes('tên') ? invalid : undefined);
    setDetailsMissing(absent);
    // Lỗi nằm ở khối thông tin thêm thì mở khối để thấy ô cần sửa.
    if (absent.length || (builtDetails && !builtDetails.ok)) setDetailsOpen(true);
    if (problem) {
      toast.error(problem);
      return undefined;
    }
    const sellerProblems = sellerDirty && sellerDraft ? sellerErrors(sellerDraft) : {};
    setSellerFieldErrors(sellerProblems);
    const firstSellerProblem = Object.values(sellerProblems)[0];
    if (firstSellerProblem) {
      toast.error(firstSellerProblem);
      return undefined;
    }
    setBusy(true);
    try {
      const next = await updateQuoteVersion(detail.id, version.versionNo, {
        ...generalPatch(detail, general),
        ...(sellerDirty && sellerDraft ? sellerPatch(sellerDraft) : {}),
        ...(builtDetails?.ok ? builtDetails.patch : {}),
      });
      setViewing(undefined);
      setDetail(next);
      setDraft(null);
      setSellerDraft(null);
      setDetailsDraft(null);
      setDetailsMissing([]);
      toast.success('Đã lưu báo giá.');
      return next;
    } catch (cause) {
      setSellerFieldErrors(sellerFieldErrorsOf(cause));
      toast.error(quoteFormErrorMessage(cause, 'Không lưu được báo giá.'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  /** Nút "Sửa % chiết khấu": mở khối thông tin báo giá và cuộn tới ô chiết khấu tổng đơn (theo mẫu đang chọn trên màn). */
  function openOrderDiscount() {
    setDetailsOpen(true);
    window.setTimeout(() => {
      const anchor = document.getElementById(ORDER_DISCOUNT_ANCHOR);
      anchor?.scrollIntoView?.({ block: 'center' });
      anchor?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
    }, 0);
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

  const backToTasks = onBackToTasks ? (
    <button type="button" className={styles.buttonGhost} onClick={onBackToTasks}>
      <ArrowLeft size={14} /> {BACK_TO_TASKS_LABEL}
    </button>
  ) : null;

  if (error && !detail) {
    return (
      <div className={styles.page}>
        {backToTasks}
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách báo giá
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!detail || !version || !shownGeneral || !shownSeller) return null;

  const isCurrent = version.versionNo === detail.currentVersion;
  const totals = version.totals;
  const form = version.form;
  const approvalHistory = detail.history.filter((entry) => ['submit', 'approve', 'reject'].includes(entry.action));
  const selectedTemplate = lookups.templates.find((item) => item.id === shownGeneral.templateId);
  /** Chế độ chiết khấu theo mẫu đang chọn trên màn; mẫu không còn trong danh sách thì theo bản đã lưu. */
  const shownDiscountMode = selectedTemplate?.discountMode ?? version.form.discountMode;
  const toolbarActions = actions.filter((action) => action !== 'submit' && action !== 'send');

  const header = (
    <div className={styles.detailHead}>
      {backToTasks}
      <button type="button" className={styles.buttonGhost} onClick={onBack}>
        <ArrowLeft size={14} /> Danh sách báo giá
      </button>
      <h2 className={styles.detailTitle}>
        Báo giá <span className={styles.mono}>{detail.code}</span>
      </h2>
      {detail.versions.length > 1 ? (
        <button type="button" className={styles.buttonGhost} onClick={() => setComparing((value) => !value)}>
          {comparing ? 'Ẩn so sánh' : 'So sánh phiên bản'}
        </button>
      ) : null}
      {canDeleteQuote(detail, capabilities, currentUserId) ? (
        <button type="button" className={`${styles.buttonDangerGhost} ${styles.pushRight}`} disabled={busy} onClick={() => setDeleting(true)}>
          <Trash2 size={14} aria-hidden="true" /> Xoá báo giá
        </button>
      ) : null}
      {deleting ? (
        <DeleteQuoteDialog
          code={detail.code}
          viaProcedure={version.status === 'PENDING' && !!detail.procedure}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await deleteQuote(detail.id);
            toast.success(`Đã xoá báo giá ${detail.code}.`);
            setDeleting(false);
            onBack();
          }}
        />
      ) : null}
    </div>
  );

  const left = (
    <>
      {detail.awaitingMyApproval ? <AwaitingApprovalNotice quoteId={detail.id} target={detail.awaitingMyApproval} /> : null}
      <QuoteSellerSection
        value={shownSeller}
        onChange={(next) => {
          setSellerDraft(next);
          setSellerFieldErrors({});
        }}
        editable={editable}
        organizations={organizations}
        organizationName={form.organizationName}
        errors={sellerFieldErrors}
      />
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
              showTemplate={false}
            />
          </>
        ) : null}
        {shownDetails ? (
          <QuoteDetailsBlock
            open={detailsOpen}
            onToggle={() => setDetailsOpen((value) => !value)}
            editable={editable}
            value={shownDetails}
            onChange={(next) => {
              setDetailsDraft(next);
              setDetailsMissing([]);
            }}
            fields={lookups.fields}
            missing={detailsMissing}
            modes={shownModes}
            version={version}
          />
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
          // Theo mẫu đang chọn trên màn (đổi mẫu chưa lưu cũng tính): bấm khi còn thay đổi thì lưu trước rồi mới mở.
          enabled: shownDiscountMode === 'ORDER',
          hint:
            shownDiscountMode === 'ORDER'
              ? 'Nhập chiết khấu một lần cho cả báo giá.'
              : 'Mẫu báo giá này tính chiết khấu theo dòng; chọn mẫu tính theo tổng đơn để nhập chiết khấu tổng đơn.',
          onOpen: openOrderDiscount,
        }}
        onAdd={(search) => setPicking({ search })}
        onInsert={(line) => setPicking({ search: '', beforeLineNo: line.lineNo })}
        onEdit={setEditingLine}
        onView={setViewingLine}
        onRemove={(row) => run(() => removeQuoteLine(detail.id, version.versionNo, row.id, version.revision), 'Đã bỏ dòng.')}
        note={
          form.discountMode === 'ORDER' || form.taxMode === 'ORDER' ? (
            <p className={styles.muted}>
              Mẫu {form.templateName ?? ''}: {form.discountMode === 'ORDER' ? 'chiết khấu tính theo tổng đơn' : 'chiết khấu tính theo dòng'},{' '}
              {form.taxMode === 'ORDER' ? 'thuế tính theo tổng đơn' : 'thuế tính theo dòng'}.
            </p>
          ) : undefined
        }
      >
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

      <WorkspaceSection id={BUSINESS_PLAN_SECTION_ID} title="Phương án kinh doanh (PAKD)" defaultOpen={openPanel === 'business-plan'}>
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
        summary={
          <>
            <span className={styles.mono}>{detail.code}</span>
            <StatusPill tone={QUOTE_STATUS_TONE[version.status]}>{QUOTE_STATUS_LABELS[version.status]}</StatusPill>
            <SearchableSelect
              style={{ width: 150 }}
              options={detail.versions.map((entry) => ({
                value: String(entry.versionNo),
                label: `Phiên bản ${entry.versionNo}`,
                description: `${QUOTE_STATUS_LABELS[entry.status]} · ${formatMoney(entry.totalAmount)}`,
              }))}
              value={String(version.versionNo)}
              clearable={false}
              height={32}
              onChange={(value) => {
                const number = Number(value);
                setViewing(number === detail.currentVersion ? undefined : number);
              }}
            />
            {isCurrent ? null : <span>Đang xem bản cũ, hiện tại là phiên bản {detail.currentVersion}</span>}
          </>
        }
        preview={
          <QuotePreviewPane
            choice={previewLayoutChoice(version)}
            templateId={shownGeneral.templateId || null}
            templateName={selectedTemplate?.name ?? form.templateName}
            templateHasLayout={selectedTemplate?.hasLayout}
            templatePicker={
              editable ? (
                <TemplatePicker
                  templates={lookups.templates}
                  value={shownGeneral.templateId}
                  onChange={(templateId) => {
                    setDraft({ ...shownGeneral, templateId });
                    setGeneralError(undefined);
                  }}
                />
              ) : undefined
            }
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
                setSellerDraft(null);
                setSellerFieldErrors({});
                setDetailsDraft(null);
                setDetailsMissing([]);
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

/** Hỏi lại trước khi xoá hẳn báo giá; lỗi (ví dụ hồ sơ Quy trình vừa duyệt xong) hiện trong hộp, báo giá giữ nguyên. */
function DeleteQuoteDialog({
  code,
  viaProcedure,
  onClose,
  onConfirm,
}: {
  code: string;
  viaProcedure: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function confirm() {
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm();
    } catch (cause) {
      setError(errorMessage(cause, 'Không xoá được báo giá.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog
      open
      danger
      title={`Xoá báo giá ${code}?`}
      submitLabel="Xoá báo giá"
      cancelLabel="Không xoá"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void confirm()}
    >
      <p>Báo giá cùng dòng hàng, phương án kinh doanh, người theo dõi, liên kết và tài liệu đính kèm sẽ bị xoá hẳn, không khôi phục được.</p>
      {viaProcedure ? <p>Hồ sơ duyệt bên Quy trình của báo giá này sẽ được huỷ.</p> : null}
    </CrmDialog>
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
