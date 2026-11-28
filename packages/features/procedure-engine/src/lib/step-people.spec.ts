import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { overviewWaitingLabel, overviewWaitingTitle } from './procedure-overview';
import { currentWaiting, peopleSummary, stagePeople, stepStageProgress } from './step-people';

const POSITIONS = [
  'Trưởng Văn phòng Đại diện',
  'Trưởng phòng Hành chính - Tổng hợp',
  'Chánh Văn phòng',
  'Chủ tịch HĐQT',
  'Tổng Giám đốc',
];

function instance(stage: 'S' | 'A', overrides: Record<string, unknown> = {}): ProcedureInstance {
  return {
    id: 'i-1',
    status: 'running',
    currentStepId: 's-1',
    activity: [{ id: 'a-1', action: 'start', actorId: 'u-1', actorName: 'Hồ Thọ', createdAt: '2026-11-01T00:00:00.000Z' }],
    authorization: { myRoles: [], currentRoleStage: stage, availableActions: [], isOverride: false, canManageSubtasks: false },
    steps: [
      {
        id: 's-1',
        definitionStepId: 'd-1',
        order: 1,
        name: 'Chuẩn bị hồ sơ thanh toán',
        status: 'active',
        currentRoleStage: stage,
        assignments: POSITIONS.map((label, index) => ({
          id: `as-${index}`,
          role: stage,
          subjectType: 'position',
          subjectId: `pos-${index}`,
          subjectLabel: label,
        })),
      },
    ],
    ...overrides,
  } as unknown as ProcedureInstance;
}

describe('Ai đang xử lý (hiển thị)', () => {
  it('pha S: hồ sơ đã có người mở thì hiện người đó, không hiện danh sách chức danh được phép lập', () => {
    expect(currentWaiting(instance('S'))).toEqual({ text: 'Hồ Thọ', title: 'Hồ Thọ' });
    // Nhãn "Chờ …" của bảng hồ sơ dùng cùng luật.
    expect(overviewWaitingLabel(instance('S'))).toBe('Chờ Hồ Thọ');
  });

  it('chỉ có chức danh: tối đa 2 nhãn rồi "+N", đủ danh sách ở gợi ý', () => {
    expect(currentWaiting(instance('A'))).toEqual({
      text: 'Trưởng Văn phòng Đại diện, Trưởng phòng Hành chính - Tổng hợp +3',
      title: POSITIONS.join(', '),
    });
    expect(overviewWaitingLabel(instance('A'))).toBe('Chờ Trưởng Văn phòng Đại diện, Trưởng phòng Hành chính - Tổng hợp +3');
    expect(overviewWaitingTitle(instance('A'))).toBe(`Chờ ${POSITIONS.join(', ')}`);
  });

  it('phân giải được thì hiện tên người đang giữ chức danh và người nhận uỷ quyền', () => {
    const resolve = (id: string) =>
      id === 'pos-0'
        ? { title: POSITIONS[0] as string, people: ['Nguyễn Văn A'] }
        : id === 'u-9'
          ? { title: 'Trần Thị B' }
          : undefined;
    const delegated = instance('A', {
      delegations: [
        { id: 'd-1', stepInstanceId: 's-1', delegatedBy: 'u-2', delegatedByName: 'X', delegatedTo: 'u-9', roles: ['A'], createdAt: '' },
        { id: 'd-2', stepInstanceId: 's-other', delegatedBy: 'u-2', delegatedByName: 'X', delegatedTo: 'u-8', roles: ['A'], createdAt: '' },
      ],
    });
    const step = delegated.steps[0];
    if (!step) throw new Error('thiếu bước');
    expect(stagePeople(delegated, step, 'A', resolve)).toEqual(['Nguyễn Văn A', ...POSITIONS.slice(1), 'Trần Thị B']);
  });

  it('hồ sơ chưa ai mở (không có thao tác khởi tạo) thì pha S vẫn theo phân công; bước Tài chính và hồ sơ đã đóng giữ như cũ', () => {
    expect(currentWaiting(instance('S', { activity: [] }))?.text).toBe(
      'Trưởng Văn phòng Đại diện, Trưởng phòng Hành chính - Tổng hợp +3',
    );
    const finance = instance('A');
    (finance.steps[0] as { integration?: unknown }).integration = { module: 'finance', action: 'voucher' };
    expect(overviewWaitingLabel(finance)).toBe('Chờ Tài chính');
    expect(overviewWaitingLabel(instance('A', { status: 'completed' }))).toBe('Hoàn thành');
    expect(peopleSummary(['A', 'B'])).toEqual({ text: 'A, B', title: 'A, B', more: 0 });
  });
});

