import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('health')
export class AppController {
  constructor(
    private readonly appService: AppService,
  ) {}

  @Get('live')
  getData() {
    return this.appService.getData();
  }

  @Get('ready')
  ready() { return { status: 'ready', service: 'procedure-api' }; }
}
