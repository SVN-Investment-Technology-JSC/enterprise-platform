import { CrmModule } from '@enterprise-platform/module-crm';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CrmAccessGuard } from './crm-access.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [CrmModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: CrmAccessGuard }],
})
export class CrmApiModule {}
