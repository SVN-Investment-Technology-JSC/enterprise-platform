import { randomUUID } from 'node:crypto';
import type { Contract, Customer } from '@enterprise-platform/contracts-workspace';
import { ContractService } from './contract.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { ContractWriteModel, WorkspaceStore } from './workspace-store.port.js';

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

/** Store trong bộ nhớ với một khách hàng sẵn có. */
function makeStore() {
  const customerId = randomUUID();
  const customers = new Map<string, Customer>([
    [
      customerId,
      {
        id: customerId,
        code: 'KH01',
        name: 'Công ty A',
        createdBy: 'u1',
        createdAt: '',
        updatedAt: '',
      },
    ],
  ]);
  const contracts = new Map<string, Contract>();

  const store = {
    customer: {
      findById: async (_tenant: string, id: string) => customers.get(id),
    },
    contract: {
      listByCustomer: async (_tenant: string, id: string) =>
        [...contracts.values()].filter((c) => c.customerId === id),
      findById: async (_tenant: string, id: string) => contracts.get(id),
      findByCode: async (_tenant: string, code: string) =>
        [...contracts.values()].find((c) => c.code === code),
      create: async (_tenant: string, actorUserId: string, input: ContractWriteModel) => {
        const contract: Contract = {
          id: randomUUID(),
          customerId: input.customerId,
          code: input.code,
          name: input.name,
          status: input.status,
          value: input.value ?? undefined,
          signedDate: input.signedDate ?? undefined,
          note: input.note ?? undefined,
          createdBy: actorUserId,
          createdAt: '2026-10-18T00:00:00.000Z',
          updatedAt: '2026-10-18T00:00:00.000Z',
        };
        contracts.set(contract.id, contract);
        return contract;
      },
      update: async (
        _tenant: string,
        id: string,
        input: Partial<ContractWriteModel>,
      ) => {
        const current = contracts.get(id) as Contract;
        const next = { ...current, ...input } as Contract;
        contracts.set(id, next);
        return next;
      },
      remove: async (_tenant: string, id: string) => {
        contracts.delete(id);
      },
    },
  } as unknown as WorkspaceStore;

  return { store, customerId, customers, contracts };
}

describe('ContractService.create', () => {
  it('tạo hợp đồng dưới khách hàng, mặc định trạng thái draft', async () => {
    const { store, customerId } = makeStore();
    const service = new ContractService(store);
    const contract = await service.create(actor, {
      customerId,
      code: 'hd01',
      name: '  Hợp đồng 1  ',
      value: 1000,
      signedDate: '2026-10-01',
    });
    expect(contract.code).toBe('HD01');
    expect(contract.name).toBe('Hợp đồng 1');
    expect(contract.status).toBe('draft');
    expect(contract.value).toBe(1000);
    expect(contract.customerId).toBe(customerId);
  });

  it('khách hàng không tồn tại nhận 404', async () => {
    const { store } = makeStore();
    const service = new ContractService(store);
    await expect(
      service.create(actor, { customerId: randomUUID(), code: 'HD01', name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('trùng mã hợp đồng báo xung đột 409', async () => {
    const { store, customerId } = makeStore();
    const service = new ContractService(store);
    await service.create(actor, { customerId, code: 'HD01', name: 'A' });
    await expect(
      service.create(actor, { customerId, code: 'HD01', name: 'B' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('giá trị âm bị từ chối', async () => {
    const { store, customerId } = makeStore();
    const service = new ContractService(store);
    await expect(
      service.create(actor, { customerId, code: 'HD02', name: 'A', value: -5 }),
    ).rejects.toThrow(/không âm/);
  });
});

describe('ContractService.update', () => {
  it('đổi trạng thái hợp đồng', async () => {
    const { store, customerId } = makeStore();
    const service = new ContractService(store);
    const created = await service.create(actor, { customerId, code: 'HD01', name: 'A' });
    const updated = await service.update(actor, created.id, { status: 'active' });
    expect(updated.status).toBe('active');
  });

  it('trạng thái không hợp lệ bị từ chối', async () => {
    const { store, customerId } = makeStore();
    const service = new ContractService(store);
    const created = await service.create(actor, { customerId, code: 'HD01', name: 'A' });
    await expect(
      service.update(actor, created.id, { status: 'xxx' as never }),
    ).rejects.toThrow(/không hợp lệ/);
  });

  it('hợp đồng không tồn tại nhận 404', async () => {
    const { store } = makeStore();
    const service = new ContractService(store);
    await expect(service.update(actor, randomUUID(), { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('ContractService.remove', () => {
  it('xoá hợp đồng; không tồn tại thì 404', async () => {
    const { store, customerId, contracts } = makeStore();
    const service = new ContractService(store);
    const created = await service.create(actor, { customerId, code: 'HD01', name: 'A' });
    await service.remove(actor, created.id);
    expect(contracts.has(created.id)).toBe(false);
    await expect(service.remove(actor, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
  });
});
