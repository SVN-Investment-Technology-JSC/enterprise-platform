'use client';

/**
 * Bố cục màn lập và sửa báo giá 2 cột (phase 3, plan 9.4; task P3C4-02, P3C4-05): trái nhập liệu, phải xem trước dính
 * khi cuộn, nút Huỷ / Lưu / Trình duyệt / Báo giá dưới xem trước. Màn dưới 1280 px chuyển thành hai tab, nút hành động
 * xuống thanh dưới cố định. Thành phần này chỉ sắp chỗ; logic lưu, tính giá, duyệt, gửi vẫn ở `QuoteEditor`.
 *
 * Kèm các hàm thuần cho xem trước: ghép thông tin chung đang nhập (chưa lưu) vào báo giá để dựng bố cục, và dựng một báo
 * giá rỗng cho màn lập mới.
 */
import type {
  CustomFieldValue,
  QuoteDetail,
  QuoteTemplate,
  QuoteType,
  UpdateQuoteVersionRequest,
} from '@enterprise-platform/contracts-crm';
import { useEffect, useState, type ReactNode } from 'react';
import { CrmDialog } from '../components/crm-ui';
import salesStyles from '../sales.module.scss';
import type { GeneralState } from './quote-form-parts';
import styles from './quote-workspace.module.scss';

/** Bề ngang dưới mức này thì chuyển sang hai tab (plan 9.4). */
export const QUOTE_WORKSPACE_NARROW_QUERY = '(max-width: 1279.98px)';

