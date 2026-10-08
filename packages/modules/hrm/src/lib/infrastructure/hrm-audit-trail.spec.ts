import { auditActionLabel, auditFallback } from './hrm-audit-trail';

describe('audit trail labels', () => {
  it('uses Vietnamese labels and readable fallbacks for unknown actions', () => {
    expect(auditActionLabel('LEAVE_SUBMITTED')).toBe('Gửi đơn nghỉ');
    expect(auditActionLabel('ATTENDANCE_DEVICE_APPROVED')).toBe(
      'Duyệt thiết bị chấm công',
    );
    expect(auditActionLabel('BENEFIT_PLAN_CREATED')).toBe('Tạo benefit plan');
    expect(auditActionLabel('SOMETHING_ODD')).toBe('something odd');
  });

  it('describes a deleted record from its before snapshot', () => {
    expect(
      auditFallback('CALENDAR_DELETED', {
        before: { name: 'Tết Dương lịch', work_date: '2029-12-31T17:00:00.000Z' },
      }),
    ).toEqual({
      kind: 'Lịch làm việc',
      label: 'Tết Dương lịch · 01/01/2030 (đã xóa/không còn)',
    });
    expect(
      auditFallback('TIMESHEET_PERIOD_DELETED', {
        before: {
          period_code: 'KC-05',
          from_date: '2029-04-30T17:00:00.000Z',
          to_date: '2029-05-30T17:00:00.000Z',
        },
      }).label,
    ).toBe('KC-05 · 01/05/2029 - 31/05/2029 (đã xóa/không còn)');
    expect(auditFallback('LEAVE_SCHEDULE_EDIT', {}).kind).toBe('Lịch cộng phép');
    expect(auditFallback('UNKNOWN', null)).toEqual({ kind: null, label: null });
  });
});
