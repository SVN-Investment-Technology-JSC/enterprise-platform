import { PostgresPoolRegistry,TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { InventoryApplication } from './application/inventory.application.js';
import { INVENTORY_STORE,type InventoryStore } from './application/inventory-store.port.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory.store.js';
import { InventoryController } from './presentation/inventory.controller.js';
@Module({imports:[PlatformIdentityModule],controllers:[InventoryController],providers:[PostgresPoolRegistry,TenantDatabaseRegistry,{provide:PostgresInventoryStore,useFactory:(p:PostgresPoolRegistry,d:TenantDatabaseRegistry)=>new PostgresInventoryStore(p,async id=>d.require(id)),inject:[PostgresPoolRegistry,TenantDatabaseRegistry]},{provide:INVENTORY_STORE,useExisting:PostgresInventoryStore},{provide:InventoryApplication,useFactory:(s:InventoryStore)=>new InventoryApplication(s),inject:[INVENTORY_STORE]}],exports:[InventoryApplication]})
export class ModuleInventoryModule {}
