import {
  definitionAllowsBulkAction,
  procedureBulkInputBlocker,
  procedureBulkPlan,
} from './procedure-bulk-action.js';
import type { ProcedureInstance, ProcedureRuntimeAuthorization } from './procedure-engine.contracts.js';

function instance(overrides: Partial<ProcedureInstance> = {}): ProcedureInstance {
  return {
    id: 'i-1',
    code: 'HS-1',
    title: 'Hồ sơ',
    definitionId: 'd-1',
    definitionCode: 'D',
    definitionName: 'Quy trình',
    definitionVersion: 1,
    status: 'running',
    currentStepId: 's-1',
    initiatedBy: 'nv',
    startedAt: '2026-11-27T08:00:00.000Z',
    steps: [
      {
        id: 's-1',
        definitionStepId: 'ds-1',
        key: 'DUYET',
        order: 1,
        name: 'Duyệt',
        status: 'ready',
        currentRoleStage: 'A',
        assignments: [{ id: 'a-1', role: 'A', subjectType: 'user', subjectId: 'ql' }],
      },
    ],
    activity: [],
    ...overrides,
  };
}

const authorization = (overrides: Partial<ProcedureRuntimeAuthorization> = {}): ProcedureRuntimeAuthorization => ({
  myRoles: ['A'],
  currentRoleStage: 'A',
  availableActions: ['comment', 'approve', 'reject', 'return'],
  canManageSubtasks: false,
  isOverride: false,
  ...overrides,
});

describe('Thao tác hàng loạt', () => {
  it('quy trình chưa bật thì không cho (mặc định an toàn)', () => {
    expect(definitionAllowsBulkAction(undefined, 'approve')).toBe(false);
    expect(definitionAllowsBulkAction({}, 'approve')).toBe(false);
    expect(definitionAllowsBulkAction({ bulkActions: { approve: true } }, 'approve')).toBe(true);
    expect(definitionAllowsBulkAction({ bulkActions: { approve: true } }, 'reject')).toBe(false);
  });

  it('duyệt: approve khi pha có, complete ở pha thực hiện; không tới lượt thì bỏ qua', () => {
    expect(procedureBulkPlan(instance(), authorization(), 'approve')).toEqual({ ok: true, runtimeAction: 'approve' });
    expect(
      procedureBulkPlan(
        instance(),
        authorization({ myRoles: ['R'], currentRoleStage: 'R', availableActions: ['comment', 'complete'] }),
        'approve',
      ),
    ).toEqual({ ok: true, runtimeAction: 'complete' });
    // Quản trị chỉ có quyền can thiệp, không giữ vai của pha: không tính là tới lượt.
    expect(
      procedureBulkPlan(instance(), authorization({ myRoles: [], isOverride: true }), 'approve'),
    ).toMatchObject({ ok: false, reason: 'not_your_turn' });
    expect(procedureBulkPlan(instance({ status: 'completed' }), authorization(), 'approve')).toMatchObject({
      ok: false,
      reason: 'not_running',
    });
  });

  it('không duyệt: chỉ khi pha có thao tác từ chối, pha Xem xét (R) thì không', () => {
    expect(procedureBulkPlan(instance(), authorization(), 'reject')).toEqual({ ok: true, runtimeAction: 'reject' });
    expect(
      procedureBulkPlan(
        instance(),
        authorization({ myRoles: ['R'], currentRoleStage: 'R', availableActions: ['comment', 'complete', 'reject'] }),
        'reject',
      ),
    ).toMatchObject({ ok: false, reason: 'not_your_turn' });
  });

  it('bước cần nhập / làm thêm thì bỏ qua với lý do', () => {
    const finance = instance();
    finance.steps[0].integration = { module: 'finance', voucherKind: 'PAYMENT' } as never;
    expect(
      procedureBulkPlan(finance, authorization({ availableActions: ['comment', 'reject'] }), 'approve'),
    ).toMatchObject({ ok: false, reason: 'input_required', message: expect.stringContaining('Tài chính') });

    const withInput = instance({
      flow: { gateways: [], attributes: [{ id: 'x', code: 'y_kien', name: 'Ý kiến', type: 'text', required: true }] },
    });
    expect(procedureBulkInputBlocker(withInput, authorization({ editableAttributeKeys: ['process:y_kien'] }))).toBe(
      'Cần nhập: Ý kiến',
    );

    const short = instance();
    short.steps[0].materials = [{ materialCode: 'M', quantity: 1 }];
    short.steps[0].materialCheck = { state: 'short' } as never;
    expect(procedureBulkInputBlocker(short, authorization())).toBe('Thiếu vật tư cho bước này');

    const open = instance({
      subtasks: [{ id: 't', stepInstanceId: 's-1', status: 'open' } as never],
    });
    expect(procedureBulkInputBlocker(open, authorization())).toBe('Còn đầu việc chưa xong');

    const asset = instance();
    asset.steps[0].assignments.push({ id: 'e', role: 'E', subjectType: 'user', subjectId: 'kt', eTaskSource: 'inventory_asset' });
    expect(procedureBulkInputBlocker(asset, authorization({ currentRoleStage: 'E' }))).toBe('Cần chọn thiết bị cho hồ sơ');
    expect(procedureBulkInputBlocker({ ...asset, assetCode: 'MAY-1' }, authorization({ currentRoleStage: 'E' }))).toBe(
      'Cần phân rã công việc (WBS) của bước',
    );
  });
});
