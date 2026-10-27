import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { CalendarService } from './application/calendar.service.js';
import { CatalogService } from './application/catalog.service.js';
import { ChatService } from './application/chat.service.js';
import { ContractService } from './application/contract.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmCustomerLinkService } from './application/crm-customer-link.service.js';
import {
  CRM_CUSTOMER_COPIES,
  CRM_CUSTOMER_DIRECTORY,
  type CrmCustomerCopyStore,
  type CrmCustomerDirectory,
} from './application/crm-customer.port.js';
import { PostgresCrmCustomerCopies } from './infrastructure/crm-customer-events.js';
import { HttpCrmCustomerDirectory } from './infrastructure/http-crm-customer-directory.js';
import { DirectoryService } from './application/directory.service.js';
import { DocumentService } from './application/document.service.js';
import { InternalLookupService } from './application/internal-lookup.service.js';
import {
  EXTERNAL_REFERENCE_READER,
  type ExternalReferenceReader,
} from './application/external-reference.port.js';
import { ExternalReferenceService } from './application/external-reference.service.js';
import { FinanceService } from './application/finance.service.js';
import {
  FLEET_AVAILABILITY_READER,
  type FleetAvailabilityReader,
} from './application/fleet-availability.port.js';
import { FleetTransportService } from './application/fleet-transport.service.js';
import { HttpFleetAvailabilityClient } from './infrastructure/http-fleet-availability.js';
import { ProjectRequestService } from './application/project-request.service.js';
import { WorkdayRuleService } from './application/workday-rule.service.js';
import { ProjectCodeService } from './application/project-code.service.js';
import { WorkspaceLabelService } from './application/workspace-label.service.js';
import { ProjectGroupService } from './application/project-group.service.js';
import { ProjectRoleService } from './application/project-role.service.js';
import { MyWorkService } from './application/my-work.service.js';
import {
  ORGANIZATION_DIRECTORY,
  type OrganizationDirectory,
} from './application/organization-directory.port.js';
import { ProjectService } from './application/project.service.js';
import { ReportService } from './application/report.service.js';
import { StandaloneTaskService } from './application/standalone-task.service.js';
import { WorkItemService } from './application/work-item.service.js';
import { WorkItemDeletionService } from './application/work-item-deletion.service.js';
import { HttpProcedureReversalChecker } from './infrastructure/http-procedure-reversal-check.js';
import { WorkspaceApplication } from './application/workspace.application.js';
import { WORKSPACE_STORE, type WorkspaceStore } from './application/workspace-store.port.js';
import { HttpExternalReferenceClient } from './infrastructure/http-external-reference.js';
import { HttpOrganizationDirectory } from './infrastructure/http-organization-directory.js';
import { PostgresWorkspaceStore } from './infrastructure/postgres-workspace-store.js';
import { WorkspaceController } from './presentation/workspace.controller.js';

/**
 * Composition root của module.
 *
 * Dùng `useFactory` tường minh thay vì để Nest tự suy DI, đúng như
 * `InventoryModule`: store là lớp thường, không gắn `@Injectable`, nên phải
 * dựng bằng tay. `useExisting` nối interface token về đúng một thực thể, để
 * không sinh hai pool registry khác nhau.
 *
 * Module export luôn hai registry: composition root của app cần chúng để
 * guard đăng ký `TenantDatabaseReference` sau mỗi access-decision.
 */
