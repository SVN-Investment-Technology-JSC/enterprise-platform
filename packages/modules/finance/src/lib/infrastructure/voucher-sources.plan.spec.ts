import type { FinanceStepVoucherRequestedPayload } from '@enterprise-platform/contracts-finance';
import { invalid } from '../domain/finance.error.js';
import type { NormalizedVoucher } from '../domain/voucher.rules.js';
import { planRequestedVoucher } from './voucher-sources.store.js';
import type { ResolvedWorkspaceLinks } from './vouchers.store.js';

const PROJECT = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const ITEM = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const USER = '5b7f3c1e-2d4a-4b6c-8e9f-0a1b2c3d4e5f';

const payload = (over: Partial<FinanceStepVoucherRequestedPayload> = {}): FinanceStepVoucherRequestedPayload => ({
  instanceId: 'i1',
  instanceCode: 'PR-1',
  instanceTitle: 'Chi vật tư dự án',
  definitionId: 'd1',
  definitionName: 'Chi phí dự án',
  stepInstanceId: 's1',
  stepName: 'Kế toán chi tiền',
  activation: 1,
  voucherKind: 'PAYMENT',
  values: {
    amount: 1_500_000,
    content: null,
    counterpartyName: null,
    counterpartyAccountNo: null,
    counterpartyBank: null,
    voucherDate: null,
  },
  initiatedBy: USER,
  assigneeIds: [],
  assigneeSubjects: [],
  requestedAt: '2026-11-15T00:00:00.000Z',
  ...over,
});

const linksOf = (allocation: NormalizedVoucher['allocation']): ResolvedWorkspaceLinks => ({
  allocation: allocation
    ? {
        type: allocation.type,
        projectId: allocation.projectId,
        projectCode: 'DA-1',
        projectName: 'Dự án',
        workItemId: allocation.workItemId ?? null,
        workItemCode: allocation.workItemId ? 'CV001' : null,
        workItemTitle: allocation.workItemId ? 'Mua vật tư' : null,
      }
    : null,
  relatedProjects: [],
});

describe('planRequestedVoucher — hạch toán từ hồ sơ Quy trình', () => {
  it('có công việc: hạch toán cho công việc và khoá trường hạch toán', async () => {
    const plan = await planRequestedVoucher(
      payload({ projectId: PROJECT, workItemId: ITEM }),
      async (allocation) => linksOf(allocation),
      async () => PROJECT,
    );
    expect(plan.voucher.allocation).toMatchObject({ type: 'WORK_ITEM', projectId: PROJECT, workItemId: ITEM });
    expect(plan.lockedFields).toContain('allocation');
    expect(plan.allocationNote).toBeNull();
  });

  it('chỉ có dự án: hạch toán cho dự án', async () => {
    const plan = await planRequestedVoucher(payload({ projectId: PROJECT }), async (a) => linksOf(a), async () => null);
    expect(plan.voucher.allocation).toMatchObject({ type: 'PROJECT', projectId: PROJECT });
  });

  it('công việc không xác nhận được (đã huỷ) mà còn dự án: lùi về dự án thay vì mất cả hạch toán', async () => {
    const plan = await planRequestedVoucher(
      payload({ projectId: PROJECT, workItemId: ITEM }),
      async (allocation) => {
        if (allocation?.type === 'WORK_ITEM') throw invalid('Công việc CV001 đã huỷ, không thể hạch toán.');
        return linksOf(allocation);
      },
      async () => PROJECT,
    );
    expect(plan.voucher.allocation).toMatchObject({ type: 'PROJECT', projectId: PROJECT, workItemId: null });
    expect(plan.lockedFields).toContain('allocation');
    expect(plan.allocationNote).toBeNull();
  });

  it('công việc đã xoá (không tìm thấy dự án chứa nó) mà còn dự án: lùi về dự án', async () => {
    const plan = await planRequestedVoucher(
      payload({ projectId: PROJECT, workItemId: ITEM }),
      async (allocation) => linksOf(allocation),
      async () => null,
    );
    expect(plan.voucher.allocation).toMatchObject({ type: 'PROJECT', projectId: PROJECT });
  });

  it('tra công việc lỗi mạng mà còn dự án: vẫn thử bằng dự án', async () => {
    const plan = await planRequestedVoucher(
      payload({ projectId: PROJECT, workItemId: ITEM }),
      async (allocation) => linksOf(allocation),
      async () => {
        throw new Error('timeout');
      },
    );
    expect(plan.voucher.allocation).toMatchObject({ type: 'PROJECT', projectId: PROJECT });
  });

  it('không xác nhận được gì: để trống hạch toán, không khoá, kèm ghi chú cho kế toán', async () => {
    const plan = await planRequestedVoucher(
      payload({ projectId: PROJECT }),
      async () => {
        throw new Error('Workspace không trả lời');
      },
      async () => null,
    );
    expect(plan.voucher.allocation).toBeNull();
    expect(plan.lockedFields).not.toContain('allocation');
    expect(plan.allocationNote).toMatch(/Workspace không trả lời/);
  });

  it('chỉ có công việc đã xoá và không có dự án: để trống kèm ghi chú', async () => {
    const plan = await planRequestedVoucher(payload({ workItemId: ITEM }), async (a) => linksOf(a), async () => null);
    expect(plan.voucher.allocation).toBeNull();
    expect(plan.allocationNote).toMatch(/không còn tồn tại/);
  });

  it('hồ sơ không gắn dự án: không hạch toán và không có ghi chú', async () => {
    const plan = await planRequestedVoucher(payload(), async (a) => linksOf(a), async () => null);
    expect(plan.voucher.allocation).toBeNull();
    expect(plan.allocationNote).toBeNull();
  });
});
