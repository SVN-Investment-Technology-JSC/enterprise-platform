import { Module } from '@nestjs/common';
import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import {
  INVENTORY_TASK_TEMPLATE_RESOLVER,
  type InventoryTaskTemplateResolver,
} from './application/inventory-task-template.port.js';
import { HttpInventoryTaskTemplateResolver } from './infrastructure/http-inventory-task-template.resolver.js';
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
      provide: INVENTORY_TASK_TEMPLATE_RESOLVER,
      useFactory: () => new HttpInventoryTaskTemplateResolver(),
    },
    {
      provide: ProcedureEngineApplication,
      useFactory: (
        store: ProcedureStore,
        clock: ProcedureClock,
        ids: ProcedureIdGenerator,
        inventoryTasks: InventoryTaskTemplateResolver,
      ) => new ProcedureEngineApplication(store, clock, ids, inventoryTasks),
      inject: [
        PROCEDURE_STORE,
        PROCEDURE_CLOCK,
        PROCEDURE_ID_GENERATOR,
        INVENTORY_TASK_TEMPLATE_RESOLVER,
      ],
    },
  ],
  exports: [ProcedureEngineApplication, ProcedureAttachmentService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class ProcedureEngineModule {}
