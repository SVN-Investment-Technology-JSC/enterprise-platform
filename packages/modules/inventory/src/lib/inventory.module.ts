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
import { StocktakeService } from './application/stocktake.service.js';
import { STOCKTAKE_STORE, type StocktakeStore } from './application/stocktake-store.port.js';
import { PostgresStocktakeStore } from './infrastructure/postgres-stocktake.store.js';
import { StocktakeController } from './presentation/stocktake.controller.js';
import { StockMovementService } from './application/stock-movement.service.js';
import { STOCK_MOVEMENT_STORE, type StockMovementStore } from './application/stock-movement-store.port.js';
import { PostgresStockMovementStore } from './infrastructure/postgres-stock-movement.store.js';
import { StockMovementController } from './presentation/stock-movement.controller.js';
import { RequisitionFulfilmentService } from './application/requisition-fulfilment.service.js';
import {
  PROCEDURE_INSTANCE_READER,
  type ProcedureInstanceReader,
} from './application/procedure-instance-reader.port.js';
import { HttpProcedureInstanceReader } from './infrastructure/http-procedure-instance.reader.js';
import { RequisitionController } from './presentation/requisition.controller.js';
import { LinkableController } from './presentation/linkable.controller.js';

@Module({
  controllers: [
    // Trước InventoryController: route tĩnh `internal/materials/fingerprint` phải
    // khớp trước `internal/materials/:code` (Express khớp theo thứ tự đăng ký).
    InternalCatalogController,
    InventoryController,
    StockDocumentController,
    StocktakeController,
    LotController,
    SerialController,
    InternalDocumentsController,
    InventoryReportsController,
    StockMovementController,
    RequisitionController,
    LinkableController,
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
      provide: STOCKTAKE_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresStocktakeStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: StocktakeService,
      useFactory: (stocktakes: StocktakeStore, documents: StockDocumentStore, store: InventoryStore) =>
        new StocktakeService(stocktakes, documents, store),
      inject: [STOCKTAKE_STORE, STOCK_DOCUMENT_STORE, INVENTORY_STORE],
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
    {
      provide: STOCK_MOVEMENT_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresStockMovementStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: StockMovementService,
      useFactory: (store: StockMovementStore) => new StockMovementService(store),
      inject: [STOCK_MOVEMENT_STORE],
    },
    // Cấp vật tư theo yêu cầu Quy trình (ISS-BE-031): hỏi Quy trình qua API nội bộ (PROCEDURE_API_URL).
    { provide: PROCEDURE_INSTANCE_READER, useFactory: () => new HttpProcedureInstanceReader() },
    {
      provide: RequisitionFulfilmentService,
      useFactory: (
        documents: StockDocumentStore,
        store: InventoryStore,
        inventory: InventoryApplication,
        procedures: ProcedureInstanceReader,
      ) => new RequisitionFulfilmentService(documents, store, inventory, procedures),
      inject: [STOCK_DOCUMENT_STORE, INVENTORY_STORE, InventoryApplication, PROCEDURE_INSTANCE_READER],
    },
  ],
  exports: [
    InventoryApplication,
    StockDocumentService,
    StocktakeService,
    LotService,
    SerialService,
    QualityService,
    InventoryReportService,
    StockMovementService,
    RequisitionFulfilmentService,
    AssetDocumentService,
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
  ],
})
export class InventoryModule {}
