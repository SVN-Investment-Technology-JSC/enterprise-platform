import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { CrmController } from './presentation/crm.controller.js';

@Module({
  imports: [PlatformIdentityModule],
  controllers: [CrmController],
  providers: [PostgresPoolRegistry],
  exports: [],
})
export class ModuleCrmModule {}
