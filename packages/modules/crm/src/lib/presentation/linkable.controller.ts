import { CRM_DUPLICATE_TAX_CODE, CRM_PAGE_LIMIT_MAX } from '@enterprise-platform/contracts-crm';
import {
  LINKABLE_CONFIRM_REQUIRED,
  clampLinkableLimit,
  parseLinkableCreateRequest,
  parseLinkableIds,
  type LinkableCandidateList,
  type LinkableCreateForm,
  type LinkableCreatePreview,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import { Body, Controller, Get, HttpCode, HttpException, Inject, Post, Query, Req } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { ContractService, requireContractWriter } from '../application/contract.service.js';
import { requireSalesWriter } from '../application/crm-access.js';
import { CrmPeopleService, CustomerGroupService } from '../application/customer-group.service.js';
import { CustomerKindService } from '../application/customer-kind.service.js';
import { CustomerService } from '../application/customer.service.js';
import { LeadService } from '../application/lead.service.js';
import { OpportunityService } from '../application/opportunity.service.js';
import { QuoteService } from '../application/quote.service.js';
import { ReceivableService } from '../application/receivable.service.js';
import { SalesOrderService } from '../application/sales-order.service.js';
import { WarrantyService } from '../application/warranty.service.js';
import { CrmConflictError, CrmError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';
import {
  CONTRACT_QUOTE_FIELD,
  contractCreateForm,
  contractQuotePreview,
  contractRequest,
  customerCreateForm,
  customerRequest,
  duplicateTaxCodeWarnings,
  isCrmCreatableKind,
  opportunityCreateForm,
  opportunityRequest,
  withCreateFlags,
  type CrmCreatableKind,
} from './linkable-create.js';
import {
  CRM_LINKABLE_KINDS,
  CRM_LINKABLE_KIND_LIST,
  contractCandidate,
  contractObject,
  customerCandidate,
  customerObject,
  isCrmLinkableKind,
  leadCandidate,
  leadObject,
  opportunityCandidate,
  opportunityObject,
  orderCandidate,
  orderObject,
  quoteCandidate,
  quoteObject,
  receiptCandidate,
  receiptMatches,
  receiptObject,
  warrantyCandidate,
  warrantyObject,
  type CrmLinkableKind,
} from './linkable.mapper.js';

/**
 * Bán hàng công bố hồ sơ để module khác (Workspace) gắn làm "đối tượng liên quan". Đọc, cộng tạo nhanh khách hàng, hợp
 * đồng (có thể gắn báo giá, xem trước dòng hàng), cơ hội.
 *
 * Gọi lại đúng các service sẵn có (cùng `list`, `get`, `create` mà màn Bán hàng dùng), nên quyền và phạm vi dữ liệu y hệt
 * màn hình Bán hàng: người không xem được hồ sơ ở đây thì cũng không tìm, không gắn được; người không được tạo ở đây thì
 * cũng không tạo nhanh được. Không thêm truy vấn hay bảng nào.
 * Hợp đồng route: `contracts-integration` (`linkable-objects.ts`).
 */
@Controller('v1/linkable')
export class LinkableController {
  constructor(
    @Inject(CustomerService) private readonly customers: CustomerService,
    @Inject(OpportunityService) private readonly opportunities: OpportunityService,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(SalesOrderService) private readonly orders: SalesOrderService,
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(WarrantyService) private readonly warranty: WarrantyService,
    @Inject(ReceivableService) private readonly receivables: ReceivableService,
    @Inject(CrmPeopleService) private readonly people: CrmPeopleService,
    @Inject(CustomerGroupService) private readonly groups: CustomerGroupService,
    @Inject(CustomerKindService) private readonly customerKinds: CustomerKindService,
  ) {}

  /** Loại tạo nhanh được mang cờ `create` theo quyền ghi của người hỏi (chỉ để ẩn hiện nút; tạo vẫn kiểm lại). */
  @Get('kinds')
  kinds(@Req() request?: CrmRequest): LinkableKindList {
    return { kinds: withCreateFlags(CRM_LINKABLE_KIND_LIST, request?.crmActor) };
  }

  /** Form tạo nhanh; người không có quyền tạo loại này nhận 403 ngay, trước khi nhập. */
  @Get('create-form')
  createForm(@Req() request: CrmRequest, @Query('kind') kind?: string): Promise<LinkableCreateForm> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const type = requireCreatableKind(kind);
      requireCreator(actor, type);
      // Danh bạ đọc từ sơ đồ tổ chức; không đọc được thì ô người phụ trách không có lựa chọn (mặc định là người tạo).
      const people = await this.people.list(actor).catch(() => []);
      switch (type) {
        case CRM_LINKABLE_KINDS.customer: {
          const [groups, kinds] = await Promise.all([this.groups.list(actor), this.customerKinds.list(actor)]);
          return customerCreateForm({ people, groups, kinds });
        }
        case CRM_LINKABLE_KINDS.contract:
          return contractCreateForm({ people });
        case CRM_LINKABLE_KINDS.opportunity:
          return opportunityCreateForm({ people, pipelines: await this.opportunities.listPipelines(actor) });
      }
    });
  }

  /**
   * Tạo hồ sơ qua đúng `create` của service (cùng kiểm tra như màn Bán hàng) rồi trả hồ sơ đầy đủ để bên gọi gắn ngay.
   * Trùng mã số thuế chưa xác nhận: 409 `LINKABLE_CONFIRM_REQUIRED` kèm danh sách khách đã có; gửi lại `confirm: true`.
   */
  @Post('create')
  @HttpCode(201)
  create(@Req() request: CrmRequest, @Query('kind') kind?: string, @Body() body?: unknown): Promise<LinkableObject> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const type = requireCreatableKind(kind);
      const { values, confirm } = parseLinkableCreateRequest(body);
      switch (type) {
        case CRM_LINKABLE_KINDS.customer:
          try {
            return customerObject(await this.customers.create(actor, customerRequest(values, confirm === true)));
          } catch (error) {
            throw confirmRequired(error);
          }
        case CRM_LINKABLE_KINDS.contract: {
          // Gắn báo giá thì service lấy dòng từ báo giá; chuỗi phía trước (báo giá, cơ hội) như khi đọc hợp đồng.
          const contract = await this.contracts.create(actor, contractRequest(values));
          return contractObject(contract, contract.quoteId ? await this.opportunityOfQuote(actor, contract.quoteId) : null);
        }
        case CRM_LINKABLE_KINDS.opportunity:
          return opportunityObject(await this.opportunities.create(actor, opportunityRequest(values)));
      }
    });
  }

  /**
   * Xem trước theo giá trị một ô của form tạo nhanh. Chỉ ô "Báo giá" của form lập hợp đồng: dòng, tổng hợp đồng sẽ
   * nhận (cùng quyền và bộ dựng với `GET /v1/contracts/quote-preview/:quoteId`); báo giá không gắn được thì 409 kèm
   * lý do (`QUOTE_NOT_ACCEPTED`, `QUOTE_CONVERTED`...).
   */
  @Get('create-preview')
  createPreview(
    @Req() request: CrmRequest,
    @Query('kind') kind?: string,
    @Query('field') field?: string,
    @Query('value') value?: string,
  ): Promise<LinkableCreatePreview> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const type = requireCreatableKind(kind);
      if (type !== CRM_LINKABLE_KINDS.contract || field !== CONTRACT_QUOTE_FIELD || !value?.trim()) {
        throw new HttpException(
          { statusCode: 400, code: 'VALIDATION', message: 'Ô này không có xem trước.' },
          400,
        );
      }
      return contractQuotePreview(await this.contracts.quotePreview(actor, value.trim()));
    });
  }

  /**
   * Tìm theo chữ. Tham số lọc thêm chỉ đọc khi biết (ô "Báo giá" của form lập hợp đồng gửi `contractLinkable=true`,
   * `customerId`); tham số lạ bị bỏ qua, không có thì tìm như cũ.
   */
  @Get('search')
  search(
    @Req() request: CrmRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('contractLinkable') contractLinkable?: string,
    @Query('customerId') customerId?: string,
  ): Promise<LinkableCandidateList> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const query = { q: (q ?? '').trim().slice(0, 100) || undefined, limit: clampLinkableLimit(limit) };
      switch (requireKind(kind)) {
        case CRM_LINKABLE_KINDS.customer:
          return { items: (await this.customers.list(actor, query)).items.map(customerCandidate) };
        case CRM_LINKABLE_KINDS.opportunity:
          return { items: (await this.opportunities.list(actor, query)).items.map(opportunityCandidate) };
        case CRM_LINKABLE_KINDS.quote: {
          // Id khách sai định dạng thì bỏ lọc khách (không báo lỗi cho cả ô tìm).
          const filtered = {
            ...query,
            ...(contractLinkable === 'true' ? { contractLinkable: true } : {}),
            ...(isUuid(customerId) ? { customerId } : {}),
          };
          return { items: (await this.quotes.list(actor, filtered)).items.map(quoteCandidate) };
        }
        case CRM_LINKABLE_KINDS.contract:
          return { items: (await this.contracts.list(actor, query)).items.map(contractCandidate) };
        case CRM_LINKABLE_KINDS.order:
          return { items: (await this.orders.list(actor, query)).items.map(orderCandidate) };
        case CRM_LINKABLE_KINDS.lead:
          return { items: (await this.leads.list(actor, query)).items.map(leadCandidate) };
        case CRM_LINKABLE_KINDS.warranty:
          return { items: (await this.warranty.list(actor, query)).items.map(warrantyCandidate) };
        case CRM_LINKABLE_KINDS.receipt: {
          // Danh sách phiếu thu không tìm theo chữ: có chữ thì lấy một trang lớn mới nhất rồi lọc, không thì đúng `limit`.
          const page = await this.receivables.listReceipts(actor, {
            limit: query.q ? CRM_PAGE_LIMIT_MAX : query.limit,
          });
          const rows = page.items.filter((row) => receiptMatches(row, query.q)).slice(0, query.limit);
          return { items: rows.map(receiptCandidate) };
        }
      }
    });
  }

  /** Hồ sơ đầy đủ theo lô; id không thấy hoặc không có quyền thì bỏ qua, không làm hỏng cả lô. */
  @Get('resolve')
  resolve(
    @Req() request: CrmRequest,
    @Query('kind') kind?: string,
    @Query('ids') ids?: string,
  ): Promise<LinkableObjectList> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const type = requireKind(kind);
      const settled = await Promise.all(parseLinkableIds(ids).map((id) => this.readOne(actor, type, id)));
      return { items: settled.filter((item): item is LinkableObject => item !== undefined) };
    });
  }

  private async readOne(actor: CrmActor, kind: CrmLinkableKind, id: string): Promise<LinkableObject | undefined> {
    try {
      switch (kind) {
        case CRM_LINKABLE_KINDS.customer:
          return customerObject(await this.customers.get(actor, id));
        case CRM_LINKABLE_KINDS.opportunity:
          return opportunityObject(await this.opportunities.get(actor, id));
        case CRM_LINKABLE_KINDS.quote:
          return quoteObject(await this.quotes.get(actor, id));
        case CRM_LINKABLE_KINDS.contract: {
          const contract = await this.contracts.get(actor, id);
          return contractObject(contract, contract.quoteId ? await this.opportunityOfQuote(actor, contract.quoteId) : null);
        }
        case CRM_LINKABLE_KINDS.order:
          return orderObject(await this.orders.get(actor, id));
        case CRM_LINKABLE_KINDS.lead:
          return leadObject(await this.leads.get(actor, id));
        case CRM_LINKABLE_KINDS.warranty:
          return warrantyObject(await this.warranty.get(actor, id));
        case CRM_LINKABLE_KINDS.receipt:
          return receiptObject(await this.receivables.getReceipt(actor, id));
      }
    } catch (error) {
      // Không tìm thấy, không trong phạm vi, id sai định dạng: bỏ qua dòng này. Lỗi khác là bug, ném tiếp.
      if (error instanceof CrmError || (error as { code?: string } | null)?.code === '22P02') return undefined;
      throw error;
    }
  }

  /** Cơ hội của báo giá gốc, để gợi ý gắn cả chuỗi; không đọc được thì thôi. */
  private async opportunityOfQuote(actor: CrmActor, quoteId: string) {
    try {
      const quote = await this.quotes.get(actor, quoteId);
      return quote.opportunityId ? { id: quote.opportunityId, name: quote.opportunityName } : null;
    } catch {
      return null;
    }
  }
}

