import { Module } from '@nestjs/common';
import { PlatformAccessController } from './platform-access.controller.js';
import { PlatformIdentityController } from './platform-identity.controller.js';
import { PlatformIdentityService } from './platform-identity.service.js';

@Module({
  controllers: [PlatformIdentityController, PlatformAccessController],
  providers: [PlatformIdentityService],
  exports: [PlatformIdentityService],
})
export class PlatformIdentityModule {}
