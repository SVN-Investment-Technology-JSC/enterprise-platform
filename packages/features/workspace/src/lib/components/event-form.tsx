'use client';

import {
  EVENT_TYPES,
  RECURRENCE_FREQUENCIES,
  type CalendarOccurrence,
  type CreateEventRequest,
  type EventMutationResponse,
  type EventType,
  type ParticipantResponse,
  type RecurrenceFrequency,
  type RecurrenceScope,
  type SchedulingWarning,
  type UpdateEventRequest,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { EVENT_TYPE_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { useDirectory } from './use-directory';

export interface EventFormProps {
  readonly open: boolean;
  /** Có nghĩa là đang xem hoặc sửa một buổi đã tồn tại. */
  readonly occurrence?: CalendarOccurrence;
  /** Ngày `YYYY-MM-DD` được chọn khi tạo mới. */
  readonly defaultDate?: string;
  readonly currentUserId: string;
  /** Quản trị tenant sửa được sự kiện của người khác, như ở server. */
  readonly isTenantAdmin?: boolean;
  readonly loadDetail: (eventId: string) => Promise<EventMutationResponse>;
  readonly onClose: () => void;
  readonly onCreate: (input: Omit<CreateEventRequest, 'projectId'>) => Promise<SchedulingWarning[]>;
  readonly onUpdate: (input: UpdateEventRequest) => Promise<SchedulingWarning[]>;
  readonly onCancelEvent: (scope: RecurrenceScope, occurrenceDate?: string) => Promise<void>;
  readonly onRespond: (response: ParticipantResponse) => Promise<void>;
}

interface FormState {
  title: string;
  description: string;
  location: string;
  eventType: EventType;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  repeats: boolean;
  freq: RecurrenceFrequency;
  interval: string;
  count: string;
  participantUserIds: string[];
  scope: RecurrenceScope;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  location: '',
  eventType: 'meeting',
  date: '',
  startTime: '09:00',
  endTime: '10:00',
  allDay: false,
  repeats: false,
  freq: 'WEEKLY',
  interval: '1',
  count: '10',
  participantUserIds: [],
  scope: 'single',
};

const RESPONSES: readonly { value: ParticipantResponse; label: string }[] = [
  { value: 'accepted', label: 'Tham gia' },
  { value: 'tentative', label: 'Có thể' },
  { value: 'declined', label: 'Từ chối' },
];

const SCOPE_LABELS: Record<RecurrenceScope, string> = {
  single: 'Chỉ buổi này',
  following: 'Từ buổi này trở đi',
  all: 'Toàn bộ chuỗi',
};

/** `2026-09-21` + `09:00` → mốc ISO theo múi giờ trình duyệt. */
function toInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function timeOf(iso: string): string {
  const value = new Date(iso);
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function dateOf(iso: string): string {
  const value = new Date(iso);
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Tạo, xem, sửa sự kiện Họp / Sinh hoạt.
 *
 * Người tham dự chọn từ **danh bạ cả tổ chức**, không chỉ thành viên dự án.
 * Mở một sự kiện có sẵn thì nạp chi tiết trước — người tham dự và mô tả không
 * có trong dữ liệu lưới lịch; bỏ bước này mà gửi danh sách rỗng lên là xoá
 * sạch người được mời.
 *
 * Người được mời (không phải người tổ chức) thấy sự kiện ở chế độ chỉ đọc
 * kèm ba nút phản hồi.
 */
export function EventForm({
  open,
  occurrence,
  defaultDate,
  currentUserId,
  isTenantAdmin = false,
  loadDetail,
  onClose,
  onCreate,
  onUpdate,
  onCancelEvent,
  onRespond,
}: EventFormProps) {
  const directory = useDirectory();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [organizerId, setOrganizerId] = useState<string>();
  const [myResponse, setMyResponse] = useState<ParticipantResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [warnings, setWarnings] = useState<readonly SchedulingWarning[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setWarnings([]);
    setSubmitting(false);
    setMyResponse(undefined);

    if (!occurrence) {
      setOrganizerId(currentUserId);
      setForm({ ...EMPTY, date: defaultDate ?? dateOf(new Date().toISOString()) });
      return;
    }

    setOrganizerId(occurrence.organizerUserId);
    setForm({
      ...EMPTY,
      title: occurrence.title,
      location: occurrence.location ?? '',
      eventType: occurrence.eventType,
      date: dateOf(occurrence.startAt),
      startTime: timeOf(occurrence.startAt),
      endTime: timeOf(occurrence.endAt),
      allDay: occurrence.allDay,
      scope: occurrence.isRecurring ? 'single' : 'all',
    });

    let alive = true;
    setLoading(true);
    loadDetail(occurrence.eventId)
      .then((detail) => {
        if (!alive) return;
        setForm((current) => ({
          ...current,
          description: detail.event.description ?? '',
          // Người tổ chức luôn có mặt; không đưa vào danh sách chọn.
          participantUserIds: detail.participants
            .filter((participant) => !participant.isOrganizer)
            .map((participant) => participant.userId),
        }));
        setMyResponse(
          detail.participants.find((participant) => participant.userId === currentUserId)
            ?.responseStatus,
        );
      })
      .catch((cause: { message?: string }) => {
        if (alive) setError(cause?.message ?? 'Không nạp được chi tiết sự kiện.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, occurrence, defaultDate, currentUserId, loadDetail]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const canEdit = !occurrence || organizerId === currentUserId || isTenantAdmin;
  const isInvitee = Boolean(occurrence) && !canEdit && myResponse !== undefined;

  const buildRecurrence = () => {
    if (!form.repeats) return undefined;
    const interval = Math.max(Math.trunc(Number(form.interval) || 1), 1);
    const count = Math.max(Math.trunc(Number(form.count) || 1), 1);
    // Luôn kèm COUNT: chuỗi vô hạn bị server từ chối.
    return `FREQ=${form.freq};INTERVAL=${interval};COUNT=${count}`;
  };

  const submit = async () => {
    if (!canEdit) {
      onClose();
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      const startAt = toInstant(form.date, form.allDay ? '00:00' : form.startTime);
      const endAt = toInstant(form.date, form.allDay ? '23:59' : form.endTime);
      const common = {
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        eventType: form.eventType,
        startAt,
        endAt,
        allDay: form.allDay,
        participantUserIds: form.participantUserIds,
      };

      const result = occurrence
        ? await onUpdate({ ...common, scope: form.scope, occurrenceDate: occurrence.occurrenceDate })
        : await onCreate({ ...common, recurrenceRule: buildRecurrence() });

      // Trùng lịch người chỉ là cảnh báo: giữ hộp thoại mở để người tổ chức
      // đọc rồi tự quyết, thay vì đóng lại như chưa có chuyện gì.
      if (result.length > 0) {
        setWarnings(result);
        setSubmitting(false);
        return;
      }
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được sự kiện.');
      setSubmitting(false);
    }
  };

  const respond = async (response: ParticipantResponse) => {
    setError(undefined);
    setSubmitting(true);
    try {
      await onRespond(response);
      setMyResponse(response);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gửi được phản hồi.');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      await onCancelEvent(form.scope, occurrence?.occurrenceDate);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không huỷ được sự kiện.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={!occurrence ? 'Tạo sự kiện' : canEdit ? 'Sửa sự kiện' : 'Chi tiết sự kiện'}
      subtitle={
        !canEdit
          ? `Người tổ chức: ${directory.nameOf(organizerId)}`
          : occurrence?.isRecurring
            ? 'Sự kiện này lặp lại. Hãy chọn phạm vi tác động bên dưới.'
            : 'Mời được bất kỳ ai trong tổ chức. Trùng lịch người chỉ là cảnh báo.'
      }
      submitLabel={!canEdit ? 'Đóng' : occurrence ? 'Lưu thay đổi' : 'Tạo sự kiện'}
      submitting={submitting || loading}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {isInvitee ? (
        <div className={styles.fieldRow}>
          <Field label="Phản hồi của bạn">
            <div className={styles.responseGroup} role="group" aria-label="Phản hồi lời mời">
              {RESPONSES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={myResponse === option.value}
                  disabled={submitting}
                  onClick={() => void respond(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      ) : null}

      <Field label="Tiêu đề">
        <input
          value={form.title}
          required
          maxLength={200}
          disabled={!canEdit}
          placeholder="Ví dụ: Họp giao ban tuần, Sinh hoạt chi đoàn"
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Loại">
          <Choice
            label="Loại"
            value={form.eventType}
            disabled={!canEdit}
            options={EVENT_TYPES.map((type) => ({ value: type, label: EVENT_TYPE_LABELS[type] }))}
            onChange={(value) => set({ eventType: value as EventType })}
          />
        </Field>
        <Field label="Địa điểm">
          <input
            value={form.location}
            maxLength={255}
            disabled={!canEdit}
            placeholder="Phòng 301, hội trường, link họp trực tuyến…"
            onChange={(event) => set({ location: event.target.value })}
          />
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label="Ngày">
          <input
            type="date"
            value={form.date}
            required
            disabled={!canEdit}
            onChange={(event) => set({ date: event.target.value })}
          />
        </Field>
        {form.allDay ? null : (
          <>
            <Field label="Bắt đầu">
              <input
                type="time"
                value={form.startTime}
                disabled={!canEdit}
                onChange={(event) => set({ startTime: event.target.value })}
              />
            </Field>
            <Field label="Kết thúc">
              <input
                type="time"
                value={form.endTime}
                disabled={!canEdit}
                onChange={(event) => set({ endTime: event.target.value })}
              />
            </Field>
          </>
        )}
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={form.allDay}
          disabled={!canEdit}
          onChange={(event) => set({ allDay: event.target.checked })}
        />
        Cả ngày
      </label>

      <Field
        label="Người tham dự"
        hint={canEdit ? 'Tìm và chọn người trong cả tổ chức, không chỉ thành viên dự án.' : undefined}
      >
        <PeoplePicker
          people={directory.people}
          selected={form.participantUserIds}
          onChange={(userIds) => set({ participantUserIds: userIds })}
          nameOf={directory.nameOf}
          exclude={organizerId ? [organizerId] : []}
          disabled={!canEdit}
          degraded={directory.degraded}
          loaded={directory.loaded}
        />
      </Field>

      <Field label="Mô tả">
        <textarea
          rows={2}
          value={form.description}
          disabled={!canEdit}
          placeholder="Nội dung, chương trình, tài liệu cần chuẩn bị"
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      {occurrence || !canEdit ? null : (
        <>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={form.repeats}
              onChange={(event) => set({ repeats: event.target.checked })}
            />
            Lặp lại
          </label>

          {form.repeats ? (
            <div className={styles.fieldRow}>
              <Field label="Tần suất">
                <Choice
                  label="Tần suất"
                  value={form.freq}
                  options={RECURRENCE_FREQUENCIES.map((freq) => ({
                    value: freq,
                    label:
                      freq === 'DAILY' ? 'Hằng ngày' : freq === 'WEEKLY' ? 'Hằng tuần' : 'Hằng tháng',
                  }))}
                  onChange={(value) => set({ freq: value as RecurrenceFrequency })}
                />
              </Field>
              <Field label="Mỗi" hint="Ví dụ 2 với hằng tuần là hai tuần một lần.">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.interval}
                  onChange={(event) => set({ interval: event.target.value })}
                />
              </Field>
              <Field label="Số lần" hint="Bắt buộc có điểm dừng, tối đa 365 lần.">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.count}
                  onChange={(event) => set({ count: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
        </>
      )}

      {occurrence?.isRecurring && canEdit ? (
        <Field label="Phạm vi thay đổi">
          <Choice
            label="Phạm vi thay đổi"
            value={form.scope}
            options={(['single', 'following', 'all'] as const).map((scope) => ({
              value: scope,
              label: SCOPE_LABELS[scope],
            }))}
            onChange={(value) => set({ scope: value as RecurrenceScope })}
          />
        </Field>
      ) : null}

      {warnings.length > 0 ? (
        <div className={styles.notice} role="status">
          <strong>Đã lưu, nhưng có trùng lịch:</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.userId}-${warning.conflictingEventId}`}>
                {directory.nameOf(warning.userId)} — {warning.message}
              </li>
            ))}
          </ul>
          <button type="button" className={styles.buttonGhost} onClick={onClose}>
            Đã hiểu, đóng lại
          </button>
        </div>
      ) : null}

      {occurrence && canEdit ? (
        <button type="button" className={styles.buttonDanger} onClick={() => void remove()}>
          {form.scope === 'single'
            ? 'Huỷ buổi này'
            : form.scope === 'following'
              ? 'Huỷ từ buổi này trở đi'
              : 'Huỷ toàn bộ sự kiện'}
        </button>
      ) : null}
    </Dialog>
  );
}
