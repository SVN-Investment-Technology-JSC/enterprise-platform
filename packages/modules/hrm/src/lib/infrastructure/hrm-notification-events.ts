import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { randomUUID } from 'node:crypto';

export interface PayslipPublishedEventInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly employeeId: string;
  readonly payslipId: string;
  readonly payrollRunId: string;
  readonly periodLabel: string;
  readonly actorUserId: string;
}

export function payslipPublishedEvent(input: PayslipPublishedEventInput) {
  return createIntegrationEvent({
    id: randomUUID(),
    type: 'hrm.payslip.published',
    version: 1,
    tenantId: input.tenantId,
    source: 'hrm',
    correlationId: input.payslipId,
    payload: {
      userId: input.userId,
      employeeId: input.employeeId,
      payslipId: input.payslipId,
      payrollRunId: input.payrollRunId,
      periodLabel: input.periodLabel,
      actorUserId: input.actorUserId,
    },
  });
}
