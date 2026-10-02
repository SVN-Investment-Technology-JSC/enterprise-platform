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
});
