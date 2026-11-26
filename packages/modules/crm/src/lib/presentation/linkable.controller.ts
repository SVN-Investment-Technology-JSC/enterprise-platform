import { CRM_PAGE_LIMIT_MAX } from '@enterprise-platform/contracts-crm';
import {
  clampLinkableLimit,
  parseLinkableIds,
  type LinkableCandidateList,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import { Controller, Get, HttpException, Inject, Query, Req } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { ContractService } from '../application/contract.service.js';
import { CustomerService } from '../application/customer.service.js';
import { LeadService } from '../application/lead.service.js';
import { OpportunityService } from '../application/opportunity.service.js';
import { QuoteService } from '../application/quote.service.js';
import { ReceivableService } from '../application/receivable.service.js';
import { SalesOrderService } from '../application/sales-order.service.js';
import { WarrantyService } from '../application/warranty.service.js';
import { CrmError } from '../domain/crm.error.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';
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
 * Bán hàng công bố hồ sơ để module khác (Workspace) gắn làm "đối tượng liên quan". Chỉ đọc.
 *
 * Gọi lại đúng các service sẵn có (cùng `list`, `get` mà màn Bán hàng dùng), nên quyền và phạm vi dữ liệu y hệt màn hình
 * Bán hàng: người không xem được hồ sơ ở đây thì cũng không tìm, không gắn được. Không thêm truy vấn hay bảng nào.
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
  ) {}

  @Get('kinds')
  kinds(): LinkableKindList {
    return { kinds: CRM_LINKABLE_KIND_LIST };
  }

  @Get('search')
  search(
    @Req() request: CrmRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<LinkableCandidateList> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const query = { q: (q ?? '').trim().slice(0, 100) || undefined, limit: clampLinkableLimit(limit) };
      switch (requireKind(kind)) {
        case CRM_LINKABLE_KINDS.customer:
          return { items: (await this.customers.list(actor, query)).items.map(customerCandidate) };
        case CRM_LINKABLE_KINDS.opportunity:
          return { items: (await this.opportunities.list(actor, query)).items.map(opportunityCandidate) };
        case CRM_LINKABLE_KINDS.quote:
          return { items: (await this.quotes.list(actor, query)).items.map(quoteCandidate) };
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

function requireKind(kind: unknown): CrmLinkableKind {
  if (!isCrmLinkableKind(kind)) {
    throw new HttpException(
      { statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Bán hàng.' },
      400,
    );
  }
  return kind;
}
