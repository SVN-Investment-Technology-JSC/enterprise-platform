import { PostgresNotificationScheduleSource } from './notification-schedule-source';

describe('notification schedule source', () => {
  it('expands recurring calendar reminders in the event timezone and skips declined participants and cancelled occurrences', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ workspace: true, calendar: true, procedure: false, maintenance: false, inventory: false }] };
      if (sql.includes('calendar_event_exceptions')) return { rows: [{ series_id: 'series-a', occurrence_date: '2026-10-03' }] };
      if (sql.includes('calendar_events')) return { rows: [{
        id: 'event-a', series_id: 'series-a', title: 'Daily standup',
        start_at: new Date('2026-10-01T02:00:00Z'), end_at: new Date('2026-10-01T03:00:00Z'),
        timezone: 'Asia/Ho_Chi_Minh', recurrence_rule: 'FREQ=DAILY', recurrence_count: 5,
        recurrence_until: null, participant_user_ids: ['user-a'],
      }] };
      return { rows: [] };
    });
    const source = new PostgresNotificationScheduleSource({ query } as never);
    const secondDay = await source.candidates(new Date('2026-10-02T01:50:00Z'));
    expect(secondDay).toEqual([expect.objectContaining({
      eventType: 'workspace.calendar-event.reminder', userId: 'user-a',
      scheduledFor: '2026-10-02T01:45:00.000Z',
      payload: expect.objectContaining({ startAt: '2026-10-02T02:00:00.000Z' }),
    })]);
    expect(await source.candidates(new Date('2026-10-03T01:50:00Z'))).toEqual([]);
    expect(query.mock.calls.some(([sql]) => sql.includes("response_status <> 'declined'"))).toBe(true);
  });

  it('maps task, SLA, maintenance and reservation deadlines to their policy payloads', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ workspace: true, calendar: false, procedure: true, maintenance: true, inventory: true }] };
      if (sql.includes('work_items')) return { rows: [{ id: 'task-a', title: 'Task', assignee_user_id: 'user-a', due_at: new Date('2026-10-02T17:00:00Z') }] };
      if (sql.includes('procedure_schema.instances')) return { rows: [{ snapshot: {
        id: 'instance-a', title: 'Approval', currentStepId: 'step-a', steps: [{ id: 'step-a', slaDueAt: '2026-10-02T02:00:00Z', currentRoleStage: 'A', assignments: [{ subjectType: 'user', subjectId: 'user-b', role: 'A' }], resolutions: [] }],
      } }] };
      if (sql.includes('maintenance_schema.occurrences')) return { rows: [{ id: 'occurrence-a', title: 'Repair', due_at: new Date('2026-10-02T03:00:00Z'), assignee_id: 'user-c', created_by: 'user-d' }] };
      if (sql.includes('inventory_schema.reservations')) return { rows: [{ id: 'reservation-a', reservation_code: 'R001', expires_at: new Date('2026-10-02T04:00:00Z'), created_by: 'user-e' }] };
      return { rows: [] };
    });
    const candidates = await new PostgresNotificationScheduleSource({ query } as never).candidates(new Date('2026-10-02T01:00:00Z'));
    expect(candidates.map((item) => item.eventType)).toEqual(expect.arrayContaining([
      'workspace.work-item.due-soon', 'workspace.work-item.overdue', 'procedure.sla.warning',
      'procedure.sla.breached', 'maintenance.occurrence.due-soon', 'maintenance.occurrence.overdue', 'inventory.reservation.expiring',
    ]));
    expect(candidates.find((item) => item.eventType === 'procedure.sla.warning')?.userId).toBe('user-b');
    expect(candidates.find((item) => item.eventType === 'inventory.reservation.expiring')?.payload).toMatchObject({ sourceId: 'reservation-a' });
  });

  describe('nhắc hoạt động Bán hàng', () => {
    const activity = (overrides: Record<string, unknown> = {}) => ({
      id: 'activity-a', subject: 'Gọi lại khách', due_at: new Date('2026-10-02T03:00:00Z'),
      assignee_user_id: 'user-crm', customer_id: 'customer-a', opportunity_id: null, ...overrides,
    });
    const source = (rows: unknown[], setting?: unknown) => {
      const query = jest.fn(async (sql: string, ...params: unknown[]) => {
        void params;
        if (sql.includes('to_regclass')) return { rows: [{ workspace: false, calendar: false, procedure: false, maintenance: false, inventory: false, crm: true }] };
        if (sql.includes('crm_schema.settings')) return { rows: setting === undefined ? [] : [{ value: setting }] };
        if (sql.includes('crm_schema.activities')) return { rows };
        return { rows: [] };
      });
      return { query, source: new PostgresNotificationScheduleSource({ query } as never) };
    };

    it('TC-INT-09/10: nhắc trước 30 phút (mặc định) và đúng hạn cho người được giao', async () => {
      const { query, source: subject } = source([activity()]);
      const candidates = await subject.candidates(new Date('2026-10-02T02:30:00Z'));
      expect(candidates).toEqual([
        expect.objectContaining({
          eventType: 'crm.activity.due-soon', aggregateType: 'crm-activity', aggregateId: 'activity-a',
          userId: 'user-crm', scheduledFor: '2026-10-02T02:30:00.000Z', scheduleKey: 'crm:activity:activity-a:due-soon',
          payload: { activityId: 'activity-a', title: 'Gọi lại khách', customerId: 'customer-a', dueAt: '2026-10-02T03:00:00.000Z', assigneeUserId: 'user-crm' },
        }),
        expect.objectContaining({ eventType: 'crm.activity.overdue', scheduledFor: '2026-10-02T03:00:00.000Z' }),
      ]);
      const activityQuery = query.mock.calls.find(([sql]) => sql.includes('FROM crm_schema.activities'));
      // Chỉ hoạt động đang mở mới được nhắc (TC-ACT-05): hoàn tất, huỷ thì không quá hạn.
      expect(activityQuery?.[0]).toContain("status = 'OPEN'");
      expect(activityQuery?.[1]).toEqual([new Date('2026-10-02T02:30:00Z'), 30]);
    });

    it('đọc số phút nhắc từ cấu hình tenant; giá trị hỏng thì 30', async () => {
      const custom = await source([activity()], { leadMinutes: 120 }).source.candidates(new Date('2026-10-02T00:00:00Z'));
      expect(custom.find((item) => item.eventType === 'crm.activity.due-soon')?.scheduledFor).toBe('2026-10-02T01:00:00.000Z');
      const broken = await source([activity()], { leadMinutes: 'x' }).source.candidates(new Date('2026-10-02T00:00:00Z'));
      expect(broken.find((item) => item.eventType === 'crm.activity.due-soon')?.scheduledFor).toBe('2026-10-02T02:30:00.000Z');
    });

    it('TC-ACT-04: dời hạn thì thời điểm nhắc đổi theo hạn mới', async () => {
      const before = await source([activity()]).source.candidates(new Date('2026-10-02T00:00:00Z'));
      const after = await source([activity({ due_at: new Date('2026-10-03T03:00:00Z') })]).source.candidates(new Date('2026-10-02T00:00:00Z'));
      const at = (list: readonly { eventType: string; scheduledFor: string }[]) => list.find((item) => item.eventType === 'crm.activity.due-soon')?.scheduledFor;
      expect(at(before)).toBe('2026-10-02T02:30:00.000Z');
      expect(at(after)).toBe('2026-10-03T02:30:00.000Z');
    });

    it('Công việc và Bảo trì vẫn nhắc trước 24 giờ', async () => {
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('to_regclass')) return { rows: [{ workspace: true, calendar: false, procedure: false, maintenance: true, inventory: false, crm: false }] };
        if (sql.includes('work_items')) return { rows: [{ id: 'task-a', title: 'Task', assignee_user_id: 'user-a', project_id: 'p1', due_at: new Date('2026-10-03T00:00:00Z') }] };
        if (sql.includes('maintenance_schema.occurrences')) return { rows: [{ id: 'occ-a', title: 'Repair', due_at: new Date('2026-10-03T00:00:00Z'), assignee_id: 'user-c' }] };
        return { rows: [] };
      });
      const candidates = await new PostgresNotificationScheduleSource({ query } as never).candidates(new Date('2026-10-02T00:00:00Z'));
      expect(candidates.filter((item) => item.eventType.endsWith('due-soon')).map((item) => item.scheduledFor)).toEqual([
        '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z',
      ]);
      expect(candidates.find((item) => item.eventType === 'workspace.work-item.due-soon')?.payload).toEqual({
        workItemId: 'task-a', title: 'Task', projectId: 'p1', dueAt: '2026-10-03T00:00:00.000Z', assigneeUserId: 'user-a',
      });
      expect(query.mock.calls.some(([sql]) => sql.includes('FROM crm_schema'))).toBe(false);
    });
  });

  describe('hợp đồng Bán hàng sắp hết hạn', () => {
    const source = (rows: unknown[], setting?: unknown) => {
      const query = jest.fn(async (sql: string, ...params: unknown[]) => {
        void params;
        if (sql.includes('to_regclass')) {
          return { rows: [{ workspace: false, calendar: false, procedure: false, maintenance: false, inventory: false, crm: false, crm_contracts: true }] };
        }
        if (sql.includes("key = 'contract.expiring'")) return { rows: setting === undefined ? [] : [{ value: setting }] };
        if (sql.includes('FROM crm_schema.contracts')) return { rows };
        return { rows: [] };
      });
      return { query, source: new PostgresNotificationScheduleSource({ query } as never) };
    };

    it('TC-CON-09: báo người phụ trách từ đầu ngày còn đúng 30 ngày (mặc định), chỉ xét hợp đồng hết hạn trong 30 ngày', async () => {
      const { query, source: subject } = source([
        { id: 'contract-a', code: 'HD2600001', title: 'Khung 2026', valid_to: '2026-11-26', owner_user_id: 'user-owner', days_left: 30 },
      ]);
      const candidates = await subject.candidates(new Date('2026-10-27T03:00:00Z'));
      expect(candidates).toEqual([
        expect.objectContaining({
          eventType: 'crm.contract.expiring', userId: 'user-owner', aggregateType: 'crm-contract', aggregateId: 'contract-a',
          scheduleKey: 'crm:contract:contract-a:expiring:2026-11-26', scheduledFor: '2026-10-26T17:00:00.000Z',
          payload: expect.objectContaining({ contractId: 'contract-a', endDate: '2026-11-26', ownerUserId: 'user-owner', daysLeft: 30 }),
        }),
      ]);
      const contractQuery = query.mock.calls.find(([sql]) => sql.includes('FROM crm_schema.contracts'));
      expect(contractQuery?.[0]).toContain("status = 'ACTIVE'");
      // Cửa sổ là [hôm nay, hôm nay + 30]: hợp đồng còn 31 ngày nằm ngoài truy vấn.
      expect(contractQuery?.[1]).toEqual([new Date('2026-10-27T03:00:00Z'), 30, 'Asia/Ho_Chi_Minh']);
    });

    it('đọc số ngày từ cấu hình tenant; giá trị hỏng thì 30', async () => {
      const row = { id: 'c', code: 'HD1', title: 'T', valid_to: '2026-11-10', owner_user_id: 'u', days_left: 14 };
      const custom = source([row], { days: 15 });
      const [candidate] = await custom.source.candidates(new Date('2026-10-27T03:00:00Z'));
      expect(candidate.scheduledFor).toBe('2026-10-25T17:00:00.000Z');
      expect(custom.query.mock.calls.find(([sql]) => sql.includes('FROM crm_schema.contracts'))?.[1]).toEqual([
        new Date('2026-10-27T03:00:00Z'), 15, 'Asia/Ho_Chi_Minh',
      ]);
      const broken = source([row], { days: 'x' });
      await broken.source.candidates(new Date('2026-10-27T03:00:00Z'));
      expect((broken.query.mock.calls.find(([sql]) => sql.includes('FROM crm_schema.contracts'))?.[1] as unknown[] | undefined)?.[1]).toBe(30);
    });
  });
});
