import {
  QUOTE_PREVIEW_LINES_MAX,
  type PricingResult,
  type PricingSettings,
  type QuotePreviewLine,
  type QuotePreviewRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalDate, optionalId, requiredText } from '../domain/fields.js';
import { priceQuote, type PricingLineInput } from '../domain/pricing-engine.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CustomerService } from './customer.service.js';
import { boundedNumber } from './price-list.service.js';
import type { CatalogReader, PricingStore } from './pricing-store.port.js';

const QUANTITY_MAX = 999_999_999;
const AMOUNT_MAX = 1e13;

/** Ngày hôm nay theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function vietnamToday(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Cấu hình trần chiết khấu và "Thử tính giá": chạy engine giá với bảng giá,
 * chính sách trong DB. Báo giá (T3-08) và đơn bán (T4-08) dùng cùng đường này.
 *
 * Ai có `crm.read` thử được; chọn khách thì khách phải nằm trong phạm vi dữ
 * liệu (đọc qua `CustomerService`, ngoài phạm vi trả 404).
 */
export class PricingService {
  constructor(
    private readonly store: PricingStore,
    private readonly customers: Pick<CustomerService, 'get'>,
    private readonly catalog: CatalogReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async settings(actor: CrmActor): Promise<PricingSettings> {
    return { discountCapPercent: await this.store.discountCapPercent(actor.tenantId) };
  }

  async saveSettings(actor: CrmActor, request: Partial<PricingSettings>): Promise<PricingSettings> {
    requireSalesManager(actor);
    const percent = boundedNumber(request?.discountCapPercent, 0, 100, 'trần chiết khấu', 4);
    await this.store.saveDiscountCapPercent(actor.tenantId, percent, actor.userId);
    return this.settings(actor);
  }

  async preview(actor: CrmActor, request: QuotePreviewRequest): Promise<PricingResult> {
    const date = optionalDate(request?.date, 'ngày tính giá') ?? vietnamToday(this.now());
    const customerId = optionalId(request?.customerId, 'khách hàng');
    let customerGroupId = optionalId(request?.customerGroupId, 'nhóm khách hàng');
    if (customerId) {
      const customer = await this.customers.get(actor, customerId);
      customerGroupId = customer.groupId;
    }
    const rawLines: unknown = request?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      throw new CrmValidationError('REQUIRED', 'Vui lòng nhập ít nhất một dòng hàng.');
    }
    if (rawLines.length > QUOTE_PREVIEW_LINES_MAX) {
      throw new CrmValidationError('TOO_MANY_LINES', `Mỗi lần tính tối đa ${QUOTE_PREVIEW_LINES_MAX} dòng.`);
    }
    const lines = rawLines.map((line: QuotePreviewLine, index: number) => lineInput(line ?? ({} as never), index));
    const materialIds = [...new Set(lines.map((line) => line.materialId))];

    const [priceLists, policies, cap, known, contractPrices] = await Promise.all([
      this.store.priceListsForPricing(actor.tenantId, date, customerGroupId, materialIds),
      this.store.policiesForPricing(actor.tenantId, date),
      this.store.discountCapPercent(actor.tenantId),
      this.catalog.materials(actor.tenantId, materialIds),
      // Giá khung của hợp đồng khung, nguyên tắc đang hiệu lực của khách (T4-02).
      this.store.contractPricesForPricing(actor.tenantId, date, customerId, materialIds),
    ]);
    const enriched = lines.map((line) => {
      const material = known.get(line.materialId);
      return material
        ? { ...line, materialCode: material.code, materialName: material.name, category: material.category ?? line.category }
        : line;
    });
    const shipping = request?.shipping
      ? {
          amount: boundedNumber(request.shipping.amount, 0, AMOUNT_MAX, 'phí vận chuyển', 2),
          vatRate:
            request.shipping.vatRate === undefined || request.shipping.vatRate === null
              ? null
              : boundedNumber(request.shipping.vatRate, 0, 100, 'thuế suất phí vận chuyển', 2),
        }
      : null;

    return priceQuote({
      date,
      customerId,
      customerGroupId,
      lines: enriched,
      priceLists,
      policies,
      contractPrices,
      discountCapPercent: cap,
      shipping,
    });
  }
}

function lineInput(line: QuotePreviewLine, index: number): PricingLineInput {
  const fail = (message: string) => new CrmValidationError('INVALID_LINE', `Dòng ${index + 1}: ${message}`, { line: index + 1 });
  if (!isUuid(line.materialId)) throw fail('vui lòng chọn mặt hàng.');
  const quantity = Number(line.quantity);
  if (line.quantity === null || line.quantity === undefined || !Number.isFinite(quantity) || quantity <= 0) {
    throw new CrmValidationError('INVALID_QUANTITY', 'Số lượng phải lớn hơn 0.', { line: index + 1 });
  }
  try {
    const optionalNumber = (value: unknown, max: number, label: string, decimals: number) =>
      value === undefined || value === null || value === '' ? null : boundedNumber(value, 0, max, label, decimals);
    return {
      materialId: line.materialId.toLowerCase(),
      materialCode: typeof line.materialCode === 'string' ? line.materialCode.trim().slice(0, 100) : null,
      materialName: typeof line.materialName === 'string' ? line.materialName.trim().slice(0, 300) : null,
      category: typeof line.category === 'string' ? line.category.trim().slice(0, 300) || null : null,
      quantity: boundedNumber(quantity, 0, QUANTITY_MAX, 'số lượng', 3),
      unit: requiredText(line.unit, 50, 'đơn vị tính'),
      override: {
        unitPrice: optionalNumber(line.overrideUnitPrice, AMOUNT_MAX, 'đơn giá ghi đè', 2),
        discountPercent: optionalNumber(line.overrideDiscountPercent, 100, 'chiết khấu ghi đè', 4),
      },
    };
  } catch (error) {
    if (error instanceof CrmValidationError) throw fail(error.message);
    throw error;
  }
}
