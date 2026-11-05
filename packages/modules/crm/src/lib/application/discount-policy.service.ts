import {
  DISCOUNT_CRITERIA,
  DISCOUNT_CRITERION_LABELS,
  DISCOUNT_POLICY_RULES_MAX,
  DISCOUNT_STACKING,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type SaveDiscountPolicyRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalDate, optionalEnum, optionalText, requiredText } from '../domain/fields.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import { boundedNumber, pricingCode, pricingStatus, validityRange } from './price-list.service.js';
import type { DiscountPolicyRecord, DiscountPolicyStore } from './pricing-store.port.js';

const QUANTITY_MAX = 999_999_999;

/**
 * Chính sách chiết khấu với tiêu chí P1 (PRC-02): bậc số lượng, thời gian,
 * khách hàng hoặc nhóm, mặt hàng hoặc nhóm hàng. Ai có `crm.read` đọc được;
 * ghi cần `crm.manage`.
 *
 * Cách biểu diễn bậc: một chính sách "bậc số lượng" có nhiều dòng QUANTITY, mỗi
 * dòng một khoảng [từ, đến] và phần trăm riêng; các khoảng không được chồng
 * nhau. Chính sách không có bậc dùng phần trăm của chính sách.
 */
export class DiscountPolicyService {
  constructor(private readonly policies: DiscountPolicyStore) {}

  list(actor: CrmActor): Promise<DiscountPolicy[]> {
    return this.policies.listPolicies(actor.tenantId);
  }

  get(actor: CrmActor, id: string): Promise<DiscountPolicy> {
    return this.require(actor.tenantId, id);
  }

  async create(actor: CrmActor, request: SaveDiscountPolicyRequest): Promise<DiscountPolicy> {
    requireSalesManager(actor);
    const record = await this.checkedRecord(actor.tenantId, request);
    const id = await this.policies.createPolicy(actor.tenantId, record, actor.userId);
    return this.require(actor.tenantId, id);
  }

  async update(actor: CrmActor, id: string, request: SaveDiscountPolicyRequest): Promise<DiscountPolicy> {
    requireSalesManager(actor);
    const record = await this.checkedRecord(actor.tenantId, request);
    const updated = isUuid(id) && (await this.policies.updatePolicy(actor.tenantId, id, record, actor.userId));
    if (!updated) throw notFound();
    return this.require(actor.tenantId, id);
  }

  async remove(actor: CrmActor, id: string): Promise<void> {
    requireSalesManager(actor);
    const deleted = isUuid(id) && (await this.policies.deletePolicy(actor.tenantId, id));
    if (!deleted) throw notFound();
  }

  /** Kiểm hình dạng rồi kiểm khách, nhóm khách được nhắc tới có thật. */
  private async checkedRecord(tenantId: string, request: SaveDiscountPolicyRequest): Promise<DiscountPolicyRecord> {
    const record = discountPolicyRecord(request);
    const refs = (criterion: string) =>
      record.rules.filter((rule) => rule.criterion === criterion).map((rule) => rule.refId as string);
    const [missingGroups, missingCustomers] = await Promise.all([
      refs('CUSTOMER_GROUP').length ? this.policies.missingCustomerGroups(tenantId, refs('CUSTOMER_GROUP')) : [],
      refs('CUSTOMER').length ? this.policies.missingCustomers(tenantId, refs('CUSTOMER')) : [],
    ]);
    if (missingGroups.length) {
      throw new CrmValidationError('INVALID_REFERENCE', 'Nhóm khách hàng trong tiêu chí không còn tồn tại.');
    }
    if (missingCustomers.length) {
      throw new CrmValidationError('INVALID_REFERENCE', 'Khách hàng trong tiêu chí không còn tồn tại.');
    }
    return record;
  }

  private async require(tenantId: string, id: string): Promise<DiscountPolicy> {
    const policy = isUuid(id) ? await this.policies.getPolicy(tenantId, id) : undefined;
    if (!policy) throw notFound();
    return policy;
  }
}

function notFound(): CrmNotFoundError {
  return new CrmNotFoundError('Không tìm thấy chính sách chiết khấu.');
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new CrmValidationError('INVALID', `${label} không hợp lệ.`);
  return value;
}

function percentOf(value: unknown, label: string): number {
  const percent = boundedNumber(value, 0, 100, label, 4);
  if (percent <= 0) throw new CrmValidationError('INVALID_NUMBER', `${label.charAt(0).toUpperCase()}${label.slice(1)} phải lớn hơn 0.`);
  return percent;
}

