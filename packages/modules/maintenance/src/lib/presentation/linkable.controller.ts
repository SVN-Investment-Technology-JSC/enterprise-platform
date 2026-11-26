import {
  clampLinkableLimit,
  parseLinkableIds,
  type LinkableCandidateList,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import { Controller, Get, HttpException, Inject, Query, Req } from '@nestjs/common';
import { MaintenanceApplication } from '../application/maintenance.application.js';
import type { MaintenanceActor } from '../application/maintenance-store.port.js';
import { MaintenanceError } from '../domain/maintenance.error.js';
import {
  MAINTENANCE_LINKABLE_KINDS,
  MAINTENANCE_LINKABLE_KIND_LIST,
  isMaintenanceLinkableKind,
  occurrenceCandidate,
  occurrenceObject,
  searchOccurrences,
  type MaintenanceLinkableKind,
} from './linkable.mapper.js';

interface MaintenanceRequest {
  maintenanceActor?: MaintenanceActor;
}

/**
 * Bảo trì công bố phiếu bảo trì để module khác (Workspace) gắn làm "đối tượng liên quan". Chỉ đọc.
 *
 * Gọi lại đúng service mà màn Bảo trì dùng (`workspace` cho danh sách phiếu như `GET v1/occurrences`, `getOccurrence`
 * như `GET v1/occurrences/:id`); guard của app đã đòi `maintenance.read` cho mọi GET, nên ai không vào được Bảo trì thì
 * cũng không tìm, không gắn được. Không thêm truy vấn hay bảng nào. Hợp đồng route: `contracts-integration`
 * (`linkable-objects.ts`).
 */
@Controller('v1/linkable')
export class MaintenanceLinkableController {
  constructor(@Inject(MaintenanceApplication) private readonly maintenance: MaintenanceApplication) {}

  @Get('kinds')
  kinds(@Req() request: MaintenanceRequest): LinkableKindList {
    actorOf(request);
    return { kinds: MAINTENANCE_LINKABLE_KIND_LIST };
  }

  @Get('search')
  search(
    @Req() request: MaintenanceRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<LinkableCandidateList> {
    return execute(async () => {
      const actor = actorOf(request);
      const text = (q ?? '').trim().slice(0, 100) || undefined;
      switch (requireKind(kind)) {
        case MAINTENANCE_LINKABLE_KINDS.occurrence: {
          const { occurrences } = await this.maintenance.workspace(actor);
          return { items: searchOccurrences(occurrences, text, clampLinkableLimit(limit)).map(occurrenceCandidate) };
        }
      }
    });
  }

  /** Hồ sơ đầy đủ theo lô; id không thấy (hoặc sai định dạng) thì bỏ qua, không làm hỏng cả lô. */
  @Get('resolve')
  resolve(
    @Req() request: MaintenanceRequest,
    @Query('kind') kind?: string,
    @Query('ids') ids?: string,
  ): Promise<LinkableObjectList> {
    return execute(async () => {
      const actor = actorOf(request);
      const type = requireKind(kind);
      const settled = await Promise.all(parseLinkableIds(ids).map((id) => this.readOne(actor, type, id)));
      return { items: settled.filter((item): item is LinkableObject => item !== undefined) };
    });
  }

  private async readOne(
    actor: MaintenanceActor,
    kind: MaintenanceLinkableKind,
    id: string,
  ): Promise<LinkableObject | undefined> {
    try {
      switch (kind) {
        case MAINTENANCE_LINKABLE_KINDS.occurrence:
          return occurrenceObject(await this.maintenance.getOccurrence(actor, id));
      }
    } catch (error) {
      // Không tìm thấy, không có quyền, id không phải UUID (Postgres 22P02): bỏ qua dòng này. Lỗi khác là bug, ném tiếp.
      if (isSkippable(error)) return undefined;
      throw error;
    }
  }
}

function isSkippable(error: unknown): boolean {
  if (error instanceof MaintenanceError) return error.code === 'not_found' || error.code === 'forbidden';
  return (error as { code?: string } | null)?.code === '22P02';
}

function actorOf(request: MaintenanceRequest): MaintenanceActor {
  if (!request.maintenanceActor) {
    throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted maintenance context.' }, 401);
  }
  return request.maintenanceActor;
}

function requireKind(kind: unknown): MaintenanceLinkableKind {
  if (!isMaintenanceLinkableKind(kind)) {
    throw new HttpException(
      { statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Bảo trì.' },
      400,
    );
  }
  return kind;
}

/** Đổi lỗi nghiệp vụ thành HTTP giống `MaintenanceController`; lỗi khác là bug và để Nest trả 500. */
async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof MaintenanceError)) throw error;
    const status = { validation: 400, forbidden: 403, not_found: 404, conflict: 409, unavailable: 503 }[error.code];
    throw new HttpException({ statusCode: status, code: error.code.toUpperCase(), message: error.message }, status);
  }
}
