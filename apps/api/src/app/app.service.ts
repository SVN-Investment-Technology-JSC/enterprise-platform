import { PlatformDatabaseProbe, ServiceHealth } from '@enterprise-platform/platform-module-access';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';

/**
 * Healthcheck của Platform API (ISS-OPS-014): `GET /api` (Dockerfile HEALTHCHECK đang gọi) và `GET /api/health/ready`
 * kiểm DB platform thật, mất kết nối thì 503; `GET /api/health/live` chỉ báo tiến trình còn sống.
 */
@Injectable()
export class AppService implements OnModuleDestroy {
  private readonly database = new PlatformDatabaseProbe();
  private readonly health = new ServiceHealth('api', { database: this.database });

  async getData(): Promise<{ message: string }> {
    await this.health.ready();
    return { message: 'Platform API is ready' };
  }

  live() {
    return this.health.live();
  }

  ready() {
    return this.health.ready();
  }

  onModuleDestroy(): Promise<void> {
    return this.database.close();
  }
}
