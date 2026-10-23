import {
  type Contract,
  type CreateCustomerRequest,
  type Customer,
  type CustomerSummary,
  type UpdateCustomerRequest,
  WORKSPACE_CODE_MAX_LENGTH,
} from '@enterprise-platform/contracts-workspace';
import {
  CustomerCodeConflictError,
  CustomerNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { CustomerUpdateModel, CustomerWriteModel, WorkspaceStore } from './workspace-store.port.js';

/**
 * Khách hàng chủ quản của dự án.
 *
 * Không có khái niệm thành viên hay phạm vi như dự án: ai dùng được Workspace
 * cũng đọc và quản lý được danh mục khách hàng của tenant. Mã khách hàng là
 * định danh người dùng đọc nên phải duy nhất trong tenant; không xoá được khách
 * hàng khi còn hợp đồng hoặc dự án trỏ tới.
 */
export class CustomerService {
  constructor(private readonly store: WorkspaceStore) {}

  async list(
    actor: WorkspaceActor,
    query?: { readonly search?: string },
  ): Promise<readonly CustomerSummary[]> {
    return this.store.customer.list(actor.tenantId, {
      search: query?.search?.trim() || undefined,
    });
  }

  /** Khách hàng kèm toàn bộ hợp đồng của họ. */
  async detail(
    actor: WorkspaceActor,
    customerId: string,
  ): Promise<{ customer: Customer; contracts: readonly Contract[] }> {
    const customer = await this.store.customer.findById(actor.tenantId, customerId);
    if (!customer) throw new CustomerNotFoundError();
    const contracts = await this.store.contract.listByCustomer(actor.tenantId, customerId);
    return { customer, contracts };
  }

  async create(actor: WorkspaceActor, input: CreateCustomerRequest): Promise<Customer> {
    const code = requireCode(input.code, 'Mã khách hàng');
    const name = requireText(input.name, 'Tên khách hàng', 200);

    // Kiểm tra trước để trả mã lỗi rõ ràng; UNIQUE trên cột `code` vẫn là chốt
    // chặn thật khi hai request vào cùng lúc.
    const existing = await this.store.customer.findByCode(actor.tenantId, code);
    if (existing) throw new CustomerCodeConflictError(code);

    const model: CustomerWriteModel = { code, name, note: optionalText(input.note) };
    return this.store.customer.create(actor.tenantId, actor.userId, model);
  }

  async update(
    actor: WorkspaceActor,
    customerId: string,
    input: UpdateCustomerRequest,
  ): Promise<Customer> {
    const existing = await this.store.customer.findById(actor.tenantId, customerId);
    if (!existing) throw new CustomerNotFoundError();

    const body = input ?? {};
    const patch: { -readonly [Key in keyof CustomerUpdateModel]?: CustomerUpdateModel[Key] } = {};
    if (body.name !== undefined) patch.name = requireText(body.name, 'Tên khách hàng', 200);
    if (body.note !== undefined) patch.note = optionalText(body.note);

    return this.store.customer.update(actor.tenantId, customerId, patch);
  }

  /** Xoá khách hàng: chỉ khi không còn hợp đồng và không còn dự án trỏ tới. */
  async remove(actor: WorkspaceActor, customerId: string): Promise<void> {
    const existing = await this.store.customer.findById(actor.tenantId, customerId);
    if (!existing) throw new CustomerNotFoundError();

    const deps = await this.store.customer.dependents(actor.tenantId, customerId);
    if (deps.contractCount > 0 || deps.projectCount > 0) {
      const parts: string[] = [];
      if (deps.contractCount > 0) parts.push(`${deps.contractCount} hợp đồng`);
      if (deps.projectCount > 0) parts.push(`${deps.projectCount} dự án`);
      throw new WorkspaceValidationError(
        `Không xoá được khách hàng còn ${parts.join(' và ')} trỏ tới. Hãy gỡ chúng trước.`,
      );
    }
    await this.store.customer.remove(actor.tenantId, customerId);
  }
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/** Mã người dùng tự đặt: chữ gì cũng được, chỉ cắt khoảng trắng hai đầu và giới hạn độ dài. */
function requireCode(value: unknown, label: string): string {
  const code = String(value ?? '').trim();
  if (!code) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (code.length > WORKSPACE_CODE_MAX_LENGTH) {
    throw new WorkspaceValidationError(`${label} dài tối đa ${WORKSPACE_CODE_MAX_LENGTH} ký tự.`);
  }
  return code;
}
