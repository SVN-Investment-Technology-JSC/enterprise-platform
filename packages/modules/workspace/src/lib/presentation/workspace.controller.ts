import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type {
  AddDependencyRequest,
  ChangeWorkItemStatusRequest,
  CompleteUploadRequest,
  CreateCostEntryRequest,
  CreateDocumentRequest,
  CreateEventRequest,
  CreateExternalReferenceRequest,
  RequestWorkItemProcedureRequest,
  CreateFolderRequest,
  UpdateFolderRequest,
  AddFolderRefRequest,
  ChangeStandaloneTaskStatusRequest,
  CreateStandaloneTaskRequest,
  ReverseStandaloneTaskRequest,
  UpdateStandaloneTaskRequest,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  CreateContractRequest,
  UpdateContractRequest,
  EnsureFolderPathRequest,
  CreateProjectRequest,
  CreateSavedFilterRequest,
  CreateTagRequest,
  CreateVersionRequest,
  CreateWorkItemRequest,
  LinkDocumentRequest,
  MoveWorkItemRequest,
  ReverseWorkItemRequest,
  ReverseProjectRequestRequest,
  RespondToEventRequest,
  SaveProjectRoleRequest,
  SendChatMessageRequest,
  SetProjectMembersRequest,
  UpdateChatMessageRequest,
  UpdateDocumentAudienceRequest,
  UpdateEventRequest,
  UpdateProjectFinanceRequest,
  UpdateProjectRequest,
  UpdateTagRequest,
  UpdateWorkItemCostRequest,
  UpdateWorkdayRulesRequest,
  UpdateWorkItemRequest,
} from '@enterprise-platform/contracts-workspace';
import { WorkspaceApplication, type WorkspaceActor } from '../application/workspace.application.js';
import { ProjectService } from '../application/project.service.js';
import { ProjectRoleService } from '../application/project-role.service.js';
import { WorkItemService } from '../application/work-item.service.js';
import { WorkItemDeletionService } from '../application/work-item-deletion.service.js';
import { CalendarService } from '../application/calendar.service.js';
import { CatalogService } from '../application/catalog.service.js';
import { ChatService } from '../application/chat.service.js';
import { ContractService } from '../application/contract.service.js';
import { CustomerService } from '../application/customer.service.js';
import { DirectoryService } from '../application/directory.service.js';
import { DocumentService } from '../application/document.service.js';
import { ExternalReferenceService } from '../application/external-reference.service.js';
import { FinanceService } from '../application/finance.service.js';
import { FleetTransportService } from '../application/fleet-transport.service.js';
import { ProjectRequestService } from '../application/project-request.service.js';
import { WorkdayRuleService } from '../application/workday-rule.service.js';
import { InternalLookupService } from '../application/internal-lookup.service.js';
import { MyWorkService } from '../application/my-work.service.js';
import { ReportService } from '../application/report.service.js';
import { StandaloneTaskService } from '../application/standalone-task.service.js';
import { WorkspaceError } from '../domain/workspace.error.js';

/**
 * Guard gắn danh tính đã xác minh vào chính đối tượng request, dưới tên
 * `workspaceActor` — cùng quy ước `request.<moduleKey>Actor` mà Inventory,
 * Maintenance và Procedure đang dùng.
 */
interface WorkspaceRequest {
  workspaceActor?: WorkspaceActor;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

/**
 * Access token của chính người gọi, để chuyển tiếp khi đọc module khác.
 *
 * Đọc đúng hai nguồn mà guard chấp nhận — header `Authorization: Bearer` hoặc
 * cookie `ep_access` — và không làm gì khác với nó. Guard đã xác minh token
 * trước khi request tới được đây.
 */
function accessTokenOf(request: WorkspaceRequest): string | undefined {
  const header = request.headers?.['authorization'];
  const bearer = Array.isArray(header) ? header[0] : header;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  return request.cookies?.['ep_access'];
}

/**
 * Tiền tố `api/workspace` được đặt bằng `setGlobalPrefix` trong main.ts, nên
 * controller chỉ khai báo phần phiên bản.
 *
 * Controller cố ý mỏng: không có logic nghiệp vụ nào ở đây, chỉ đọc tham số,
 * gọi service và đổi lỗi nghiệp vụ thành HTTP.
 */
@Controller('v1')
export class WorkspaceController {
  constructor(
    private readonly app: WorkspaceApplication,
    private readonly projects: ProjectService,
    private readonly workItems: WorkItemService,
    private readonly calendar: CalendarService,
    private readonly chat: ChatService,
    private readonly documents: DocumentService,
    private readonly myWorkService: MyWorkService,
    private readonly reportService: ReportService,
    private readonly externalRefs: ExternalReferenceService,
    private readonly finance: FinanceService,
    private readonly directory: DirectoryService,
    private readonly internalLookup: InternalLookupService,
    private readonly catalog: CatalogService,
    private readonly projectRequests: ProjectRequestService,
    private readonly workdayRules: WorkdayRuleService,
    private readonly projectRoles: ProjectRoleService,
    private readonly workItemDeletion: WorkItemDeletionService,
    private readonly fleetTransport: FleetTransportService,
    private readonly standaloneTasks: StandaloneTaskService,
    private readonly customers: CustomerService,
    private readonly contracts: ContractService,
  ) {}