describe('tiến độ từng người trong một bước (vai R rồi vai A)', () => {
  const assignments = [
    { id: 'as-r', role: 'R', subjectType: 'user', subjectId: 'u-lan', subjectLabel: 'Trần Thị Lan' },
    { id: 'as-a', role: 'A', subjectType: 'position', subjectId: 'pos-kt', subjectLabel: 'Kế toán trưởng' },
    { id: 'as-i', role: 'I', subjectType: 'user', subjectId: 'u-xem', subjectLabel: 'Người theo dõi' },
  ];
  const entry = (id: string, action: string, actorId: string, actorName: string, createdAt: string, comment?: string) => ({
    id,
    action,
    actorId,
    actorName,
    summary: action,
    createdAt,
    stepInstanceId: 's-3',
    ...(comment ? { comment } : {}),
  });
  const reviewed = entry('a-2', 'complete', 'u-lan', 'Trần Thị Lan', '2026-11-02T02:00:00.000Z', 'Đã kiểm hồ sơ');
  // Nhật ký mới nhất ở đầu (server `unshift`).
  const make = (step: Record<string, unknown>, activity: unknown[], overrides: Record<string, unknown> = {}) => {
    const value = {
      id: 'i-1',
      status: 'running',
      currentStepId: 's-3',
      activity: [...activity, { id: 'a-1', action: 'start', actorId: 'u-1', actorName: 'Hồ Thọ', createdAt: '2026-11-01T00:00:00.000Z' }],
      ...overrides,
    } as unknown as ProcedureInstance;
    const fullStep = { id: 's-3', assignments, startedAt: '2026-11-02T00:00:00.000Z', ...step } as never;
    return stepStageProgress(value, fullStep);
  };

  it('R đã xem xét, A đang chờ: thấy ngay người xem xét đã xong phần mình (kèm thời gian, ý kiến)', () => {
    const result = make({ status: 'ready', currentRoleStage: 'A' }, [reviewed]);
    expect(result).toEqual([
      { role: 'R', status: 'done', names: ['Trần Thị Lan'], at: '2026-11-02T02:00:00.000Z', comment: 'Đã kiểm hồ sơ' },
      { role: 'A', status: 'waiting', names: ['Kế toán trưởng'] },
    ]);
  });

  it('R đã xem xét, A đã phê duyệt (bước xong)', () => {
    const approved = entry('a-3', 'approve', 'u-kt', 'Phạm Kế Toán', '2026-11-02T05:00:00.000Z');
    const result = make({ status: 'completed', currentRoleStage: 'A' }, [approved, reviewed], { currentStepId: 's-4' });
    expect(result.map((item) => [item.role, item.status, item.names[0], item.at])).toEqual([
      ['R', 'done', 'Trần Thị Lan', '2026-11-02T02:00:00.000Z'],
      ['A', 'done', 'Phạm Kế Toán', '2026-11-02T05:00:00.000Z'],
    ]);
  });

  it('A trả lại: R vẫn là đã xem xét, A là đã trả lại kèm lý do', () => {
    const returned = entry('a-3', 'return', 'u-kt', 'Phạm Kế Toán', '2026-11-02T05:00:00.000Z', 'Thiếu hoá đơn');
    const result = make({ status: 'returned', currentRoleStage: 'R', startedAt: undefined }, [returned, reviewed], {
      currentStepId: 's-2',
    });
    expect(result.map((item) => [item.role, item.status, item.comment])).toEqual([
      ['R', 'done', 'Đã kiểm hồ sơ'],
      ['A', 'returned', 'Thiếu hoá đơn'],
    ]);
  });

  it('bước mở lại sau khi bị trả về: chỉ tính lần chạy mới; hoàn duyệt mở lại pha vừa xong; người được uỷ quyền', () => {
    // Lần trước đã xem xét lúc 02:00; bước được mở lại lúc 06:00 nên chưa ai xử lý lần này.
    const again = make({ status: 'active', currentRoleStage: 'R', startedAt: '2026-11-02T06:00:00.000Z' }, [reviewed]);
    expect(again.map((item) => item.status)).toEqual(['waiting', 'pending']);
    // R xem xét rồi hoàn duyệt: pha R lại đang chờ.
    const withdrawn = entry('a-3', 'withdraw', 'u-lan', 'Trần Thị Lan', '2026-11-02T03:00:00.000Z');
    expect(make({ status: 'active', currentRoleStage: 'R' }, [withdrawn, reviewed]).map((item) => item.status)).toEqual([
      'waiting',
      'pending',
    ]);
    // Người nhận uỷ quyền vai R xử lý thay.
    const byDelegate = entry('a-2', 'complete', 'u-thu', 'Lê Văn Thu', '2026-11-02T02:00:00.000Z');
    const delegated = make({ status: 'ready', currentRoleStage: 'A' }, [byDelegate], {
      delegations: [{ id: 'd-1', delegatedBy: 'u-lan', delegatedByName: 'Trần Thị Lan', delegatedTo: 'u-thu', roles: ['R'], createdAt: '2026-11-02T01:00:00.000Z' }],
    });
    expect(delegated[0]).toMatchObject({ status: 'done', names: ['Lê Văn Thu'], delegatedBy: 'Trần Thị Lan' });
  });
});
