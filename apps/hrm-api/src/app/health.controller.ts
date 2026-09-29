import { Controller, Get } from '@nestjs/common';

/** Probed by Docker and Nginx gateway */
@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'live', service: 'hrm-api' };
  }

  @Get('ready')
  ready() {
    return { status: 'ready', service: 'hrm-api' };
  }
}
