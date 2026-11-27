import type { CreateRelatedObjectRequest } from '@enterprise-platform/contracts-workspace';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RelatedObjectCreateRejectedError, RelatedObjectService } from '../application/related-object.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { WorkspaceError } from '../domain/workspace.error.js';

interface WorkspaceRequest {
  workspaceActor?: WorkspaceActor;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

/** Access token của chính người gọi, chuyển tiếp nguyên vẹn khi đọc module khác (cùng cách `WorkspaceController`). */
function accessTokenOf(request: WorkspaceRequest): string | undefined {
  const header = request.headers?.['authorization'];
  const bearer = Array.isArray(header) ? header[0] : header;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  return request.cookies?.['ep_access'];
}

/**
 * CSRF của chính phiên người gọi, để chuyển tiếp khi tạo nhanh ở module gốc (module gốc đòi CSRF cho lệnh ghi). Guard
 * toàn cục đã đối chiếu header với cookie `ep_csrf` trước khi tới đây; chỉ nhận khi hai giá trị vẫn khớp.
 */
function csrfTokenOf(request: WorkspaceRequest): string | undefined {
  const header = request.headers?.['x-csrf-token'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value === request.cookies?.['ep_csrf'] ? value : undefined;
}

/** Tiền tố tham số lọc của ô tham chiếu trên route tìm kiếm: `f.customerId=...` thành `customerId=...`. */
const SEARCH_FILTER_PREFIX = 'f.';

/** Gom tham số `f.*` của request (chỉ giá trị chuỗi đơn); hình dạng tên, giá trị do service lọc tiếp. */
function searchFiltersOf(query: Record<string, unknown> | undefined): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [name, value] of Object.entries(query ?? {})) {
    if (!name.startsWith(SEARCH_FILTER_PREFIX) || typeof value !== 'string') continue;
    filters[name.slice(SEARCH_FILTER_PREFIX.length)] = value;
  }
  return filters;
}

/**
 * Đối tượng liên quan (xem mục "ĐỐI TƯỢNG LIÊN QUAN" trong `contracts-workspace`).
 *
 * Controller riêng, không thêm vào `WorkspaceController`, để tính năng mới không đụng file cũ. Đi qua cùng guard toàn cục
 * của workspace-api nên `workspaceActor` đã được xác minh.
 */
@Controller('v1')
export class RelatedObjectsController {
  constructor(private readonly related: RelatedObjectService) {}

  @Get('related-objects/kinds')
  kinds(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.related.kinds(this.actor(request), accessTokenOf(request)));
  }

  @Get('related-objects/search')
  search(
    @Req() request: WorkspaceRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query() query?: Record<string, unknown>,
  ) {
    return this.execute(() =>
      this.related.search(this.actor(request), accessTokenOf(request), kind, q, limit, searchFiltersOf(query)),
    );
  }

  /** Xem trước theo giá trị một ô của form tạo nhanh (ô có `preview`); GET, đi dưới phiên người gọi như tìm kiếm. */
  @Get('related-objects/create-preview')
  createPreview(
    @Req() request: WorkspaceRequest,
    @Query('kind') kind?: string,
    @Query('field') field?: string,
    @Query('value') value?: string,
  ) {
    return this.execute(() => this.related.createPreview(this.actor(request), accessTokenOf(request), kind, field, value));
  }

  @Get('related-objects/preview')
  preview(@Req() request: WorkspaceRequest, @Query('kind') kind?: string, @Query('id') id?: string) {
    return this.execute(() => this.related.preview(this.actor(request), accessTokenOf(request), kind, id));
  }

  /** Form tạo nhanh do module gốc mô tả (loại có `create`). */
  @Get('related-objects/create-form')
  createForm(@Req() request: WorkspaceRequest, @Query('kind') kind?: string) {
    return this.execute(() => this.related.createForm(this.actor(request), accessTokenOf(request), kind));
  }

  /** Tạo hồ sơ ở module gốc dưới phiên người gọi; chưa gắn vào dự án hay công việc nào. */
  @Post('related-objects/create')
  @HttpCode(201)
  createRecord(@Req() request: WorkspaceRequest, @Query('kind') kind?: string, @Body() body?: unknown) {
    return this.execute(() =>
      this.related.createRecord(this.actor(request), accessTokenOf(request), csrfTokenOf(request), kind, body),
    );
  }

  @Get('projects/:id/related-objects')
  listForProject(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.related.listForProject(this.actor(request), accessTokenOf(request), id));
  }

  @Get('work-items/:id/related-objects')
  listForWorkItem(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.related.listForWorkItem(this.actor(request), accessTokenOf(request), id));
  }

  @Post('projects/:id/related-objects')
  @HttpCode(201)
  linkToProject(@Req() request: WorkspaceRequest, @Param('id') id: string, @Body() body: CreateRelatedObjectRequest) {
    return this.execute(() =>
      this.related.linkToProject(this.actor(request), accessTokenOf(request), id, body ?? ({} as CreateRelatedObjectRequest)),
    );
  }

  @Post('work-items/:id/related-objects')
  @HttpCode(201)
  linkToWorkItem(@Req() request: WorkspaceRequest, @Param('id') id: string, @Body() body: CreateRelatedObjectRequest) {
    return this.execute(() =>
      this.related.linkToWorkItem(this.actor(request), accessTokenOf(request), id, body ?? ({} as CreateRelatedObjectRequest)),
    );
  }

  @Delete('related-objects/:id')
  @HttpCode(204)
  unlink(@Req() request: WorkspaceRequest, @Param('id') id: string) {
    return this.execute(() => this.related.unlink(this.actor(request), id));
  }

  private actor(request: WorkspaceRequest): WorkspaceActor {
    if (!request.workspaceActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted workspace context.' },
        401,
      );
    }
    return request.workspaceActor;
  }

  /** Đổi lỗi nghiệp vụ thành phản hồi HTTP có mã máy đọc được; id sai định dạng UUID coi là không tìm thấy. */
  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof WorkspaceError)) throw error;
      // Tạo nhanh bị module gốc từ chối: kèm cảnh báo cần xác nhận và ô sai để hộp thoại hiện đúng chỗ.
      const extra =
        error instanceof RelatedObjectCreateRejectedError
          ? { warnings: error.warnings, ...(error.field ? { field: error.field } : {}) }
          : {};
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message, ...extra },
        error.statusCode,
      );
    }
  }
}
