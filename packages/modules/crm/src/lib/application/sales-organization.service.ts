import {
  SALES_ORGANIZATION_IN_USE_CODE,
  SALES_ORGANIZATION_INACTIVE_CODE,
  SALES_ORGANIZATION_INVALID_CODE,
  SALES_ORGANIZATION_NOT_FOUND_CODE,
  validateQuoteSeller,
  validateSalesOrganization,
  type QuoteSeller,
  type SalesOrganization,
  type SalesOrganizationError,
  type SalesOrganizationSummary,
  type SaveSalesOrganizationRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { SalesOrganizationReader, SalesOrganizationRecord, SalesOrganizationStore } from './sales-organization-store.port.js';

/**
 * Danh mục tổ chức báo giá (plan phase 3 mục 16, D3-24, D3-25): công ty con, pháp nhân phát hành báo giá.
 *
 * Ai có `crm.read` xem được (để chọn trên báo giá); thêm, sửa, tắt, xoá chỉ `crm.manage`. Tổ chức đã có báo giá dùng
 * thì không xoá được, chỉ tắt. Tắt tổ chức mặc định thì tổ chức đó thôi là mặc định (mặc định phải đang bật).
 */
export class SalesOrganizationService {
  constructor(private readonly store: SalesOrganizationStore) {}

  list(actor: CrmActor, includeInactive: unknown): Promise<SalesOrganizationSummary[]> {
    return this.store.list(actor.tenantId, includeInactive === true || includeInactive === 'true');
  }

  async get(actor: CrmActor, id: string): Promise<SalesOrganization> {
    if (!isUuid(id)) throw salesOrganizationNotFound();
    const organization = await this.store.get(actor.tenantId, id.toLowerCase());
    if (!organization) throw salesOrganizationNotFound();
    return organization;
  }

  async create(actor: CrmActor, request: SaveSalesOrganizationRequest): Promise<SalesOrganization> {
    requireSalesManager(actor);
    return this.store.create(actor.tenantId, organizationRecord(request), actor.userId);
  }

  /**
   * Sửa: web gửi đủ trường như tạo; trường không gửi (`undefined`) giữ giá trị đang lưu, kể cả logo (`logo: null` là
   * bỏ logo). Nhờ vậy nút Tắt/Bật, Đặt mặc định chỉ cần gửi một trường.
   */
  async update(actor: CrmActor, id: string, request: Partial<SaveSalesOrganizationRequest>): Promise<SalesOrganization> {
    requireSalesManager(actor);
    if (!isUuid(id)) throw salesOrganizationNotFound();
    const current = await this.store.get(actor.tenantId, id.toLowerCase());
    if (!current) throw salesOrganizationNotFound();
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(request ?? {})) if (value !== undefined) merged[key] = value;
    const updated = await this.store.update(actor.tenantId, current.id, organizationRecord(merged), actor.userId);
    if (!updated) throw salesOrganizationNotFound();
    return updated;
  }

  async remove(actor: CrmActor, id: string): Promise<void> {
    requireSalesManager(actor);
    if (!isUuid(id)) throw salesOrganizationNotFound();
    const result = await this.store.remove(actor.tenantId, id.toLowerCase(), actor.userId);
    if (result === 'not-found') throw salesOrganizationNotFound();
    if (result === 'in-use') throw new CrmConflictError(SALES_ORGANIZATION_IN_USE_CODE, 'Tổ chức đã có báo giá, chỉ tắt được.');
  }
}

/** 404 riêng mã `SALES_ORGANIZATION_NOT_FOUND` để web phân biệt với báo giá không có. */
export function salesOrganizationNotFound(): CrmError {
  return new CrmError(SALES_ORGANIZATION_NOT_FOUND_CODE, 'Không tìm thấy tổ chức báo giá.', 404);
}

/** Lỗi kiểm tổ chức hoặc `seller`: 400, `message` là lỗi đầu tiên, đủ danh sách ở `fieldErrors`. */
export function salesOrganizationInvalid(errors: readonly SalesOrganizationError[]): CrmValidationError {
  return new CrmValidationError(SALES_ORGANIZATION_INVALID_CODE, errors[0]?.message ?? 'Thông tin tổ chức không hợp lệ.', {
    fieldErrors: errors,
  });
}

function organizationRecord(input: unknown): SalesOrganizationRecord {
  const result = validateSalesOrganization(input);
  if (!result.ok) throw salesOrganizationInvalid(result.errors);
  const organization = result.organization;
  // Tổ chức mặc định được chọn sẵn khi lập báo giá nên phải đang bật; tắt thì thôi là mặc định.
  return organization.active ? organization : { ...organization, isDefault: false };
}

/** Thông tin tổ chức sửa tay trên báo giá: `null` là xoá; còn lại chỉ kiểm độ dài (không ép bắt buộc). */
export function quoteSellerOf(value: unknown): QuoteSeller | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CrmValidationError(SALES_ORGANIZATION_INVALID_CODE, 'Thông tin tổ chức trên báo giá không hợp lệ.', { fieldErrors: [] });
  }
  const result = validateQuoteSeller(value as Record<string, unknown>);
  if (!result.ok) throw salesOrganizationInvalid(result.errors);
  return result.seller;
}

/**
 * Tổ chức chọn trên báo giá: phải tồn tại (404 `SALES_ORGANIZATION_NOT_FOUND`) và đang bật (400
 * `SALES_ORGANIZATION_INACTIVE`). Giữ nguyên tổ chức cũ đã tắt thì bên gọi không gọi hàm này.
 */
export async function pickSalesOrganization(
  reader: SalesOrganizationReader | undefined,
  tenantId: string,
  id: unknown,
): Promise<SalesOrganization> {
  if (!isUuid(id) || !reader) throw salesOrganizationNotFound();
  const organization = await reader.get(tenantId, id.toLowerCase());
  if (!organization) throw salesOrganizationNotFound();
  if (!organization.active) {
    throw new CrmValidationError(SALES_ORGANIZATION_INACTIVE_CODE, 'Tổ chức báo giá này đã tắt, vui lòng chọn tổ chức khác.');
  }
  return organization;
}
