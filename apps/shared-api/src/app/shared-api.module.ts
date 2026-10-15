import { SharedModule } from '@enterprise-platform/module-shared';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { SharedAccessGuard } from './shared-access.guard';

@Module({
  imports: [SharedModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SharedAccessGuard }],
})
export class SharedApiModule {}
