import { PlatformDatabaseProbe, ServiceHealth } from '@enterprise-platform/platform-module-access';
import { Controller, Get, type OnModuleDestroy } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('health')
export class AppController implements OnModuleDestroy {
  private readonly database = new PlatformDatabaseProbe();
  private readonly health = new ServiceHealth('procedure-api', { database: this.database });

  constructor(
    private readonly appService: AppService,
  ) {}

  @Get('live')
  getData() {
    return this.appService.getData();
  }

  /** Kiểm DB platform thật, lỗi thì 503 (ISS-OPS-014). */
  @Get('ready')
  ready() {
    return this.health.ready();
  }

  onModuleDestroy() {
    return this.database.close();
  }
}
