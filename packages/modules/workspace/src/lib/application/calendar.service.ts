import {
  EVENT_TYPES,
  MAX_EVENT_PARTICIPANTS,
  MAX_QUERY_RANGE_DAYS,
  PARTICIPANT_RESPONSES,
  type CalendarEvent,
  type CalendarOccurrence,
  type CalendarRangeResponse,
  type CreateEventRequest,
  type EventMutationResponse,
  type EventParticipant,
  type EventType,
  type ParticipantResponse,
  type RecurrenceScope,
  type SchedulingWarning,
  type UpdateEventRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  effectiveStop,
  expandOccurrences,
  parseRecurrenceRule,
  withoutStop,
  type Occurrence,
} from '../domain/recurrence.js';
import {
  EventNotFoundError,
  EventOrganizerOnlyError,
  RangeTooWideError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { DirectoryService } from './directory.service.js';
import { requireProjectRole, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { EventException, WorkspaceStore } from './workspace-store.port.js';

const MS_PER_DAY = 86_400_000;

export class CalendarService {
  /**
   * `directory` để trống thì không đối chiếu người được mời với danh bạ —
   * dùng trong test chỉ quan tâm quy tắc lịch.
   */
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly directory?: DirectoryService,
  ) {}

  /**
   * Đọc lịch trong một khoảng, đã khai triển chuỗi lặp và áp ngoại lệ.
   *
   * Không truyền `projectId` thì chỉ trả lịch của chính người gọi. Kể cả
   * quản trị viên tenant cũng vậy: lịch cá nhân của người khác không phải
   * thứ quản trị cần nhìn mặc định.
   */
  async range(
    actor: WorkspaceActor,
    query: { from?: string; to?: string; projectId?: string },
  ): Promise<CalendarRangeResponse> {
    const from = parseInstant(query.from, 'from');
    const to = parseInstant(query.to, 'to');
    if (to.getTime() < from.getTime()) {
      throw new WorkspaceValidationError('Mốc kết thúc phải sau mốc bắt đầu.');
    }
    // Mọi lần xuất hiện đều phải khai triển trong bộ nhớ, nên khoảng tra cứu
    // rộng bao nhiêu thì chi phí tăng bấy nhiêu.
    if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_QUERY_RANGE_DAYS) {
      throw new RangeTooWideError(MAX_QUERY_RANGE_DAYS);
    }

    if (query.projectId) await this.projects.access(actor, query.projectId);

    const events = await this.store.calendar.listCandidates(actor.tenantId, {
      from,
      to,
      projectId: query.projectId,
      userId: query.projectId ? undefined : actor.userId,
    });

    const seriesIds = [
      ...new Set(events.map((event) => event.seriesId).filter(Boolean) as string[]),
    ];
    const exceptions = await this.store.calendar.listExceptions(actor.tenantId, seriesIds);

    return {
      occurrences: buildOccurrences(events, exceptions, from, to),
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async detail(actor: WorkspaceActor, eventId: string): Promise<EventMutationResponse> {
    const event = await this.loadVisible(actor, eventId);
    return {
      event,
      participants: await this.store.calendar.listParticipants(actor.tenantId, eventId),
      warnings: [],
    };
  }

  async create(
    actor: WorkspaceActor,
    input: CreateEventRequest,
  ): Promise<EventMutationResponse> {
    const draft = this.validateDraft(input);
    if (input.projectId) {
      const access = await this.projects.access(actor, input.projectId);
      requireProjectRole(access, 'member');
    }

    const participantUserIds = normaliseParticipants(input.participantUserIds);
    await this.requireOrganizationPeople(actor, participantUserIds);
    const created =await this.store.calendar.createEvent(
      actor.tenantId,
      actor.userId,
      draft,
      participantUserIds,
    );

    return {
      ...created,
      warnings: await this.warnBusyParticipants(
        actor,
        participantUserIds,
        draft.startAt,
        draft.endAt,
        created.event.id,
      ),
    };
  }

  /**
   * Sửa sự kiện.
   *
   * `scope: 'single'` tách riêng một buổi ra khỏi chuỗi: tạo một sự kiện mới
   * không lặp, giữ nguyên `series_id`, rồi ghi một dòng ngoại lệ `moved` trỏ
   * sang nó. Chuỗi gốc không bị đụng tới, nên các buổi khác giữ nguyên.
   */
  async update(
    actor: WorkspaceActor,
    eventId: string,
    input: UpdateEventRequest,
  ): Promise<EventMutationResponse> {
    const event = await this.loadVisible(actor, eventId);
    if (event.organizerUserId !== actor.userId && !actor.isTenantAdmin) {
      throw new EventOrganizerOnlyError();
    }

    const scope: RecurrenceScope = input.scope ?? 'all';
    if (scope !== 'all' && !event.recurrenceRule) {
      throw new WorkspaceValidationError('Sự kiện này không lặp, không có buổi riêng để tách.');
    }
    if (input.participantUserIds) {
      await this.requireOrganizationPeople(actor, normaliseParticipants(input.participantUserIds));
    }

    if (scope === 'single') return this.splitOccurrence(actor, event, input);
    if (scope === 'following') return this.splitFollowing(actor, event, input);

    const startAt = input.startAt ? parseInstant(input.startAt, 'startAt') : undefined;
    const endAt = input.endAt ? parseInstant(input.endAt, 'endAt') : undefined;
    assertOrder(startAt ?? new Date(event.startAt), endAt ?? new Date(event.endAt));

    const updated = await this.store.calendar.updateEvent(
      actor.tenantId,
      actor.userId,
      eventId,
      {
        title: input.title === undefined ? undefined : requireText(input.title, 'Tiêu đề', 200),
        description: input.description,
        location: input.location,
        eventType: input.eventType === undefined ? undefined : pickEventType(input.eventType),
        startAt,
        endAt,
        allDay: input.allDay,
      },
      input.participantUserIds ? normaliseParticipants(input.participantUserIds) : undefined,
    );

    return {
      ...updated,
      warnings: await this.warnBusyParticipants(
        actor,
        updated.participants.map((participant) => participant.userId),
        new Date(updated.event.startAt),
        new Date(updated.event.endAt),
        eventId,
      ),
    };
  }

  /**
   * Huỷ sự kiện hoặc một buổi của chuỗi.
   *
   * Huỷ một buổi chỉ ghi một dòng ngoại lệ `cancelled`; chuỗi gốc giữ nguyên
   * để các buổi còn lại vẫn diễn ra.
   */
  async cancel(
    actor: WorkspaceActor,
    eventId: string,
    scope: RecurrenceScope,
    occurrenceDate?: string,
  ): Promise<CalendarEvent> {
    const event = await this.loadVisible(actor, eventId);
    if (event.organizerUserId !== actor.userId && !actor.isTenantAdmin) {
      throw new EventOrganizerOnlyError();
    }

    if (scope === 'following') {
      if (!event.recurrenceRule) {
        throw new WorkspaceValidationError('Sự kiện này không lặp, hãy huỷ cả sự kiện.');
      }
      const { index, occurrence } = locateOccurrence(event, requireDateKey(occurrenceDate));
      // Huỷ từ buổi đầu tiên chính là huỷ cả chuỗi.
      if (index > 0) {
        const cut = await this.store.calendar.updateEvent(
          actor.tenantId,
          actor.userId,
          event.id,
          { recurrenceUntil: new Date(occurrence.startAt.getTime() - 1000) },
          undefined,
        );
        return cut.event;
      }
    }

    if (scope === 'single') {
      if (!event.seriesId) {
        throw new WorkspaceValidationError('Sự kiện này không lặp, hãy huỷ cả sự kiện.');
      }
      const date = requireDateKey(occurrenceDate);
      await this.store.calendar.addException(actor.tenantId, actor.userId, {
        seriesId: event.seriesId,
        occurrenceDate: date,
        exceptionType: 'cancelled',
      });
      return event;
    }

    return this.store.calendar.cancelEvent(actor.tenantId, eventId);
  }

  /** Phản hồi lời mời. Chỉ chính chủ đổi được trạng thái của mình. */
  async respond(
    actor: WorkspaceActor,
    eventId: string,
    response: string,
  ): Promise<EventParticipant> {
    if (!(PARTICIPANT_RESPONSES as readonly string[]).includes(response)) {
      throw new WorkspaceValidationError(`Phản hồi "${response}" không hợp lệ.`);
    }
    await this.loadVisible(actor, eventId);
    return this.store.calendar.respond(
      actor.tenantId,
      eventId,
      actor.userId,
      response as ParticipantResponse,
    );
  }

  /* ------------------------------------------------------------ nội bộ */

  /**
   * Người được mời phải có trong danh bạ tổ chức.
   *
   * Danh bạ không đọc được thì bỏ qua: không biết thì không chặn — một cuộc
   * họp không nên hỏng vì Tenant Core chậm.
   */
  private async requireOrganizationPeople(
    actor: WorkspaceActor,
    userIds: readonly string[],
  ): Promise<void> {
    const invitees = userIds.filter((userId) => userId !== actor.userId);
    const unknown = await this.directory?.unknownUserIds(actor.tenantId, invitees);
    if (unknown && unknown.length > 0) {
      throw new WorkspaceValidationError(
        `Không tìm thấy ${unknown.length} người được mời trong tổ chức. Hãy chọn từ danh bạ.`,
      );
    }
  }

  /**
   * "Từ buổi này trở đi": cắt chuỗi cũ ngay trước buổi được chọn, rồi sinh
   * một chuỗi mới bắt đầu từ buổi đó với nội dung đã sửa.
   *
   * Hai chuỗi độc lập sau khi tách: ngoại lệ cũ rơi vào sau điểm cắt không
   * còn buổi nào để áp, nên tự mất tác dụng. Chọn đúng buổi đầu tiên thì
   * không có gì để cắt — sửa thẳng cả chuỗi.
   */
  private async splitFollowing(
    actor: WorkspaceActor,
    event: CalendarEvent,
    input: UpdateEventRequest,
  ): Promise<EventMutationResponse> {
    const { index, occurrence } = locateOccurrence(event, requireDateKey(input.occurrenceDate));
    if (index === 0) return this.update(actor, event.id, { ...input, scope: 'all' });

    const startAt = input.startAt ? parseInstant(input.startAt, 'startAt') : occurrence.startAt;
    const endAt = input.endAt ? parseInstant(input.endAt, 'endAt') : occurrence.endAt;
    assertOrder(startAt, endAt);

    // Chuỗi cũ dừng ngay trước buổi được chọn.
    await this.store.calendar.updateEvent(
      actor.tenantId,
      actor.userId,
      event.id,
      { recurrenceUntil: new Date(occurrence.startAt.getTime() - 1000) },
      undefined,
    );

    // Điểm dừng hiệu lực của chuỗi gốc, gộp cả chuỗi RRULE lẫn cột. Chuỗi mới
    // nhận nó ở dạng CỘT, còn chuỗi RRULE bỏ COUNT/UNTIL — chép nguyên
    // `COUNT=10` sang thì chuỗi mới đếm lại từ đầu và sinh thừa buổi.
    const originalRule = parseRecurrenceRule(
      event.recurrenceRule,
      Boolean(event.recurrenceUntil || event.recurrenceCount),
    );
    const stop = originalRule
      ? effectiveStop(
          originalRule,
          event.recurrenceUntil ? new Date(event.recurrenceUntil) : null,
          event.recurrenceCount,
        )
      : {};

    const existing = await this.store.calendar.listParticipants(actor.tenantId, event.id);
    const created = await this.store.calendar.createEvent(
      actor.tenantId,
      actor.userId,
      {
        // Chuỗi mới có series_id riêng: store tự gán bằng id của chính nó.
        seriesId: null,
        projectId: event.projectId ?? null,
        workItemId: event.workItemId ?? null,
        title: input.title ? requireText(input.title, 'Tiêu đề', 200) : event.title,
        description: input.description ?? event.description ?? null,
        location: input.location ?? event.location ?? null,
        eventType: input.eventType ? pickEventType(input.eventType) : event.eventType,
        startAt,
        endAt,
        allDay: input.allDay ?? event.allDay,
        timezone: event.timezone,
        recurrenceRule: event.recurrenceRule ? withoutStop(event.recurrenceRule) : null,
        recurrenceUntil: stop.until ?? null,
        // Số buổi CÒN LẠI, không phải số buổi ban đầu: tổng hai chuỗi phải
        // đúng bằng chuỗi gốc.
        recurrenceCount: stop.count != null ? Math.max(stop.count - index, 1) : null,
      },
      input.participantUserIds
        ? normaliseParticipants(input.participantUserIds)
        : existing.map((participant) => participant.userId),
    );

    return {
      ...created,
      warnings: await this.warnBusyParticipants(
        actor,
        created.participants.map((participant) => participant.userId),
        startAt,
        endAt,
        created.event.id,
      ),
    };
  }

  private async splitOccurrence(
    actor: WorkspaceActor,
    event: CalendarEvent,
    input: UpdateEventRequest,
  ): Promise<EventMutationResponse> {
    const date = requireDateKey(input.occurrenceDate);
    if (!input.startAt || !input.endAt) {
      throw new WorkspaceValidationError(
        'Tách một buổi cần mốc bắt đầu và kết thúc mới của chính buổi đó.',
      );
    }
    const startAt = parseInstant(input.startAt, 'startAt');
    const endAt = parseInstant(input.endAt, 'endAt');
    assertOrder(startAt, endAt);

    const existing = await this.store.calendar.listParticipants(actor.tenantId, event.id);

    const replacement = await this.store.calendar.createEvent(
      actor.tenantId,
      actor.userId,
      {
        // Giữ nguyên series_id để buổi tách ra vẫn thuộc về chuỗi, nhưng bỏ
        // quy tắc lặp: nó chỉ còn là một buổi đơn lẻ.
        seriesId: event.seriesId ?? event.id,
        projectId: event.projectId ?? null,
        workItemId: event.workItemId ?? null,
        title: input.title ? requireText(input.title, 'Tiêu đề', 200) : event.title,
        description: input.description ?? event.description ?? null,
        location: input.location ?? event.location ?? null,
        eventType: input.eventType ? pickEventType(input.eventType) : event.eventType,
        startAt,
        endAt,
        allDay: input.allDay ?? event.allDay,
        timezone: event.timezone,
        recurrenceRule: null,
        recurrenceUntil: null,
        recurrenceCount: null,
      },
      input.participantUserIds
        ? normaliseParticipants(input.participantUserIds)
        : existing.map((participant) => participant.userId),
    );

    await this.store.calendar.addException(actor.tenantId, actor.userId, {
      seriesId: event.seriesId ?? event.id,
      occurrenceDate: date,
      exceptionType: 'moved',
      replacementEventId: replacement.event.id,
    });

    return {
      ...replacement,
      warnings: await this.warnBusyParticipants(
        actor,
        replacement.participants.map((participant) => participant.userId),
        startAt,
        endAt,
        replacement.event.id,
      ),
    };
  }

  /**
   * Trùng lịch người là cảnh báo mềm, không chặn.
   *
   * Người tổ chức biết rõ hơn hệ thống rằng ai bắt buộc phải có mặt.
   */
  private async warnBusyParticipants(
    actor: WorkspaceActor,
    userIds: readonly string[],
    startAt: Date,
    endAt: Date,
    excludeEventId: string,
  ): Promise<SchedulingWarning[]> {
    if (userIds.length === 0) return [];
    const busy = await this.store.calendar.busySlots(
      actor.tenantId,
      userIds,
      startAt,
      endAt,
      excludeEventId,
    );
    return busy.map((slot) => ({
      code: 'PARTICIPANT_BUSY' as const,
      userId: slot.userId,
      conflictingEventId: slot.eventId,
      message: 'Người này đã có lịch khác trùng khoảng thời gian.',
    }));
  }

  /** Nạp sự kiện và kiểm quyền xem. */
  private async loadVisible(actor: WorkspaceActor, eventId: string): Promise<CalendarEvent> {
    const event = await this.store.calendar.findEvent(actor.tenantId, eventId);
    if (!event) throw new EventNotFoundError(eventId);
    if (event.organizerUserId === actor.userId || actor.isTenantAdmin) return event;

    // Người được mời luôn xem được sự kiện của mình, KỂ CẢ khi họ không
    // thuộc dự án: sự kiện mời người trong cả tổ chức. Họ chỉ thấy đúng sự
    // kiện này — mọi endpoint khác của dự án vẫn chặn họ như cũ.
    const participants = await this.store.calendar.listParticipants(actor.tenantId, eventId);
    if (participants.some((participant) => participant.userId === actor.userId)) return event;

    // Không được mời: sự kiện gắn dự án mượn hàng rào thành viên của dự án.
    if (event.projectId) {
      await this.projects.access(actor, event.projectId);
      return event;
    }
    // Sự kiện cá nhân: trả `404` chứ không phải `403`, để người ngoài không dò
    // được id nào có thật.
    throw new EventNotFoundError(eventId);
  }

  private validateDraft(input: CreateEventRequest) {
    const title = requireText(input.title, 'Tiêu đề sự kiện', 200);
    const startAt = parseInstant(input.startAt, 'startAt');
    const endAt = parseInstant(input.endAt, 'endAt');
    assertOrder(startAt, endAt);

    const timezone = (input.timezone ?? 'Asia/Ho_Chi_Minh').trim();
    // Phân tích ngay lúc tạo để chuỗi sai cú pháp bị chặn tại cửa, thay vì
    // lặng lẽ trở thành sự kiện đơn lẻ.
    const rule = parseRecurrenceRule(
      input.recurrenceRule,
      Boolean(input.recurrenceUntil || input.recurrenceCount),
    );
    if (rule) {
      // Một lần khai triển thử cũng xác nhận múi giờ đọc được.
      expandOccurrences({ startAt, endAt, timezone, rule }, startAt, endAt);
    }

    return {
      projectId: input.projectId ?? null,
      workItemId: input.workItemId ?? null,
      title,
      description: input.description ?? null,
      location: input.location ?? null,
      eventType: pickEventType(input.eventType),
      startAt,
      endAt,
      allDay: input.allDay ?? false,
      timezone,
      recurrenceRule: input.recurrenceRule?.trim() || null,
      recurrenceUntil: input.recurrenceUntil ? parseInstant(input.recurrenceUntil, 'recurrenceUntil') : null,
      recurrenceCount: input.recurrenceCount ?? null,
    };
  }
}

/* =========================================================================
   KHAI TRIỂN VÀ ÁP NGOẠI LỆ
   ========================================================================= */

/**
 * Biến danh sách sự kiện thành danh sách lần xuất hiện trong khoảng.
 *
 * Trình tự bắt buộc: khai triển chuỗi → **bỏ** những ngày có ngoại lệ, kể cả
 * `moved` → **thêm** các sự kiện thay thế. Làm ngược lại sẽ hiện hai buổi
 * cho một ngày đã được dời.
 */
export function buildOccurrences(
  events: readonly CalendarEvent[],
  exceptions: readonly EventException[],
  from: Date,
  to: Date,
): CalendarOccurrence[] {
  const skipBySeries = new Map<string, Set<string>>();
  for (const exception of exceptions) {
    const days = skipBySeries.get(exception.seriesId);
    if (days) days.add(exception.occurrenceDate);
    else skipBySeries.set(exception.seriesId, new Set([exception.occurrenceDate]));
  }
  const replacementIds = new Set(
    exceptions
      .filter((exception) => exception.exceptionType === 'moved')
      .map((exception) => exception.replacementEventId)
      .filter(Boolean) as string[],
  );

  const result: CalendarOccurrence[] = [];
  for (const event of events) {
    const isReplacement = replacementIds.has(event.id);
    const rule = parseRecurrenceRule(
      event.recurrenceRule,
      Boolean(event.recurrenceUntil || event.recurrenceCount),
    );
    const expanded = expandOccurrences(
      {
        startAt: new Date(event.startAt),
        endAt: new Date(event.endAt),
        timezone: event.timezone,
        rule,
        until: event.recurrenceUntil ? new Date(event.recurrenceUntil) : null,
        count: event.recurrenceCount ?? null,
      },
      from,
      to,
    );

    // Ngày bị tách chỉ áp cho CHUỖI GỐC. Bản thay thế cũng mang `series_id`
    // của chuỗi và rơi đúng vào ngày đó, lọc nó đi là xoá mất buổi vừa dời.
    const skip = !isReplacement && event.seriesId ? skipBySeries.get(event.seriesId) : undefined;

    for (const occurrence of expanded) {
      if (skip?.has(occurrence.occurrenceDate)) continue;
      result.push(toOccurrence(event, occurrence, isReplacement, Boolean(rule)));
    }
  }

  return result.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function toOccurrence(
  event: CalendarEvent,
  occurrence: Occurrence,
  isException: boolean,
  isRecurring: boolean,
): CalendarOccurrence {
  return {
    eventId: event.id,
    seriesId: event.seriesId,
    occurrenceDate: occurrence.occurrenceDate,
    startAt: occurrence.startAt.toISOString(),
    endAt: occurrence.endAt.toISOString(),
    title: event.title,
    eventType: event.eventType,
    allDay: event.allDay,
    timezone: event.timezone,
    location: event.location,
    projectId: event.projectId,
    workItemId: event.workItemId,
    organizerUserId: event.organizerUserId,
    isException,
    isRecurring,
  };
}

/* =========================================================================
   KIỂM TRA ĐẦU VÀO
   ========================================================================= */

function parseInstant(value: unknown, field: string): Date {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) {
    throw new WorkspaceValidationError(`Trường "${field}" không phải mốc thời gian hợp lệ.`);
  }
  return parsed;
}

function assertOrder(startAt: Date, endAt: Date): void {
  if (endAt.getTime() < startAt.getTime()) {
    throw new WorkspaceValidationError('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
  }
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function requireDateKey(value: unknown): string {
  const text = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new WorkspaceValidationError('Cần chỉ rõ buổi nào, dạng YYYY-MM-DD.');
  }
  return text;
}

/**
 * Buổi thứ mấy của chuỗi rơi vào ngày `date`, và mốc giờ thật của nó.
 *
 * Khai triển tới hết ngày đó là đủ: buổi cần tìm không thể nằm sau chính nó.
 * Dùng cho cả sửa lẫn huỷ "từ buổi này trở đi".
 */
function locateOccurrence(
  event: CalendarEvent,
  date: string,
): { index: number; occurrence: Occurrence } {
  const seriesStart = new Date(event.startAt);
  const horizon = new Date(new Date(`${date}T00:00:00Z`).getTime() + 2 * MS_PER_DAY);
  const occurrences = expandOccurrences(
    {
      startAt: seriesStart,
      endAt: new Date(event.endAt),
      timezone: event.timezone,
      rule: parseRecurrenceRule(
        event.recurrenceRule,
        Boolean(event.recurrenceUntil || event.recurrenceCount),
      ),
      until: event.recurrenceUntil ? new Date(event.recurrenceUntil) : null,
      count: event.recurrenceCount ?? null,
    },
    seriesStart,
    horizon,
  );
  const index = occurrences.findIndex((occurrence) => occurrence.occurrenceDate === date);
  if (index < 0) {
    throw new WorkspaceValidationError(`Chuỗi này không có buổi nào vào ngày ${date}.`);
  }
  return { index, occurrence: occurrences[index] as Occurrence };
}

function pickEventType(value: unknown): EventType {
  const text = String(value ?? 'meeting');
  return (EVENT_TYPES as readonly string[]).includes(text) ? (text as EventType) : 'meeting';
}

function normaliseParticipants(userIds: readonly string[] | undefined): string[] {
  const unique = [...new Set(userIds ?? [])].filter(Boolean);
  // Danh sách dài hơn trần là dấu hiệu dùng sai công cụ: đó là thông báo
  // toàn công ty, không phải một cuộc họp.
  if (unique.length > MAX_EVENT_PARTICIPANTS) {
    throw new WorkspaceValidationError(
      `Một sự kiện tối đa ${MAX_EVENT_PARTICIPANTS} người tham dự.`,
    );
  }
  return unique;
}

