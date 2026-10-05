import { BadRequestException } from '@nestjs/common';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('./hrm-request-transition.js', () => ({ applyHrmRequestResult: jest.fn() }));

import { resolveProcedureAction } from './hrm-procedure-bridge.service';
import {
  HRM_PROCEDURE_SYSTEM_ACTOR_ID,
  resolveProcedureApproverId,
} from './hrm-procedure-sync';

describe('resolveProcedureApproverId', () => {
  const user = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  it('dùng actorId thật của sự kiện completed', () => {
    expect(resolveProcedureApproverId(user)).toBe(user);
  });
  it.each([undefined, null, '', 'khong-phai-uuid', HRM_PROCEDURE_SYSTEM_ACTOR_ID])(
    'giữ actor hệ thống khi actor là %p',
    (value) => {
      expect(resolveProcedureApproverId(value as string)).toBe(HRM_PROCEDURE_SYSTEM_ACTOR_ID);
    },
  );
});

describe('resolveProcedureAction', () => {
  it('chấp nhận chữ thường và chữ hoa', () => {
    expect(resolveProcedureAction('approve')).toBe('approve');
    expect(resolveProcedureAction(' Reject ')).toBe('reject');
    expect(resolveProcedureAction('CANCEL')).toBe('cancel');
  });
  it('báo rõ giá trị hợp lệ khi sai', () => {
    expect(() => resolveProcedureAction('delete')).toThrow(BadRequestException);
    expect(() => resolveProcedureAction(undefined)).toThrow(
      /APPROVE \| REJECT \| RETURN \| COMPLETE \| CANCEL/,
    );
  });
});
