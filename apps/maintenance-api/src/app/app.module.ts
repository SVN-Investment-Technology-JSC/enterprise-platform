import { MaintenanceModule } from '@enterprise-platform/module-maintenance';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { MaintenanceAccessGuard } from './maintenance-access.guard';

@Module({
  imports: [MaintenanceModule],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: MaintenanceAccessGuard }],
})
export class AppModule {}