export function discountPolicyRecord(request: SaveDiscountPolicyRequest): DiscountPolicyRecord {
  const rawRules: unknown = request?.rules ?? [];
  if (!Array.isArray(rawRules)) throw new CrmValidationError('INVALID', 'Danh sách tiêu chí không hợp lệ.');
  if (rawRules.length > DISCOUNT_POLICY_RULES_MAX) {
    throw new CrmValidationError('TOO_MANY_RULES', `Mỗi chính sách tối đa ${DISCOUNT_POLICY_RULES_MAX} tiêu chí.`);
  }
  const rules = rawRules.map((rule: DiscountPolicyRule, index: number) => ruleRecord(rule ?? ({} as never), index));
  const tiers = rules.filter((rule) => rule.criterion === 'QUANTITY');
  assertTiersDisjoint(tiers);

  const hasTiers = tiers.length > 0;
  const percent =
    request?.percent === undefined || request?.percent === null || request?.percent === ('' as never)
      ? null
      : percentOf(request.percent, 'phần trăm chiết khấu');
  if (!hasTiers && percent === null) {
    throw new CrmValidationError('PERCENT_REQUIRED', 'Vui lòng nhập phần trăm chiết khấu hoặc thêm bậc số lượng.');
  }
  if (hasTiers && percent !== null) {
    throw new CrmValidationError('PERCENT_WITH_TIERS', 'Chính sách có bậc số lượng thì phần trăm lấy theo từng bậc.');
  }

  const appliesToAllCustomers = optionalBoolean(request?.appliesToAllCustomers, true, 'Phạm vi khách hàng');
  const customerRules = rules.filter((rule) => rule.criterion === 'CUSTOMER' || rule.criterion === 'CUSTOMER_GROUP');
  if (appliesToAllCustomers && customerRules.length) {
    throw new CrmValidationError(
      'CUSTOMER_SCOPE_CONFLICT',
      'Chính sách áp cho mọi khách hàng thì không thêm tiêu chí khách hàng hoặc nhóm khách.',
    );
  }
  if (!appliesToAllCustomers && !customerRules.length) {
    throw new CrmValidationError('CUSTOMER_SCOPE_REQUIRED', 'Vui lòng chọn khách hàng hoặc nhóm khách được áp chính sách.');
  }

  const priority = request?.priority ?? 100;
  if (!Number.isInteger(priority) || priority < 1 || priority > 1000) {
    throw new CrmValidationError('INVALID_NUMBER', 'Độ ưu tiên phải là số nguyên từ 1 đến 1000.');
  }

  return {
    code: pricingCode(request?.code, 'mã chính sách'),
    name: requiredText(request?.name, 200, 'tên chính sách'),
    priority,
    stacking: optionalEnum(request?.stacking, DISCOUNT_STACKING, 'kiểu kết hợp') ?? 'STACK',
    exclusive: optionalBoolean(request?.exclusive, false, 'Cờ độc quyền'),
    percent,
    ...validityRange(request?.validFrom, request?.validTo),
    status: pricingStatus(request?.status),
    appliesToAllCustomers,
    note: optionalText(request?.note, 1000, 'ghi chú'),
    rules,
  };
}

/** Chuẩn hoá một tiêu chí; trường không thuộc loại tiêu chí bị bỏ. */
export function ruleRecord(rule: DiscountPolicyRule, index: number): DiscountPolicyRule {
  const criterion = optionalEnum(rule.criterion, DISCOUNT_CRITERIA, 'loại tiêu chí');
  const fail = (message: string) =>
    new CrmValidationError('INVALID_RULE', `Tiêu chí ${index + 1}: ${message}`, { rule: index + 1 });
  if (!criterion) throw fail('vui lòng chọn loại tiêu chí.');
  const empty = { criterion, minQty: null, maxQty: null, refId: null, refText: null, fromDate: null, toDate: null, percent: null };
  try {
    switch (criterion) {
      case 'QUANTITY': {
        const minQty = boundedNumber(rule.minQty, 0, QUANTITY_MAX, 'số lượng từ', 3);
        if (minQty <= 0) throw fail('số lượng từ phải lớn hơn 0.');
        const maxQty =
          rule.maxQty === undefined || rule.maxQty === null ? null : boundedNumber(rule.maxQty, 0, QUANTITY_MAX, 'số lượng đến', 3);
        if (maxQty !== null && maxQty < minQty) throw fail('số lượng đến phải lớn hơn hoặc bằng số lượng từ.');
        return { ...empty, minQty, maxQty, percent: percentOf(rule.percent, 'phần trăm của bậc') };
      }
      case 'PERIOD': {
        const fromDate = optionalDate(rule.fromDate, 'từ ngày');
        if (!fromDate) throw fail('vui lòng nhập từ ngày.');
        const toDate = optionalDate(rule.toDate, 'đến ngày');
        if (toDate && toDate < fromDate) throw fail('đến ngày phải sau hoặc bằng từ ngày.');
        return { ...empty, fromDate, toDate };
      }
      case 'MATERIAL_CATEGORY':
        return { ...empty, refText: requiredText(rule.refText, 300, 'nhóm hàng') };
      default: {
        if (!isUuid(rule.refId)) throw fail(`vui lòng chọn ${DISCOUNT_CRITERION_LABELS[criterion].toLowerCase()}.`);
        return { ...empty, refId: rule.refId.toLowerCase(), refText: optionalText(rule.refText, 300, 'tên hiển thị') };
      }
    }
  } catch (error) {
    if (error instanceof CrmValidationError && error.code !== 'INVALID_RULE') throw fail(error.message);
    throw error;
  }
}

/** Các bậc số lượng không chồng nhau (mốc tính cả hai đầu). */
function assertTiersDisjoint(tiers: readonly DiscountPolicyRule[]): void {
  const sorted = [...tiers].sort((left, right) => (left.minQty ?? 0) - (right.minQty ?? 0));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    if (previous.maxQty === null || previous.maxQty === undefined || previous.maxQty >= (sorted[index].minQty ?? 0)) {
      throw new CrmValidationError(
        'OVERLAPPING_TIERS',
        `Bậc số lượng từ ${sorted[index].minQty} chồng với bậc từ ${previous.minQty}. Các bậc không được chồng nhau.`,
      );
    }
  }
}
