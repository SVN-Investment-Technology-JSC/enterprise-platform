import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  type Activity,
  type ActivityListQuery,
  type CreateActivityRequest,
  type CrmPage,
  type CustomerTimelineEntry,
  type UpdateActivityRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import {
  isUuid,
  optionalEnum,
  optionalId,
  optionalInstant,
  optionalText,
  requiredText,
  requiredVersion,
} from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import type {
  ActivityRecord,
  ActivityStore,
  CustomerStore,
  OpportunityStore,
  TimelineStore,
} from './sales-store.port.js';

const ACTIVITY_NOT_FOUND = 'Không tìm thấy hoạt động.';

/**
 * Hoạt động chăm sóc khách hàng: gọi điện, email, gặp mặt, công việc.
 *
 * Phải gắn khách hàng hoặc cơ hội trong phạm vi của người tạo; gắn cơ hội thì
 * tự gắn luôn khách của cơ hội để hoạt động hiện trên dòng thời gian khách.
 * Người được giao là bất kỳ ai trong tổ chức; người được giao luôn thấy hoạt
 * động của mình. Nhắc trước hạn và quá hạn do notification-worker quét bảng.
 */
export class ActivityService {
  constructor(
    private readonly activities: ActivityStore,
    private readonly customers: CustomerStore,
    private readonly opportunities: OpportunityStore,
    private readonly scopes: CrmDataScopeService,
  ) {}

  async list(actor: CrmActor, query: ActivityListQuery): Promise<CrmPage<Activity>> {
    const scope = await this.scopes.resolve(actor);
    return this.activities.listActivities(actor.tenantId, scope, {
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      opportunityId: optionalId(query.opportunityId, 'cơ hội') ?? undefined,
      assigneeUserId: optionalId(query.assigneeUserId, 'người được giao') ?? undefined,
      status: optionalEnum(query.status, ACTIVITY_STATUSES, 'trạng thái'),
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<Activity> {
    const scope = await this.scopes.resolve(actor);
    return this.require(actor.tenantId, scope, id);
  }

  async create(actor: CrmActor, request: CreateActivityRequest): Promise<Activity> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    let customerId = optionalId(request.customerId, 'khách hàng');
    const opportunityId = optionalId(request.opportunityId, 'cơ hội');
    if (!customerId && !opportunityId) {
      throw new CrmValidationError('ACTIVITY_TARGET_REQUIRED', 'Hoạt động phải gắn khách hàng hoặc cơ hội.');
    }
    if (opportunityId) {
      const opportunity = await this.opportunities.getOpportunity(actor.tenantId, scope, opportunityId);
      if (!opportunity) throw new CrmNotFoundError('Không tìm thấy cơ hội.');
      if (customerId && customerId !== opportunity.customerId) {
        throw new CrmValidationError('ACTIVITY_TARGET_MISMATCH', 'Cơ hội không thuộc khách hàng đã chọn.');
      }
      customerId = opportunity.customerId;
    } else if (customerId) {
      const customer = await this.customers.getCustomer(actor.tenantId, scope, customerId);
      if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    }
    const record: ActivityRecord = {
      type: requiredType(request.type),
      subject: requiredText(request.subject, 300, 'tiêu đề hoạt động'),
      description: optionalText(request.description, 4000, 'mô tả'),
      assigneeUserId: optionalId(request.assigneeUserId, 'người được giao') ?? actor.userId,
      dueAt: optionalInstant(request.dueAt, 'hạn'),
      status: 'OPEN',
      result: null,
    };
    const id = await this.activities.createActivity(
      actor.tenantId,
      { customerId, opportunityId },
      record,
      actor.userId,
    );
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  /** Sửa, ghi kết quả, hoàn tất, huỷ hoặc mở lại. */
  async update(actor: CrmActor, id: string, request: UpdateActivityRequest): Promise<Activity> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    const record: ActivityRecord = {
      type: request.type === undefined ? current.type : requiredType(request.type),
      subject:
        request.subject === undefined ? current.subject : requiredText(request.subject, 300, 'tiêu đề hoạt động'),
      description:
        request.description === undefined ? current.description : optionalText(request.description, 4000, 'mô tả'),
      assigneeUserId:
        request.assigneeUserId === undefined
          ? current.assigneeUserId
          : (optionalId(request.assigneeUserId, 'người được giao') ?? current.assigneeUserId),
      dueAt: request.dueAt === undefined ? current.dueAt : optionalInstant(request.dueAt, 'hạn'),
      status: optionalEnum(request.status, ACTIVITY_STATUSES, 'trạng thái') ?? current.status,
      result: request.result === undefined ? current.result : optionalText(request.result, 4000, 'kết quả'),
    };
    await this.activities.updateActivity(
      actor.tenantId,
      id,
      record,
      requiredVersion(request.version),
      actor.userId,
    );
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  private async require(tenantId: string, scope: CrmDataScope, id: string): Promise<Activity> {
    if (!isUuid(id)) throw new CrmNotFoundError(ACTIVITY_NOT_FOUND);
    const activity = await this.activities.getActivity(tenantId, scope, id);
    if (!activity) throw new CrmNotFoundError(ACTIVITY_NOT_FOUND);
    return activity;
  }
}

function requiredType(value: unknown) {
  const type = optionalEnum(value, ACTIVITY_TYPES, 'loại hoạt động');
  if (!type) throw new CrmValidationError('ACTIVITY_TYPE_REQUIRED', 'Vui lòng chọn loại hoạt động.');
  return type;
}

/**
 * Dòng thời gian khách hàng: hợp nhất cơ hội (tạo, chuyển giai đoạn) và hoạt
 * động, mới nhất trước, phân trang keyset. Khách phải trong phạm vi; từng mục
 * còn lọc theo phạm vi riêng của nó (cơ hội của người ngoài phạm vi không hiện).
 * Giai đoạn sau thêm loại mục ở `TimelineStore` và union `CustomerTimelineEntry`.
 */
export class CustomerTimelineService {
  constructor(
    private readonly timeline: TimelineStore,
    private readonly customers: CustomerStore,
    private readonly scopes: CrmDataScopeService,
  ) {}

  async list(
    actor: CrmActor,
    customerId: string,
    query: { cursor?: unknown; limit?: unknown },
  ): Promise<CrmPage<CustomerTimelineEntry>> {
    const scope = await this.scopes.resolve(actor);
    const customer = isUuid(customerId)
      ? await this.customers.getCustomer(actor.tenantId, scope, customerId)
      : undefined;
    if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    return this.timeline.customerTimeline(
      actor.tenantId,
      scope,
      customerId,
      decodeCursor(query.cursor),
      pageLimit(query.limit),
    );
  }
}
