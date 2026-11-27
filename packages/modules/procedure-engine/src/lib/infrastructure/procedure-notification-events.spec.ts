import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { procedureNotificationEvents } from './procedure-notification-events.js';

function instance(
  patch: Partial<ProcedureInstance> = {},
): ProcedureInstance {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    code: 'QT-001',
    title: 'Đề nghị mua sắm',
    definitionId: '50000000-0000-4000-8000-000000000002',
    definitionCode: 'MUA-SAM',
    definitionName: 'Mua sắm',
    definitionVersion: 1,
    status: 'running',
    currentStepId: '50000000-0000-4000-8000-000000000003',
    initiatedBy: '50000000-0000-4000-8000-000000000004',
    startedAt: '2026-10-01T08:00:00.000Z',
    steps: [
      {
        id: '50000000-0000-4000-8000-000000000003',
        definitionStepId: '50000000-0000-4000-8000-000000000005',
        key: 'approve',
        order: 1,
        name: 'Phê duyệt',
        status: 'active',
        currentRoleStage: 'A',
        assignments: [
          {
            id: '50000000-0000-4000-8000-000000000006',
            role: 'A',
            subjectType: 'user',
            subjectId: '50000000-0000-4000-8000-000000000007',
          },
        ],
        startedAt: '2026-10-01T08:00:00.000Z',
        slaHours: 2,
        slaDueAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    activity: [],
    ...patch,
  };
}

describe('procedureNotificationEvents', () => {
  it('emits an assignment carrying organization roles when the step is held by a unit or position', () => {
    const base = instance();
    const orgInstance = instance({
      steps: [
        {
          ...base.steps[0],
          currentRoleStage: 'A',
          assignments: [
            { id: 'a1', role: 'A', subjectType: 'organization_unit', subjectId: 'unit-1' },
            { id: 'a2', role: 'A', subjectType: 'position', subjectId: 'position-1' },
            { id: 'a3', role: 'R', subjectType: 'organization_unit', subjectId: 'unit-2' },
            { id: 'a4', role: 'S', subjectType: 'organization_unit', subjectId: 'unit-3' },
          ],
        },
      ],
    });

    const [event] = procedureNotificationEvents([], [orgInstance]);

    expect(event.type).toBe('procedure.assignment.created');
    expect(event.payload).toEqual(
      expect.objectContaining({
        assigneeUserIds: [],
        // Chỉ các vai đang đến lượt (A); vai R chưa tới lượt, vai S (người khởi tạo) không cần báo.
        assignments: [
          { subjectType: 'organization_unit', subjectId: 'unit-1', role: 'A' },
          { subjectType: 'position', subjectId: 'position-1', role: 'A' },
        ],
      }),
    );
  });

  it('emits an assignment when a running instance enters a new current step', () => {
    const events = procedureNotificationEvents([], [instance()]);

    expect(events).toContainEqual({
      type: 'procedure.assignment.created',
      aggregateType: 'procedure-instance',
      aggregateId: '50000000-0000-4000-8000-000000000001',
      payload: expect.objectContaining({
        instanceId: '50000000-0000-4000-8000-000000000001',
        stepInstanceId: '50000000-0000-4000-8000-000000000003',
        assigneeUserIds: ['50000000-0000-4000-8000-000000000007'],
      }),
    });
  });

  describe('báo người tạo mỗi lần hồ sơ được xử lý ở một bước', () => {
    const REQUESTER = '50000000-0000-4000-8000-000000000004';
    const NEXT_ASSIGNEE = '50000000-0000-4000-8000-000000000009';
    const PROCESSED = 'procedure.step.processed';
    const processed = (before: ProcedureInstance, after: ProcedureInstance) =>
      procedureNotificationEvents([before], [after]).filter((e) => e.type === PROCESSED);
    const entry = (patch: Partial<ProcedureInstance['activity'][number]>) =>
      ({
        id: 'act-1',
        action: 'approve',
        actorId: 'checker',
        actorName: 'Kế toán',
        summary: '',
        createdAt: '2026-10-01T08:30:00.000Z',
        stepInstanceId: 'step-1',
        ...patch,
      }) as ProcedureInstance['activity'][number];
    const step = (patch: Partial<ProcedureInstance['steps'][number]>): ProcedureInstance['steps'][number] => ({
      id: 'step-1',
      definitionStepId: 'd1',
      key: 'k',
      order: 1,
      name: 'Kế toán kiểm tra',
      status: 'active',
      currentRoleStage: 'R',
      assignments: [
        { id: 'a', role: 'R', subjectType: 'user', subjectId: 'checker' },
        { id: 'c', role: 'A', subjectType: 'user', subjectId: 'chief' },
      ],
      ...patch,
    });
    const second = (patch: Partial<ProcedureInstance['steps'][number]> = {}) =>
      step({
        id: 'step-2',
        order: 2,
        name: 'Giám đốc duyệt',
        status: 'pending',
        assignments: [{ id: 'b', role: 'A', subjectType: 'user', subjectId: NEXT_ASSIGNEE }],
        currentRoleStage: 'A',
        ...patch,
      });
    /** Hồ sơ trước và sau khi Kế toán xong bước 1 và hồ sơ sang bước 2. */
    const advance = (over: Partial<ProcedureInstance> = {}) => {
      const before = instance({ currentStepId: 'step-1', steps: [step({ status: 'active' }), second()] });
      const after = instance({
        currentStepId: 'step-2',
        steps: [step({ status: 'completed' }), second({ status: 'active' })],
        activity: [entry({})],
        ...over,
      });
      return { before, after };
    };
    /** Kế toán xong pha R, hồ sơ vẫn ở bước 1 nhưng chuyển sang pha A của Kế toán trưởng. */
    const phaseChange = (over: Partial<ProcedureInstance> = {}) => {
      const before = instance({ currentStepId: 'step-1', steps: [step({ status: 'active' }), second()] });
      const after = instance({
        currentStepId: 'step-1',
        steps: [step({ status: 'ready', currentRoleStage: 'A' }), second()],
        activity: [entry({ action: 'complete' })],
        ...over,
      });
      return { before, after };
    };

    it('xong cả bước, hồ sơ còn chạy: báo người tạo, nêu bước kế tiếp và người xử lý', () => {
      const { before, after } = advance();
      const events = processed(before, after);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual(
        expect.objectContaining({
          instanceCode: 'QT-001',
          kind: 'step',
          stepName: 'Kế toán kiểm tra',
          currentStepName: 'Giám đốc duyệt',
          actorName: 'Kế toán',
          recipientUserIds: [REQUESTER],
          actorUserId: 'checker',
        }),
      );
    });

    it('xong một pha, hồ sơ chuyển sang pha duyệt của cùng bước: vẫn báo người tạo', () => {
      const { before, after } = phaseChange();
      const events = processed(before, after);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual(
        expect.objectContaining({
          kind: 'stage',
          stepName: 'Kế toán kiểm tra',
          currentStepName: 'Kế toán kiểm tra',
          waiting: 'duyệt',
          recipientUserIds: [REQUESTER],
        }),
      );
    });

    it('xong pha xem xét trong cùng bước: báo NGAY người giữ pha kế (Kế toán trưởng) là tới lượt họ', () => {
      const { before, after } = phaseChange();
      expect(procedureNotificationEvents([before], [after])).toContainEqual(
        expect.objectContaining({
          type: 'procedure.assignment.created',
          payload: expect.objectContaining({ stepInstanceId: 'step-1', assigneeUserIds: ['chief'] }),
        }),
      );
    });

    it('pha kế trong cùng bước giao cho chức danh / đơn vị: gửi kèm để worker giải ra người', () => {
      const { before, after } = phaseChange();
      after.steps[0].assignments = [
        { id: 'a', role: 'R', subjectType: 'user', subjectId: 'checker' },
        { id: 'c', role: 'A', subjectType: 'position', subjectId: 'chief-accountant' },
      ];
      expect(procedureNotificationEvents([before], [after])).toContainEqual(
        expect.objectContaining({
          type: 'procedure.assignment.created',
          payload: expect.objectContaining({
            assigneeUserIds: [],
            assignments: [{ subjectType: 'position', subjectId: 'chief-accountant', role: 'A' }],
          }),
        }),
      );
    });

    it('người tạo cũng là người giữ pha kế trong cùng bước: nhận thông báo tới lượt, không báo trùng "vừa được xử lý"', () => {
      const { before, after } = phaseChange();
      after.steps[0].assignments = [{ id: 'c', role: 'A', subjectType: 'user', subjectId: REQUESTER }];
      expect(processed(before, after)).toHaveLength(0);
      expect(procedureNotificationEvents([before], [after])).toContainEqual(
        expect.objectContaining({
          type: 'procedure.assignment.created',
          payload: expect.objectContaining({ assigneeUserIds: [REQUESTER] }),
        }),
      );
    });

    it('lưu lại hồ sơ cùng bước, cùng pha thì không báo giao việc lại', () => {
      const { after } = phaseChange();
      expect(procedureNotificationEvents([after], [after]).map((e) => e.type)).not.toContain('procedure.assignment.created');
    });

    it('hồ sơ bị trả lại: báo người tạo, nêu bước được trả về', () => {
      const before = instance({ currentStepId: 'step-2', steps: [step({ status: 'completed' }), second({ status: 'active' })] });
      const after = instance({
        currentStepId: 'step-1',
        steps: [step({ status: 'active' }), second({ status: 'returned' })],
        activity: [entry({ action: 'return', actorId: 'boss', actorName: 'Giám đốc', stepInstanceId: 'step-2' })],
      });
      const [event] = processed(before, after);
      expect(event.payload).toEqual(
        expect.objectContaining({ kind: 'return', currentStepName: 'Kế toán kiểm tra', actorName: 'Giám đốc' }),
      );
    });

    it('hoàn duyệt: báo người tạo bước được mở lại', () => {
      const before = instance({ currentStepId: 'step-2', steps: [step({ status: 'completed' }), second({ status: 'active' })] });
      const after = instance({
        currentStepId: 'step-1',
        steps: [step({ status: 'ready', currentRoleStage: 'A' }), second()],
        activity: [entry({ action: 'withdraw' })],
      });
      const [event] = processed(before, after);
      expect(event.payload).toEqual(expect.objectContaining({ kind: 'withdraw', stepName: 'Kế toán kiểm tra' }));
    });

    it('người nhận bước kế vẫn được báo bước mới như cũ', () => {
      const { before, after } = advance();
      expect(procedureNotificationEvents([before], [after])).toContainEqual(
        expect.objectContaining({
          type: 'procedure.assignment.created',
          payload: expect.objectContaining({ assigneeUserIds: [NEXT_ASSIGNEE] }),
        }),
      );
    });

    it('người tạo hộ cũng được báo, không trùng người', () => {
      const { before, after } = advance({ createdOnBehalfBy: { userId: 'proxy', name: 'Thư ký' } });
      const [event] = processed(before, after);
      expect(event.payload['recipientUserIds']).toEqual([REQUESTER, 'proxy']);
    });

    it('người tạo là người xử lý bước kế (đã nhận "bước mới") thì không báo trùng', () => {
      const { before, after } = advance();
      after.steps[1].assignments = [{ id: 'b', role: 'A', subjectType: 'user', subjectId: REQUESTER }];
      expect(processed(before, after)).toHaveLength(0);
    });

    it('người tạo tự xử lý thì không tự báo cho mình', () => {
      const { before, after } = advance({ activity: [entry({ actorId: REQUESTER })] });
      expect(processed(before, after)).toHaveLength(0);
    });

    it('bước cuối (hồ sơ kết thúc) chỉ có thông báo kết thúc, không báo thêm theo bước', () => {
      const { before, after } = advance();
      const done = { ...after, status: 'completed' as const, currentStepId: undefined, completedAt: '2026-10-01T09:00:00.000Z' };
      const types = procedureNotificationEvents([before], [done]).map((e) => e.type);
      expect(types).toContain('procedure.instance.completed');
      expect(types).not.toContain(PROCESSED);
    });

    it('trao đổi không phải xử lý: không báo', () => {
      const { before, after } = advance({ activity: [entry({ action: 'comment' })] });
      expect(processed(before, after)).toHaveLength(0);
    });

    it('lưu lại hồ sơ không đổi thì không báo lại', () => {
      const { after } = advance();
      expect(processed(after, after)).toHaveLength(0);
    });
  });


  it('routes a terminal result back to the initiator', () => {
    const before = instance();
    const after = instance({
      status: 'completed',
      currentStepId: undefined,
      completedAt: '2026-10-01T09:00:00.000Z',
    });

    expect(procedureNotificationEvents([before], [after])).toContainEqual({
      type: 'procedure.instance.completed',
      aggregateType: 'procedure-instance',
      aggregateId: after.id,
      payload: expect.objectContaining({
        requesterUserId: before.initiatedBy,
        status: 'completed',
      }),
    });
  });
  it('emits reversed and adjustment-requested events for the S holders when an instance is reversed', () => {
    const base = instance();
    const done = instance({
      status: 'completed',
      currentStepId: undefined,
      sourceType: 'manual',
      steps: [
        {
          ...base.steps[0],
          status: 'completed',
          assignments: [
            ...base.steps[0].assignments,
            { id: 's1', role: 'S', subjectType: 'user', subjectId: 'user-s' },
            { id: 's2', role: 'S', subjectType: 'position', subjectId: 'position-s' },
          ],
        },
      ],
    });
    const reversed: ProcedureInstance = {
      ...done,
      status: 'reversed',
      reversal: {
        reversedAt: '2026-10-09T08:00:00.000Z',
        reversedBy: 'admin',
        reversedByName: 'Quản trị',
        reason: 'Sai số ngày',
        adjustmentRequested: true,
      },
    };

    const events = procedureNotificationEvents([done], [reversed]);
    expect(events.map((event) => event.type)).toEqual([
      'procedure.instance.reversed',
      'procedure.instance.adjustment_requested',
    ]);
    expect(events[0].payload).toEqual(
      expect.objectContaining({ sourceType: 'manual', reason: 'Sai số ngày' }),
    );
    expect(events[1].payload).toEqual(
      expect.objectContaining({
        assigneeUserIds: ['user-s'],
        assignments: [{ subjectType: 'position', subjectId: 'position-s', role: 'S' }],
        launchUrl: `/modules/procedure?adjustFrom=${done.id}#workspace`,
      }),
    );

    // Không tạo lại sự kiện khi trạng thái không đổi.
    expect(procedureNotificationEvents([reversed], [reversed])).toEqual([]);

    // Đơn HRM: chỉ báo huỷ hiệu lực; HRM tự mời người gửi đơn lập đơn mới.
    const hrmDone = { ...done, sourceType: 'hrm_request' as const, sourceId: 'link-1' };
    expect(
      procedureNotificationEvents([hrmDone], [{ ...reversed, sourceType: 'hrm_request', sourceId: 'link-1' }]).map(
        (event) => event.type,
      ),
    ).toEqual(['procedure.instance.reversed']);
  });
});

describe('procedureMentionEvents (thông báo "bạn được nhắc")', () => {
  const activity = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    action: 'comment' as const,
    actorId: 'user-actor',
    actorName: 'Đậu Bá Kiên',
    summary: 'Đã gửi trao đổi.',
    comment: 'Nhờ @Tài Búa xem giúp',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  });
  const mentionEvents = (before: ProcedureInstance, after: ProcedureInstance) =>
    procedureNotificationEvents([before], [after]).filter(
      (event) => event.type === 'procedure.mention.created',
    );

  it('báo từng người được nhắc, kèm tên người gửi, mã hồ sơ và đường dẫn mở hồ sơ', () => {
    const after = instance({ activity: [activity('c1', { mentions: ['user-b', 'user-c'] })] });
    expect(mentionEvents(instance(), after)).toEqual([
      {
        type: 'procedure.mention.created',
        aggregateType: 'procedure-instance',
        aggregateId: after.id,
        payload: {
          mentionId: 'c1',
          threadId: after.id,
          instanceId: after.id,
          instanceCode: 'QT-001',
          mentionedUserIds: ['user-b', 'user-c'],
          actorUserId: 'user-actor',
          excerpt: 'Đậu Bá Kiên · QT-001: Nhờ @Tài Búa xem giúp',
          deepLink: `/procedures/instances/${after.id}`,
          sourceType: 'procedure_comment',
        },
      },
    ]);
  });

  it('không báo cho chính người gửi, và không phát gì khi chỉ nhắc chính mình', () => {
    const after = instance({ activity: [activity('c1', { mentions: ['user-actor', 'user-b'] })] });
    const [event] = mentionEvents(instance(), after);
    expect(event.payload.mentionedUserIds).toEqual(['user-b']);

    const self = instance({ activity: [activity('c2', { mentions: ['user-actor'] })] });
    expect(mentionEvents(instance(), self)).toEqual([]);
  });

  it('chỉ báo trao đổi MỚI: ghi lại hồ sơ không báo lại lần nhắc cũ', () => {
    const old = instance({ activity: [activity('c1', { mentions: ['user-b'] })] });
    expect(mentionEvents(old, old)).toEqual([]);
  });

  it('không báo khi trao đổi không nhắc ai, hoặc khi mục không phải trao đổi', () => {
    const plain = instance({ activity: [activity('c1')] });
    const approve = instance({
      activity: [activity('a1', { action: 'approve', mentions: ['user-b'] })],
    });
    expect(mentionEvents(instance(), plain)).toEqual([]);
    expect(mentionEvents(instance(), approve)).toEqual([]);
  });

  it('cắt người nhận ở giới hạn và cắt trích đoạn ở 160 ký tự', () => {
    const mentions = Array.from({ length: 30 }, (_, i) => `user-${i}`);
    const after = instance({ activity: [activity('c1', { mentions, comment: 'x'.repeat(500) })] });
    const [event] = mentionEvents(instance(), after);
    expect(event.payload.mentionedUserIds as string[]).toHaveLength(20);
    expect((event.payload.excerpt as string).length).toBe(160);
  });
});
