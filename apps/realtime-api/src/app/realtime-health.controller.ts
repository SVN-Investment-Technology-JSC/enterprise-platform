import { Controller, Get, Header } from '@nestjs/common';
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

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsText(): Promise<string> {
    return this.metrics.render();
  }
}
