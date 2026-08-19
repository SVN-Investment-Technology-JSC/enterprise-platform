import { Controller, Get } from '@nestjs/common';

/** Probed by Docker and the gateway; the access guard lets these through unauthenticated. */
@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'live', service: 'inventory-api' };
  }

  @Get('ready')
  ready() {
    return { status: 'ready', service: 'inventory-api' };
  }
}