function requireCreatableKind(kind: unknown): CrmCreatableKind {
  if (!isCrmCreatableKind(kind)) {
    throw new HttpException(
      { statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng này không tạo nhanh được.' },
      400,
    );
  }
  return kind;
}

/** Cùng kiểm tra quyền mà `create` của service sẽ làm, chạy sớm để form không mở cho người không tạo được. */
function requireCreator(actor: CrmActor, kind: CrmCreatableKind): void {
  if (kind === CRM_LINKABLE_KINDS.contract) requireContractWriter(actor);
  else requireSalesWriter(actor);
}

/** Cảnh báo trùng mã số thuế của Bán hàng thành lỗi "cần xác nhận" chung của hợp đồng tạo nhanh. */
function confirmRequired(error: unknown): unknown {
  if (!(error instanceof CrmError) || error.code !== CRM_DUPLICATE_TAX_CODE) return error;
  return new CrmConflictError(LINKABLE_CONFIRM_REQUIRED, error.message, {
    field: 'taxCode',
    warnings: duplicateTaxCodeWarnings(error.details?.['matches']),
  });
}

function requireKind(kind: unknown): CrmLinkableKind {
  if (!isCrmLinkableKind(kind)) {
    throw new HttpException(
      { statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Bán hàng.' },
      400,
    );
  }
  return kind;
}
