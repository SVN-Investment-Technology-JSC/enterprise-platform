/**
 * Tổ chức báo giá (công ty con, pháp nhân bán hàng) của tenant, plan phase 3 mục 16 (D3-24 đến D3-28). Quản trị bán hàng
 * khai ở Cấu hình; người lập báo giá chọn tổ chức phát hành báo giá, đầu trang in lấy thông tin tổ chức đó (biến
 * `company.*`). Hàm kiểm dùng chung cho web và server.
 */
import { checkQuoteLayoutImage } from './quote-layout.js';

/** Thông tin chữ của tổ chức in lên báo giá; trên phiên bản báo giá là bản sửa được riêng cho báo giá đó. */
export interface QuoteSeller {
  readonly name: string;
  readonly shortName: string | null;
  readonly address: string;
  readonly taxCode: string;
  readonly phone: string;
  readonly email: string;
  readonly website: string | null;
  readonly bankAccount: string | null;
  readonly bankName: string | null;
  readonly representative: string | null;
  readonly representativeTitle: string | null;
}

/** Một dòng danh sách tổ chức (không có logo để danh sách nhẹ). */
export interface SalesOrganizationSummary extends QuoteSeller {
  readonly id: string;
  readonly code: string | null;
  readonly hasLogo: boolean;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
  /** Đã có phiên bản báo giá dùng: không xoá được, chỉ tắt. */
  readonly inUse: boolean;
  readonly updatedAt: string;
}

/** Chi tiết một tổ chức, có logo. */
export interface SalesOrganization extends SalesOrganizationSummary {
  /** Data URL PNG hoặc JPEG, tối đa 300 KB; rỗng là không có logo. */
  readonly logo: string | null;
}

/**
 * Tạo hoặc sửa tổ chức. Tạo gửi đủ trường bắt buộc; sửa (PATCH) có thể chỉ gửi trường cần đổi (trường không gửi giữ giá
 * trị cũ, kể cả logo; `logo: null` là bỏ logo). Tổ chức tắt thì không còn là mặc định.
 */
export interface SaveSalesOrganizationRequest {
  readonly code?: string | null;
  readonly name: string;
  readonly shortName?: string | null;
  readonly address: string;
  readonly taxCode: string;
  readonly phone: string;
  readonly email: string;
  readonly website?: string | null;
  readonly bankAccount?: string | null;
  readonly bankName?: string | null;
  readonly representative?: string | null;
  readonly representativeTitle?: string | null;
  /** `null` là bỏ logo. */
  readonly logo?: string | null;
  readonly isDefault?: boolean;
  readonly active?: boolean;
  readonly sortOrder?: number;
}

export const SALES_ORGANIZATION_LIMITS = {
  code: 30,
  name: 200,
  shortName: 100,
  address: 500,
  taxCode: 20,
  phone: 50,
  email: 200,
  website: 200,
  bankAccount: 50,
  bankName: 200,
  representative: 200,
  representativeTitle: 100,
} as const;

export type SalesOrganizationField = keyof typeof SALES_ORGANIZATION_LIMITS | 'logo' | 'sortOrder';

/** Nhãn tiếng Việt của từng trường, dùng cho câu lỗi và form. */
export const SALES_ORGANIZATION_FIELD_LABELS: Readonly<Record<SalesOrganizationField, string>> = {
  code: 'Mã',
  name: 'Tên công ty',
  shortName: 'Tên viết tắt',
  address: 'Địa chỉ',
  taxCode: 'Mã số thuế',
  phone: 'Điện thoại',
  email: 'Email',
  website: 'Website',
  bankAccount: 'Số tài khoản',
  bankName: 'Ngân hàng',
  representative: 'Người đại diện',
  representativeTitle: 'Chức vụ',
  logo: 'Logo',
  sortOrder: 'Thứ tự',
};

/** Trường bắt buộc của tổ chức (D3-25). Trên báo giá (`QuoteSeller`) không ép bắt buộc. */
export const SALES_ORGANIZATION_REQUIRED_FIELDS = ['name', 'address', 'taxCode', 'phone', 'email'] as const;

const SELLER_TEXT_FIELDS = [
  'name',
  'shortName',
  'address',
  'taxCode',
  'phone',
  'email',
  'website',
  'bankAccount',
  'bankName',
  'representative',
  'representativeTitle',
] as const satisfies readonly (keyof QuoteSeller)[];

export const SALES_ORGANIZATION_NOT_FOUND_CODE = 'SALES_ORGANIZATION_NOT_FOUND';
export const SALES_ORGANIZATION_INACTIVE_CODE = 'SALES_ORGANIZATION_INACTIVE';
export const SALES_ORGANIZATION_IN_USE_CODE = 'SALES_ORGANIZATION_IN_USE';
export const SALES_ORGANIZATION_NAME_EXISTS_CODE = 'SALES_ORGANIZATION_NAME_EXISTS';
export const SALES_ORGANIZATION_CODE_EXISTS_CODE = 'SALES_ORGANIZATION_CODE_EXISTS';
export const SALES_ORGANIZATION_INVALID_CODE = 'SALES_ORGANIZATION_INVALID';

export interface SalesOrganizationError {
  readonly field: SalesOrganizationField;
  readonly message: string;
}

