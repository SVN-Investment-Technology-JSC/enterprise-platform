import {
  LEAD_STATUSES,
  type ConvertLeadRequest,
  type ConvertLeadResult,
  type CreateLeadRequest,
  type CrmPage,
  type Lead,
  type LeadListQuery,
  type LeadStatus,
  type UpdateLeadRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import {
  isUuid,
  normalizeSearch,
  optionalEmail,
  optionalEnum,
  optionalId,
  optionalText,
  requiredText,
  requiredVersion,
} from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { normalizeTaxCode } from '../domain/tax-code.js';
import { assertOwnerInScope, requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import { opportunityRecord } from './opportunity.service.js';
import type { LeadRecord, LeadStore } from './sales-store.port.js';

const LEAD_NOT_FOUND = 'Không tìm thấy lead.';
const EDITABLE_STATUSES = ['NEW', 'WORKING', 'DISQUALIFIED'] as const;

/**
 * Lead và thao tác "Chuyển thành khách hàng và cơ hội".
 *
 * Chuyển đổi kiểm mọi dữ liệu trước (MST sai định dạng trả 400, không ghi gì),
 * rồi để store làm cả chuỗi trong một transaction: khớp MST với khách có sẵn
 * thì gắn cơ hội vào khách đó, không tạo khách mới.
 */
export class LeadService {
  constructor(
    private readonly leads: LeadStore,
    private readonly scopes: CrmDataScopeService,
  ) {}

  async list(actor: CrmActor, query: LeadListQuery): Promise<CrmPage<Lead>> {
    const scope = await this.scopes.resolve(actor);
    return this.leads.listLeads(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      status: optionalEnum(query.status, LEAD_STATUSES, 'trạng thái'),
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<Lead> {
    const scope = await this.scopes.resolve(actor);
    return this.require(actor.tenantId, scope, id);
  }

  async create(actor: CrmActor, request: CreateLeadRequest): Promise<Lead> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const record = leadRecord(request, actor.userId);
    assertOwnerInScope(scope, record.ownerUserId);
    const id = await this.leads.createLead(actor.tenantId, record, actor.userId);
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async update(actor: CrmActor, id: string, request: UpdateLeadRequest): Promise<Lead> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    if (current.status === 'CONVERTED') {
      throw new CrmConflictError('LEAD_CONVERTED', 'Lead đã chuyển đổi, không sửa được.');
    }
    const merged = { ...current, ...definedOnly(request) };
    const record = leadRecord(merged, current.ownerUserId);
    if (record.ownerUserId !== current.ownerUserId) assertOwnerInScope(scope, record.ownerUserId);
    const status: Exclude<LeadStatus, 'CONVERTED'> =
      optionalEnum(request.status, EDITABLE_STATUSES, 'trạng thái') ?? (current.status as Exclude<LeadStatus, 'CONVERTED'>);
    await this.leads.updateLead(actor.tenantId, id, record, status, requiredVersion(request.version), actor.userId);
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async convert(actor: CrmActor, id: string, request: ConvertLeadRequest): Promise<ConvertLeadResult> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const lead = await this.require(actor.tenantId, scope, id);
    if (lead.status === 'CONVERTED') {
      throw new CrmConflictError('LEAD_CONVERTED', 'Lead đã được chuyển thành khách hàng và cơ hội.');
    }
    if (lead.status === 'DISQUALIFIED') {
      throw new CrmConflictError(
        'LEAD_DISQUALIFIED',
        'Lead đã đánh dấu không tiềm năng. Đổi trạng thái trước khi chuyển đổi.',
      );
    }
    // Lead nhập từ nguồn ngoài có thể mang MST sai: chặn trước khi ghi bất cứ gì.
    const taxCode = normalizeTaxCode(lead.taxCode);
    const opportunity = opportunityRecord(
      {
        name: request.opportunityName?.trim() || lead.name,
        probability: 0,
        expectedValue: request.expectedValue,
        expectedCloseDate: request.expectedCloseDate,
        need: lead.need,
        budget: null,
        ownerUserId: lead.ownerUserId,
      },
      lead.ownerUserId,
    );
    const outcome = await this.leads.convertLead(
      actor.tenantId,
      {
        leadId: lead.id,
        expectedVersion: lead.version,
        customer: {
          name: lead.name,
          taxCode,
          address: null,
          province: null,
          region: null,
          industry: null,
          phone: lead.phone,
          email: lead.email,
          groupId: null,
          kind: 'LEAD_CUSTOMER',
          creditLimit: null,
          paymentTermDays: null,
          note: lead.note,
          ownerUserId: lead.ownerUserId,
        },
        contact: lead.contactName
          ? {
              fullName: lead.contactName,
              title: null,
              phone: lead.phone,
              email: lead.email,
              note: null,
              isPrimary: true,
            }
          : null,
        opportunity,
      },
      actor.userId,
    );
    return { leadId: lead.id, ...outcome };
  }

  private async require(tenantId: string, scope: CrmDataScope, id: string): Promise<Lead> {
    if (!isUuid(id)) throw new CrmNotFoundError(LEAD_NOT_FOUND);
    const lead = await this.leads.getLead(tenantId, scope, id);
    if (!lead) throw new CrmNotFoundError(LEAD_NOT_FOUND);
    return lead;
  }
}

export function leadRecord(
  request: {
    name?: unknown;
    contactName?: unknown;
    taxCode?: unknown;
    phone?: unknown;
    email?: unknown;
    source?: unknown;
    need?: unknown;
    note?: unknown;
    ownerUserId?: unknown;
  },
  defaultOwner: string,
): LeadRecord {
  return {
    name: requiredText(request.name, 300, 'tên lead'),
    contactName: optionalText(request.contactName, 200, 'người liên hệ'),
    taxCode: normalizeTaxCode(request.taxCode),
    phone: optionalText(request.phone, 50, 'số điện thoại'),
    email: optionalEmail(request.email),
    source: optionalText(request.source, 100, 'nguồn'),
    need: optionalText(request.need, 4000, 'nhu cầu'),
    note: optionalText(request.note, 2000, 'ghi chú'),
    ownerUserId: optionalId(request.ownerUserId, 'người phụ trách') ?? defaultOwner,
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