@Module({
  controllers: [WorkspaceController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresWorkspaceStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresWorkspaceStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: WORKSPACE_STORE, useExisting: PostgresWorkspaceStore },
    {
      // Một thực thể cho cả module: cache 30 giây "tenant có bật Bán hàng" nằm trong nó.
      provide: CRM_CUSTOMER_DIRECTORY,
      useFactory: () => new HttpCrmCustomerDirectory(),
    },
    {
      provide: CRM_CUSTOMER_COPIES,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresCrmCustomerCopies((tenantId) => pools.forTenant(references.require(tenantId))),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: CrmCustomerLinkService,
      useFactory: (directory: CrmCustomerDirectory, copies: CrmCustomerCopyStore) =>
        new CrmCustomerLinkService(directory, copies),
      inject: [CRM_CUSTOMER_DIRECTORY, CRM_CUSTOMER_COPIES],
    },
    {
      provide: WorkspaceApplication,
      useFactory: (store: WorkspaceStore, crm: CrmCustomerDirectory) => new WorkspaceApplication(store, crm),
      inject: [WORKSPACE_STORE, CRM_CUSTOMER_DIRECTORY],
    },
    {
      // Một thực thể cho cả module: cache danh bạ 60 giây nằm trong nó.
      provide: ORGANIZATION_DIRECTORY,
      useFactory: () => new HttpOrganizationDirectory(),
    },
    {
      provide: DirectoryService,
      useFactory: (directory: OrganizationDirectory) => new DirectoryService(directory),
      inject: [ORGANIZATION_DIRECTORY],
    },
    {
      // Một thực thể cho cả module: cache quyền theo vai nằm trong nó.
      provide: ProjectRoleService,
      useFactory: (store: WorkspaceStore) => new ProjectRoleService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      provide: ProjectGroupService,
      useFactory: (store: WorkspaceStore) => new ProjectGroupService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      provide: ProjectCodeService,
      useFactory: (store: WorkspaceStore) => new ProjectCodeService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      provide: WorkspaceLabelService,
      useFactory: (store: WorkspaceStore) => new WorkspaceLabelService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      provide: ProjectService,
      useFactory: (
        store: WorkspaceStore,
        directory: DirectoryService,
        roles: ProjectRoleService,
        groups: ProjectGroupService,
        codes: ProjectCodeService,
      ) => new ProjectService(store, directory, roles, groups, codes),
      inject: [
        WORKSPACE_STORE,
        DirectoryService,
        ProjectRoleService,
        ProjectGroupService,
        ProjectCodeService,
      ],
    },
    {
      // Lịch bận của xe do HRM trả lời qua HTTP chỉ đọc; đặt xe đi bằng sự kiện.
      provide: FLEET_AVAILABILITY_READER,
      useFactory: () => new HttpFleetAvailabilityClient(),
    },
    {
      provide: FleetTransportService,
      useFactory: (store: WorkspaceStore, reader: FleetAvailabilityReader) =>
        new FleetTransportService(store, reader),
      inject: [WORKSPACE_STORE, FLEET_AVAILABILITY_READER],
    },
    {
      // Công việc cần `ProjectService` để phân giải vai trò trong dự án, nên
      // phụ thuộc này là một chiều: project không biết gì về work item.
      provide: WorkItemService,
      useFactory: (store: WorkspaceStore, projects: ProjectService, fleet: FleetTransportService) =>
        new WorkItemService(store, projects, new HttpProcedureReversalChecker(), fleet),
      inject: [WORKSPACE_STORE, ProjectService, FleetTransportService],
    },
    {
      // Xoá công việc tách khỏi `WorkItemService`: chỉ cần store và phân giải
      // vai trò dự án, không kéo theo phụ thuộc kiểm quy trình.
      provide: WorkItemDeletionService,
      useFactory: (store: WorkspaceStore, projects: ProjectService, fleet: FleetTransportService) =>
        new WorkItemDeletionService(store, projects, fleet),
      inject: [WORKSPACE_STORE, ProjectService, FleetTransportService],
    },
    {
      provide: CalendarService,
      useFactory: (
        store: WorkspaceStore,
        projects: ProjectService,
        directory: DirectoryService,
        fleet: FleetTransportService,
      ) => new CalendarService(store, projects, directory, fleet),
      inject: [WORKSPACE_STORE, ProjectService, DirectoryService, FleetTransportService],
    },
    {
      provide: ChatService,
      useFactory: (store: WorkspaceStore, projects: ProjectService) =>
        new ChatService(store, projects),
      inject: [WORKSPACE_STORE, ProjectService],
    },
    {
      // Tham số thứ ba để mặc định: service tự dựng `S3ObjectStorage` từ biến
      // môi trường, đúng khuôn `AssetDocumentService` của Kho.
      provide: DocumentService,
      useFactory: (store: WorkspaceStore, projects: ProjectService) =>
        new DocumentService(store, projects),
      inject: [WORKSPACE_STORE, ProjectService],
    },
    {
      // Cố ý KHÔNG nhận ProjectService: trang này không có khái niệm phạm vi
      // dự án, mọi truy vấn đều bị kẹp cứng vào danh tính người gọi.
      provide: MyWorkService,
      useFactory: (store: WorkspaceStore) => new MyWorkService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      // Cũng không nhận ProjectService: phạm vi báo cáo được dịch thẳng
      // thành điều kiện SQL, không đi qua lớp kiểm quyền từng dự án.
      provide: ReportService,
      useFactory: (store: WorkspaceStore) => new ReportService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      // Tra cứu cho module khác qua `/v1/internal/*`; chỉ đọc nhãn, không tài chính.
      provide: InternalLookupService,
      useFactory: (store: WorkspaceStore) => new InternalLookupService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      // Một thực thể dùng chung cho cả module: cache 60 giây nằm trong nó,
      // tách làm nhiều thực thể là mỗi cái một cache riêng, vô nghĩa.
      provide: EXTERNAL_REFERENCE_READER,
      useFactory: () => new HttpExternalReferenceClient(),
    },
    {
      provide: ExternalReferenceService,
      useFactory: (
        store: WorkspaceStore,
        projects: ProjectService,
        reader: ExternalReferenceReader,
      ) => new ExternalReferenceService(store, projects, reader),
      inject: [WORKSPACE_STORE, ProjectService, EXTERNAL_REFERENCE_READER],
    },
    {
      provide: FinanceService,
      useFactory: (store: WorkspaceStore, projects: ProjectService) =>
        new FinanceService(store, projects),
      inject: [WORKSPACE_STORE, ProjectService],
    },
    {
      provide: WorkdayRuleService,
      useFactory: (store: WorkspaceStore) => new WorkdayRuleService(store),
      inject: [WORKSPACE_STORE],
    },
    {
      provide: ProjectRequestService,
      useFactory: (store: WorkspaceStore, projects: ProjectService) =>
        new ProjectRequestService(store, projects, new HttpProcedureReversalChecker()),
      inject: [WORKSPACE_STORE, ProjectService],
    },
    {
      // Không nhận ProjectService: việc giao lẻ không thuộc dự án nào, quyền
      // suy từ vai của người gọi trên chính việc đó.
      provide: StandaloneTaskService,
      useFactory: (store: WorkspaceStore, directory: DirectoryService) =>
        new StandaloneTaskService(store, directory, new HttpProcedureReversalChecker()),
      inject: [WORKSPACE_STORE, DirectoryService],
    },
    {
      provide: CatalogService,
      useFactory: (store: WorkspaceStore, projects: ProjectService) =>
        new CatalogService(store, projects),
      inject: [WORKSPACE_STORE, ProjectService],
    },
    {
      // Danh mục khách hàng không thuộc dự án nào: chỉ cần store.
      provide: CustomerService,
      useFactory: (store: WorkspaceStore, crm: CrmCustomerDirectory) => new CustomerService(store, crm),
      inject: [WORKSPACE_STORE, CRM_CUSTOMER_DIRECTORY],
    },
    {
      provide: ContractService,
      useFactory: (store: WorkspaceStore) => new ContractService(store),
      inject: [WORKSPACE_STORE],
    },
  ],
  exports: [
    WorkspaceApplication,
    DirectoryService,
    ProjectService,
    WorkItemService,
    CalendarService,
    ChatService,
    DocumentService,
    MyWorkService,
    ReportService,
    ExternalReferenceService,
    FinanceService,
    ProjectRequestService,
    WorkdayRuleService,
    ProjectRoleService,
    ProjectGroupService,
    ProjectCodeService,
    CatalogService,
    CustomerService,
    CrmCustomerLinkService,
    ContractService,
    FleetTransportService,
    StandaloneTaskService,
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
  ],
})
export class WorkspaceModule {}
