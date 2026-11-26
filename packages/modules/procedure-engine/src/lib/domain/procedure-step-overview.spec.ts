import type { ProcedureActivity, ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { buildInstanceStepOverview, STEP_OVERVIEW_MAX_EVENTS } from './procedure-progress.js';

function activity(id: string, action: ProcedureActivity['action'], extra: Partial<ProcedureActivity> = {}): ProcedureActivity {
  return {
    id,
    action,
    actorId: 'user-secret-id',
    actorName: 'Nguyễn Văn A',
    summary: 'Tóm tắt',
    createdAt: '2026-10-15T02:00:00.000Z',
    ...extra,
  };
}

function instance(extra: Partial<ProcedureInstance> = {}): ProcedureInstance {
  return {
    id: 'inst-1',
    code: 'PR-1',
    title: 'Đơn',
    definitionId: 'def',
    definitionCode: 'DEF',
    definitionName: 'Đơn',
    definitionVersion: 1,
    status: 'running',
    currentStepId: 'step-2',
    initiatedBy: 'user-secret-id',
    startedAt: '2026-10-15T02:00:00.000Z',
    attributeValues: { 'process:so_tien': { type: 'number', value: 999 } } as never,
    activity: [
      activity('a3', 'comment', { comment: 'Nội dung riêng tư', mentions: ['u9'], idempotencyKey: 'k-comment' }),
      activity('a2', 'approve', { stepInstanceId: 'step-1', comment: 'Lý do duyệt', idempotencyKey: 'k-approve' }),
      activity('a1', 'start'),
    ],
    steps: [
      {
        id: 'step-1',
        definitionStepId: 'd1',
        key: 'S1',
        order: 1,
        name: 'Duyệt',
        status: 'completed',
        currentRoleStage: null,
        startedAt: '2026-10-15T02:00:00.000Z',
        completedAt: '2026-10-15T03:00:00.000Z',
        assignments: [{ id: 'x1', role: 'A', subjectType: 'position', subjectId: 'p1', subjectLabel: 'Trưởng phòng' }],
      },
      {
        id: 'step-2',
        definitionStepId: 'd2',
        key: 'S2',
        order: 2,
        name: 'Nhánh không đi',
        status: 'skipped',
        currentRoleStage: null,
        assignments: [],
      },
      {
        id: 'step-3',
        definitionStepId: 'd3',
        key: 'S3',
        order: 4,
        name: 'Giám đốc',
        status: 'active',
        currentRoleStage: 'A',
        slaHours: 8,
        slaDueAt: '2026-10-16T02:00:00.000Z',
        assignments: [{ id: 'x2', role: 'A', subjectType: 'position', subjectId: 'p2', subjectLabel: 'Giám đốc' }],
      },
    ],
    ...extra,
  } as ProcedureInstance;
}

describe('buildInstanceStepOverview', () => {
  it('giữ cả bước nhánh không đi và dùng nhãn người phụ trách', () => {
    const overview = buildInstanceStepOverview(instance());
    expect(overview.steps.map((step) => [step.id, step.status, step.order])).toEqual([
      ['step-1', 'completed', 1],
      ['step-2', 'skipped', 2],
      ['step-3', 'active', 4],
    ]);
    expect(overview.steps[2]).toMatchObject({ assigneeLabel: 'Giám đốc', slaHours: 8, roleStage: 'A' });
    expect(overview.steps[0].startedAt).toBe('2026-10-15T02:00:00.000Z');
    expect(overview).toMatchObject({ instanceId: 'inst-1', instanceCode: 'PR-1', currentStepId: 'step-2' });
  });

  it('bỏ bình luận khỏi nhật ký và không lộ actorId, lý do, mentions, idempotencyKey', () => {
    const overview = buildInstanceStepOverview(instance());
    expect(overview.events.map((event) => event.id)).toEqual(['a2', 'a1']);
    expect(overview.events[0]).toEqual({
      id: 'a2',
      action: 'approve',
      actorName: 'Nguyễn Văn A',
      createdAt: '2026-10-15T02:00:00.000Z',
      stepId: 'step-1',
    });
    const text = JSON.stringify(overview);
    for (const leaked of ['user-secret-id', 'Lý do duyệt', 'Nội dung riêng tư', 'k-approve', 'k-comment', 'mentions', 'so_tien', 'Tóm tắt']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('giới hạn 50 dòng nhật ký, giữ các dòng mới nhất', () => {
    const many = Array.from({ length: 80 }, (_, index) => activity(`e${index}`, 'approve'));
    const overview = buildInstanceStepOverview(instance({ activity: many }));
    expect(overview.events).toHaveLength(STEP_OVERVIEW_MAX_EVENTS);
    expect(overview.events[0].id).toBe('e0');
  });

  describe('gateways', () => {
    const flow = {
      attributes: [],
      gateways: [
        {
          id: 'g1',
          key: 'G1',
          name: 'Rẽ theo số tiền',
          type: 'exclusive',
          afterStepId: 'd1',
          branches: [
            { id: 'b-hi', key: 'hi', label: 'Số tiền lớn', isDefault: false, condition: { secret: 'dieu-kien-bi-mat' }, stepIds: ['d2'] },
            { id: 'b-def', key: 'def', label: 'Mặc định', isDefault: true, stepIds: ['d3', 'd-khong-co'] },
          ],
        },
        { id: 'g-orphan', key: 'G2', name: 'Mồ côi', type: 'exclusive', afterStepId: 'd-khong-co', branches: [] },
      ],
    };
    const decision = (id: string, branch: string, extra: Record<string, unknown> = {}) => ({
      id,
      gatewayId: 'g1',
      gatewayName: 'Rẽ theo số tiền',
      afterStepInstanceId: 'step-1',
      chosenBranchId: branch,
      chosenBranchLabel: branch,
      usedDefault: false,
      evaluatedAt: '2026-10-15T02:30:00.000Z',
      inputs: [{ code: 'so_tien', value: 987654321 }],
      branchResults: [{ branchId: branch, matched: true, detail: 'ket-qua-bi-mat' }],
      ...extra,
    });

    it('đổi id bước định nghĩa sang id bước hồ sơ, bỏ điểm rẽ không tìm được bước đứng trước', () => {
      const overview = buildInstanceStepOverview(
        instance({ flow: flow as never, decisions: [decision('x1', 'b-hi')] as never }),
      );
      expect(overview.gateways).toEqual([
        {
          id: 'g1',
          name: 'Rẽ theo số tiền',
          afterStepId: 'step-1',
          chosenBranchId: 'b-hi',
          branches: [
            { id: 'b-hi', label: 'Số tiền lớn', isDefault: false, stepIds: ['step-2'] },
            { id: 'b-def', label: 'Mặc định', isDefault: true, stepIds: ['step-3'] },
          ],
        },
      ]);
    });

    it('chưa quyết thì không có chosenBranchId; quyết định đã bị thay thế bị bỏ qua', () => {
      const undecided = buildInstanceStepOverview(instance({ flow: flow as never }));
      expect(undecided.gateways?.[0]).not.toHaveProperty('chosenBranchId');
      const onlySuperseded = buildInstanceStepOverview(
        instance({ flow: flow as never, decisions: [decision('x1', 'b-hi', { supersededAt: '2026-10-15T04:00:00.000Z' })] as never }),
      );
      expect(onlySuperseded.gateways?.[0]).not.toHaveProperty('chosenBranchId');
      const redecided = buildInstanceStepOverview(
        instance({
          flow: flow as never,
          decisions: [
            decision('x2', 'b-def', { evaluatedAt: '2026-10-15T05:00:00.000Z' }),
            decision('x1', 'b-hi', { supersededAt: '2026-10-15T04:00:00.000Z' }),
          ] as never,
        }),
      );
      expect(redecided.gateways?.[0].chosenBranchId).toBe('b-def');
    });

    it('không lộ đầu vào, điều kiện hay kết quả đánh giá', () => {
      const text = JSON.stringify(
        buildInstanceStepOverview(instance({ flow: flow as never, decisions: [decision('x1', 'b-hi')] as never })),
      );
      for (const leaked of ['dieu-kien-bi-mat', 'ket-qua-bi-mat', '987654321', 'branchResults', 'inputs', 'condition']) {
        expect(text).not.toContain(leaked);
      }
    });

    it('không có flow thì không có gateways', () => {
      expect(buildInstanceStepOverview(instance()).gateways).toBeUndefined();
      expect(buildInstanceStepOverview(instance({ flow: { attributes: [], gateways: [] } })).gateways).toBeUndefined();
    });
  });

  it('tiến độ lấy từ instance.progress, không có thì đếm bước đã xong', () => {
    const withProgress = buildInstanceStepOverview(
      instance({ progress: { completed: 1, total: 2, isEstimate: false } }),
    );
    expect(withProgress.progress).toEqual({ completed: 1, total: 2 });
    const fallback = buildInstanceStepOverview(instance());
    expect(fallback.progress).toEqual({ completed: 1, total: 3 });
  });
});
