import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmInternalController } from './hrm-internal.controller';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const U1 = '11111111-1111-4111-8111-111111111111';

describe('HrmInternalController profile-facts', () => {
  const request = {} as Request;

  it('trả { data } từ DB của tenant, lọc theo query', async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ rows: [{ user_id: U1, date_of_birth: '1992-05-09', join_date: '2022-03-01' }] });
    const serviceContext = jest.fn().mockResolvedValue({ tenantId: 't1', pool: { query } });
    const controller = new HrmInternalController({ serviceContext } as unknown as HrmContextService);

    const result = await controller.profileFacts(request, U1, '5');

    expect(serviceContext).toHaveBeenCalledWith(request);
    expect(result).toEqual({
      data: [{ userId: U1, birthYear: 1992, birthMonth: 5, birthDay: 9, joinDate: '2022-03-01' }],
    });
    expect(query.mock.calls[0][1]).toEqual(['t1', [U1], 5]);
  });

  it('không chạm DB khi service token sai', async () => {
    const serviceContext = jest.fn().mockRejectedValue(new UnauthorizedException());
    const controller = new HrmInternalController({ serviceContext } as unknown as HrmContextService);
    await expect(controller.profileFacts(request)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tháng sai là 400 trước khi hỏi DB', async () => {
    const serviceContext = jest.fn();
    const controller = new HrmInternalController({ serviceContext } as unknown as HrmContextService);
    await expect(controller.profileFacts(request, undefined, '0')).rejects.toMatchObject({ status: 400 });
    expect(serviceContext).not.toHaveBeenCalled();
  });
});
