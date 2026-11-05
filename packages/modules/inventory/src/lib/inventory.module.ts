import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { AssetDocumentService } from './application/asset-document.service.js';
import { InventoryApplication } from './application/inventory.application.js';
import { INVENTORY_STORE, type InventoryStore } from './application/inventory-store.port.js';
import { StockDocumentService } from './application/stock-document.service.js';
import {
  STOCK_DOCUMENT_STORE,
  type StockDocumentStore,
} from './application/stock-document-store.port.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { LotService } from './application/lot.service.js';
import { QualityService } from './application/quality.service.js';
import { SerialService } from './application/serial.service.js';
import {
  TRACEABILITY_STORE,
  type TraceabilityStore,
} from './application/traceability-store.port.js';
import { PostgresTraceabilityStore } from './infrastructure/postgres-traceability.store.js';
import {
  INVENTORY_REPORT_STORE,
  type InventoryReportStore,
} from './application/inventory-report-store.port.js';
import { InventoryReportService } from './application/inventory-report.service.js';
import { PostgresInventoryReportStore } from './infrastructure/postgres-inventory-report.store.js';
import { InventoryReportsController } from './presentation/inventory-reports.controller.js';
import { InventoryController } from './presentation/inventory.controller.js';
import { InternalCatalogController } from './presentation/internal-catalog.controller.js';
import { InternalDocumentsController } from './presentation/internal-documents.controller.js';
import { LotController } from './presentation/lot.controller.js';
import { SerialController } from './presentation/serial.controller.js';
import { StockDocumentController } from './presentation/stock-document.controller.js';

@Module({
  controllers: [
    InventoryController,
    StockDocumentController,
    LotController,
    SerialController,
    InternalCatalogController,
    InternalDocumentsController,
    InventoryReportsController,
  ],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresInventoryStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresInventoryStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: INVENTORY_STORE, useExisting: PostgresInventoryStore },
    {
      provide: STOCK_DOCUMENT_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresStockDocumentStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: InventoryApplication,
      useFactory: (store: InventoryStore, documents: StockDocumentStore, traceability: TraceabilityStore) =>
        new InventoryApplication(store, documents, traceability),
      inject: [INVENTORY_STORE, STOCK_DOCUMENT_STORE, TRACEABILITY_STORE],
    },
    {
      provide: StockDocumentService,
      useFactory: (documents: StockDocumentStore, store: InventoryStore) =>
        new StockDocumentService(documents, store),
      inject: [STOCK_DOCUMENT_STORE, INVENTORY_STORE],
    },
    {
      provide: TRACEABILITY_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresTraceabilityStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: LotService,
      useFactory: (store: TraceabilityStore) => new LotService(store),
      inject: [TRACEABILITY_STORE],
    },
    {
      provide: SerialService,
      useFactory: (store: TraceabilityStore) => new SerialService(store),
      inject: [TRACEABILITY_STORE],
    },
    {
      provide: QualityService,
      useFactory: (store: TraceabilityStore) => new QualityService(store),
      inject: [TRACEABILITY_STORE],
    },
    {
      provide: INVENTORY_REPORT_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresInventoryReportStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: InventoryReportService,
      useFactory: (store: InventoryReportStore) => new InventoryReportService(store),
      inject: [INVENTORY_REPORT_STORE],
    },
    {
      provide: AssetDocumentService,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new AssetDocumentService(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
  ],
  exports: [
    InventoryApplication,
    StockDocumentService,
    LotService,
    SerialService,
    QualityService,
    InventoryReportService,
    AssetDocumentService,
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
  ],
})
export class InventoryModule {}
