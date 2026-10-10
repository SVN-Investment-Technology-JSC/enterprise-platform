import { dashboardPlan, formatShiftWindow } from './hrm-dashboard-access';

describe('dashboardPlan', () => {
  it('nhan vien thuong chi goi endpoint tu phuc vu', () => {
    const plan = dashboardPlan([
      'hrm.read',
      'hrm.self.read',
      'hrm.self.attendance',
      'hrm.self.request',
      'hrm.self.payslip',
    ]);
    expect(plan.personal).toBe(true);
    expect(plan.canPunch).toBe(true);
    expect(plan.canSeePayslip).toBe(true);
    expect(plan.approvals).toEqual([]);
    expect(plan.overview).toBe(false);
    expect(plan.timesheetPeriods).toBe(false);
    expect(plan.payrollPeriods).toBe(false);
    expect(plan.endpoints).toEqual(['/my-attendance-context']);
  });

  it('khong co hrm.self.read thi khong co vung ca nhan', () => {
    const plan = dashboardPlan(['hrm.dashboard.read']);
    expect(plan.personal).toBe(false);
    expect(plan.canPunch).toBe(false);
    expect(plan.endpoints).toEqual(['/dashboard/overview']);
  });

  it('chi bam vao/ra ca khi co hrm.self.attendance', () => {
    expect(dashboardPlan(['hrm.self.read']).canPunch).toBe(false);
    expect(dashboardPlan(['hrm.self.attendance']).canPunch).toBe(false);
  });

  it('nguoi duyet chi dem loai don ho duoc duyet, luon kem forApproval=1', () => {
    const plan = dashboardPlan([
      'hrm.self.read',
      'hrm.leave.approve',
      'hrm.ot.approve.all',
      'hrm.attendance.approve',
    ]);
    expect(plan.approvals.map((s: { kind: string }) => s.kind)).toEqual([
      'LEAVE',
      'OT',
      'ATTENDANCE',
    ]);
    expect(plan.endpoints).toEqual([
      '/my-attendance-context',
      '/leave-requests?forApproval=1',
      '/ot-requests?forApproval=1',
      '/attendance-corrections?forApproval=1',
    ]);
  });

  it('quyen duyet tam ung hoac doc tam ung moi goi salary-advance-requests', () => {
    expect(dashboardPlan(['hrm.leave.approve']).endpoints).not.toContain(
      '/salary-advance-requests?forApproval=1',
    );
    expect(dashboardPlan(['hrm.advance.approve']).endpoints).toContain(
      '/salary-advance-requests?forApproval=1',
    );
  });

  it('request.read hoac request.manage xem moi loai don tru tam ung', () => {
    for (const key of ['hrm.request.read', 'hrm.request.manage']) {
      const kinds = dashboardPlan([key]).approvals.map((s: { kind: string }) => s.kind);
      expect(kinds).toEqual([
        'LEAVE',
        'OT',
        'BUSINESS_TRIP',
        'SHIFT_CHANGE',
        'ATTENDANCE',
        'PROFILE',
      ]);
    }
  });

  it('ky cong va ky luong can quyen rieng', () => {
    const plan = dashboardPlan(['hrm.timesheet.read', 'hrm.payroll.read']);
    expect(plan.endpoints).toEqual(['/timesheet-periods', '/payroll-periods']);
    expect(dashboardPlan(['hrm.payroll.read']).endpoints).toEqual([
      '/payroll-periods',
    ]);
  });

  it('khong co quyen nao thi khong goi endpoint nao', () => {
    expect(dashboardPlan([]).endpoints).toEqual([]);
  });
});

describe('formatShiftWindow', () => {
  it('tra null khi chua phan ca', () => {
    expect(formatShiftWindow(null)).toBeNull();
    expect(formatShiftWindow(undefined)).toBeNull();
  });

  it('dinh dang gio theo mui gio', () => {
    expect(
      formatShiftWindow(
        { start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:30:00.000Z' },
        'Asia/Ho_Chi_Minh',
      ),
    ).toBe('08:00 - 17:30');
  });
});
