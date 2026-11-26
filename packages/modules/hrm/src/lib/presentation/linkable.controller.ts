import type { HrmAction } from '@enterprise-platform/contracts-identity';
import {
  clampLinkableLimit,
  parseLinkableIds,
  type LinkableCandidate,
  type LinkableCandidateList,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmApprovalPolicyService, approverPermissions } from '../infrastructure/hrm-approval-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';
import { HrmCustomRequestController } from './hrm-custom-request.controller.js';
import { HrmEmployeeController } from './hrm-employee.controller.js';
import { HrmLeaveController } from './hrm-leave.controller.js';
import { HrmPersonnelDecisionController } from './hrm-personnel-decision.controller.js';
import { HrmRequestController } from './hrm-request.controller.js';
import {
  HRM_LINKABLE_KINDS,
  HRM_LINKABLE_KIND_LIST,
  HRM_LINKABLE_REQUEST_TYPES,
  NO_PEOPLE,
  customCandidate,
  customObject,
  decisionCandidate,
  decisionObject,
  hrmLinkablePeople,
  isGroupFollower,
  isHrmLinkableKind,
  leaveCandidate,
  leaveObject,
  matchesLinkableQuery,
  otCandidate,
  otObject,
  tripCandidate,
  tripObject,
  type HrmLinkableKind,
  type HrmLinkablePeople,
  type HrmLinkablePerson,
  type HrmLinkableRequestKind,
} from './linkable.mapper.js';

/** Một trang của `GET employee-options` (giới hạn của route đó) và số trang tối đa đọc để lấy họ tên. */
const PEOPLE_PAGE_SIZE = 100;
const PEOPLE_MAX_PAGES = 30;

interface RequestRow {
  readonly id: string;
  readonly employeeId: string;
  readonly approvedBy?: string | null;
  readonly createdAt: string;
  readonly groupId?: string | null;
}

/** Cách đọc và chuyển dạng một loại đơn; `list` gọi đúng route danh sách sẵn có, `forApproval` như màn Duyệt đơn. */
interface RequestSource<T extends RequestRow> {
  readonly list: (forApproval?: '1') => Promise<{ readonly data: readonly T[] }>;
  readonly candidate: (row: T, people: HrmLinkablePeople) => LinkableCandidate;
  readonly object: (row: T, people: HrmLinkablePeople) => LinkableObject;
}