  /**
   * Xe và tài xế còn trống (kèm khoảng bận) trong một khung giờ, để form công việc và lịch họp không cho chọn
   * trùng. Dữ liệu do HRM trả lời; `excludeSource*` bỏ qua lịch của chính nguồn đang sửa.
   */
  @Get('fleet/availability')
  fleetAvailability(
    @Req() request: WorkspaceRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeSourceType') excludeSourceType?: string,
    @Query('excludeSourceId') excludeSourceId?: string,
  ) {
    return this.execute(async () => ({
      data: await this.fleetTransport.availability(this.actor(request), {
        from,
        to,
        excludeSourceType,
        excludeSourceId,
      }),
    }));
  }

  /** Phương tiện hiện có của một công việc hoặc lịch họp (`null` nếu chưa chọn). */
  @Get('fleet/transports/:sourceType/:sourceId')
  fleetTransportOf(
    @Req() request: WorkspaceRequest,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.execute(async () => ({
      data: await this.fleetTransport.find(this.actor(request), sourceType, sourceId),
    }));
  }

  /** Trạng thái cài đặt module cho tenant đang đăng nhập. */
  @Get('status')
  status(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.app.status(this.actor(request)));
  }

  /* ---------------------------------------------------------------- Dự án */

  @Get('projects')
  listProjects(
    @Req() request: WorkspaceRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('projectType') projectType?: string,
  ) {
    return this.execute(() =>
      this.projects.list(this.actor(request), { search, status, projectType, page, pageSize }),
    );
  }

  /** Loại dự án đang dùng, kèm số dự án — để lọc và gợi ý khi nhập. */
  @Get('project-types')
  listProjectTypes(@Req() request: WorkspaceRequest) {
    return this.execute(async () => ({ items: await this.projects.types(this.actor(request)) }));
  }

  /* ------------------------------------------------------ Nhãn & mẫu lọc */

  @Get('tags')
  listTags(@Req() request: WorkspaceRequest) {
    return this.execute(async () => ({ items: await this.catalog.tags(this.actor(request)) }));
  }

  @Post('tags')
  @HttpCode(201)
  createTag(@Req() request: WorkspaceRequest, @Body() body: CreateTagRequest) {
    return this.execute(() =>
      this.catalog.createTag(this.actor(request), body ?? ({} as CreateTagRequest)),
    );
  }

  @Patch('tags/:id')
  updateTag(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateTagRequest,
  ) {
    return this.execute(() => this.catalog.updateTag(this.actor(request), id, body ?? {}));
  }

  @Get('saved-filters')
  listSavedFilters(
    @Req() request: WorkspaceRequest,
    @Query('view') view?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.execute(async () => ({
      items: await this.catalog.savedFilters(this.actor(request), { view, projectId }),
    }));
  }

  @Post('saved-filters')
  @HttpCode(201)
  createSavedFilter(@Req() request: WorkspaceRequest, @Body() body: CreateSavedFilterRequest) {
    return this.execute(() =>
      this.catalog.createSavedFilter(
        this.actor(request),
        body ?? ({} as CreateSavedFilterRequest),
      ),
    );
  }

