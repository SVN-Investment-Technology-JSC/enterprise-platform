import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { RealtimeHealthController } from './realtime-health.controller';
import { RealtimeHealthService, RealtimeMetrics } from './realtime-health';

describe('RealtimeHealthController metrics (SEC-OPS020-01)', () => {
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const controller = new RealtimeHealthController(
    new RealtimeHealthService({ query: jest.fn() }, { ping: jest.fn() }),
    new RealtimeMetrics(),
  );
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'token-noi-bo';
  });
  afterAll(() => {
    if (originalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  it('không có token thì 401', () => {
    expect(() => controller.metricsText(request({}))).toThrow(UnauthorizedException);
  });

  it('token sai thì 401', () => {
    expect(() => controller.metricsText(request({ 'x-service-token': 'token-noi-bx' }))).toThrow(
      UnauthorizedException,
    );
    expect(() => controller.metricsText(request({ authorization: 'Bearer sai' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('chưa cấu hình INTERNAL_SERVICE_TOKEN thì 401 kể cả khi gửi rỗng', () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    expect(() => controller.metricsText(request({ 'x-service-token': '' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('token đúng qua x-service-token hoặc Bearer thì trả số liệu', async () => {
    await expect(
      controller.metricsText(request({ 'x-service-token': 'token-noi-bo' })),
    ).resolves.toContain('realtime_active_sockets');
    await expect(
      controller.metricsText(request({ authorization: 'Bearer token-noi-bo' })),
    ).resolves.toContain('realtime_active_sockets');
  });

  it('health không đòi token', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });
});