/**
 * Nhân sự công bố hồ sơ để module khác (Workspace) gắn làm "đối tượng liên quan". Chỉ đọc.
 *
 * Gọi lại đúng các handler danh sách/chi tiết sẵn có (cùng request của người dùng), nên quyền và phạm vi dữ liệu y hệt
 * màn hình Nhân sự; không thêm truy vấn hay bảng nào:
 * - Đơn làm thêm, nghỉ phép, công tác, đơn khác: route danh sách `GET ot-requests`, `leave-requests`,
 *   `business-trip-requests`, `custom-requests`. Người có `hrm.request.read` thấy mọi đơn; người khác thấy đơn của mình
 *   cộng danh sách chờ duyệt (`forApproval=1`) trong phạm vi duyệt của họ. Chưa có route đọc một đơn, nên `resolve` đọc
 *   danh sách rồi lọc theo id.
 * - Quyết định nhân sự: `GET personnel-decisions` và `GET personnel-decisions/:id` (`hrm.appointment.read`).
 * - Họ tên, mã, đơn vị người đề nghị và người duyệt: `GET employee-options` (`hrm.read`).
 *
 * `@RequirePermission('hrm.read')` là quyền tối thiểu chung của mọi loại (mọi quyền HRM đều kéo theo `hrm.read`); quyền
 * và phạm vi riêng từng loại do handler gốc kiểm như khi mở màn hình. Hợp đồng route: `contracts-integration`
 * (`linkable-objects.ts`).
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1/linkable')
export class HrmLinkableController {
  private readonly requests: HrmRequestController;
  private readonly leaves: HrmLeaveController;
  private readonly customs: HrmCustomRequestController;
  private readonly decisions: HrmPersonnelDecisionController;
  private readonly employees: HrmEmployeeController;

  constructor(
    private readonly ctx: HrmContextService,
    bridge: HrmProcedureBridgeService,
    approvals: HrmApprovalPolicyService,
  ) {
    this.requests = new HrmRequestController(ctx, bridge, approvals);
    this.leaves = new HrmLeaveController(ctx, bridge, approvals);
    this.customs = new HrmCustomRequestController(ctx, bridge, approvals);
    this.decisions = new HrmPersonnelDecisionController(ctx);
    this.employees = new HrmEmployeeController(ctx);
  }

  /** Chỉ các loại người dùng đọc được, theo đúng điều kiện của route danh sách từng loại. */
  @Get('kinds')
  @RequirePermission('hrm.read')
  async kinds(@Req() req: Request): Promise<LinkableKindList> {
    const readable = await Promise.all(HRM_LINKABLE_KIND_LIST.map((kind) => this.canRead(req, kind.key as HrmLinkableKind)));
    return { kinds: HRM_LINKABLE_KIND_LIST.filter((_, index) => readable[index]) };
  }

  @Get('search')
  @RequirePermission('hrm.read')
  async search(
    @Req() req: Request,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<LinkableCandidateList> {
    const type = requireKind(kind);
    const query = (q ?? '').trim().slice(0, 100);
    const max = clampLinkableLimit(limit);
    if (type === HRM_LINKABLE_KINDS.decision) {
      const rows = (await this.decisions.list(req)).data;
      return { items: rows.map(decisionCandidate).filter((item) => matchesLinkableQuery(item, query)).slice(0, max) };
    }
    return this.searchRequests(req, this.source(req, type), query, max);
  }

  /** Hồ sơ đầy đủ theo lô; id không thấy hoặc không có quyền thì bỏ qua, không làm hỏng cả lô. */
  @Get('resolve')
  @RequirePermission('hrm.read')
  async resolve(
    @Req() req: Request,
    @Query('kind') kind?: string,
    @Query('ids') ids?: string,
  ): Promise<LinkableObjectList> {
    const type = requireKind(kind);
    const wanted = parseLinkableIds(ids);
    if (wanted.length === 0) return { items: [] };
    if (type === HRM_LINKABLE_KINDS.decision) {
      const settled = await Promise.all(wanted.map((id) => skipUnreadable(() => this.decisions.get(req, id))));
      const rows = settled.flatMap((result) => (result ? [result.data] : []));
      const people = await this.people(req, [], rows.map((row) => row.approvedBy));
      return { items: rows.map((row) => decisionObject(row, people)) };
    }
    return this.resolveRequests(req, this.source(req, type), wanted);
  }

  private source(req: Request, kind: HrmLinkableRequestKind): RequestSource<RequestRow> {
    switch (kind) {
      case HRM_LINKABLE_KINDS.ot:
        return erase({
          list: (forApproval) =>
            this.requests.listOtRequests(req, undefined, undefined, undefined, undefined, forApproval),
          candidate: otCandidate,
          object: otObject,
        });
      case HRM_LINKABLE_KINDS.leave:
        return erase({
          list: (forApproval) => this.leaves.listLeaveRequests(req, undefined, undefined, forApproval),
          candidate: leaveCandidate,
          object: leaveObject,
        });
      case HRM_LINKABLE_KINDS.trip:
        return erase({
          list: (forApproval) => this.requests.listBusinessTripRequests(req, undefined, undefined, forApproval),
          candidate: tripCandidate,
          object: tripObject,
        });
      case HRM_LINKABLE_KINDS.custom:
        return erase({
          list: (forApproval) =>
            this.customs.list(req, undefined, undefined, undefined, undefined, undefined, forApproval),
          candidate: customCandidate,
          object: customObject,
        });
    }
  }

  private async searchRequests(
    req: Request,
    source: RequestSource<RequestRow>,
    query: string,
    max: number,
  ): Promise<LinkableCandidateList> {
    const rows = (await this.visibleRequests(req, source)).filter((row) => !isGroupFollower(row));
    // Không tìm theo chữ thì chỉ cần họ tên của các dòng mới nhất sẽ trả về.
    const shown = query ? rows : rows.slice(0, max);
    const people = await this.people(req, shown.map((row) => row.employeeId), []);
    const items = shown.map((row) => source.candidate(row, people)).filter((item) => matchesLinkableQuery(item, query));
    return { items: items.slice(0, max) };
  }

  private async resolveRequests(
    req: Request,
    source: RequestSource<RequestRow>,
    ids: readonly string[],
  ): Promise<LinkableObjectList> {
    const wanted = new Set(ids);
    let rows: RequestRow[];
    try {
      rows = (await this.visibleRequests(req, source)).filter((row) => wanted.has(row.id));
    } catch (error) {
      // Không còn quyền đọc loại đơn này: mọi id đều bị bỏ qua.
      if (error instanceof ForbiddenException) return { items: [] };
      throw error;
    }
    const people = await this.people(
      req,
      rows.map((row) => row.employeeId),
      rows.map((row) => row.approvedBy),
    );
    return { items: rows.map((row) => source.object(row, people)) };
  }

  /**
   * Các đơn người dùng xem được, mới tạo trước. Có `hrm.request.read` thì danh sách thường đã là mọi đơn; không có thì
   * gộp đơn của mình với danh sách chờ duyệt của mình, như hai màn "Đơn từ của tôi" và "Duyệt đơn".
   */
  private async visibleRequests(req: Request, source: RequestSource<RequestRow>): Promise<RequestRow[]> {
    const context = await this.ctx.getContext(req, 'hrm.read');
    const calls: (() => Promise<{ readonly data: readonly RequestRow[] }>)[] = [() => source.list()];
    if (!this.ctx.has(context, 'hrm.request.read')) calls.push(() => source.list('1'));
    const byId = new Map<string, RequestRow>();
    let denied: unknown;
    let readable = false;
    for (const call of calls) {
      try {
        for (const row of (await call()).data) if (!byId.has(row.id)) byId.set(row.id, row);
        readable = true;
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        denied ??= error;
      }
    }
    if (!readable) throw denied;
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Mã, họ tên, đơn vị của người đề nghị và người duyệt, đọc qua `GET employee-options` đến khi đủ. */
  private async people(
    req: Request,
    employeeIds: readonly (string | null | undefined)[],
    userIds: readonly (string | null | undefined)[],
  ): Promise<HrmLinkablePeople> {
    const missingEmployees = new Set(employeeIds.filter((id): id is string => Boolean(id)));
    const missingUsers = new Set(userIds.filter((id): id is string => Boolean(id)));
    if (missingEmployees.size === 0 && missingUsers.size === 0) return NO_PEOPLE;
    const found: HrmLinkablePerson[] = [];
    for (let page = 1; page <= PEOPLE_MAX_PAGES; page++) {
      const { data } = await this.employees.employeeOptions(req, String(page), String(PEOPLE_PAGE_SIZE));
      for (const person of data as HrmLinkablePerson[]) {
        const wantedEmployee = missingEmployees.delete(person.employeeId);
        const wantedUser = Boolean(person.userId && missingUsers.delete(person.userId));
        if (wantedEmployee || wantedUser) found.push(person);
      }
      if (data.length < PEOPLE_PAGE_SIZE || (missingEmployees.size === 0 && missingUsers.size === 0)) break;
    }
    return hrmLinkablePeople(found);
  }

  private async canRead(req: Request, kind: HrmLinkableKind): Promise<boolean> {
    if (kind === HRM_LINKABLE_KINDS.decision) return this.allowed(req, 'hrm.appointment.read');
    // Như `HrmContextService.scoped` của route danh sách: đọc toàn tenant, quyền duyệt loại đơn, hoặc xem của bản thân.
    const context = await this.ctx.getContext(req, 'hrm.read');
    const permissions: readonly HrmAction[] = ['hrm.request.read', ...approverPermissions(HRM_LINKABLE_REQUEST_TYPES[kind])];
    if (permissions.some((permission) => this.ctx.has(context, permission))) return true;
    return this.allowed(req, 'hrm.self.read');
  }

  private async allowed(req: Request, permission: HrmAction): Promise<boolean> {
    try {
      await this.ctx.getContext(req, permission);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
}

/** Mỗi loại đơn có kiểu dòng riêng; bộ đọc chỉ dùng các trường chung nên gom về một kiểu. */
function erase<T extends RequestRow>(source: RequestSource<T>): RequestSource<RequestRow> {
  return source as unknown as RequestSource<RequestRow>;
}

function requireKind(kind: unknown): HrmLinkableKind {
  if (!isHrmLinkableKind(kind)) {
    throw new BadRequestException({ statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Nhân sự.' });
  }
  return kind;
}

/** Không thấy (404), id sai định dạng (400) hoặc không có quyền (403): bỏ qua dòng này. Lỗi khác là bug, ném tiếp. */
async function skipUnreadable<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof HttpException && [400, 403, 404].includes(error.getStatus())) return undefined;
    throw error;
  }
}
