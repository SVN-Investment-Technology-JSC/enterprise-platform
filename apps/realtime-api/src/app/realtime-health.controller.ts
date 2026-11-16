import { Controller, Get, Header, Req, UnauthorizedException } from '@nestjs/common';
import { verifyServiceToken } from '@enterprise-platform/platform-module-access';
import type { Request } from 'express';
import { RealtimeHealthService, RealtimeMetrics } from './realtime-health';

@Controller('realtime/v1')
export class RealtimeHealthController {
  constructor(
    private readonly health: RealtimeHealthService,
    private readonly metrics: RealtimeMetrics,
  ) {}

  @Get('health/live')
  live() {
    return this.health.live();
  }

  @Get('health/ready')
  ready() {
    return this.health.ready();
  }

  /**
   * Số liệu Prometheus chỉ dành cho hệ thống giám sát nội bộ (ISS-OPS-020): bên gọi
   * phải gửi `INTERNAL_SERVICE_TOKEN` qua `x-service-token` hoặc
   * `Authorization: Bearer <token>` (dạng Prometheus hỗ trợ sẵn).
   */
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsText(@Req() request: Request): Promise<string> {
    if (!metricsCallerTrusted(request)) {
      throw new UnauthorizedException({
        code: 'SERVICE_IDENTITY_INVALID',
        message: 'Thiếu hoặc sai token dịch vụ nội bộ.',
      });
    }
    return this.metrics.render();
  }
}

function metricsCallerTrusted(request: Request): boolean {
  if (verifyServiceToken(request.headers['x-service-token'])) return true;
  const authorization = request.headers.authorization;
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
  return verifyServiceToken(bearer);
}
