import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  SHARED_TRASH_PATHS,
  type CompleteSharedUploadRequest,
  type CreateSharedDocumentRequest,
  type CreateSharedFolderRequest,
  type CreateSharedVersionRequest,
  type RestoreSharedTrashRequest,
  type SharedDocumentKind,
  type SharedDocumentStatus,
  type SharedStatus,
  type SharedTrashKind,
  type UpdateSharedDocumentRequest,
  type UpdateSharedFolderRequest,
} from '@enterprise-platform/contracts-shared';
import { CompanyDocumentService } from '../application/company-document.service.js';
import type { SharedActor } from '../application/shared-actor.js';
import { StorageQuotaService } from '../application/storage-quota.service.js';
import { SHARED_STORE, type SharedStore } from '../application/shared-store.port.js';
import { SharedError } from '../domain/shared.error.js';

/** Đoạn đường dẫn `folders`/`documents` của Thùng rác → loại mục. Lạ thì coi như không có route. */
function trashKind(segment: string): SharedTrashKind {
  const kind = (Object.keys(SHARED_TRASH_PATHS) as SharedTrashKind[]).find(
    (key) => SHARED_TRASH_PATHS[key] === segment,
  );
  if (!kind) {
    throw new HttpException(
      { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
      404,
    );
  }
  return kind;
}

/** Guard gắn danh tính đã xác minh vào request dưới tên `sharedActor`. */
interface SharedRequest {
  sharedActor?: SharedActor;
}

@Controller('v1')
export class SharedController {
  constructor(
    private readonly documents: CompanyDocumentService,
    private readonly quota: StorageQuotaService,
    @Inject(SHARED_STORE) private readonly store: SharedStore,
  ) {}

  /** Mức sẵn sàng của phân hệ và quyền của người đang đăng nhập (chỉ để ẩn hiện). */
  @Get('status')
  status(@Req() request: SharedRequest): Promise<SharedStatus> {
    return this.execute(async () => {
      const actor = this.actor(request);
      const schema = await this.store.diagnostics.schemaStatus(actor.tenantId);
      return {
        tenantId: actor.tenantId,
        ...schema,
        capabilities: {
          isTenantAdmin: actor.isTenantAdmin,
          canManage: actor.canManage,
          canWriteDocuments: actor.canWriteDocuments,
          canDeleteDocuments: actor.canDeleteDocuments,
        },
      };
    });
  }

  @Get('storage')
  storage(@Req() request: SharedRequest) {
    return this.execute(() => this.quota.usage(this.actor(request).tenantId));
  }

  /* ------------------------------------------------------------ thư mục */

  @Get('folders')
  folders(@Req() request: SharedRequest) {
    return this.execute(async () => ({ items: await this.documents.folders(this.actor(request)) }));
  }

  @Post('folders')
  createFolder(@Req() request: SharedRequest, @Body() body: CreateSharedFolderRequest) {
    return this.execute(() =>
      this.documents.createFolder(this.actor(request), body ?? ({} as CreateSharedFolderRequest)),
    );
  }

  @Patch('folders/:id')
  updateFolder(
    @Req() request: SharedRequest,
    @Param('id') id: string,
    @Body() body: UpdateSharedFolderRequest,
  ) {
    return this.execute(() => this.documents.updateFolder(this.actor(request), id, body ?? {}));
  }

  /** Chuyển cả nhánh vào Thùng rác; trả số thư mục và tài liệu đã chuyển. */
  @Delete('folders/:id')
  deleteFolder(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.deleteFolder(this.actor(request), id));
  }

  /* ----------------------------------------------------------- tài liệu */

  @Get('documents')
  list(
    @Req() request: SharedRequest,
    @Query('folderId') folderId?: string,
    @Query('search') search?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('expiringWithinDays') expiringWithinDays?: string,
  ) {
    return this.execute(async () => ({
      items: await this.documents.list(this.actor(request), {
        folderId: folderId || undefined,
        search,
        kind: (kind || undefined) as SharedDocumentKind | undefined,
        status: (status || undefined) as SharedDocumentStatus | undefined,
        expiringWithinDays:
          expiringWithinDays === undefined || expiringWithinDays === ''
            ? undefined
            : Number(expiringWithinDays),
      }),
    }));
  }

  @Post('documents')
  create(@Req() request: SharedRequest, @Body() body: CreateSharedDocumentRequest) {
    return this.execute(() =>
      this.documents.create(this.actor(request), body ?? ({} as CreateSharedDocumentRequest)),
    );
  }

  @Get('documents/:id')
  detail(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.detail(this.actor(request), id));
  }

  @Patch('documents/:id')
  update(
    @Req() request: SharedRequest,
    @Param('id') id: string,
    @Body() body: UpdateSharedDocumentRequest,
  ) {
    return this.execute(() => this.documents.update(this.actor(request), id, body ?? {}));
  }

  @Post('documents/:id/versions')
  addVersion(
    @Req() request: SharedRequest,
    @Param('id') id: string,
    @Body() body: CreateSharedVersionRequest,
  ) {
    return this.execute(() =>
      this.documents.addVersion(this.actor(request), id, body ?? ({} as CreateSharedVersionRequest)),
    );
  }

  @Post('documents/:id/versions/:versionId/complete')
  completeUpload(
    @Req() request: SharedRequest,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: CompleteSharedUploadRequest,
  ) {
    return this.execute(() =>
      this.documents.completeUpload(this.actor(request), id, versionId, body?.sizeBytes),
    );
  }

  @Get('documents/:id/download')
  download(
    @Req() request: SharedRequest,
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
    @Query('mode') mode?: string,
  ) {
    return this.execute(() =>
      this.documents.download(
        this.actor(request),
        id,
        versionId || undefined,
        mode === 'preview' ? 'preview' : 'download',
      ),
    );
  }

  @Post('documents/:id/lock')
  lock(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.lock(this.actor(request), id));
  }

  @Delete('documents/:id/lock')
  unlock(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.unlock(this.actor(request), id));
  }

  @Post('documents/:id/archive')
  archive(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.archive(this.actor(request), id));
  }

  @Post('documents/:id/restore')
  restore(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.restore(this.actor(request), id));
  }

  @Post('documents/:id/duplicate')
  duplicate(@Req() request: SharedRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.duplicate(this.actor(request), id));
  }

  /** Chuyển tài liệu vào Thùng rác. */
  @Delete('documents/:id')
  @HttpCode(204)
  async deleteDocument(@Req() request: SharedRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.documents.deleteDocument(this.actor(request), id));
  }

  /* ---------------------------------------------------------- Thùng rác */

  @Get('trash')
  trash(@Req() request: SharedRequest) {
    return this.execute(async () => ({ items: await this.documents.trash(this.actor(request)) }));
  }

  @Post('trash/:kind/:id/restore')
  restoreFromTrash(
    @Req() request: SharedRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body?: RestoreSharedTrashRequest,
  ) {
    return this.execute(() =>
      this.documents.restoreFromTrash(this.actor(request), trashKind(kind), id, body ?? undefined),
    );
  }

  @Delete('trash/:kind/:id')
  @HttpCode(204)
  async purge(
    @Req() request: SharedRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.execute(() => this.documents.purge(this.actor(request), trashKind(kind), id));
  }

  /** Dọn sạch Thùng rác. */
  @Delete('trash')
  emptyTrash(@Req() request: SharedRequest) {
    return this.execute(() => this.documents.emptyTrash(this.actor(request)));
  }

  /* ------------------------------------------------------------ nội bộ */

  private actor(request: SharedRequest): SharedActor {
    if (!request.sharedActor) {
      // Guard luôn gắn actor trước khi tới đây; thiếu là cấu hình sai.
      throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
    }
    return request.sharedActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      // Id trên URL không phải UUID: với người gọi, đó là "không tìm thấy".
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof SharedError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
