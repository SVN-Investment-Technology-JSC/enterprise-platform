import { ModuleHrmModule } from '@enterprise-platform/module-hrm';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  imports: [ModuleHrmModule],
  controllers: [HealthController],
  providers: [],
})
export class HrmApiModule {}
