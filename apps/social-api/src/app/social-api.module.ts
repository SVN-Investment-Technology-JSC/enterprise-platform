import { SocialModule } from '@enterprise-platform/module-social';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { SocialAccessGuard } from './social-access.guard';

@Module({
  imports: [SocialModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SocialAccessGuard }],
})
export class SocialApiModule {}
