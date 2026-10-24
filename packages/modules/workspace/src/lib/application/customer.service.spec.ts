import { randomUUID } from 'node:crypto';
import type { Contract, Customer } from '@enterprise-platform/contracts-workspace';
import { CustomerService } from './customer.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { CustomerWriteModel, WorkspaceStore } from './workspace-store.port.js';

const actor: WorkspaceActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'U',
  isTenantAdmin: false,
  canManage: true,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

/** Store trong bộ nhớ, đủ cho các luật của service. `projectDeps` giả số dự án. */
function makeStore() {
  const customers = new Map<string, Customer>();
  const contracts = new Map<string, Contract>();
  const projectDeps = new Map<string, number>();

  const store = {
    customer: {
      list: async () =>
        [...customers.values()].map((customer) => ({
          ...customer,
          contractCount: [...contracts.values()].filter((c) => c.customerId === customer.id).length,
          projectCount: projectDeps.get(customer.id) ?? 0,
        })),
      findById: async (_tenant: string, id: string) => customers.get(id),
      findByCode: async (_tenant: string, code: string) =>
        [...customers.values()].find((customer) => customer.code === code),
      create: async (_tenant: string, actorUserId: string, input: CustomerWriteModel) => {
        const customer: Customer = {
          id: randomUUID(),
          code: input.code,
          name: input.name,
          note: input.note ?? undefined,
          createdBy: actorUserId,
          createdAt: '2026-10-18T00:00:00.000Z',
          updatedAt: '2026-10-18T00:00:00.000Z',
        };
        customers.set(customer.id, customer);
        return customer;
      },
      update: async (
        _tenant: string,
        id: string,
        input: { name?: string; note?: string | null },
      ) => {
        const current = customers.get(id) as Customer;
        const next: Customer = {
          ...current,
          name: input.name ?? current.name,
          note: input.note === undefined ? current.note : (input.note ?? undefined),
        };
        customers.set(id, next);
        return next;
      },
      remove: async (_tenant: string, id: string) => {
        customers.delete(id);
      },
      dependents: async (_tenant: string, id: string) => ({
        contractCount: [...contracts.values()].filter((c) => c.customerId === id).length,
        projectCount: projectDeps.get(id) ?? 0,
      }),
    },
    contract: {
      listByCustomer: async (_tenant: string, id: string) =>
        [...contracts.values()].filter((c) => c.customerId === id),
    },
  } as unknown as WorkspaceStore;

  return { store, customers, contracts, projectDeps };
}

async function seeded() {
  const fixture = makeStore();
  const service = new CustomerService(fixture.store);
  const created = await service.create(actor, { code: '  kh 01/Hà Nội  ', name: '  Công ty A  ' });
  return { ...fixture, service, id: created.id };
}

describe('CustomerService.create', () => {
  it('giữ nguyên mã người dùng gõ (chỉ cắt khoảng trắng hai đầu) và cắt khoảng trắng tên', async () => {
    const { id, customers } = await seeded();
    const customer = customers.get(id) as Customer;
    expect(customer.code).toBe('kh 01/Hà Nội');
    expect(customer.name).toBe('Công ty A');
  });

  it('mã rỗng hoặc dài quá 32 ký tự bị từ chối', async () => {
    const { store } = makeStore();
    const service = new CustomerService(store);
    await expect(service.create(actor, { code: '   ', name: 'A' })).rejects.toThrow(/Mã khách hàng/);
    await expect(service.create(actor, { code: 'x'.repeat(33), name: 'A' })).rejects.toThrow(/tối đa 32/);
  });

  it('trùng mã trong tenant báo xung đột 409', async () => {
    const { service } = await seeded();
    await expect(service.create(actor, { code: 'kh 01/Hà Nội', name: 'Khác' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe('CustomerService.update', () => {
  it('đổi tên và gỡ ghi chú', async () => {
    const { service, id } = await seeded();
    const updated = await service.update(actor, id, { name: 'Công ty B', note: null });
    expect(updated.name).toBe('Công ty B');
    expect(updated.note).toBeUndefined();
  });

  it('khách hàng không tồn tại nhận 404', async () => {
    const { service } = await seeded();
    await expect(service.update(actor, randomUUID(), { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('CustomerService.detail', () => {
  it('trả khách hàng kèm hợp đồng', async () => {
    const { service, id, contracts } = await seeded();
    contracts.set('c1', {
      id: 'c1',
      customerId: id,
      code: 'HD01',
      name: 'Hợp đồng 1',
      status: 'draft',
      createdBy: 'u1',
      createdAt: '',
      updatedAt: '',
    });
    const detail = await service.detail(actor, id);
    expect(detail.customer.id).toBe(id);
    expect(detail.contracts.map((c) => c.id)).toEqual(['c1']);
  });
});

describe('CustomerService.remove', () => {
  it('xoá được khi không còn phụ thuộc', async () => {
    const { service, id, customers } = await seeded();
    await service.remove(actor, id);
    expect(customers.has(id)).toBe(false);
  });

  it('chặn xoá khi còn hợp đồng', async () => {
    const { service, id, contracts } = await seeded();
    contracts.set('c1', {
      id: 'c1',
      customerId: id,
      code: 'HD01',
      name: 'Hợp đồng 1',
      status: 'draft',
      createdBy: 'u1',
      createdAt: '',
      updatedAt: '',
    });
    await expect(service.remove(actor, id)).rejects.toThrow(/hợp đồng/);
  });

  it('chặn xoá khi còn dự án', async () => {
    const { service, id, projectDeps } = await seeded();
    projectDeps.set(id, 2);
    await expect(service.remove(actor, id)).rejects.toThrow(/dự án/);
  });
});
