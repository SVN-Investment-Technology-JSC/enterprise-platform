import {
  clampLinkableLimit,
  parseLinkableIds,
  type LinkableCandidateList,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import { Controller, Get, HttpException, Query, Req } from '@nestjs/common';
import { CorrespondenceService } from '../application/correspondence.service.js';
import type { CorrespondenceActor } from '../application/ports.js';
import { CorrespondenceError } from '../domain/correspondence.error.js';
import { CorrespondenceHttp, type CorrespondenceRequest } from './correspondence-http.js';
import {
  CORRESPONDENCE_LINKABLE_KIND_LIST,
  directionOfKind,
  isCorrespondenceLinkableKind,
  letterCandidate,
  letterObject,
  type CorrespondenceLinkableKind,
} from './linkable.mapper.js';

/**
 * Văn thư công bố công văn đến, công văn đi để module khác (Workspace) gắn làm "đối tượng liên quan". Chỉ đọc.
 *
 * Gọi lại đúng `list` (hộp "Công văn đến" / "Công văn đi") và `detail` mà màn Văn thư dùng, nên quyền xem từng công văn
 * (người liên quan, quyền xem mọi công văn, quyền xem công văn mật) y hệt màn hình: công văn không xem được ở Văn thư thì
 * cũng không tìm, không gắn được. Không thêm truy vấn hay bảng nào. Hợp đồng route: `contracts-integration`
 * (`linkable-objects.ts`).
 */
@Controller('v1')
export class CorrespondenceLinkableController extends CorrespondenceHttp {
  constructor(service: CorrespondenceService) {
    super(service);
  }

  @Get('linkable/kinds')
  kinds(@Req() request: CorrespondenceRequest): LinkableKindList {
    this.actor(request);
    return { kinds: CORRESPONDENCE_LINKABLE_KIND_LIST };
  }

  /** Không có chữ thì các công văn mới nhất của chiều đó (như hộp thư trên màn Văn thư). */
  @Get('linkable/search')
  search(
    @Req() request: CorrespondenceRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<LinkableCandidateList> {
    return this.execute(async () => {
      const direction = directionOfKind(requireKind(kind));
      const rows = await this.service.list(this.actor(request), {
        box: direction,
        search: (q ?? '').trim().slice(0, 100) || undefined,
      });
      return { items: rows.slice(0, clampLinkableLimit(limit)).map(letterCandidate) };
    });
  }

  /** Hồ sơ đầy đủ theo lô; công văn không thấy, không được xem hay khác chiều thì bỏ qua, không làm hỏng cả lô. */
  @Get('linkable/resolve')
  resolve(
    @Req() request: CorrespondenceRequest,
    @Query('kind') kind?: string,
    @Query('ids') ids?: string,
  ): Promise<LinkableObjectList> {
    return this.execute(async () => {
      const actor = this.actor(request);
      const type = requireKind(kind);
      const settled = await Promise.all(parseLinkableIds(ids).map((id) => this.readOne(actor, type, id)));
      return { items: settled.filter((item): item is LinkableObject => item !== undefined) };
    });
  }

  private async readOne(
    actor: CorrespondenceActor,
    kind: CorrespondenceLinkableKind,
    id: string,
  ): Promise<LinkableObject | undefined> {
    try {
      const letter = await this.service.detail(actor, id);
      return letter.direction === directionOfKind(kind) ? letterObject(letter) : undefined;
    } catch (error) {
      // Không tìm thấy, không được xem (404/403), id không phải UUID (Postgres 22P02): bỏ qua. Lỗi khác ném tiếp.
      if (error instanceof CorrespondenceError && (error.statusCode === 404 || error.statusCode === 403)) return undefined;
      if ((error as { code?: string } | null)?.code === '22P02') return undefined;
      throw error;
    }
  }
}

function requireKind(kind: unknown): CorrespondenceLinkableKind {
  if (!isCorrespondenceLinkableKind(kind)) {
    throw new HttpException(
      { statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Văn thư.' },
      400,
    );
  }
  return kind;
}
