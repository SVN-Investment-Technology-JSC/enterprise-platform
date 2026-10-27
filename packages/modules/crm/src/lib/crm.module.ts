import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { ActivityService, CustomerTimelineService } from './application/activity.service.js';
import { CRM_DIAGNOSTICS } from './application/crm-store.port.js';
import { CrmPeopleService, CrmSettingsService, CustomerGroupService } from './application/customer-group.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService } from './application/opportunity.service.js';
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
import { CrmController } from './presentation/crm.controller.js';
import { CrmSettingsController, CustomersController } from './presentation/customers.controller.js';
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
    LeadsController,
    OpportunitiesController,
    ActivitiesController,
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
  ],
  exports: [CrmDatabase, CrmDataScopeService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class CrmModule {}