  @Delete('saved-filters/:id')
  @HttpCode(204)
  removeSavedFilter(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.catalog.removeSavedFilter(this.actor(request), id));
  }

  @Post('projects')
  @HttpCode(201)
  createProject(@Req() request: WorkspaceRequest, @Body() body: CreateProjectRequest) {
    return this.execute(() => this.projects.create(this.actor(request), body ?? {}));
  }

  /**
   * Chi tiết dự án. Trường `finance` chỉ có mặt khi người gọi được xem; với
   * `member` và `viewer` nó vắng hẳn khỏi payload.
   */
  @Get('projects/:id')
  getProject(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.finance.detailWithFinance(this.actor(request), id));
  }

  @Patch('projects/:id')
  updateProject(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateProjectRequest,
  ) {
    return this.execute(() => this.projects.update(this.actor(request), id, body ?? {}));
  }

  /** Huỷ dự án. Chuyển `status = cancelled`, không xoá dòng. */
  @Delete('projects/:id')
  cancelProject(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.projects.cancel(this.actor(request), id));
  }

  @Get('projects/:id/members')
  listMembers(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(async () => ({
      items: await this.projects.members(this.actor(request), id),
    }));
  }

  @Put('projects/:id/members')
  setMembers(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: SetProjectMembersRequest,
  ) {
    return this.execute(async () => ({
      items: await this.projects.setMembers(this.actor(request), id, body ?? { members: [] }),
    }));
  }

  @Get('projects/:id/work-items')
  projectTree(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.workItems.tree(this.actor(request), id));
  }

  /** Nhật ký hoạt động của cả dự án; nuôi tab Hoạt động. */
  @Get('projects/:id/activity')
  projectActivity(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(async () => ({
      items: await this.workItems.projectHistory(this.actor(request), id),
    }));
  }

  @Get('projects/:id/dependencies')
  projectDependencies(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(async () => ({
      items: await this.workItems.projectDependencies(this.actor(request), id),
    }));
  }

  /* ----------------------------------------------------------- Công việc */

  @Post('work-items')
  @HttpCode(201)
  createWorkItem(@Req() request: WorkspaceRequest, @Body() body: CreateWorkItemRequest) {
    return this.execute(() =>
      this.workItems.create(this.actor(request), body ?? ({} as CreateWorkItemRequest)),
    );
  }

  @Get('work-items/:id')
  getWorkItem(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.workItems.detail(this.actor(request), id));
  }

  @Patch('work-items/:id')
  updateWorkItem(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateWorkItemRequest,
  ) {
    return this.execute(() => this.workItems.update(this.actor(request), id, body ?? {}));
  }

  /** Huỷ hiệu lực công việc đã hoàn thành — chủ nhiệm dự án hoặc quản trị. */
  @Post('work-items/:id/reverse')
  @HttpCode(200)
  reverseWorkItem(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: ReverseWorkItemRequest,
  ) {
    return this.execute(() =>
      this.workItems.reverse(this.actor(request), id, body ?? ({} as ReverseWorkItemRequest)),
    );
  }

  @Patch('work-items/:id/status')
  changeWorkItemStatus(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: ChangeWorkItemStatusRequest,
  ) {
    return this.execute(() =>
      this.workItems.changeStatus(
        this.actor(request),
        id,
        body ?? ({} as ChangeWorkItemStatusRequest),
      ),
    );
  }

  @Post('work-items/:id/move')
  moveWorkItem(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: MoveWorkItemRequest,
  ) {
    return this.execute(() => this.workItems.move(this.actor(request), id, body ?? {}));
  }

  /**
   * Xoá hẳn công việc (và cả nhánh con) — chỉ chủ nhiệm dự án. Khác với "Huỷ"
   * (đổi trạng thái `cancelled`, mở lại được) ở `PATCH .../status`.
   */
  @Delete('work-items/:id')
  @HttpCode(204)
  deleteWorkItem(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.workItemDeletion.delete(this.actor(request), id));
  }

  @Get('work-items/:id/history')
  workItemHistory(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(async () => ({
      items: await this.workItems.history(this.actor(request), id),
    }));
  }

  /* ------------------------------------------------------------ Phụ thuộc */

  @Get('work-items/:id/dependencies')
  listDependencies(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(async () => ({
      items: await this.workItems.dependencies(this.actor(request), id),
    }));
  }

  @Post('work-items/:id/dependencies')
  @HttpCode(201)
  addDependency(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: AddDependencyRequest,
  ) {
    return this.execute(() =>
      this.workItems.addDependency(
        this.actor(request),
        id,
        body ?? ({} as AddDependencyRequest),
      ),
    );
  }

  @Delete('work-items/:id/dependencies/:dependencyId')
  @HttpCode(204)
  removeDependency(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Param('dependencyId') dependencyId: string,
  ) {
    return this.execute(() =>
      this.workItems.removeDependency(this.actor(request), id, dependencyId),
    );
  }

  /* --------------------------------------------------------- Lịch biểu */

  /**
   * Lịch trong một khoảng, đã khai triển chuỗi lặp.
   *
   * Không truyền `projectId` thì chỉ trả lịch của chính người gọi.
   */
  @Get('calendar')
  calendarRange(
    @Req() request: WorkspaceRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.execute(() =>
      this.calendar.range(this.actor(request), { from, to, projectId }),
    );
  }

  @Get('calendar/events/:id')
  getEvent(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.calendar.detail(this.actor(request), id));
  }

  @Post('calendar/events')
  @HttpCode(201)
  createEvent(@Req() request: WorkspaceRequest, @Body() body: CreateEventRequest) {
    return this.execute(() =>
      this.calendar.create(this.actor(request), body ?? ({} as CreateEventRequest)),
    );
  }

  @Patch('calendar/events/:id')
  updateEvent(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateEventRequest,
  ) {
    return this.execute(() => this.calendar.update(this.actor(request), id, body ?? {}));
  }

  /** `scope=single` cần thêm `occurrenceDate`; mặc định huỷ cả sự kiện. */
  @Delete('calendar/events/:id')
  cancelEvent(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Query('scope') scope?: string,
    @Query('occurrenceDate') occurrenceDate?: string,
  ) {
    return this.execute(() =>
      this.calendar.cancel(
        this.actor(request),
        id,
        scope === 'single' || scope === 'following' ? scope : 'all',
        occurrenceDate,
      ),
    );
  }

  @Post('calendar/events/:id/respond')
  respondToEvent(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: RespondToEventRequest,
  ) {
    return this.execute(() =>
      this.calendar.respond(this.actor(request), id, String(body?.responseStatus ?? '')),
    );
  }


  /* ----------------------------------------------------------- Tài liệu */

  @Get('folders')
  listFolders(@Req() request: WorkspaceRequest, @Query('projectId') projectId?: string) {
    return this.execute(async () => ({
      items: await this.documents.folders(this.actor(request), projectId),
    }));
  }

  @Post('folders')
  @HttpCode(201)
  createFolder(@Req() request: WorkspaceRequest, @Body() body: CreateFolderRequest) {
    return this.execute(() =>
      this.documents.createFolder(this.actor(request), body ?? ({} as CreateFolderRequest)),
    );
  }

  /**
   * Dọn sẵn đường dẫn `<gốc>/<dự án>/<công việc>` và trả về thư mục lá.
   *
   * Gọi ngay trước khi tạo tài liệu: giao diện chỉ cần hỏi người dùng thư mục
   * gốc, phần phân loại theo dự án và công việc do server lo cho nhất quán
   * giữa mọi lối tải lên (tab Tài liệu, khung trao đổi).
   */
  @Post('folders/ensure-path')
  @HttpCode(200)
  ensureFolderPath(
    @Req() request: WorkspaceRequest,
    @Body() body: EnsureFolderPathRequest,
  ) {
    return this.execute(() =>
      this.documents.ensurePath(
        this.actor(request),
        body ?? ({} as EnsureFolderPathRequest),
      ),
    );
  }

  /** Đổi tên hoặc chuyển thư mục; thư mục dự án do thành viên dự án quản lý. */
  @Patch('folders/:id')
  updateFolder(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateFolderRequest,
  ) {
    return this.execute(() =>
      this.documents.updateFolder(this.actor(request), id, body ?? ({} as UpdateFolderRequest)),
    );
  }

  /**
   * Gỡ thư mục rỗng khỏi cây. Thư mục dự án: thành viên dự án; kho cấp đơn vị:
   * cần quyền xoá, mặc định chỉ quản trị tenant.
   */
  @Delete('folders/:id')
  @HttpCode(204)
  removeFolder(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.removeFolder(this.actor(request), id));
  }

  @Get('documents')
  listDocuments(
    @Req() request: WorkspaceRequest,
    @Query('projectId') projectId?: string,
    @Query('folderId') folderId?: string,
    @Query('status') status?: string,
    @Query('audience') audience?: string,
    @Query('search') search?: string,
    @Query('linkedType') linkedType?: string,
    @Query('linkedId') linkedId?: string,
  ) {
    return this.execute(async () => ({
      items: await this.documents.list(this.actor(request), {
        projectId,
        folderId,
        status,
        audience,
        search,
        linkedType,
        linkedId,
      }),
    }));
  }

  /**
   * Chặng 1 của luồng tải lên ba chặng.
   *
   * Trả về `uploadUrl` ký trước; trình duyệt `PUT` thẳng tệp lên đó. Không có
   * chặng 3 — server không được kho lưu trữ báo lại.
   */
  @Post('documents')
  @HttpCode(201)
  createDocument(@Req() request: WorkspaceRequest, @Body() body: CreateDocumentRequest) {
    return this.execute(() =>
      this.documents.create(this.actor(request), body ?? ({} as CreateDocumentRequest)),
    );
  }

  @Get('documents/:id')
  getDocument(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.detail(this.actor(request), id));
  }

  @Post('documents/:id/versions')
  @HttpCode(201)
  createVersion(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: CreateVersionRequest,
  ) {
    return this.execute(() =>
      this.documents.addVersion(this.actor(request), id, body ?? ({} as CreateVersionRequest)),
    );
  }

  /** Chặng 3 của luồng tải lên: trình duyệt báo đã `PUT` xong lên kho. */
  @Post('documents/:id/versions/:versionId/complete')
  completeUpload(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: CompleteUploadRequest,
  ) {
    return this.execute(() =>
      this.documents.completeUpload(this.actor(request), id, versionId, body?.sizeBytes),
    );
  }

  /**
   * `versionId` rỗng nghĩa là phiên bản hiện hành. `mode=preview` cấp URL mở
   * ngay trong trình duyệt để xem trước.
   */
  @Get('documents/:id/download')
  downloadDocument(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
    @Query('mode') mode?: string,
  ) {
    return this.execute(() =>
      this.documents.download(
        this.actor(request),
        id,
        versionId,
        mode === 'preview' ? 'preview' : 'download',
      ),
    );
  }

  @Post('documents/:id/lock')
  lockDocument(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.lock(this.actor(request), id));
  }

  @Post('documents/:id/unlock')
  unlockDocument(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.unlock(this.actor(request), id));
  }

  /** Đổi phân loại nội bộ/khách hàng của tài liệu. */
  @Patch('documents/:id/audience')
  setDocumentAudience(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateDocumentAudienceRequest,
  ) {
    return this.execute(() => this.documents.setAudience(this.actor(request), id, body?.audience));
  }

  /** Lưu trữ: chuyển `status = archived`, không xoá dòng và không xoá tệp. */
  @Delete('documents/:id')
  archiveDocument(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.archive(this.actor(request), id));
  }

  @Post('documents/:id/links')
  @HttpCode(201)
  linkDocument(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: LinkDocumentRequest,
  ) {
    return this.execute(() =>
      this.documents.link(this.actor(request), id, body ?? ({} as LinkDocumentRequest)),
    );
  }

  /** Cho tài liệu hiện thêm ở một thư mục khác, không nhân bản tệp. */
  @Post('documents/:id/folder-refs')
  @HttpCode(201)
  addFolderRef(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: AddFolderRefRequest,
  ) {
    return this.execute(() =>
      this.documents.addFolderRef(this.actor(request), id, body ?? ({} as AddFolderRefRequest)),
    );
  }

  @Delete('documents/:id/folder-refs/:refId')
  @HttpCode(204)
  removeFolderRef(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Param('refId') refId: string,
  ) {
    return this.execute(() => this.documents.removeFolderRef(this.actor(request), id, refId));
  }

  @Delete('documents/:id/links/:linkId')
  @HttpCode(204)
  unlinkDocument(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ) {
    return this.execute(() => this.documents.unlink(this.actor(request), id, linkId));
  }
  /* -------------------------------------------------------- Chat theo node */

  /**
   * Luồng tin của một node.
   *
   * Node chưa từng có ai nhắn vẫn trả `200` với luồng rỗng — Drawer phải mở
   * được ở mọi node, kênh chỉ sinh khi có tin đầu tiên.
   */
  @Get('chat/:entityType/:entityId')
  chatThread(
    @Req() request: WorkspaceRequest,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('before') before?: string,
  ) {
    return this.execute(() =>
      this.chat.thread(this.actor(request), entityType, entityId, before || undefined),
    );
  }

  /**
   * Ai cần nhận tín hiệu "đang nhập" của một node.
   *
   * Dịch vụ realtime gọi bằng cookie của người đang gõ để kiểm quyền và lấy danh
   * sách; kết quả được nó lưu tạm. Dùng tiền tố riêng `chat-typing` để không bao
   * giờ bị route `chat/:entityType/:entityId` bắt nhầm.
   */
  @Get('chat-typing/recipients')
  chatTypingRecipients(
    @Req() request: WorkspaceRequest,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.execute(() =>
      this.chat.typingRecipients(this.actor(request), entityType ?? '', entityId ?? ''),
    );
  }

  @Post('chat/messages')
  @HttpCode(201)
  sendChatMessage(@Req() request: WorkspaceRequest, @Body() body: SendChatMessageRequest) {
    return this.execute(() =>
      this.chat.send(this.actor(request), body ?? ({} as SendChatMessageRequest)),
    );
  }

  @Patch('chat/messages/:id')
  editChatMessage(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateChatMessageRequest,
  ) {
    return this.execute(() =>
      this.chat.edit(this.actor(request), id, body ?? ({} as UpdateChatMessageRequest)),
    );
  }

  /** Thu hồi tin: xoá mềm, dòng ở lại để các trả lời không mất ngữ cảnh. */
  @Delete('chat/messages/:id')
  deleteChatMessage(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.chat.remove(this.actor(request), id));
  }

  /**
   * Số tin chưa đọc của cả cây trong MỘT lời gọi.
   *
   * Cây 200 node vẫn chỉ tốn một request để biết chỗ nào cần tô chấm đỏ.
   */
  @Get('projects/:id/unread')
  projectUnread(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.chat.unread(this.actor(request), id));
  }

  /* ------------------------------------------------- Công việc của tôi */

  /**
   * Tổng hợp của riêng người đang đăng nhập.
   *
   * **Cố ý không có tham số nào.** Danh tính lấy từ `actor(request)` do guard
   * gắn vào; một `userId` gửi kèm trên query string sẽ bị bỏ qua hoàn toàn vì
   * không chỗ nào đọc tới nó. Kể cả `tenant-admin` cũng chỉ thấy việc của
   * chính mình ở đây — ngoại lệ duy nhất của cơ chế override toàn tenant.
   */
  /**
   * Danh bạ người trong tổ chức — để chọn thành viên dự án, người tham dự
   * sự kiện, và hiện tên thật. Chỉ tên và đơn vị, không có quyền.
   */
  @Get('directory')
  directoryList(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.directory.list(this.actor(request)));
  }

  /* -------------------------------------------------------- Đọc nội bộ */

  /**
   * Nhãn công việc cho module khác. Guard chỉ cho qua khi có service token và
   * `x-tenant-id`; payload không có tài chính, mô tả hay thành viên.
   */
  @Get('internal/work-items/:id')
  internalWorkItem(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.internalLookup.workItem(this.actor(request), id));
  }

  /** Danh sách dự án của tenant cho module khác cho chọn (Tài chính hạch toán thu chi); chỉ mã, tên, trạng thái. */
  @Get('internal/projects')
  internalProjects(
    @Req() request: WorkspaceRequest,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() => this.internalLookup.listProjects(this.actor(request), { search, limit }));
  }

  /** Công việc của một dự án cho module khác cho chọn. */
  @Get('internal/projects/:id/work-items')
  internalProjectWorkItems(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(async () => ({
      items: await this.internalLookup.projectWorkItems(this.actor(request), id),
    }));
  }

  /** Nhãn và số liệu tiến độ của dự án cho module khác; không tài chính. */
  @Get('internal/projects/:id')
  internalProject(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.internalLookup.project(this.actor(request), id));
  }

  @Get('my-work')
  myWork(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.myWorkService.summary(this.actor(request)));
  }

  /* ------------------------------------------ Công việc ngoài dự án */

  /** `scope`: `assigned_to_me` (mặc định), `assigned_by_me` hoặc `following`. */
  @Get('standalone-tasks')
  listStandaloneTasks(@Req() request: WorkspaceRequest, @Query('scope') scope?: string) {
    return this.execute(() => this.standaloneTasks.list(this.actor(request), scope));
  }

  @Get('standalone-tasks/:id')
  getStandaloneTask(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.standaloneTasks.detail(this.actor(request), id));
  }

  @Post('standalone-tasks')
  @HttpCode(201)
  createStandaloneTask(
    @Req() request: WorkspaceRequest,
    @Body() body: CreateStandaloneTaskRequest,
  ) {
    return this.execute(() =>
      this.standaloneTasks.create(
        this.actor(request),
        body ?? ({} as CreateStandaloneTaskRequest),
      ),
    );
  }

  @Patch('standalone-tasks/:id')
  updateStandaloneTask(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateStandaloneTaskRequest,
  ) {
    return this.execute(() => this.standaloneTasks.update(this.actor(request), id, body ?? {}));
  }

  @Patch('standalone-tasks/:id/status')
  changeStandaloneTaskStatus(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: ChangeStandaloneTaskStatusRequest,
  ) {
    return this.execute(() =>
      this.standaloneTasks.changeStatus(
        this.actor(request),
        id,
        body ?? ({} as ChangeStandaloneTaskStatusRequest),
      ),
    );
  }

  /** Huỷ hiệu lực việc đã hoàn thành (người giao). */
  @Post('standalone-tasks/:id/reverse')
  @HttpCode(200)
  reverseStandaloneTask(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: ReverseStandaloneTaskRequest,
  ) {
    return this.execute(() =>
      this.standaloneTasks.reverse(
        this.actor(request),
        id,
        body ?? ({} as ReverseStandaloneTaskRequest),
      ),
    );
  }

  @Delete('standalone-tasks/:id')
  @HttpCode(204)
  removeStandaloneTask(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.standaloneTasks.remove(this.actor(request), id));
  }

  /* ------------------------------------------------ Khách hàng & Hợp đồng */

  @Get('customers')
  listCustomers(@Req() request: WorkspaceRequest, @Query('query') query?: string) {
    return this.execute(() => this.customers.list(this.actor(request), { search: query }));
  }

  @Get('customers/:id')
  getCustomer(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.customers.detail(this.actor(request), id));
  }

  @Post('customers')
  @HttpCode(201)
  createCustomer(@Req() request: WorkspaceRequest, @Body() body: CreateCustomerRequest) {
    return this.execute(() =>
      this.customers.create(this.actor(request), body ?? ({} as CreateCustomerRequest)),
    );
  }

  @Patch('customers/:id')
  updateCustomer(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateCustomerRequest,
  ) {
    return this.execute(() => this.customers.update(this.actor(request), id, body ?? {}));
  }

  @Delete('customers/:id')
  @HttpCode(204)
  removeCustomer(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.customers.remove(this.actor(request), id));
  }

  @Get('customers/:id/contracts')
  listCustomerContracts(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.contracts.listByCustomer(this.actor(request), id));
  }

  @Post('contracts')
  @HttpCode(201)
  createContract(@Req() request: WorkspaceRequest, @Body() body: CreateContractRequest) {
    return this.execute(() =>
      this.contracts.create(this.actor(request), body ?? ({} as CreateContractRequest)),
    );
  }

  @Patch('contracts/:id')
  updateContract(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateContractRequest,
  ) {
    return this.execute(() => this.contracts.update(this.actor(request), id, body ?? {}));
  }

  @Delete('contracts/:id')
  @HttpCode(204)
  removeContract(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.contracts.remove(this.actor(request), id));
  }

  /* ----------------------------------------------------------- Báo cáo */

  /**
   * Ba báo cáo cộng khối "Của tôi".
   *
   * Phạm vi suy từ vai trò ở phía server. `projectIds` chỉ **thu hẹp** phạm
   * vi đó, không mở rộng: lọc một dự án không tham gia trả `403`, không phải
   * mảng rỗng.
   */
  @Get('reports')
  reports(
    @Req() request: WorkspaceRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.execute(() =>
      this.reportService.bundle(this.actor(request), { from, to, projectIds }),
    );
  }

  /* ------------------------------------------------------- Liên module */

  /**
   * Mọi con trỏ sang module khác của một dự án, trong MỘT lời gọi.
   *
   * Cây dùng nó để biết công việc nào chạy theo quy trình mà chưa có con
   * trỏ — đó là những việc cần badge "Chưa mở được quy trình".
   */
  @Get('projects/:id/external-references')
  projectExternalReferences(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() =>
      this.externalRefs.listForProject(this.actor(request), accessTokenOf(request), id),
    );
  }

  @Get('work-items/:id/links')
  workItemLinks(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() =>
      this.externalRefs.listForWorkItem(this.actor(request), accessTokenOf(request), id),
    );
  }

  /**
   * Gửi lại yêu cầu mở hồ sơ cho công việc "Theo quy trình" (Thử lại).
   *
   * Chỉ ghi yêu cầu và phát sự kiện; Quy trình tự mở hồ sơ rồi báo về.
   */
  @Post('work-items/:id/procedure-request')
  @HttpCode(202)
  requestWorkItemProcedure(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: RequestWorkItemProcedureRequest,
  ) {
    return this.execute(() =>
      this.workItems.requestProcedure(this.actor(request), id, String(body?.definitionId ?? '')),
    );
  }

  /** Bước 5 của luồng tạo việc theo quy trình. Lặp lại được, không sinh trùng. */
  @Post('work-items/:id/links')
  @HttpCode(201)
  linkWorkItem(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: CreateExternalReferenceRequest,
  ) {
    return this.execute(() =>
      this.externalRefs.link(
        this.actor(request),
        id,
        body ?? ({} as CreateExternalReferenceRequest),
      ),
    );
  }

  /** Gỡ con trỏ. Hồ sơ gốc ở module kia không bị đụng tới. */
  @Delete('work-items/:id/links/:referenceId')
  @HttpCode(204)
  unlinkWorkItem(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.execute(() =>
      this.externalRefs.unlink(this.actor(request), id, referenceId),
    );
  }

  /* ---------------------------------------------------------- Tài chính */

  /** `member` và `viewer` nhận `403 FINANCE_FORBIDDEN`. */
  @Get('projects/:id/finance')
  projectFinance(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.finance.forProject(this.actor(request), id));
  }

  @Patch('projects/:id/finance')
  updateProjectFinance(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateProjectFinanceRequest,
  ) {
    return this.execute(() => this.finance.updateProject(this.actor(request), id, body ?? {}));
  }

  /**
   * Chi phí một công việc. Endpoint riêng, KHÔNG gộp vào `PATCH /work-items/:id`:
   * `member` sửa được công việc của mình nhưng không được đụng số tiền.
   */
  @Patch('work-items/:id/costs')
  updateWorkItemCost(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: UpdateWorkItemCostRequest,
  ) {
    return this.execute(() => this.finance.updateItemCost(this.actor(request), id, body ?? {}));
  }

  /* -------------------------------------------------------- Sổ chi phí */

  @Get('work-items/:id/cost-entries')
  workItemCostEntries(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.finance.costEntriesForWorkItem(this.actor(request), id));
  }

  /** Ghi một dòng chi phí thực tế. Chỉ ghi thêm — sai thì ghi dòng điều chỉnh. */
  @Post('work-items/:id/cost-entries')
  @HttpCode(201)
  addCostEntry(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: CreateCostEntryRequest,
  ) {
    return this.execute(() =>
      this.finance.addCostEntry(this.actor(request), id, body ?? ({} as CreateCostEntryRequest)),
    );
  }

  @Get('projects/:id/cost-entries')
  projectCostEntries(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.finance.costEntriesForProject(this.actor(request), id));
  }

  /** Thứ tự ưu tiên tính công (dùng chung toàn tenant). */
  @Get('workday-rules')
  getWorkdayRules(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.workdayRules.get(this.actor(request)));
  }

  @Put('workday-rules')
  updateWorkdayRules(
    @Req() request: WorkspaceRequest,
    @Body() body: UpdateWorkdayRulesRequest,
  ) {
    return this.execute(() => this.workdayRules.update(this.actor(request), body));
  }

  /** Vai trò trong dự án (dùng chung toàn tenant) và quyền của từng vai. */
  @Get('project-roles')
  listProjectRoles(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.projectRoles.list(this.actor(request)));
  }

  @Post('project-roles')
  createProjectRole(@Req() request: WorkspaceRequest, @Body() body: SaveProjectRoleRequest) {
    return this.execute(() => this.projectRoles.create(this.actor(request), body));
  }

  @Put('project-roles/:key')
  updateProjectRole(
    @Req() request: WorkspaceRequest,
    @Param('key') key: string,
    @Body() body: SaveProjectRoleRequest,
  ) {
    return this.execute(() => this.projectRoles.update(this.actor(request), key, body));
  }

  @Delete('project-roles/:key')
  removeProjectRole(@Req() request: WorkspaceRequest, @Param('key') key: string) {
    return this.execute(() => this.projectRoles.remove(this.actor(request), key));
  }

  /** Tab "Đơn từ": đơn module khác gửi kèm dự án này. */
  @Get('projects/:id/requests')
  projectRequestList(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.projectRequests.listForProject(this.actor(request), id));
  }

  /** Huỷ hiệu lực đơn từ đã duyệt — gửi yêu cầu sang module nguồn. */
  @Post('project-requests/:id/reverse')
  @HttpCode(200)
  reverseProjectRequest(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: ReverseProjectRequestRequest,
  ) {
    return this.execute(() =>
      this.projectRequests.reverse(this.actor(request), id, body ?? ({} as ReverseProjectRequestRequest)),
    );
  }

  /**
   * Lấy danh tính người gọi. Thiếu nghĩa là guard chưa chạy hoặc đã bị gỡ
   * khỏi route — luôn là lỗi cấu hình, không bao giờ là tình huống bình thường.
   */
  private actor(request: WorkspaceRequest): WorkspaceActor {
    if (!request.workspaceActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted workspace context.' },
        401,
      );
    }
    return request.workspaceActor;
  }

  /**
   * Đổi lỗi nghiệp vụ thành phản hồi HTTP có mã máy đọc được.
   *
   * Lỗi khác `WorkspaceError` được ném tiếp nguyên trạng để Nest trả 500:
   * đó là bug, che đi sẽ khó tìm.
   */
  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      // Id trên URL không phải UUID: Postgres báo `22P02` ở câu truy vấn đầu
      // tiên. Với người gọi, id sai định dạng hay id không có đều là "không
      // tìm thấy" — không phải lỗi 500 của máy chủ.
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof WorkspaceError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