/** `true` khi màn hẹp hơn 1280 px. Môi trường không có `matchMedia` (máy chủ, jsdom) coi là màn rộng. */
export function useNarrowScreen(query = QUOTE_WORKSPACE_NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    setNarrow(list.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  return narrow;
}

type WorkspaceTab = 'input' | 'preview';

/**
 * Khung 2 cột. `left` và `preview` luôn được dựng (đổi tab chỉ ẩn), để chuyển tab hay đổi cỡ cửa sổ không làm mất dữ
 * liệu đang nhập ở các khối con.
 */
export function QuoteWorkspace({
  header,
  left,
  preview,
  actions,
  narrow: forcedNarrow,
}: {
  header?: ReactNode;
  left: ReactNode;
  preview: ReactNode;
  /** Hàng nút hành động; rỗng thì không có thanh nút (người chỉ đọc). */
  actions?: ReactNode;
  /** Ép chế độ màn hẹp (spec); mặc định theo bề ngang cửa sổ. */
  narrow?: boolean;
}) {
  const detected = useNarrowScreen();
  const narrow = forcedNarrow ?? detected;
  const [tab, setTab] = useState<WorkspaceTab>('input');
  const actionBar = actions ? (
    <div className={narrow ? `${styles.actionBar} ${styles.actionBarFixed}` : styles.actionBar} role="toolbar" aria-label="Thao tác báo giá">
      {actions}
    </div>
  ) : null;

  return (
    <div className={narrow ? `${styles.workspace} ${styles.narrow}` : styles.workspace}>
      {header}
      {narrow ? (
        <div className={styles.tabs} role="tablist" aria-label="Màn báo giá">
          {(
            [
              ['input', 'Nhập liệu'],
              ['preview', 'Xem trước'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? styles.tabActive : styles.tab}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.columns}>
        <div className={styles.left} hidden={narrow && tab !== 'input'} data-testid="quote-workspace-left">
          {left}
        </div>
        <aside className={styles.right} hidden={narrow && tab !== 'preview'} data-testid="quote-workspace-right">
          <div className={styles.rightInner}>
            {preview}
            {narrow ? null : actionBar}
          </div>
        </aside>
      </div>
      {narrow && actionBar ? (
        <>
          <div className={styles.actionBarSpacer} />
          {actionBar}
        </>
      ) : null}
    </div>
  );
}

/** Khối thu gọn được ở cột trái (PAKD, khuyến mãi, tài liệu, liên quan, lịch sử). */
export function WorkspaceSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className={styles.section} open={defaultOpen || undefined}>
      <summary className={styles.sectionSummary}>{title}</summary>
      {children}
    </details>
  );
}

/**
 * Bốn nút dưới xem trước (plan 9.4). Nút chỉ hiện với người được lập, sửa báo giá; bật tắt theo `can*` do màn gọi tính
 * từ `quoteActions` như trước. Huỷ khi có thay đổi chưa lưu thì hỏi lại.
 */
export function QuoteActionBar({
  dirty,
  busy,
  canCancel,
  canSave,
  canSubmit,
  canSend,
  submitHint,
  cancelMessage = 'Các thông tin vừa nhập sẽ trở về giá trị đã lưu.',
  onCancel,
  onSave,
  onSubmit,
  onSend,
}: {
  dirty: boolean;
  busy: boolean;
  /** Bấm được Huỷ khi không có thay đổi (màn lập mới: về danh sách). */
  canCancel?: boolean;
  canSave: boolean;
  canSubmit: boolean;
  canSend: boolean;
  /** Lý do nút Trình duyệt tắt (ví dụ chưa có dòng hàng). */
  submitHint?: string;
  /** Câu giải thích trong hộp hỏi khi Huỷ có thay đổi chưa lưu. */
  cancelMessage?: string;
  onCancel: () => void;
  onSave: () => void;
  onSubmit: () => void;
  onSend: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button
        type="button"
        className={salesStyles.buttonGhost}
        disabled={busy || (!dirty && !canCancel)}
        onClick={() => (dirty ? setConfirming(true) : onCancel())}
      >
        Huỷ
      </button>
      <button type="button" className={salesStyles.buttonGhost} disabled={busy || !canSave} onClick={onSave}>
        Lưu
      </button>
      <button type="button" className={salesStyles.buttonPrimary} disabled={busy || !canSubmit} title={canSubmit ? undefined : submitHint} onClick={onSubmit}>
        Trình duyệt
      </button>
      <button type="button" className={salesStyles.buttonPrimary} disabled={busy || !canSend} onClick={onSend}>
        Báo giá
      </button>
      {confirming ? (
        <CrmDialog
          open
          danger
          title="Bỏ các thay đổi chưa lưu?"
          submitLabel="Bỏ thay đổi"
          cancelLabel="Ở lại"
          onClose={() => setConfirming(false)}
          onSubmit={() => {
            setConfirming(false);
            onCancel();
          }}
        >
          <p className={salesStyles.muted}>{cancelMessage}</p>
        </CrmDialog>
      ) : null}
    </>
  );
}

// --- Hàm thuần cho thông tin chung và xem trước --------------------------------------------------------------------

/** Thông tin chung đã lưu của phiên bản (cùng cách khởi tạo với hộp thoại cập nhật thông tin). */
export function savedGeneral(detail: QuoteDetail): GeneralState {
  const version = detail.version;
  const form = version.form;
  return {
    code: detail.code,
    name: form.quoteName ?? '',
    quoteDate: form.quoteDate ?? '',
    validUntil: version.validUntil ?? '',
    templateId: form.templateId ?? '',
    typeId: form.quoteTypeId ?? '',
  };
}

export function sameGeneral(a: GeneralState, b: GeneralState): boolean {
  return (
    a.code === b.code &&
    a.name === b.name &&
    a.quoteDate === b.quoteDate &&
    a.validUntil === b.validUntil &&
    a.templateId === b.templateId &&
    a.typeId === b.typeId
  );
}

/** Thân `PATCH` phiên bản chỉ gồm thông tin chung (cùng cách ánh xạ với hộp thoại cập nhật thông tin). */
export function generalPatch(detail: QuoteDetail, general: GeneralState): UpdateQuoteVersionRequest {
  return {
    revision: detail.version.revision,
    code: general.code.trim() !== detail.code ? general.code.trim() : undefined,
    quoteName: general.name.trim(),
    quoteDate: general.quoteDate || null,
    templateId: general.templateId || undefined,
    quoteTypeId: general.typeId || undefined,
    validUntil: general.validUntil || null,
  };
}

/**
 * Báo giá để dựng xem trước: thông tin chung đang nhập (chưa lưu) đè lên bản đã lưu. Tiền giữ theo lần tính gần nhất
 * của server (plan 9.4: đổi mẫu chưa lưu thì chỉ đổi bố cục).
 */
export function draftedDetail(
  detail: QuoteDetail,
  general: GeneralState,
  lookups: { templates: readonly QuoteTemplate[]; types: readonly QuoteType[] },
): QuoteDetail {
  const version = detail.version;
  const form = version.form;
  const template = lookups.templates.find((item) => item.id === general.templateId);
  const type = lookups.types.find((item) => item.id === general.typeId);
  return {
    ...detail,
    code: general.code.trim() || detail.code,
    version: {
      ...version,
      validUntil: general.validUntil || null,
      form: {
        ...form,
        quoteName: general.name,
        quoteDate: general.quoteDate || null,
        templateId: general.templateId || null,
        templateName: general.templateId === form.templateId ? form.templateName : (template?.name ?? form.templateName),
        quoteTypeId: general.typeId || null,
        quoteTypeName: general.typeId === form.quoteTypeId ? form.quoteTypeName : (type?.name ?? form.quoteTypeName),
      },
    },
  };
}

export interface BlankQuoteInput {
  readonly general: GeneralState;
  readonly note: string;
  /** Giá trị đã dựng bằng `buildCustomFields`; `null` (bỏ trống) không in. */
  readonly customFields: Readonly<Record<string, CustomFieldValue | null>>;
  readonly customer?: { readonly id: string; readonly code: string; readonly name: string } | null;
  readonly opportunity?: { readonly id: string; readonly name: string } | null;
  readonly ownerUserId: string;
  readonly templates: readonly QuoteTemplate[];
  readonly types: readonly QuoteType[];
  readonly today: string;
}

/** Báo giá chưa có bản ghi (màn lập mới): không dòng hàng, tiền bằng 0, thông tin lấy theo form đang nhập. */
export function blankQuoteDetail(input: BlankQuoteInput): QuoteDetail {
  const { general } = input;
  const template = input.templates.find((item) => item.id === general.templateId);
  const type = input.types.find((item) => item.id === general.typeId);
  const now = input.today;
  const customFields: Record<string, CustomFieldValue> = {};
  for (const [id, value] of Object.entries(input.customFields)) if (value !== null) customFields[id] = value;
  return {
    id: '',
    code: general.code.trim(),
    opportunityId: input.opportunity?.id ?? null,
    opportunityName: input.opportunity?.name ?? null,
    customerId: input.customer?.id ?? '',
    customerCode: input.customer?.code ?? '',
    customerName: input.customer?.name ?? '',
    ownerUserId: input.ownerUserId,
    status: 'DRAFT',
    currentVersion: 1,
    quoteName: general.name,
    validUntil: general.validUntil || null,
    totalAmount: 0,
    updatedAt: now,
    acceptedVersion: null,
    convertedAt: null,
    createdAt: now,
    versions: [],
    procedure: null,
    history: [],
    approvalCheck: null,
    version: {
      id: '',
      versionNo: 1,
      status: 'DRAFT',
      revision: 0,
      validUntil: general.validUntil || null,
      priceDate: null,
      pricedOn: null,
      note: input.note.trim() || null,
      shipping: { amount: 0, vatRate: 0, cost: 0 },
      totals: {
        grossAmount: 0,
        discountAmount: 0,
        netAmount: 0,
        shippingAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        estCost: 0,
        profit: 0,
        marginPercent: null,
        discountPercent: 0,
      },
      form: {
        quoteName: general.name,
        quoteDate: general.quoteDate || null,
        templateId: general.templateId || null,
        templateName: template?.name ?? null,
        quoteTypeId: general.typeId || null,
        quoteTypeName: type?.name ?? null,
        discountMode: template?.discountMode ?? 'LINE',
        taxMode: template?.taxMode ?? 'LINE',
        orderDiscount: { percent: 0, amount: 0, inputKind: null },
        orderTax: { percent: 0, amount: 0, inputKind: null },
        fees: [],
        feesAmount: 0,
        customFields,
      },
      promotions: [],
      requiresApproval: false,
      approvalReasons: [],
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      decisionReason: null,
      sentAt: null,
      respondedAt: null,
      supersededAt: null,
      createdAt: now,
      layoutSnapshot: null,
      lines: [],
    },
  };
}
