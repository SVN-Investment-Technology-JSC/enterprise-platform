import {
  buildMatrixCsvRows,
  timesheetMatrixCell,
} from './matrix-timesheet-cell';

describe('timesheetMatrixCell', () => {
  it('never fabricates check-in/out times', () => {
    const cell = timesheetMatrixCell({ id: 't1', status: 'NORMAL', workedMinutes: 480, workdayUnits: 1 });
    expect(cell.inTime).toBe('—');
    expect(cell.outTime).toBe('—');
    expect(cell.symbol).toBe('CC');
    expect(cell.recordedDay).toBe(1);
    expect(cell.workHours).toBe(8);
  });

  it('maps each timesheet status to a symbol', () => {
    const symbol = (status: string) => timesheetMatrixCell({ id: 'x', status }).symbol;
    expect(symbol('LEAVE')).toBe('P');
    expect(symbol('HOLIDAY')).toBe('L');
    expect(symbol('BUSINESS_TRIP')).toBe('CT');
    expect(symbol('ABNORMAL')).toBe('BT');
    expect(symbol('ABSENT')).toBe('V');
    expect(symbol('OFF')).toBe('OFF');
    expect(symbol('ADJUSTED')).toBe('CC');
    expect(symbol('UNKNOWN')).toBe('—');
    expect(timesheetMatrixCell({ id: 'x', status: 'ADJUSTED' }).isAdjusted).toBe(true);
    expect(timesheetMatrixCell({ id: 'x', status: 'LEAVE' }).isLeave).toBe(true);
  });

  it('shows an empty cell for missing data without concluding absence', () => {
    expect(timesheetMatrixCell(undefined).symbol).toBe('—');
    expect(timesheetMatrixCell(undefined).recordedDay).toBe(0);
    expect(timesheetMatrixCell(undefined, true).badgeText).toBe('Chưa tới ngày');
  });
});

describe('buildMatrixCsvRows', () => {
  it('exports exactly the displayed cells and totals', () => {
    const cells = [
      [
        timesheetMatrixCell({ id: 'a', status: 'NORMAL', workedMinutes: 480, workdayUnits: 1 }),
        timesheetMatrixCell(undefined),
      ],
    ];
    const rows = buildMatrixCsvRows({
      employees: [{ employeeCode: 'NV001', fullName: 'An', department: null, position: 'NV' }],
      days: [
        { dayNumber: '01', dayName: 'T5' },
        { dayNumber: '02', dayName: 'T6' },
      ],
      cellFor: (e, d) => cells[e][d],
      totalLabels: ['Giờ công', 'Số công'],
    });
    expect(rows[0]).toEqual(['STT', 'Mã NV', 'Họ và tên', 'Phòng ban', 'Vị trí', '01 (T5)', '02 (T6)', 'Giờ công', 'Số công']);
    expect(rows[1]).toEqual([1, 'NV001', 'An', '', 'NV', 'CC', '', 8, 1]);
  });
});
