import { payslipPublishedEvent } from './hrm-notification-events.js';

describe('HRM notification events', () => {
  it('targets the employee user when a payslip is published', () => {
    const event = payslipPublishedEvent({
      tenantId: '81000000-0000-4000-8000-000000000001',
      userId: '81000000-0000-4000-8000-000000000002',
      employeeId: '81000000-0000-4000-8000-000000000003',
      payslipId: '81000000-0000-4000-8000-000000000004',
      payrollRunId: '81000000-0000-4000-8000-000000000005',
      periodLabel: '2026-09',
      actorUserId: '81000000-0000-4000-8000-000000000006',
    });

    expect(event).toMatchObject({
      type: 'hrm.payslip.published',
      tenantId: '81000000-0000-4000-8000-000000000001',
      source: 'hrm',
      correlationId: '81000000-0000-4000-8000-000000000004',
      payload: {
        userId: '81000000-0000-4000-8000-000000000002',
        employeeId: '81000000-0000-4000-8000-000000000003',
        payslipId: '81000000-0000-4000-8000-000000000004',
        payrollRunId: '81000000-0000-4000-8000-000000000005',
        periodLabel: '2026-09',
        actorUserId: '81000000-0000-4000-8000-000000000006',
      },
    });
  });
});
