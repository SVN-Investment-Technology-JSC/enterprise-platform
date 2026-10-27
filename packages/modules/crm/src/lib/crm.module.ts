import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { ActivityService, CustomerTimelineService } from './application/activity.service.js';
import { CRM_DIAGNOSTICS } from './application/crm-store.port.js';
import { CrmPeopleService, CrmSettingsService, CustomerGroupService } from './application/customer-group.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService } from './application/opportunity.service.js';
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
  CRM_CUSTOMER_STORE,
  CRM_LEAD_STORE,
  CRM_OPPORTUNITY_STORE,
  CRM_PEOPLE_DIRECTORY,
  CRM_SETTINGS_STORE,
  CRM_TIMELINE_STORE,
  type ActivityStore,
  type CustomerGroupStore,
  type CustomerStore,
  type LeadStore,
  type OpportunityStore,
  type PeopleDirectory,
  type SettingsStore,
  type TimelineStore,
} from './application/sales-store.port.js';
import { CrmDatabase } from './infrastructure/crm.database.js';
import { HttpOrganizationScope } from './infrastructure/http-organization-scope.js';
import { PostgresActivityStore, PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresCustomerGroupStore, PostgresSettingsStore } from './infrastructure/postgres-settings.store.js';
import { HttpInventoryCatalogReader } from './infrastructure/http-inventory-catalog-reader.js';
import { HttpProcedureClient } from './infrastructure/http-procedure-client.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { PostgresApprovalLinks } from './infrastructure/quote-procedure-links.js';
import { QuoteApprovalSettingsService } from './application/quote-approval-settings.service.js';
import { QuoteService } from './application/quote.service.js';
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
    ActivitiesController,
    PriceListsController,
    DiscountPoliciesController,
    PricingController,
    QuotesController,
    ApprovalSettingsController,
    InternalInstancesController,
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
    store(CRM_SETTINGS_STORE, (database) => new PostgresSettingsStore(database)),
    store(CRM_LEAD_STORE, (database) => new PostgresLeadStore(database)),
    store(CRM_OPPORTUNITY_STORE, (database) => new PostgresOpportunityStore(database)),
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
      useFactory: (opportunities: OpportunityStore, customers: CustomerStore, scopes: CrmDataScopeService) =>
        new OpportunityService(opportunities, customers, scopes),
      inject: [CRM_OPPORTUNITY_STORE, CRM_CUSTOMER_STORE, CrmDataScopeService],
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
      ) => new QuoteService(quotes, settings, pricing, catalog, customers, opportunities, scopes, links, reportingLines),
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
      ],
    },
    {
      provide: QuoteApprovalSettingsService,
      useFactory: (settings: QuoteSettingsStore, procedures: ProcedureClient) =>
        new QuoteApprovalSettingsService(settings, procedures),
      inject: [CRM_QUOTE_SETTINGS_STORE, CRM_PROCEDURE_CLIENT],
    },
  ],
  exports: [CrmDatabase, CrmDataScopeService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class CrmModule {}
