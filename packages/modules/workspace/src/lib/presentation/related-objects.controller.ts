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
import { RelatedObjectService } from '../application/related-object.service.js';
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
  ) {
    return this.execute(() => this.related.search(this.actor(request), accessTokenOf(request), kind, q, limit));
  }

  @Get('related-objects/preview')
  preview(@Req() request: WorkspaceRequest, @Query('kind') kind?: string, @Query('id') id?: string) {
    return this.execute(() => this.related.preview(this.actor(request), accessTokenOf(request), kind, id));
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
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
