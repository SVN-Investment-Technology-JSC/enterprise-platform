import {
  INSTANCE_REVERSAL_GUARD,
  type InstanceReversalGuard,
} from './application/instance-reversal-guard.port.js';
import { HttpInstanceReversalGuard } from './infrastructure/http-instance-reversal.guard.js';
import { Module } from '@nestjs/common';
import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import {
  INVENTORY_TASK_TEMPLATE_RESOLVER,
  type InventoryTaskTemplateResolver,
} from './application/inventory-task-template.port.js';
import { HttpInventoryTaskTemplateResolver } from './infrastructure/http-inventory-task-template.resolver.js';
import {
  DIRECT_MANAGER_RESOLVER,
  type DirectManagerResolver,
} from './application/direct-manager.port.js';
import { INITIATOR_ACTOR_RESOLVER, type InitiatorActorResolver } from './application/initiator-actor.port.js';
import { HttpInitiatorActorResolver } from './infrastructure/http-initiator-actor.resolver.js';
import { HttpDirectManagerResolver } from './infrastructure/http-direct-manager.resolver.js';
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
      provide: DIRECT_MANAGER_RESOLVER,
      useFactory: () => new HttpDirectManagerResolver(),
    },
    {
      provide: INITIATOR_ACTOR_RESOLVER,
      useFactory: () => new HttpInitiatorActorResolver(),
    },
    {
      provide: INSTANCE_REVERSAL_GUARD,
      useFactory: () => new HttpInstanceReversalGuard(),
    },
    {
      provide: ProcedureEngineApplication,
      useFactory: (
        store: ProcedureStore,
        clock: ProcedureClock,
        ids: ProcedureIdGenerator,
        inventoryTasks: InventoryTaskTemplateResolver,
        attachments: ProcedureAttachmentService,
        directManagers: DirectManagerResolver,
        initiatorActors: InitiatorActorResolver,
        reversalGuard: InstanceReversalGuard,
      ) =>
        new ProcedureEngineApplication(
          store,
          clock,
          ids,
          inventoryTasks,
          attachments,
          directManagers,
          initiatorActors,
          reversalGuard,
        ),
      inject: [
        PROCEDURE_STORE,
        PROCEDURE_CLOCK,
        PROCEDURE_ID_GENERATOR,
        INVENTORY_TASK_TEMPLATE_RESOLVER,
        ProcedureAttachmentService,
        DIRECT_MANAGER_RESOLVER,
        INITIATOR_ACTOR_RESOLVER,
        INSTANCE_REVERSAL_GUARD,
      ],
    },
  ],
  exports: [ProcedureEngineApplication, ProcedureAttachmentService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class ProcedureEngineModule {}
