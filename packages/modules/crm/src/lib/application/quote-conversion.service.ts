import { DEFAULT_DELIVERY_LEAD_DAYS, type ConvertQuoteResult } from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import type { QuoteStore } from './quote-store.port.js';
import type { QuoteConversionStore } from './sales-order-store.port.js';
import { defaultPlannedDate, requireOrderWriter } from './sales-order.service.js';

/**
 * Chuyển báo giá Khách chấp nhận thành hợp đồng, đơn và kế hoạch giao mặc định
 * (QUO-07, T4-06). Cần `crm.order.write` và báo giá trong phạm vi dữ liệu. Báo
 * giá chưa được khách chấp nhận (kể cả đang Chờ duyệt) trả 409 (TC-QUO-12);
 * gọi lại trả đúng kết quả lần đầu (TC-QUO-13).
 */
export class QuoteConversionService {
  constructor(
    private readonly conversion: QuoteConversionStore,
    private readonly quotes: Pick<QuoteStore, 'getQuote'>,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async convert(actor: CrmActor, quoteId: string): Promise<ConvertQuoteResult> {
    requireOrderWriter(actor);
    if (!isUuid(quoteId)) throw new CrmNotFoundError('Không tìm thấy báo giá.');
    const scope = await this.scopes.resolve(actor);
    const quote = await this.quotes.getQuote(actor.tenantId, scope, quoteId);
    if (!quote) throw new CrmNotFoundError('Không tìm thấy báo giá.');
    if (quote.status !== 'ACCEPTED' && !quote.convertedAt) {
      throw new CrmConflictError('QUOTE_NOT_ACCEPTED', 'Chỉ chuyển được báo giá khách đã chấp nhận.');
    }
    const today = vietnamToday(this.now());
    return this.conversion.convert(
      actor.tenantId,
      quoteId,
      { today, plannedDate: defaultPlannedDate(today, DEFAULT_DELIVERY_LEAD_DAYS) },
      actor.userId,
    );
  }
}
