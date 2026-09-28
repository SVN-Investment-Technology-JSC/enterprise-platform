import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { CalendarService } from './application/calendar.service.js';
import { ChatService } from './application/chat.service.js';
import { DirectoryService } from './application/directory.service.js';
import { DocumentService } from './application/document.service.js';
import { InternalLookupService } from './application/internal-lookup.service.js';
import {
  EXTERNAL_REFERENCE_READER,
  type ExternalReferenceReader,
} from './application/external-reference.port.js';
import { ExternalReferenceService } from './application/external-reference.service.js';
import { FinanceService } from './application/finance.service.js';
import { MyWorkService } from './application/my-work.service.js';
import {
  ORGANIZATION_DIRECTORY,
  type OrganizationDirectory,
} from './application/organization-directory.port.js';
import { ProjectService } from './application/project.service.js';
import { ReportService } from './application/report.service.js';
import { WorkItemService } from './application/work-item.service.js';
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
      provide: WorkspaceApplication,
      useFactory: (store: WorkspaceStore) => new WorkspaceApplication(store),
      inject: [WORKSPACE_STORE],
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
      provide: ProjectService,
      useFactory: (store: WorkspaceStore, directory: DirectoryService) =>
        new ProjectService(store, directory),
      inject: [WORKSPACE_STORE, DirectoryService],
    },
    {
      // Công việc cần `ProjectService` để phân giải vai trò trong dự án, nên
      // phụ thuộc này là một chiều: project không biết gì về work item.
      provide: WorkItemService,
      useFactory: (store: WorkspaceStore, projects: ProjectService) =>
        new WorkItemService(store, projects),
      inject: [WORKSPACE_STORE, ProjectService],
    },
    {
      provide: CalendarService,
      useFactory: (store: WorkspaceStore, projects: ProjectService, directory: DirectoryService) =>
        new CalendarService(store, projects, directory),
      inject: [WORKSPACE_STORE, ProjectService, DirectoryService],
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
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
  ],
})
export class WorkspaceModule {}
