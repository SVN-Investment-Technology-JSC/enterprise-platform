import {
  CONTRACT_STATUSES,
  type Contract,
  type ContractStatus,
  type CreateContractRequest,
  type UpdateContractRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ContractCodeConflictError,
  ContractNotFoundError,
  CustomerNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { ContractUpdateModel, ContractWriteModel, WorkspaceStore } from './workspace-store.port.js';

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hợp đồng của khách hàng.
 *
 * Mỗi hợp đồng thuộc đúng một khách hàng; khách hàng chủ quản được chốt lúc
 * tạo và không đổi. Mã hợp đồng duy nhất trong tenant.
 */
export class ContractService {
  constructor(private readonly store: WorkspaceStore) {}

  async listByCustomer(actor: WorkspaceActor, customerId: string): Promise<readonly Contract[]> {
    const customer = await this.store.customer.findById(actor.tenantId, customerId);
    if (!customer) throw new CustomerNotFoundError();
    return this.store.contract.listByCustomer(actor.tenantId, customerId);
  }

  async create(actor: WorkspaceActor, input: CreateContractRequest): Promise<Contract> {
    const customerId = requireUuid(input.customerId, 'Khách hàng');
    const customer = await this.store.customer.findById(actor.tenantId, customerId);
    if (!customer) throw new CustomerNotFoundError();

    const code = String(input.code ?? '')
      .trim()
      .toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new WorkspaceValidationError(
        'Mã hợp đồng chỉ gồm chữ in hoa, số và dấu gạch ngang, dài 2 đến 32 ký tự.',
      );
    }
    const name = requireText(input.name, 'Tên hợp đồng', 200);
    const status = input.status === undefined ? 'draft' : parseStatus(input.status);

    const existing = await this.store.contract.findByCode(actor.tenantId, code);
    if (existing) throw new ContractCodeConflictError(code);

    const model: ContractWriteModel = {
      customerId,
      code,
      name,
      status,
      value: optionalValue(input.value),
      signedDate: optionalDate(input.signedDate, 'Ngày ký'),
      note: optionalText(input.note),
    };
    return this.store.contract.create(actor.tenantId, actor.userId, model);
  }

  async update(
    actor: WorkspaceActor,
    contractId: string,
    input: UpdateContractRequest,
  ): Promise<Contract> {
    const existing = await this.store.contract.findById(actor.tenantId, contractId);
    if (!existing) throw new ContractNotFoundError();

    const body = input ?? {};
    const patch: { -readonly [Key in keyof ContractUpdateModel]?: ContractUpdateModel[Key] } = {};
    if (body.name !== undefined) patch.name = requireText(body.name, 'Tên hợp đồng', 200);
    if (body.status !== undefined) patch.status = parseStatus(body.status);
    if (body.value !== undefined) patch.value = optionalValue(body.value);
    if (body.signedDate !== undefined) patch.signedDate = optionalDate(body.signedDate, 'Ngày ký');
    if (body.note !== undefined) patch.note = optionalText(body.note);

    return this.store.contract.update(actor.tenantId, contractId, patch);
  }

  async remove(actor: WorkspaceActor, contractId: string): Promise<void> {
    const existing = await this.store.contract.findById(actor.tenantId, contractId);
    if (!existing) throw new ContractNotFoundError();
    await this.store.contract.remove(actor.tenantId, contractId);
  }
}

function parseStatus(value: unknown): ContractStatus {
  const text = String(value ?? '');
  if (!(CONTRACT_STATUSES as readonly string[]).includes(text)) {
    throw new WorkspaceValidationError(`Trạng thái hợp đồng "${text}" không hợp lệ.`);
  }
  return text as ContractStatus;
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

function requireUuid(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(text)) {
    throw new WorkspaceValidationError(`Hãy chọn ${label.toLowerCase()} hợp lệ.`);
  }
  return text;
}

/** Giá trị hợp đồng: rỗng thì gỡ số; có thì phải là số không âm. */
function optionalValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new WorkspaceValidationError('Giá trị hợp đồng phải là số không âm.');
  }
  return amount;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!DATE.test(text) || Number.isNaN(Date.parse(text))) {
    throw new WorkspaceValidationError(`${label} không hợp lệ.`);
  }
  return text;
}
