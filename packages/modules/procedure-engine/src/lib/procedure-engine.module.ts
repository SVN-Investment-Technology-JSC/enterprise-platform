import { Module } from '@nestjs/common';
import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import { ProcedureAttachmentService } from './application/procedure-attachment.service.js';
import {
  PROCEDURE_CLOCK,
  PROCEDURE_ID_GENERATOR,
  PROCEDURE_STORE,
  type ProcedureClock,
  type ProcedureIdGenerator,
  type ProcedureStore,
} from './application/procedure-store.port.js';
import { PostgresProcedureStore } from './infrastructure/postgres-procedure-store.js';
import {
  SystemProcedureClock,
  UuidProcedureIdGenerator,
} from './infrastructure/system-procedure-services.js';
import { ProcedureEngineController } from './presentation/procedure-engine.controller.js';

@Module({
  controllers: [ProcedureEngineController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresProcedureStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresProcedureStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: ProcedureAttachmentService,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new ProcedureAttachmentService(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: PROCEDURE_STORE,
      useExisting: PostgresProcedureStore,
    },
    { provide: PROCEDURE_CLOCK, useClass: SystemProcedureClock },
    { provide: PROCEDURE_ID_GENERATOR, useClass: UuidProcedureIdGenerator },
    {
      provide: ProcedureEngineApplication,
      useFactory: (
        store: ProcedureStore,
        clock: ProcedureClock,
        ids: ProcedureIdGenerator,
      ) => new ProcedureEngineApplication(store, clock, ids),
      inject: [PROCEDURE_STORE, PROCEDURE_CLOCK, PROCEDURE_ID_GENERATOR],
    },
  ],
  exports: [ProcedureEngineApplication, ProcedureAttachmentService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class ProcedureEngineModule {}
