import type { CustomerKindOption, SaveCustomerKindRequest } from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { optionalInteger, optionalText, requiredText } from '../domain/fields.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CustomerKindRecord, CustomerKindStore } from './sales-store.port.js';

const KIND_CODE_PATTERN = /^[A-Z0-9._-]+$/;
const KIND_CODE_MAX = 50;
const DEFAULT_SORT_ORDER = 100;

/**
 * Phân loại khách hàng do tenant cấu hình, cùng quy tắc với nhóm khách hàng: ai có `crm.read` cũng đọc được (để
 * lọc, chọn); tạo, sửa, xoá cần `crm.manage`. Phân loại đang có khách hoặc là phân loại hệ thống thì không xoá được.
 */
export class CustomerKindService {
  constructor(private readonly kinds: CustomerKindStore) {}

  list(actor: CrmActor): Promise<CustomerKindOption[]> {
    return this.kinds.listKinds(actor.tenantId);
  }

  async create(actor: CrmActor, request: SaveCustomerKindRequest): Promise<CustomerKindOption> {
    requireSalesManager(actor);
    return this.kinds.createKind(actor.tenantId, kindRecord(request), actor.userId);
  }

  async update(actor: CrmActor, code: string, request: SaveCustomerKindRequest): Promise<CustomerKindOption> {
    requireSalesManager(actor);
    const record = kindRecord(request);
    const current = parseKindCode(code);
    const updated = current ? await this.kinds.updateKind(actor.tenantId, current, record, actor.userId) : undefined;
    if (!updated) throw new CrmNotFoundError('Không tìm thấy phân loại khách hàng.');
    return updated;
  }

  async remove(actor: CrmActor, code: string): Promise<void> {
    requireSalesManager(actor);
    const current = parseKindCode(code);
    const deleted = current !== undefined && (await this.kinds.deleteKind(actor.tenantId, current));
    if (!deleted) throw new CrmNotFoundError('Không tìm thấy phân loại khách hàng.');
  }
}

export function kindRecord(request: SaveCustomerKindRequest): CustomerKindRecord {
  const code = requiredText(request.code, KIND_CODE_MAX, 'mã phân loại').toUpperCase();
  if (!KIND_CODE_PATTERN.test(code)) {
    throw new CrmValidationError(
      'INVALID_KIND_CODE',
      'Mã phân loại chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.',
    );
  }
  return {
    code,
    name: requiredText(request.name, 200, 'tên phân loại'),
    description: optionalText(request.description, 1000, 'mô tả'),
    sortOrder: optionalInteger(request.sortOrder, 0, 9999, 'thứ tự') ?? DEFAULT_SORT_ORDER,
  };
}

/**
 * Mã phân loại gửi lên khi lọc hoặc lưu khách: rỗng là `undefined`; sai định dạng là 400. Mã có thật hay không do
 * khoá ngoại ở DB kiểm.
 */
export function optionalKindCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const code = typeof value === 'string' ? parseKindCode(value) : undefined;
  if (!code) throw new CrmValidationError('INVALID_VALUE', 'Phân loại không hợp lệ.');
  return code;
}

function parseKindCode(value: string): string | undefined {
  const code = value.trim().toUpperCase();
  return code && code.length <= KIND_CODE_MAX && KIND_CODE_PATTERN.test(code) ? code : undefined;
}