/** MST Việt Nam: 10 số, hoặc 10 số, gạch, 3 số (chi nhánh). */
const TAX_CODE_PATTERN = /^\d{10}(-\d{3})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim().normalize('NFC') : '');
const optional = (value: unknown): string | null => clean(value) || null;

/** Thông tin chữ đã chuẩn hoá (cắt khoảng trắng, NFC; trường tuỳ chọn rỗng là `null`). */
export function normalizeQuoteSeller(input: Partial<Record<keyof QuoteSeller, unknown>> | null | undefined): QuoteSeller {
  const source = input ?? {};
  return {
    name: clean(source.name),
    shortName: optional(source.shortName),
    address: clean(source.address),
    taxCode: clean(source.taxCode),
    phone: clean(source.phone),
    email: clean(source.email),
    website: optional(source.website),
    bankAccount: optional(source.bankAccount),
    bankName: optional(source.bankName),
    representative: optional(source.representative),
    representativeTitle: optional(source.representativeTitle),
  };
}

/** Thông tin tổ chức trên báo giá có trường nào không rỗng không (rỗng hết thì lưu `null`). */
export function hasQuoteSeller(seller: QuoteSeller | null | undefined): boolean {
  return !!seller && SELLER_TEXT_FIELDS.some((field) => !!seller[field]);
}

function lengthErrors(values: Record<string, string | null>, errors: SalesOrganizationError[]): void {
  for (const [field, limit] of Object.entries(SALES_ORGANIZATION_LIMITS)) {
    const value = values[field];
    if (value && value.length > limit) {
      const key = field as keyof typeof SALES_ORGANIZATION_LIMITS;
      errors.push({ field: key, message: `${SALES_ORGANIZATION_FIELD_LABELS[key]} tối đa ${limit} ký tự.` });
    }
  }
}

/**
 * Kiểm thông tin tổ chức trên báo giá (`seller`): chỉ kiểm độ dài, không ép bắt buộc, không kiểm dạng MST, email (người
 * lập có thể sửa tay riêng cho báo giá).
 */
export function validateQuoteSeller(input: Partial<Record<keyof QuoteSeller, unknown>> | null | undefined):
  | { readonly ok: true; readonly seller: QuoteSeller | null }
  | { readonly ok: false; readonly errors: readonly SalesOrganizationError[] } {
  const seller = normalizeQuoteSeller(input);
  const errors: SalesOrganizationError[] = [];
  lengthErrors(seller as unknown as Record<string, string | null>, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, seller: hasQuoteSeller(seller) ? seller : null };
}

export interface NormalizedSalesOrganization extends QuoteSeller {
  readonly code: string | null;
  readonly logo: string | null;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
}

/** Kiểm tổ chức khi tạo, sửa (D3-25): trường bắt buộc, dạng MST, email, độ dài, logo như ảnh bố cục. */
export function validateSalesOrganization(input: unknown):
  | { readonly ok: true; readonly organization: NormalizedSalesOrganization }
  | { readonly ok: false; readonly errors: readonly SalesOrganizationError[] } {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const seller = normalizeQuoteSeller(source);
  const code = optional(source['code']);
  const errors: SalesOrganizationError[] = [];
  for (const field of SALES_ORGANIZATION_REQUIRED_FIELDS) {
    if (!seller[field]) errors.push({ field, message: `Vui lòng nhập ${SALES_ORGANIZATION_FIELD_LABELS[field].toLowerCase()}.` });
  }
  lengthErrors({ ...(seller as unknown as Record<string, string | null>), code }, errors);
  if (seller.taxCode && !TAX_CODE_PATTERN.test(seller.taxCode)) {
    errors.push({ field: 'taxCode', message: 'Mã số thuế gồm 10 chữ số, hoặc 10 chữ số, dấu gạch và 3 chữ số (chi nhánh).' });
  }
  if (seller.email && !EMAIL_PATTERN.test(seller.email)) errors.push({ field: 'email', message: 'Email không đúng định dạng.' });

  let logo: string | null = null;
  const rawLogo = source['logo'];
  if (rawLogo !== undefined && rawLogo !== null && rawLogo !== '') {
    const check = typeof rawLogo === 'string' ? checkQuoteLayoutImage(rawLogo) : 'invalid';
    if (check === 'too-large') errors.push({ field: 'logo', message: 'Logo vượt 300 KB. Hãy giảm kích thước ảnh.' });
    else if (check === 'invalid') errors.push({ field: 'logo', message: 'Logo phải là ảnh PNG hoặc JPEG.' });
    else logo = rawLogo as string;
  }

  const rawSort = source['sortOrder'];
  const sortOrder = rawSort === undefined || rawSort === null ? 0 : rawSort;
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    errors.push({ field: 'sortOrder', message: 'Thứ tự là số nguyên từ 0 đến 9999.' });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    organization: {
      ...seller,
      code,
      logo,
      isDefault: source['isDefault'] === true,
      active: source['active'] !== false,
      sortOrder: sortOrder as number,
    },
  };
}

/** Chép phần chữ của tổ chức thành thông tin trên báo giá. */
export function sellerFromOrganization(organization: QuoteSeller): QuoteSeller {
  return normalizeQuoteSeller(organization);
}

/** Giá trị biến `company.*` theo thông tin tổ chức trên báo giá; không có thì chuỗi rỗng. */
export function companyVariableValues(seller: QuoteSeller | null | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of SELLER_TEXT_FIELDS) values[`company.${field}`] = seller?.[field] ?? '';
  return values;
}
