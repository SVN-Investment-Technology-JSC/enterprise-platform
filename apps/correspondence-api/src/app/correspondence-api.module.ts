import { CorrespondenceModule } from '@enterprise-platform/module-correspondence';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CorrespondenceAccessGuard } from './correspondence-access.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [CorrespondenceModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: CorrespondenceAccessGuard }],
})
export class CorrespondenceApiModule {}
