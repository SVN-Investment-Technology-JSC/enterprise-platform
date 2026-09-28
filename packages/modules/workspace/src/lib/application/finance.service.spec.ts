import type { ProjectRole, WorkItem } from '@enterprise-platform/contracts-workspace';
import type { FinanceInputs } from '../domain/finance.rules.js';
import { FinanceService } from './finance.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const BILLION = 1_000_000_000;

const INPUTS: FinanceInputs = {
  contractValue: 25_500_000_000,
  budget: 22 * BILLION,
  committedCost: 3_200_000_000,
  forecastCostOverride: null,
  actualCost: 14_800_000_000,
  remainingEstimate: 2_100_000_000,
};

function makeStore(role: ProjectRole | undefined, item?: Partial<WorkItem>) {
  const projectWrites: unknown[] = [];
  const itemWrites: unknown[] = [];
  const entryWrites: { amount: number; note: string }[] = [];
  const store = {
    project: {
      findById: async () => ({ id: 'p1', code: 'DA-1', name: 'Dự án' }),
      rollup: async () => [],
    },
    member: { roleOf: async () => role },
    workItem: {
      findById: async () =>
        item ? ({ id: 'w1', projectId: 'p1', itemType: 'task', ...item } as WorkItem) : undefined,
    },
    finance: {
      inputs: async () => new Map([['p1', INPUTS]]),
      itemCosts: async () => [],
      updateProject: async (_tenant: string, _id: string, patch: unknown) => {
        projectWrites.push(patch);
      },
      updateItem: async (_tenant: string, _id: string, patch: unknown) => {
        itemWrites.push(patch);
      },
      addCostEntry: async (
        _tenant: string,
        _actor: string,
        input: { amount: number; note: string },
      ) => {
        entryWrites.push({ amount: input.amount, note: input.note });
        return { id: 'e1', ...input };
      },
    },
  } as unknown as WorkspaceStore;
  return { store, projectWrites, itemWrites, entryWrites };
}

