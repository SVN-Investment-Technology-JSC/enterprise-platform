import type { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import type { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { HrmContextService } from './hrm-context.service';
import { isProcedureReachable } from './hrm-procedure-api';

jest.mock('@enterprise-platform/platform-identity', () => ({
  PlatformIdentityService: class {},
}));
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));
jest.mock('./hrm-procedure-api', () => ({ isProcedureReachable: jest.fn() }));

describe('procedureAvailable', () => {
  const identity = { serviceDatabase: jest.fn() };
  const make = () =>
    new HrmContextService(
      identity as unknown as PlatformIdentityService,
      {} as unknown as PostgresPoolRegistry,
    );
  beforeEach(() => jest.clearAllMocks());

  it('true khi entitlement procedure-engine hiệu lực và Procedure trả lời', async () => {
    identity.serviceDatabase.mockResolvedValue({ databaseName: 'x' });
    (isProcedureReachable as jest.Mock).mockResolvedValue(true);
    await expect(make().procedureAvailable('t1')).resolves.toBe(true);
    expect(identity.serviceDatabase).toHaveBeenCalledWith(
      't1',
      'procedure-engine',
    );
  });

  it('false và không gọi mạng khi entitlement đã tắt', async () => {
    identity.serviceDatabase.mockResolvedValue(null);
    await expect(make().procedureAvailable('t1')).resolves.toBe(false);
    expect(isProcedureReachable).not.toHaveBeenCalled();
  });

  it('false khi Procedure không trả lời; cache ngắn hạn tránh gọi lặp', async () => {
    identity.serviceDatabase.mockResolvedValue({ databaseName: 'x' });
    (isProcedureReachable as jest.Mock).mockResolvedValue(false);
    const service = make();
    await expect(service.procedureAvailable('t1')).resolves.toBe(false);
    await expect(service.procedureAvailable('t1')).resolves.toBe(false);
    expect(identity.serviceDatabase).toHaveBeenCalledTimes(1);
  });
});
