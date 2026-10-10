import type { ProjectRequest, ProjectRole } from '@enterprise-platform/contracts-workspace';
import type { ProcedureReversalChecker } from './procedure-reversal-check.port.js';
import { ProjectRequestService } from './project-request.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

function request(overrides: Partial<ProjectRequest> = {}): ProjectRequest {
  return {
    id: 'dt-1',
    projectId: 'p1',
    code: 'DT008',
    sourceModule: 'hrm',
    sourceKind: 'business_trip',
    sourceId: 'req-1',
    requestTypeLabel: 'Đơn công tác',
    requesterUserId: 'u-employee',
    status: 'APPROVED',
    submittedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStore(row: ProjectRequest, roles: Record<string, ProjectRole>) {
  const sent: Record<string, unknown>[] = [];
  const store = {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' ? ({ id: 'p1', code: 'EVN', name: 'Dự án' } as never) : undefined,
    },
    member: {
      roleOf: async (_tenant: string, _projectId: string, userId: string) => roles[userId],
    },
    projectRequest: {
      findById: async () => row,
      requestReversal: async (_tenant: string, input: Record<string, unknown>) => {
        sent.push(input);
      },
    },
  } as unknown as WorkspaceStore;
  return { store, sent };
}

const actorOf = (userId: string, isTenantAdmin = false): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

const checker = (result: { allowed: boolean; reason?: string; approverUserIds?: string[] }) => ({
  check: jest.fn().mockResolvedValue(result),
  checkHrmRequest: jest.fn().mockResolvedValue(result),
});

const service = (store: WorkspaceStore, reversal?: ProcedureReversalChecker) =>
  new ProjectRequestService(store, new ProjectService(store), reversal);

describe('ProjectRequestService.reverse', () => {
  it('chủ nhiệm gửi yêu cầu huỷ; đơn qua quy trình thì hỏi Quy trình và kèm instanceId', async () => {
    const { store, sent } = makeStore(
      request({ procedureInstanceId: 'inst-1', procedureInstanceCode: 'PR-1' }),
      { 'u-owner': 'owner' },
    );
    const reversal = checker({ allowed: true });
    await service(store, reversal).reverse(actorOf('u-owner'), 'dt-1', {
      reason: 'Sai ngày công tác',
      createAdjustment: true,
    });
    expect(reversal.check).toHaveBeenCalledWith('t1', 'inst-1');
    expect(reversal.checkHrmRequest).not.toHaveBeenCalled();
    expect(sent).toEqual([
      expect.objectContaining({ instanceId: 'inst-1', requestKind: 'business_trip', createAdjustment: true }),
    ]);
  });

  it('người duyệt đơn (không phải chủ nhiệm) được huỷ; thành viên thường thì không', async () => {
    const { store, sent } = makeStore(request(), { 'u-approver': 'member', 'u-member': 'member' });
    const reversal = checker({ allowed: true, approverUserIds: ['u-approver'] });
    await expect(
      service(store, reversal).reverse(actorOf('u-member'), 'dt-1', { reason: 'Sai ngày', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
    await service(store, reversal).reverse(actorOf('u-approver'), 'dt-1', {
      reason: 'Sai ngày',
      createAdjustment: false,
    });
    expect(reversal.checkHrmRequest).toHaveBeenCalledWith('t1', 'business_trip', 'req-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('instanceId');
  });

  it('chặn hẳn khi module nguồn không cho huỷ, và chỉ nhận đơn đã duyệt', async () => {
    const blocked = makeStore(request(), { 'u-owner': 'owner' });
    await expect(
      service(blocked.store, checker({ allowed: false, reason: 'Đơn HRM: Kỳ lương đã chốt' })).reverse(
        actorOf('u-owner'),
        'dt-1',
        { reason: 'Sai ngày', createAdjustment: false },
      ),
    ).rejects.toThrow('Kỳ lương đã chốt');
    expect(blocked.sent).toHaveLength(0);

    const pending = makeStore(request({ status: 'PENDING' }), { 'u-owner': 'owner' });
    await expect(
      service(pending.store, checker({ allowed: true })).reverse(actorOf('u-owner'), 'dt-1', {
        reason: 'Sai ngày',
        createAdjustment: false,
      }),
    ).rejects.toThrow('Chỉ huỷ hiệu lực được đơn đã duyệt.');
  });

  it('không gửi trùng khi yêu cầu trước còn đang chờ', async () => {
    const { store } = makeStore(
      request({
        reversalRequest: { requestedAt: 'x', reason: 'Sai', adjustmentRequested: false },
      }),
      { admin: 'owner' },
    );
    await expect(
      service(store, checker({ allowed: true })).reverse(actorOf('admin', true), 'dt-1', {
        reason: 'Sai ngày',
        createAdjustment: false,
      }),
    ).rejects.toThrow('đang chờ huỷ hiệu lực');
  });
});