const actor = (isTenantAdmin = false): WorkspaceActor => ({
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin,
  canManage: isTenantAdmin,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

const service = (store: WorkspaceStore) => new FinanceService(store, new ProjectService(store));

describe('FinanceService — ai được xem', () => {
  it.each<[ProjectRole]>([['owner'], ['manager']])('%s xem được tài chính', async (role) => {
    const { store } = makeStore(role);
    const finance = await service(store).forProject(actor(), 'p1');
    expect(finance.profit).toBe(5_400_000_000);
    expect(finance.profitMargin).toBe(21.2);
  });

  it.each<[ProjectRole]>([['member'], ['viewer']])(
    '%s gọi thẳng endpoint nhận 403 FINANCE_FORBIDDEN',
    async (role) => {
      const { store } = makeStore(role);
      await expect(service(store).forProject(actor(), 'p1')).rejects.toMatchObject({
        code: 'FINANCE_FORBIDDEN',
        statusCode: 403,
      });
    },
  );

  it('quản trị viên tenant không phải thành viên vẫn xem được', async () => {
    const { store } = makeStore(undefined);
    await expect(service(store).forProject(actor(true), 'p1')).resolves.toMatchObject({
      projectId: 'p1',
    });
  });
});

describe('FinanceService — payload chi tiết dự án', () => {
  it('member KHÔNG nhận trường finance, kể cả dạng null', async () => {
    const { store } = makeStore('member');
    const detail = await service(store).detailWithFinance(actor(), 'p1');
    // Vắng hẳn, không phải null: ẩn ở giao diện mà vẫn gửi số xuống là lộ.
    expect('finance' in detail).toBe(false);
    expect(JSON.stringify(detail)).not.toContain('contractValue');
  });

  it('manager nhận kèm finance trong cùng payload', async () => {
    const { store } = makeStore('manager');
    const detail = await service(store).detailWithFinance(actor(), 'p1');
    expect(detail.finance?.contractValue).toBe(25_500_000_000);
  });
});

describe('FinanceService — ghi', () => {
  it('chặn số âm ở server, không trông vào giao diện', async () => {
    const { store } = makeStore('manager');
    await expect(
      service(store).updateProject(actor(), 'p1', { contractValue: -1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('null xoá giá trị hợp đồng, không bị coi là số 0', async () => {
    const { store, projectWrites } = makeStore('manager');
    await service(store).updateProject(actor(), 'p1', { contractValue: null });
    expect(projectWrites).toEqual([{ contractValue: null }]);
  });

  it('chi phí đã cam kết không nhận null', async () => {
    const { store } = makeStore('manager');
    await expect(
      service(store).updateProject(actor(), 'p1', { committedCost: null as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('member không sửa được chi phí công việc, kể cả việc của chính mình', async () => {
    const { store } = makeStore('member', { assigneeUserId: 'u1' });
    await expect(
      service(store).updateItemCost(actor(), 'w1', { estimatedCost: 1_000 }),
    ).rejects.toMatchObject({ code: 'FINANCE_FORBIDDEN' });
  });

  it('nhóm công việc không mang chi phí', async () => {
    const { store } = makeStore('manager', { itemType: 'phase' });
    await expect(
      service(store).updateItemCost(actor(), 'w1', { estimatedCost: 1_000 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('chi phí dự toán âm bị chặn', async () => {
    const { store } = makeStore('manager', {});
    await expect(
      service(store).updateItemCost(actor(), 'w1', { estimatedCost: -5 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('làm tròn về đồng lẻ trước khi ghi', async () => {
    const { store, itemWrites } = makeStore('manager', {});
    // Không dùng 1000,555: số đó trong số thực là 1000,55499…, và mọi phép
    // làm tròn đều ra 1000,55 — một test chọn nhầm ca sẽ báo sai về mã đúng.
    await service(store).updateItemCost(actor(), 'w1', { estimatedCost: 1000.126 });
    expect(itemWrites).toEqual([{ estimatedCost: 1000.13 }]);
  });
});

describe('FinanceService — sổ chi phí', () => {
  it('không sửa thẳng chi phí thực tế được nữa', async () => {
    const { store, itemWrites } = makeStore('manager', {});
    await expect(
      service(store).updateItemCost(actor(), 'w1', { actualCost: 1_000 } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(itemWrites).toHaveLength(0);
  });

  it('ghi một dòng kèm lý do, làm tròn về đồng lẻ', async () => {
    const { store, entryWrites } = makeStore('manager', {});
    await service(store).addCostEntry(actor(), 'w1', {
      amount: 1000.126,
      note: '  Hoá đơn vận chuyển số 128  ',
    });
    expect(entryWrites).toEqual([{ amount: 1000.13, note: 'Hoá đơn vận chuyển số 128' }]);
  });

  it('được ghi số âm để điều chỉnh', async () => {
    const { store, entryWrites } = makeStore('manager', {});
    await service(store).addCostEntry(actor(), 'w1', { amount: -500, note: 'Nhập nhầm, trả lại' });
    expect(entryWrites).toEqual([{ amount: -500, note: 'Nhập nhầm, trả lại' }]);
  });

  it.each<[string, unknown, string]>([
    ['số tiền bằng 0', 0, 'lý do'],
    ['số tiền không phải số', 'abc', 'lý do'],
    ['thiếu lý do', 1_000, '   '],
  ])('%s bị từ chối', async (_label, amount, note) => {
    const { store, entryWrites } = makeStore('manager', {});
    await expect(
      service(store).addCostEntry(actor(), 'w1', { amount: amount as number, note }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(entryWrites).toHaveLength(0);
  });

  it('member không ghi được sổ, kể cả việc của chính mình', async () => {
    const { store } = makeStore('member', { assigneeUserId: 'u1' });
    await expect(
      service(store).addCostEntry(actor(), 'w1', { amount: 1_000, note: 'x' }),
    ).rejects.toMatchObject({ code: 'FINANCE_FORBIDDEN' });
  });

  it('nhóm công việc không ghi sổ', async () => {
    const { store } = makeStore('manager', { itemType: 'phase' });
    await expect(
      service(store).addCostEntry(actor(), 'w1', { amount: 1_000, note: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
