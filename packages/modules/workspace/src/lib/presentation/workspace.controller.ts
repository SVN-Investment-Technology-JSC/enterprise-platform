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
  CreateFolderRequest,
  EnsureFolderPathRequest,
  CreateProjectRequest,
  CreateVersionRequest,
  CreateWorkItemRequest,
  LinkDocumentRequest,
  MoveWorkItemRequest,
  RespondToEventRequest,
  SendChatMessageRequest,
  SetProjectMembersRequest,
  UpdateChatMessageRequest,
  UpdateEventRequest,
  UpdateProjectFinanceRequest,
  UpdateProjectRequest,
  UpdateWorkItemCostRequest,
  UpdateWorkItemRequest,
} from '@enterprise-platform/contracts-workspace';
import { WorkspaceApplication, type WorkspaceActor } from '../application/workspace.application.js';
import { ProjectService } from '../application/project.service.js';
import { WorkItemService } from '../application/work-item.service.js';
import { CalendarService } from '../application/calendar.service.js';
import { ChatService } from '../application/chat.service.js';
import { DirectoryService } from '../application/directory.service.js';
import { DocumentService } from '../application/document.service.js';
import { ExternalReferenceService } from '../application/external-reference.service.js';
import { FinanceService } from '../application/finance.service.js';
import { InternalLookupService } from '../application/internal-lookup.service.js';
import { MyWorkService } from '../application/my-work.service.js';
import { ReportService } from '../application/report.service.js';
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
  ) {}

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
  ) {
    return this.execute(() =>
      this.projects.list(this.actor(request), { search, status, page, pageSize }),
    );
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

  /** Gỡ thư mục rỗng khỏi cây; cần quyền xoá, mặc định chỉ quản trị tenant. */
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
    @Query('search') search?: string,
    @Query('linkedType') linkedType?: string,
    @Query('linkedId') linkedId?: string,
  ) {
    return this.execute(async () => ({
      items: await this.documents.list(this.actor(request), {
        projectId,
        folderId,
        status,
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

  /** `versionId` rỗng nghĩa là phiên bản hiện hành. */
  @Get('documents/:id/download')
  downloadDocument(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.execute(() => this.documents.download(this.actor(request), id, versionId));
  }

  @Post('documents/:id/lock')
  lockDocument(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.lock(this.actor(request), id));
  }

  @Post('documents/:id/unlock')
  unlockDocument(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.unlock(this.actor(request), id));
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
  ) {
    return this.execute(() => this.chat.thread(this.actor(request), entityType, entityId));
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

  /** Nhãn và số liệu tiến độ của dự án cho module khác; không tài chính. */
  @Get('internal/projects/:id')
  internalProject(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.internalLookup.project(this.actor(request), id));
  }

  @Get('my-work')
  myWork(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.myWorkService.summary(this.actor(request)));
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
