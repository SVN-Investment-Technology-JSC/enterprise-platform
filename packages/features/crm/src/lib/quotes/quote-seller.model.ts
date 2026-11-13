/**
 * Mục "Tổ chức báo giá" trên màn lập và sửa báo giá (plan mục 16.4, task P3C6-06): trạng thái đang nhập, so sánh với bản
 * đã lưu, thân gửi API và ghép vào báo giá để dựng xem trước.
 */
import {
  SALES_ORGANIZATION_FIELD_LABELS,
  SALES_ORGANIZATION_LIMITS,
  hasQuoteSeller,
  normalizeQuoteSeller,
  sellerFromOrganization,
  validateQuoteSeller,
  type QuoteDetail,
  type QuoteSeller,
} from '@enterprise-platform/contracts-crm';

export type SellerField = keyof QuoteSeller;
export type SellerTexts = Readonly<Record<SellerField, string>>;

/** Các ô luôn hiện (nhóm bắt buộc của tổ chức). */
export const SELLER_MAIN_FIELDS = ['name', 'address', 'taxCode', 'phone', 'email'] as const satisfies readonly SellerField[];
/** Các ô tuỳ chọn, gập sau nút "Thêm thông tin". */
export const SELLER_EXTRA_FIELDS = [
  'shortName',
  'website',
  'bankAccount',
  'bankName',
  'representative',
  'representativeTitle',
] as const satisfies readonly SellerField[];
export const SELLER_FIELDS: readonly SellerField[] = [...SELLER_MAIN_FIELDS, ...SELLER_EXTRA_FIELDS];

export const sellerFieldLabel = (field: SellerField): string => SALES_ORGANIZATION_FIELD_LABELS[field];
export const sellerFieldLimit = (field: SellerField): number => SALES_ORGANIZATION_LIMITS[field];

/**
 * Lựa chọn "Nhập thủ công" ở ô chọn tổ chức (D3-29): không gắn tổ chức, người lập tự nhập thông tin công ty cho báo giá.
 * Lưu lên server là `organizationId = null` kèm `seller` có nội dung.
 */
export const MANUAL_ORGANIZATION = '__manual__';

export const isManualSeller = (state: SellerState): boolean => state.organizationId === MANUAL_ORGANIZATION;

/** Id tổ chức thật (bỏ "không chọn" và "Nhập thủ công"). */
export const organizationIdOf = (state: SellerState): string | null =>
  state.organizationId && state.organizationId !== MANUAL_ORGANIZATION ? state.organizationId : null;

/** Tổ chức đang chọn (`''` là không chọn, `MANUAL_ORGANIZATION` là nhập thủ công) và thông tin chữ. */
export interface SellerState {
  readonly organizationId: string;
  readonly seller: SellerTexts;
}

export const EMPTY_SELLER_TEXTS: SellerTexts = Object.fromEntries(SELLER_FIELDS.map((field) => [field, ''])) as SellerTexts;
export const EMPTY_SELLER_STATE: SellerState = { organizationId: '', seller: EMPTY_SELLER_TEXTS };

export function sellerTexts(seller: QuoteSeller | null | undefined): SellerTexts {
  if (!seller) return EMPTY_SELLER_TEXTS;
  return Object.fromEntries(SELLER_FIELDS.map((field) => [field, seller[field] ?? ''])) as SellerTexts;
}

/** Chép phần chữ của tổ chức vào ô (chọn tổ chức, "Lấy lại từ tổ chức"). */
export function sellerStateFromOrganization(organization: QuoteSeller & { readonly id: string }): SellerState {
  return { organizationId: organization.id, seller: sellerTexts(sellerFromOrganization(organization)) };
}

/** Bản đã lưu trên phiên bản. */
export function savedSeller(detail: QuoteDetail): SellerState {
  const form = detail.version.form;
  const organizationId = form.organizationId ?? (hasQuoteSeller(form.seller) ? MANUAL_ORGANIZATION : '');
  return { organizationId, seller: sellerTexts(form.seller) };
}

export function sameSeller(a: SellerState, b: SellerState): boolean {
  if (a.organizationId !== b.organizationId) return false;
  return SELLER_FIELDS.every((field) => a.seller[field].trim() === b.seller[field].trim());
}

/** Thông tin chữ đã chuẩn hoá để gửi; mọi ô rỗng thì `null`. */
export function sellerValue(state: SellerState): QuoteSeller | null {
  const checked = validateQuoteSeller(state.seller);
  if (checked.ok) return checked.seller;
  return normalizeQuoteSeller(state.seller);
}

/** Phần thân `POST /quotes`, `PATCH` phiên bản cho tổ chức báo giá. */
export function sellerPatch(state: SellerState): { organizationId: string | null; seller: QuoteSeller | null } {
  // Không chọn: bỏ cả thông tin; chọn tổ chức hoặc nhập thủ công: gửi thông tin đang có.
  return { organizationId: organizationIdOf(state), seller: state.organizationId ? sellerValue(state) : null };
}

/** Lỗi theo ô (chỉ độ dài, plan 16.2: thông tin trên báo giá không ép bắt buộc). */
export function sellerErrors(state: SellerState): Partial<Record<SellerField, string>> {
  const checked = validateQuoteSeller(state.seller);
  if (checked.ok) return {};
  const errors: Partial<Record<SellerField, string>> = {};
  for (const error of checked.errors) {
    if ((SELLER_FIELDS as readonly string[]).includes(error.field) && !errors[error.field as SellerField]) {
      errors[error.field as SellerField] = error.message;
    }
  }
  return errors;
}

/** Lỗi theo ô từ server (`fieldErrors` của 400 `SALES_ORGANIZATION_INVALID`). */
export function sellerFieldErrorsOf(cause: unknown): Partial<Record<SellerField, string>> {
  const list = (cause as { fieldErrors?: readonly { field: string; message: string }[] } | null)?.fieldErrors;
  const errors: Partial<Record<SellerField, string>> = {};
  for (const error of list ?? []) {
    if ((SELLER_FIELDS as readonly string[]).includes(error.field) && !errors[error.field as SellerField]) {
      errors[error.field as SellerField] = error.message;
    }
  }
  return errors;
}

/**
 * Báo giá để dựng xem trước với tổ chức đang chọn (chưa lưu). Đổi tổ chức thì logo theo tổ chức mới (`organizationLogo`,
 * rỗng là chưa tải hoặc không có); giữ tổ chức đã lưu thì giữ `sellerLogo` của server (đã gửi khách là bản chụp, D3-27).
 */
export function withSellerDraft(
  detail: QuoteDetail,
  state: SellerState,
  organization?: { readonly name: string | null; readonly logo: string | null } | null,
): QuoteDetail {
  const version = detail.version;
  const form = version.form;
  const organizationId = organizationIdOf(state);
  const changedOrganization = (form.organizationId ?? null) !== organizationId;
  const name = organizationId ? (changedOrganization ? (organization?.name ?? null) : form.organizationName) : null;
  // Nhập thủ công không có logo tổ chức: khối đầu trang dùng logo dự phòng của mẫu (nếu có).
  const logo = !organizationId ? null : changedOrganization ? (organization?.logo ?? null) : version.sellerLogo;
  return {
    ...detail,
    version: {
      ...version,
      sellerLogo: logo,
      form: { ...form, organizationId, organizationName: name, seller: state.organizationId ? sellerValue(state) : null },
    },
  };
}
