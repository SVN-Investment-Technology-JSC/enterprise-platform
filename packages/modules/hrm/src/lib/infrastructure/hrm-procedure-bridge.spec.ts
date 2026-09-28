import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import { initialProcedureValues } from './hrm-procedure-bridge.service';
import { submissionAttributes } from './hrm-submission';
jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));

describe('HRM dynamic submission values', () => {
  it('scopes first-step values and preserves false and zero without allowing later-step input', () => {
    const definition = {
      id: 'definition',
      code: 'HRM',
      name: 'Duyệt đơn',
      kind: 'process',
      status: 'published',
      versionNumber: 1,
      createdAt: '2026-09-28',
      updatedAt: '2026-09-28',
      attributes: [
        { id: 'ot', code: 'allow_ot', name: 'Cho phép OT', type: 'boolean' },
      ],
      steps: [
        {
          id: 'submit',
          key: 'S',
          name: 'Gửi đơn',
          order: 1,
          assignments: [],
          attributes: [
            { id: 'amount', code: 'amount', name: 'Số tiền', type: 'money' },
          ],
        },
        {
          id: 'approve',
          key: 'A',
          name: 'Duyệt đơn',
          order: 2,
          assignments: [],
          attributes: [
            {
              id: 'approved',
              code: 'approved',
              name: 'Đã duyệt',
              type: 'boolean',
            },
          ],
        },
      ],
    } as ProcedureDefinition;
    expect(
      initialProcedureValues(definition, {
        allow_ot: false,
        amount: 0,
        approved: true,
      }),
    ).toEqual({
      'process:allow_ot': { type: 'boolean', value: false },
      'step:submit:amount': { type: 'money', value: 0 },
    });
  });
  it('uses validated amounts even when the client spoofs code or scoped dynamic fields', () => {
    const values = submissionAttributes(
      {
        tenantId: 'tenant',
        kind: 'advance',
        employeeId: 'employee',
        initiatedBy: 'user',
        title: 'Tạm ứng',
        attributes: {
          amount: 1,
          'step:S:amount': 1,
          so_tien: 1,
          custom: 'Ghi chú',
        },
      },
      {
        requested_amount: '1000000',
        number_of_installments: 2,
        reason: 'Chi phí gia đình',
      },
    );
    expect(values).toMatchObject({
      amount: 1000000,
      'step:S:amount': 1000000,
      so_tien: 1000000,
      so_ky_tra: 2,
      custom: 'Ghi chú',
    });
  });
});
