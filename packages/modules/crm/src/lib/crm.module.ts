import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { ActivityService, CustomerTimelineService } from './application/activity.service.js';
import { CRM_DIAGNOSTICS } from './application/crm-store.port.js';
import { CrmPeopleService, CrmSettingsService, CustomerGroupService } from './application/customer-group.service.js';
import { CustomerKindService } from './application/customer-kind.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService, type OpportunityTenderReader } from './application/opportunity.service.js';
import { TenderService } from './application/tender.service.js';
import { CRM_TENDER_STORE, type TenderStore } from './application/tender-store.port.js';
import { PostgresTenderStore } from './infrastructure/postgres-tender.store.js';
import { TenderController } from './presentation/tender.controller.js';
import { StageAssigneeResolver } from './application/stage-assignee.resolver.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListService } from './application/price-list.service.js';
import { PricingService } from './application/pricing.service.js';
import {
  CRM_CATALOG_READER,
  CRM_DISCOUNT_POLICY_STORE,
  CRM_PRICE_LIST_STORE,
  CRM_PRICING_STORE,
  type CatalogReader,
  type DiscountPolicyStore,
  type PriceListStore,
  type PricingStore,
} from './application/pricing-store.port.js';
import { REPORTING_LINE_READER } from './application/organization-scope.port.js';
import {
  CRM_ACTIVITY_STORE,
  CRM_CUSTOMER_GROUP_STORE,
  CRM_CUSTOMER_KIND_STORE,
  CRM_CUSTOMER_STORE,
  CRM_LEAD_STORE,
  CRM_OPPORTUNITY_STORE,
  CRM_PEOPLE_DIRECTORY,
  CRM_SETTINGS_STORE,
  CRM_TIMELINE_STORE,
  type ActivityStore,
  type CustomerGroupStore,
  type CustomerKindStore,
  type CustomerStore,
  type LeadStore,
  type OpportunityStore,
  type PeopleDirectory,
  type SettingsStore,
  type TimelineStore,
} from './application/sales-store.port.js';
import { CrmDatabase } from './infrastructure/crm.database.js';
import { INVENTORY_ACCESS_READER, type InventoryAccessReader } from './application/inventory-access.port.js';
import { HttpInventoryAccess } from './infrastructure/http-inventory-access.js';
import { HttpOrganizationScope } from './infrastructure/http-organization-scope.js';
import { PostgresActivityStore, PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { CRM_PIPELINE_CONFIG, type PipelineConfigProvider } from './application/pipeline-config.port.js';
import {
  PostgresCustomerGroupStore,
  PostgresCustomerKindStore,
  PostgresSettingsStore,
} from './infrastructure/postgres-settings.store.js';
import { HttpInventoryCatalogReader } from './infrastructure/http-inventory-catalog-reader.js';
import { HttpProcedureClient } from './infrastructure/http-procedure-client.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { PostgresApprovalLinks } from './infrastructure/quote-procedure-links.js';
import { QuoteApprovalSettingsService } from './application/quote-approval-settings.service.js';
import { QuoteService } from './application/quote.service.js';
import { QuoteFormService } from './application/quote-form.service.js';
import { CRM_QUOTE_FORM_STORE, type QuoteFormStore } from './application/quote-form-store.port.js';
import { PostgresQuoteFormStore } from './infrastructure/postgres-quote-form.store.js';
import { SalesOrganizationService } from './application/sales-organization.service.js';
import { CRM_SALES_ORGANIZATION_STORE, type SalesOrganizationStore } from './application/sales-organization-store.port.js';
import { PostgresSalesOrganizationStore } from './infrastructure/postgres-sales-organization.store.js';
import { SalesOrganizationsController } from './presentation/sales-organizations.controller.js';
import { QuoteRelationService } from './application/quote-relation.service.js';
import { CRM_QUOTE_RELATION_STORE, type QuoteRelationStore } from './application/quote-relation-store.port.js';
import { PostgresQuoteRelationStore } from './infrastructure/postgres-quote-relation.store.js';
import { BusinessPlanService } from './application/business-plan.service.js';
import { CRM_BUSINESS_PLAN_STORE, type BusinessPlanStore } from './application/business-plan-store.port.js';
import { PostgresBusinessPlanStore } from './infrastructure/postgres-business-plan.store.js';
import { BusinessPlansController } from './presentation/business-plans.controller.js';
import {
  CRM_APPROVAL_LINKS,
  CRM_PROCEDURE_CLIENT,
  CRM_QUOTE_SETTINGS_STORE,
  CRM_QUOTE_STORE,
  type ApprovalLinks,
  type ProcedureClient,
  type QuoteSettingsStore,
  type QuoteStore,
} from './application/quote-store.port.js';
import type { ReportingLineReader } from './application/organization-scope.port.js';
import {
  ApprovalSettingsController,
  InternalInstancesController,
  QuoteFormController,
  QuoteRelationController,
  QuotesController,
} from './presentation/quotes.controller.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { CrmController } from './presentation/crm.controller.js';
import { DiscountPoliciesController } from './presentation/discount-policies.controller.js';
import { PriceListsController, PricingController } from './presentation/price-lists.controller.js';
import { CrmSettingsController, CustomersController } from './presentation/customers.controller.js';
import { InternalCustomersController } from './presentation/internal-customers.controller.js';
import {
  ActivitiesController,
  LeadsController,
  OpportunitiesController,
} from './presentation/opportunities.controller.js';
import { ContractService } from './application/contract.service.js';
import {
  CRM_CONTRACT_STORE,
  CRM_SALES_SETTINGS_STORE,
  type ContractStore,
  type SalesSettingsStore,
} from './application/contract-store.port.js';
import {
  CRM_CREDIT_LIMIT_CHECK,
  CRM_INTEGRATION_DISPATCHER,
  CRM_INVENTORY_CLIENT,
  CRM_ORDER_BALANCE_READER,
  type CreditLimitCheck,
  type IntegrationDispatcher,
  type InventoryClient,
  type OrderBalanceReader,
} from './application/fulfillment.port.js';
import { QuoteConversionService } from './application/quote-conversion.service.js';
import {
  CRM_QUOTE_CONVERSION_STORE,
  CRM_SALES_ORDER_STORE,
  type QuoteConversionStore,
  type SalesOrderStore,
} from './application/sales-order-store.port.js';
import { SalesOrderService } from './application/sales-order.service.js';
import { HttpInventoryClient } from './infrastructure/http-inventory-client.js';
import { PostgresIntegrationRequests } from './infrastructure/integration-requests.js';
import { PostgresContractStore, PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresQuoteConversionStore } from './infrastructure/postgres-quote-conversion.store.js';
import { PostgresSalesOrderStore } from './infrastructure/postgres-sales-order.store.js';
import { ContractsController } from './presentation/contracts.controller.js';
import { SalesOrdersController } from './presentation/sales-orders.controller.js';
import { CreditApprovalService, CreditLimitService } from './application/credit-limit.service.js';
import { ReceivableAdjustmentService } from './application/receivable-adjustment.service.js';
import { ReceivableService } from './application/receivable.service.js';
import {
  CRM_CREDIT_STORE,
  CRM_FINANCE_CLIENT,
  CRM_RECEIVABLE_STORE,
  type CreditStore,
  type FinanceClient,
  type ReceivableStore,
} from './application/receivable-store.port.js';
import { HttpFinanceClient } from './infrastructure/http-finance-client.js';
import { PostgresCreditStore } from './infrastructure/postgres-credit.store.js';
import { PostgresReceivableStore } from './infrastructure/postgres-receivable.store.js';
import { ReceivablesController } from './presentation/receivables.controller.js';
import { WarrantyResolutionService } from './application/warranty-resolution.service.js';
import { WarrantyService } from './application/warranty.service.js';
import { ReceivableWarrantyCredit } from './application/warranty-credit.js';
import {
  CRM_WARRANTY_CREDIT,
  CRM_WARRANTY_INVENTORY,
  CRM_WARRANTY_STORE,
  type WarrantyCreditPort,
  type WarrantyInventory,
  type WarrantyStore,
} from './application/warranty.port.js';
import {
  CRM_WARRANTY_DEVICE_DOCUMENTS,
  WarrantyDeviceDocumentService,
  type WarrantyDeviceDocumentReader,
} from './application/warranty-device-documents.service.js';
import { HttpWarrantyDeviceDocuments } from './infrastructure/http-warranty-device-documents.js';
import { HttpWarrantyInventoryClient } from './infrastructure/http-warranty-inventory.js';
import { PostgresWarrantyStore } from './infrastructure/postgres-warranty.store.js';
import { WarrantyController } from './presentation/warranty.controller.js';
import { SalesReportService } from './application/sales-report.service.js';
import { CRM_SALES_REPORT_STORE, type SalesReportStore } from './application/sales-report-store.port.js';
import { PostgresSalesReportStore } from './infrastructure/postgres-sales-report.store.js';
import { ReportsController } from './presentation/reports.controller.js';
import { SalesDashboardService } from './application/sales-dashboard.service.js';
import { CRM_SALES_DASHBOARD_STORE, type SalesDashboardStore } from './application/sales-dashboard-store.port.js';
import { PostgresSalesDashboardStore } from './infrastructure/postgres-sales-dashboard.store.js';
import { DashboardController } from './presentation/dashboard.controller.js';
import { DocumentService, DocumentTypeService } from './application/document.service.js';
import {
  CRM_DOCUMENT_STORAGE,
  CRM_DOCUMENT_STORE,
  type DocumentStorage,
  type DocumentStore,
} from './application/document-store.port.js';
import { PostgresDocumentStore, PostgresOpportunityDocumentChecker } from './infrastructure/postgres-document.store.js';
import { S3DocumentStorage } from './infrastructure/s3-document-storage.js';
import { DocumentTypesController, DocumentsController, QuoteDocumentsController } from './presentation/documents.controller.js';
import { QuoteDocumentService } from './application/quote-document.service.js';
import { CRM_QUOTE_DOCUMENT_STORE, type QuoteDocumentStore } from './application/quote-document-store.port.js';
import { PostgresQuoteDocumentStore } from './infrastructure/postgres-quote-document.store.js';
import { PromotionService } from './application/promotion.service.js';
import { CRM_PROMOTION_STORE, type PromotionStore } from './application/promotion-store.port.js';
import { PostgresPromotionStore } from './infrastructure/postgres-promotion.store.js';
import { PromotionsController } from './presentation/promotions.controller.js';
import { PipelineConfigService } from './application/pipeline-config.service.js';
import { CRM_PIPELINE_ADMIN_STORE, type PipelineAdminStore } from './application/pipeline-admin-store.port.js';
import { PostgresPipelineAdminStore } from './infrastructure/postgres-pipeline-admin.store.js';
import { PipelinesController } from './presentation/pipelines.controller.js';

/** Store Postgres dựng từ `CrmDatabase`. */
function store<T>(token: symbol, create: (database: CrmDatabase) => T) {
  return { provide: token, useFactory: create, inject: [CrmDatabase] };
}

/**
 * Composition root của Bán hàng.
 *
 * Dựng tường minh bằng `useFactory` như `SharedModule`: các lớp là lớp thường,
 * không gắn `@Injectable`. Export hai registry để guard của app đăng ký
 * database của tenant sau mỗi access-decision.
 */
@Module({
  controllers: [
    CrmController,
    CustomersController,
    CrmSettingsController,
    InternalCustomersController,
    LeadsController,
    OpportunitiesController,
    TenderController,
    ActivitiesController,
    PriceListsController,
    DiscountPoliciesController,
    PricingController,
    QuotesController,
    QuoteFormController,
    SalesOrganizationsController,
    QuoteRelationController,
    ApprovalSettingsController,
    BusinessPlansController,
    InternalInstancesController,
    ContractsController,
    SalesOrdersController,
    ReceivablesController,
    WarrantyController,
    ReportsController,
    DashboardController,
    DocumentsController,
    DocumentTypesController,
    QuoteDocumentsController,
    PromotionsController,
    PipelinesController,
  ],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: CrmDatabase,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new CrmDatabase(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: CRM_DIAGNOSTICS, useExisting: CrmDatabase },
    { provide: INVENTORY_ACCESS_READER, useFactory: () => new HttpInventoryAccess() },
    {
      // Một thực thể cho cả app: bản sao 60 giây của cơ cấu tổ chức nằm trong nó.
      provide: HttpOrganizationScope,
      useFactory: () => new HttpOrganizationScope(),
    },
    { provide: REPORTING_LINE_READER, useExisting: HttpOrganizationScope },
    { provide: CRM_PEOPLE_DIRECTORY, useExisting: HttpOrganizationScope },
    {
      provide: CrmDataScopeService,
      useFactory: (reportingLines: HttpOrganizationScope) => new CrmDataScopeService(reportingLines),
      inject: [REPORTING_LINE_READER],
    },
    store(CRM_CUSTOMER_STORE, (database) => new PostgresCustomerStore(database)),
    store(CRM_CUSTOMER_GROUP_STORE, (database) => new PostgresCustomerGroupStore(database)),
    store(CRM_CUSTOMER_KIND_STORE, (database) => new PostgresCustomerKindStore(database)),
    store(CRM_SETTINGS_STORE, (database) => new PostgresSettingsStore(database)),
    store(CRM_LEAD_STORE, (database) => new PostgresLeadStore(database)),
    store(CRM_OPPORTUNITY_STORE, (database) => new PostgresOpportunityStore(database)),
    store(CRM_PIPELINE_CONFIG, (database) => new CachedPipelineConfig(new PostgresPipelineConfigReader(database))),
    // Cấu hình luồng cho quản trị viên (GĐ G): ghi qua store riêng, huỷ cache ngay sau commit.
    store(CRM_PIPELINE_ADMIN_STORE, (database) => new PostgresPipelineAdminStore(database)),
    {
      provide: PipelineConfigService,
      useFactory: (store: PipelineAdminStore, config: PipelineConfigProvider) => new PipelineConfigService(store, config),
      inject: [CRM_PIPELINE_ADMIN_STORE, CRM_PIPELINE_CONFIG],
    },
    store(CRM_ACTIVITY_STORE, (database) => new PostgresActivityStore(database)),
    store(CRM_TIMELINE_STORE, (database) => new PostgresTimelineStore(database)),
    {
      provide: CustomerService,
      useFactory: (customers: CustomerStore, scopes: CrmDataScopeService) => new CustomerService(customers, scopes),
      inject: [CRM_CUSTOMER_STORE, CrmDataScopeService],
    },
    {
      provide: CustomerGroupService,
      useFactory: (groups: CustomerGroupStore) => new CustomerGroupService(groups),
      inject: [CRM_CUSTOMER_GROUP_STORE],
    },
    {
      provide: CustomerKindService,
      useFactory: (kinds: CustomerKindStore) => new CustomerKindService(kinds),
      inject: [CRM_CUSTOMER_KIND_STORE],
    },
    {
      provide: CrmSettingsService,
      useFactory: (settings: SettingsStore) => new CrmSettingsService(settings),
      inject: [CRM_SETTINGS_STORE],
    },
    {
      provide: CrmPeopleService,
      useFactory: (directory: PeopleDirectory) => new CrmPeopleService(directory),
      inject: [CRM_PEOPLE_DIRECTORY],
    },
    {
      provide: LeadService,
      useFactory: (leads: LeadStore, scopes: CrmDataScopeService) => new LeadService(leads, scopes),
      inject: [CRM_LEAD_STORE, CrmDataScopeService],
    },
    {
      provide: OpportunityService,
      useFactory: (
        opportunities: OpportunityStore,
        customers: CustomerStore,
        scopes: CrmDataScopeService,
        pipelines: PipelineConfigProvider,
        organization: HttpOrganizationScope,
        database: CrmDatabase,
        tender: OpportunityTenderReader,
      ) =>
        new OpportunityService(
          opportunities,
          customers,
          scopes,
          pipelines,
          undefined,
          // Cổng điều kiện DOCUMENT_TYPE (P2C-11): loại tài liệu còn hiệu lực của cơ hội đọc từ kho tài liệu CRM.
          new PostgresOpportunityDocumentChecker(database),
          new StageAssigneeResolver(organization),
          organization,
          // Cổng điều kiện TENDER_PLAN_APPROVED, TENDER_FIELD (P2E-03): hồ sơ thầu của cơ hội.
          tender,
        ),
      inject: [
        CRM_OPPORTUNITY_STORE,
        CRM_CUSTOMER_STORE,
        CrmDataScopeService,
        CRM_PIPELINE_CONFIG,
        HttpOrganizationScope,
        CrmDatabase,
        CRM_TENDER_STORE,
      ],
    },
    // Chào thầu (GĐ E): hồ sơ thầu, đối tác liên danh, duyệt phương án, kết quả thầu.
    store(CRM_TENDER_STORE, (database) => new PostgresTenderStore(database)),
    {
      provide: TenderService,
      useFactory: (
        tender: TenderStore,
        opportunityStore: OpportunityStore,
        scopes: CrmDataScopeService,
        pipelines: PipelineConfigProvider,
        opportunities: OpportunityService,
        settings: QuoteSettingsStore,
        links: ApprovalLinks,
        reportingLines: ReportingLineReader,
      ) => new TenderService(tender, opportunityStore, scopes, pipelines, opportunities, settings, links, reportingLines),
      inject: [
        CRM_TENDER_STORE,
        CRM_OPPORTUNITY_STORE,
        CrmDataScopeService,
        CRM_PIPELINE_CONFIG,
        OpportunityService,
        CRM_QUOTE_SETTINGS_STORE,
        CRM_APPROVAL_LINKS,
        REPORTING_LINE_READER,
      ],
    },
    {
      provide: ActivityService,
      useFactory: (
        activities: ActivityStore,
        customers: CustomerStore,
        opportunities: OpportunityStore,
        scopes: CrmDataScopeService,
      ) => new ActivityService(activities, customers, opportunities, scopes),
      inject: [CRM_ACTIVITY_STORE, CRM_CUSTOMER_STORE, CRM_OPPORTUNITY_STORE, CrmDataScopeService],
    },
    {
      provide: CustomerTimelineService,
      useFactory: (timeline: TimelineStore, customers: CustomerStore, scopes: CrmDataScopeService) =>
        new CustomerTimelineService(timeline, customers, scopes),
      inject: [CRM_TIMELINE_STORE, CRM_CUSTOMER_STORE, CrmDataScopeService],
    },
    // Giá (GĐ3a). Danh mục Kho đọc qua API nội bộ `GET /v1/internal/materials` (INVENTORY_API_URL).
    { provide: CRM_CATALOG_READER, useFactory: () => new HttpInventoryCatalogReader() },
    store(CRM_PRICE_LIST_STORE, (database) => new PostgresPriceListStore(database)),
    store(CRM_DISCOUNT_POLICY_STORE, (database) => new PostgresDiscountPolicyStore(database)),
    store(CRM_PRICING_STORE, (database) => new PostgresPricingStore(database)),
    {
      provide: PriceListService,
      useFactory: (lists: PriceListStore, catalog: CatalogReader) => new PriceListService(lists, catalog),
      inject: [CRM_PRICE_LIST_STORE, CRM_CATALOG_READER],
    },
    {
      provide: DiscountPolicyService,
      useFactory: (policies: DiscountPolicyStore) => new DiscountPolicyService(policies),
      inject: [CRM_DISCOUNT_POLICY_STORE],
    },
    {
      provide: PricingService,
      useFactory: (pricing: PricingStore, customers: CustomerService, catalog: CatalogReader) =>
        new PricingService(pricing, customers, catalog),
      inject: [CRM_PRICING_STORE, CustomerService, CRM_CATALOG_READER],
    },
    // Báo giá (GĐ3b). Quy trình gọi qua API (PROCEDURE_API_URL).
    { provide: CRM_PROCEDURE_CLIENT, useFactory: () => new HttpProcedureClient() },
    store(CRM_QUOTE_STORE, (database) => new PostgresQuoteStore(database)),
    store(CRM_QUOTE_SETTINGS_STORE, (database) => new PostgresQuoteSettingsStore(database)),
    {
      provide: CRM_APPROVAL_LINKS,
      useFactory: (database: CrmDatabase, procedures: ProcedureClient) => new PostgresApprovalLinks(database, procedures),
      inject: [CrmDatabase, CRM_PROCEDURE_CLIENT],
    },
    {
      provide: QuoteService,
      useFactory: (
        quotes: QuoteStore,
        settings: QuoteSettingsStore,
        pricing: PricingStore,
        catalog: CatalogReader,
        customers: CustomerStore,
        opportunities: OpportunityStore,
        scopes: CrmDataScopeService,
        links: ApprovalLinks,
        reportingLines: ReportingLineReader,
        plans: BusinessPlanService,
        form: QuoteFormStore,
        organizations: SalesOrganizationStore,
      ) =>
        new QuoteService(
          quotes,
          settings,
          pricing,
          catalog,
          customers,
          opportunities,
          scopes,
          links,
          reportingLines,
          undefined,
          plans,
          form,
          organizations,
        ),
      inject: [
        CRM_QUOTE_STORE,
        CRM_QUOTE_SETTINGS_STORE,
        CRM_PRICING_STORE,
        CRM_CATALOG_READER,
        CRM_CUSTOMER_STORE,
        CRM_OPPORTUNITY_STORE,
        CrmDataScopeService,
        CRM_APPROVAL_LINKS,
        REPORTING_LINE_READER,
        BusinessPlanService,
        CRM_QUOTE_FORM_STORE,
        CRM_SALES_ORGANIZATION_STORE,
      ],
    },
    // Báo giá theo mẫu (GĐI): mẫu, loại, mã báo giá.
    store(CRM_QUOTE_FORM_STORE, (database) => new PostgresQuoteFormStore(database)),
    {
      provide: QuoteFormService,
      useFactory: (form: QuoteFormStore) => new QuoteFormService(form),
      inject: [CRM_QUOTE_FORM_STORE],
    },
    // Tổ chức báo giá (phase 3, mục 16).
    store(CRM_SALES_ORGANIZATION_STORE, (database) => new PostgresSalesOrganizationStore(database)),
    {
      provide: SalesOrganizationService,
      useFactory: (organizations: SalesOrganizationStore) => new SalesOrganizationService(organizations),
      inject: [CRM_SALES_ORGANIZATION_STORE],
    },
    // Người theo dõi và đối tượng liên quan của báo giá (P2I-07).
    store(CRM_QUOTE_RELATION_STORE, (database) => new PostgresQuoteRelationStore(database)),
    {
      provide: QuoteRelationService,
      useFactory: (relations: QuoteRelationStore, scopes: CrmDataScopeService, people: PeopleDirectory) =>
        new QuoteRelationService(relations, scopes, people),
      inject: [CRM_QUOTE_RELATION_STORE, CrmDataScopeService, CRM_PEOPLE_DIRECTORY],
    },
    // Phương án kinh doanh (GĐ D): gắn phiên bản báo giá, nối vào duyệt báo giá và so lệch khi sửa.
    store(CRM_BUSINESS_PLAN_STORE, (database) => new PostgresBusinessPlanStore(database)),
    {
      provide: BusinessPlanService,
      useFactory: (plans: BusinessPlanStore, quotes: QuoteStore, scopes: CrmDataScopeService) =>
        new BusinessPlanService(plans, quotes, scopes),
      inject: [CRM_BUSINESS_PLAN_STORE, CRM_QUOTE_STORE, CrmDataScopeService],
    },
    {
      provide: QuoteApprovalSettingsService,
      useFactory: (settings: QuoteSettingsStore, procedures: ProcedureClient) =>
        new QuoteApprovalSettingsService(settings, procedures),
      inject: [CRM_QUOTE_SETTINGS_STORE, CRM_PROCEDURE_CLIENT],
    },
    // Hợp đồng, đơn bán, giao hàng (GĐ4). Kho gọi qua API nội bộ (INVENTORY_API_URL).
    { provide: CRM_INVENTORY_CLIENT, useFactory: () => new HttpInventoryClient() },
    // Công nợ (GĐ5): sổ công nợ là bản đọc số còn phải thu của đơn (T5-11); hạn mức đọc từ sổ (T5-10).
    // Tài chính gọi qua API nội bộ (FINANCE_API_URL).
    { provide: CRM_FINANCE_CLIENT, useFactory: () => new HttpFinanceClient() },
    store(CRM_RECEIVABLE_STORE, (database) => new PostgresReceivableStore(database)),
    store(CRM_CREDIT_STORE, (database) => new PostgresCreditStore(database)),
    { provide: CRM_ORDER_BALANCE_READER, useExisting: CRM_RECEIVABLE_STORE },
    {
      provide: CRM_CREDIT_LIMIT_CHECK,
      useFactory: (credit: CreditStore, links: ApprovalLinks) => new CreditLimitService(credit, links),
      inject: [CRM_CREDIT_STORE, CRM_APPROVAL_LINKS],
    },
    {
      provide: CRM_INTEGRATION_DISPATCHER,
      useFactory: (database: CrmDatabase, inventory: InventoryClient, finance: FinanceClient) =>
        new PostgresIntegrationRequests(database, inventory, finance),
      inject: [CrmDatabase, CRM_INVENTORY_CLIENT, CRM_FINANCE_CLIENT],
    },
    {
      provide: ReceivableService,
      useFactory: (receivables: ReceivableStore, scopes: CrmDataScopeService, dispatcher: IntegrationDispatcher) =>
        new ReceivableService(receivables, scopes, dispatcher),
      inject: [CRM_RECEIVABLE_STORE, CrmDataScopeService, CRM_INTEGRATION_DISPATCHER],
    },
    {
      provide: ReceivableAdjustmentService,
      useFactory: (receivables: ReceivableStore, scopes: CrmDataScopeService) => new ReceivableAdjustmentService(receivables, scopes),
      inject: [CRM_RECEIVABLE_STORE, CrmDataScopeService],
    },
    {
      provide: CreditApprovalService,
      useFactory: (credit: CreditStore, orders: SalesOrderService) => new CreditApprovalService(credit, orders),
      inject: [CRM_CREDIT_STORE, SalesOrderService],
    },
    store(CRM_CONTRACT_STORE, (database) => new PostgresContractStore(database)),
    store(CRM_SALES_SETTINGS_STORE, (database) => new PostgresSalesSettingsStore(database)),
    store(CRM_QUOTE_CONVERSION_STORE, (database) => new PostgresQuoteConversionStore(database)),
    {
      provide: CRM_SALES_ORDER_STORE,
      useFactory: (database: CrmDatabase, balances: OrderBalanceReader) => new PostgresSalesOrderStore(database, balances),
      inject: [CrmDatabase, CRM_ORDER_BALANCE_READER],
    },
    {
      provide: ContractService,
      useFactory: (
        contracts: ContractStore,
        customers: CustomerStore,
        catalog: CatalogReader,
        scopes: CrmDataScopeService,
        inventory: InventoryClient,
        settings: SalesSettingsStore,
        dispatcher: IntegrationDispatcher,
      ) => new ContractService(contracts, customers, catalog, scopes, inventory, settings, dispatcher),
      inject: [
        CRM_CONTRACT_STORE,
        CRM_CUSTOMER_STORE,
        CRM_CATALOG_READER,
        CrmDataScopeService,
        CRM_INVENTORY_CLIENT,
        CRM_SALES_SETTINGS_STORE,
        CRM_INTEGRATION_DISPATCHER,
      ],
    },
    {
      provide: SalesOrderService,
      useFactory: (
        orders: SalesOrderStore,
        contracts: ContractStore,
        customers: CustomerStore,
        pricing: PricingStore,
        catalog: CatalogReader,
        scopes: CrmDataScopeService,
        inventory: InventoryClient,
        settings: SalesSettingsStore,
        credit: CreditLimitCheck,
        dispatcher: IntegrationDispatcher,
      ) => new SalesOrderService(orders, contracts, customers, pricing, catalog, scopes, inventory, settings, credit, dispatcher),
      inject: [
        CRM_SALES_ORDER_STORE,
        CRM_CONTRACT_STORE,
        CRM_CUSTOMER_STORE,
        CRM_PRICING_STORE,
        CRM_CATALOG_READER,
        CrmDataScopeService,
        CRM_INVENTORY_CLIENT,
        CRM_SALES_SETTINGS_STORE,
        CRM_CREDIT_LIMIT_CHECK,
        CRM_INTEGRATION_DISPATCHER,
      ],
    },
    {
      provide: QuoteConversionService,
      useFactory: (conversion: QuoteConversionStore, quotes: QuoteStore, scopes: CrmDataScopeService) =>
        new QuoteConversionService(conversion, quotes, scopes),
      inject: [CRM_QUOTE_CONVERSION_STORE, CRM_QUOTE_STORE, CrmDataScopeService],
    },
    // Bảo hành (GĐ6). Kho qua API nội bộ; giảm trừ công nợ, hoàn tiền qua sổ công nợ GĐ5.
    store(CRM_WARRANTY_STORE, (database) => new PostgresWarrantyStore(database)),
    { provide: CRM_WARRANTY_INVENTORY, useFactory: () => new HttpWarrantyInventoryClient() },
    {
      provide: CRM_WARRANTY_CREDIT,
      useFactory: (adjustments: ReceivableAdjustmentService) => new ReceivableWarrantyCredit(adjustments),
      inject: [ReceivableAdjustmentService],
    },
    {
      provide: WarrantyService,
      useFactory: (warranty: WarrantyStore, inventory: WarrantyInventory, catalog: CatalogReader, scopes: CrmDataScopeService) =>
        new WarrantyService(warranty, inventory, catalog, scopes),
      inject: [CRM_WARRANTY_STORE, CRM_WARRANTY_INVENTORY, CRM_CATALOG_READER, CrmDataScopeService],
    },
    { provide: CRM_WARRANTY_DEVICE_DOCUMENTS, useFactory: () => new HttpWarrantyDeviceDocuments() },
    {
      provide: WarrantyDeviceDocumentService,
      useFactory: (warranty: WarrantyService, access: InventoryAccessReader, reader: WarrantyDeviceDocumentReader) =>
        new WarrantyDeviceDocumentService(warranty, access, reader),
      inject: [WarrantyService, INVENTORY_ACCESS_READER, CRM_WARRANTY_DEVICE_DOCUMENTS],
    },
    {
      provide: WarrantyResolutionService,
      useFactory: (warranty: WarrantyStore, inventory: WarrantyInventory, credit: WarrantyCreditPort, scopes: CrmDataScopeService) =>
        new WarrantyResolutionService(warranty, inventory, credit, scopes),
      inject: [CRM_WARRANTY_STORE, CRM_WARRANTY_INVENTORY, CRM_WARRANTY_CREDIT, CrmDataScopeService],
    },
    // Báo cáo (GĐ7): doanh thu đọc `sales_facts`; chuyển đổi, cảnh báo, công nợ đọc bảng nghiệp vụ.
    store(CRM_SALES_REPORT_STORE, (database) => new PostgresSalesReportStore(database)),
    {
      provide: SalesReportService,
      useFactory: (reports: SalesReportStore, scopes: CrmDataScopeService, settings: SalesSettingsStore) =>
        new SalesReportService(reports, scopes, settings),
      inject: [CRM_SALES_REPORT_STORE, CrmDataScopeService, CRM_SALES_SETTINGS_STORE],
    },
    // Dashboard Tổng quan: `crm.read`, số liệu theo phạm vi dữ liệu của người xem.
    store(CRM_SALES_DASHBOARD_STORE, (database) => new PostgresSalesDashboardStore(database)),
    {
      provide: SalesDashboardService,
      useFactory: (dashboard: SalesDashboardStore, scopes: CrmDataScopeService, settings: SalesSettingsStore) =>
        new SalesDashboardService(dashboard, scopes, settings),
      inject: [CRM_SALES_DASHBOARD_STORE, CrmDataScopeService, CRM_SALES_SETTINGS_STORE],
    },
    // Tài liệu (GĐ C): siêu dữ liệu trong `crm_schema`, file trên S3/MinIO qua URL ký 300 giây.
    store(CRM_DOCUMENT_STORE, (database) => new PostgresDocumentStore(database)),
    { provide: CRM_DOCUMENT_STORAGE, useFactory: () => new S3DocumentStorage() },
    {
      provide: DocumentService,
      useFactory: (documents: DocumentStore, storage: DocumentStorage, scopes: CrmDataScopeService) =>
        new DocumentService(documents, storage, scopes),
      inject: [CRM_DOCUMENT_STORE, CRM_DOCUMENT_STORAGE, CrmDataScopeService],
    },
    {
      provide: DocumentTypeService,
      useFactory: (documents: DocumentStore) => new DocumentTypeService(documents),
      inject: [CRM_DOCUMENT_STORE],
    },
    // Tài liệu có sẵn đính kèm vào báo giá (Q-P2-11): chỉ lưu liên kết, không nhân bản file.
    store(CRM_QUOTE_DOCUMENT_STORE, (database) => new PostgresQuoteDocumentStore(database)),
    {
      provide: QuoteDocumentService,
      useFactory: (refs: QuoteDocumentStore, documents: DocumentStore, storage: DocumentStorage, scopes: CrmDataScopeService) =>
        new QuoteDocumentService(refs, documents, storage, scopes),
      inject: [CRM_QUOTE_DOCUMENT_STORE, CRM_DOCUMENT_STORE, CRM_DOCUMENT_STORAGE, CrmDataScopeService],
    },
    // Khuyến mãi của báo giá (P2I-11): danh mục, lựa chọn của dự án, ảnh chụp trên phiên bản.
    store(CRM_PROMOTION_STORE, (database) => new PostgresPromotionStore(database)),
    {
      provide: PromotionService,
      useFactory: (promotions: PromotionStore, opportunities: OpportunityStore, quotes: QuoteStore, scopes: CrmDataScopeService) =>
        new PromotionService(promotions, opportunities, quotes, scopes),
      inject: [CRM_PROMOTION_STORE, CRM_OPPORTUNITY_STORE, CRM_QUOTE_STORE, CrmDataScopeService],
    },
  ],
  exports: [CrmDatabase, CrmDataScopeService, TenantDatabaseRegistry, PostgresPoolRegistry, ReceivableAdjustmentService],
})
export class CrmModule {}
