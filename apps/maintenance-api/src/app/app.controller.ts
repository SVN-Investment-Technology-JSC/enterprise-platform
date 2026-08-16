import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class AppController {
  @Get('live') live() { return { status: 'live', service: 'maintenance-api' }; }
  @Get('ready') ready() { return { status: 'ready', service: 'maintenance-api' }; }
}
