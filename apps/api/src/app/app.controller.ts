import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @Get('health/live')
  live() {
    return this.appService.live();
  }

  @Get('health/ready')
  ready() {
    return this.appService.ready();
  }
}
