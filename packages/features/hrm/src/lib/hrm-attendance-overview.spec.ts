import { attendanceOverviewCell } from './hrm-attendance-overview';

describe('attendance overview does not invent payable work', () => {
  it('keeps an unrecorded day unknown, including weekends and pre-employment dates', () => {
    expect(attendanceOverviewCell(undefined, undefined).symbol).toBe('—');
    expect(attendanceOverviewCell(undefined, undefined).workHours).toBe(0);
  });
  it('preserves zero minutes and never treats a punch as one paid workday', () => {
    const cell = attendanceOverviewCell(
      {
        id: 'raw',
        status: 'OPEN',
        checkInAt: '2026-09-27T01:00:00Z',
        workedMinutes: 0,
      },
      undefined,
    );
    expect(cell.workHours).toBe(0);
    expect(cell.recordedDay).toBe(1);
    expect(cell.symbol).toBe('CC');
  });
  it('shows pending leave as pending and does not fabricate eight paid hours', () => {
    const pending = attendanceOverviewCell(undefined, {
      status: 'PENDING',
      isPaid: true,
    });
    expect(pending.symbol).toBe('Chờ');
    expect(pending.workHours).toBe(0);
    const approved = attendanceOverviewCell(undefined, {
      status: 'APPROVED',
      isPaid: true,
    });
    expect(approved.symbol).toBe('P');
    expect(approved.workHours).toBe(0);
    expect(approved.recordedDay).toBe(0);
  });
});
