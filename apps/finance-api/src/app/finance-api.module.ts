import { FinanceModule } from '@enterprise-platform/module-finance';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FinanceAccessGuard } from './finance-access.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [FinanceModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: FinanceAccessGuard }],
})
export class FinanceApiModule {}
