import {
  CRM_DUPLICATE_TAX_CODE,
  CUSTOMER_KINDS,
  type CreateCustomerRequest,
  type CrmPage,
  type CustomerDetail,
  type CustomerListQuery,
  type CustomerSummary,
  type SaveContactRequest,
  type TaxCodeMatch,
  type UpdateCustomerRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import { normalizeCustomerCode } from '../domain/customer-code.js';
import {
  isUuid,
  normalizeSearch,
  optionalEmail,
  optionalEnum,
  optionalId,
  optionalInteger,
  optionalMoney,
  optionalText,
  requiredText,
  requiredVersion,
} from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { normalizeTaxCode } from '../domain/tax-code.js';
import { assertOwnerInScope, requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import type { ContactRecord, CustomerRecord, CustomerStore } from './sales-store.port.js';

const CUSTOMER_NOT_FOUND = 'Không tìm thấy khách hàng.';

/**
 * Khách hàng và người liên hệ.
 *
 * Đọc: trong phạm vi dữ liệu (ngoài phạm vi là 404). Ghi: `crm.opportunity.write`
 * và bản ghi phải trong phạm vi. MST trùng với khách khác là cảnh báo, không
 * chặn: lần lưu đầu trả 409 `DUPLICATE_TAX_CODE` kèm khách đã có, người dùng
 * xác nhận (`confirmDuplicateTaxCode`) thì lưu.
 */
export class CustomerService {
  constructor(
    private readonly customers: CustomerStore,
    private readonly scopes: CrmDataScopeService,
  ) {}

  async list(actor: CrmActor, query: CustomerListQuery): Promise<CrmPage<CustomerSummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.customers.listCustomers(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      groupId: optionalId(query.groupId, 'nhóm khách hàng') ?? undefined,
      kind: optionalEnum(query.kind, CUSTOMER_KINDS, 'phân loại'),
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<CustomerDetail> {
    const scope = await this.scopes.resolve(actor);
    return this.require(actor.tenantId, scope, id);
  }

  /** Khách khác đang dùng MST này, để giao diện cảnh báo ngay khi nhập. */
  async taxCodeMatches(actor: CrmActor, taxCode: unknown, excludeId?: unknown): Promise<TaxCodeMatch[]> {
    const normalized = normalizeTaxCode(taxCode);
    if (!normalized) return [];
    return this.customers.findByTaxCode(actor.tenantId, normalized, isUuid(excludeId) ? excludeId : undefined);
  }

  async create(actor: CrmActor, request: CreateCustomerRequest): Promise<CustomerDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const code = normalizeCustomerCode(request.code);
    const record = this.record(request, actor.userId);
    assertOwnerInScope(scope, record.ownerUserId);
    await this.assertTaxCodeConfirmed(actor.tenantId, record.taxCode, request.confirmDuplicateTaxCode);
    const id = await this.customers.createCustomer(actor.tenantId, code, record, actor.userId);
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async update(actor: CrmActor, id: string, request: UpdateCustomerRequest): Promise<CustomerDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    const code = normalizeCustomerCode(request.code) ?? current.code;
    // Trường không gửi (undefined) giữ giá trị cũ; gửi `null` là xoá.
    const record = this.record(withDefaults(request, current), current.ownerUserId);
    if (record.ownerUserId !== current.ownerUserId) assertOwnerInScope(scope, record.ownerUserId);
    if (record.taxCode !== current.taxCode) {
      await this.assertTaxCodeConfirmed(actor.tenantId, record.taxCode, request.confirmDuplicateTaxCode, id);
    }
    await this.customers.updateCustomer(
      actor.tenantId,
      id,
      code,
      record,
      requiredVersion(request.version),
      actor.userId,
    );
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async addContact(actor: CrmActor, customerId: string, request: SaveContactRequest): Promise<CustomerDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    await this.require(actor.tenantId, scope, customerId);
    await this.customers.addContact(actor.tenantId, customerId, contactRecord(request), actor.userId);
    return this.require(actor.tenantId, scope, customerId);
  }

  async updateContact(
    actor: CrmActor,
    customerId: string,
    contactId: string,
    request: SaveContactRequest,
  ): Promise<CustomerDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    await this.require(actor.tenantId, scope, customerId);
    const updated = await this.customers.updateContact(
      actor.tenantId,
      customerId,
      contactId,
      contactRecord(request),
      actor.userId,
    );
    if (!updated) throw new CrmNotFoundError('Không tìm thấy người liên hệ.');
    return this.require(actor.tenantId, scope, customerId);
  }

  /** Đặt người liên hệ chính; người chính cũ mất cờ trong cùng transaction. */
  async setPrimaryContact(actor: CrmActor, customerId: string, contactId: string): Promise<CustomerDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const customer = await this.require(actor.tenantId, scope, customerId);
    const contact = customer.contacts.find((item) => item.id === contactId);
    if (!contact) throw new CrmNotFoundError('Không tìm thấy người liên hệ.');
    await this.customers.updateContact(
      actor.tenantId,
      customerId,
      contactId,
      { ...contact, isPrimary: true },
      actor.userId,
    );
    return this.require(actor.tenantId, scope, customerId);
  }

  async deleteContact(actor: CrmActor, customerId: string, contactId: string): Promise<CustomerDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    await this.require(actor.tenantId, scope, customerId);
    const deleted = await this.customers.deleteContact(actor.tenantId, customerId, contactId);
    if (!deleted) throw new CrmNotFoundError('Không tìm thấy người liên hệ.');
    return this.require(actor.tenantId, scope, customerId);
  }

  private async require(tenantId: string, scope: CrmDataScope, id: string): Promise<CustomerDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(CUSTOMER_NOT_FOUND);
    const customer = await this.customers.getCustomer(tenantId, scope, id);
    if (!customer) throw new CrmNotFoundError(CUSTOMER_NOT_FOUND);
    return customer;
  }

  private async assertTaxCodeConfirmed(
    tenantId: string,
    taxCode: string | null,
    confirmed: boolean | undefined,
    excludeId?: string,
  ): Promise<void> {
    if (!taxCode || confirmed === true) return;
    const matches = await this.customers.findByTaxCode(tenantId, taxCode, excludeId);
    if (!matches.length) return;
    const first = matches[0];
    throw new CrmConflictError(
      CRM_DUPLICATE_TAX_CODE,
      `Mã số thuế ${taxCode} đã có ở khách hàng ${first.code} - ${first.name}. Xác nhận nếu vẫn muốn lưu.`,
      { matches },
    );
  }

  private record(request: CreateCustomerRequest | UpdateCustomerRequest, defaultOwner: string): CustomerRecord {
    return {
      name: requiredText(request.name, 300, 'tên khách hàng'),
      taxCode: normalizeTaxCode(request.taxCode),
      address: optionalText(request.address, 500, 'địa chỉ'),
      province: optionalText(request.province, 100, 'tỉnh/thành'),
      region: optionalText(request.region, 100, 'khu vực'),
      industry: optionalText(request.industry, 100, 'ngành'),
      phone: optionalText(request.phone, 50, 'số điện thoại'),
      email: optionalEmail(request.email),
      groupId: optionalId(request.groupId, 'nhóm khách hàng'),
      kind: optionalEnum(request.kind, CUSTOMER_KINDS, 'phân loại') ?? 'LEAD_CUSTOMER',
      creditLimit: optionalMoney(request.creditLimit, 'hạn mức tín dụng'),
      paymentTermDays: optionalInteger(request.paymentTermDays, 0, 365, 'thời hạn thanh toán'),
      note: optionalText(request.note, 2000, 'ghi chú'),
      ownerUserId: optionalId(request.ownerUserId, 'người phụ trách') ?? defaultOwner,
    };
  }
}

function withDefaults(request: UpdateCustomerRequest, current: CustomerDetail): UpdateCustomerRequest {
  const base: UpdateCustomerRequest = {
    code: current.code,
    version: request.version,
    name: current.name,
    taxCode: current.taxCode,
    address: current.address,
    province: current.province,
    region: current.region,
    industry: current.industry,
    phone: current.phone,
    email: current.email,
    groupId: current.groupId,
    kind: current.kind,
    creditLimit: current.creditLimit,
    paymentTermDays: current.paymentTermDays,
    note: current.note,
    ownerUserId: current.ownerUserId,
  };
  const provided = Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined));
  return { ...base, ...provided } as UpdateCustomerRequest;
}

export function contactRecord(request: SaveContactRequest): ContactRecord {
  return {
    fullName: requiredText(request.fullName, 200, 'họ tên người liên hệ'),
    title: optionalText(request.title, 200, 'chức vụ'),
    phone: optionalText(request.phone, 50, 'số điện thoại'),
    email: optionalEmail(request.email),
    note: optionalText(request.note, 1000, 'ghi chú'),
    isPrimary: request.isPrimary === true,
  };
}
