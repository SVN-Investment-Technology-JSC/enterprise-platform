import { ProcedureEngineModule } from '@enterprise-platform/module-procedure-engine';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProcedureAccessGuard } from './procedure-access.guard';

@Module({
  imports: [ProcedureEngineModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ProcedureAccessGuard }],
})
export class AppModule {}
