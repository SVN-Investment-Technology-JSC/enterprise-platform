'use client';

import {
  WORK_ITEM_PRIORITIES,
  type CreateStandaloneTaskRequest,
  type StandaloneTask,
  type StandaloneTaskExecutionType,
  type StandaloneTaskRef,
  type WorkItemPriority,
} from '@enterprise-platform/contracts-workspace';
import { useAssistantEmbed } from '@enterprise-platform/feature-module-shell';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useEffect, useMemo, useState } from 'react';
import type { FormPrefill, StandaloneTaskPrefill } from '../assistant-drafts';
import { loadStartableProceduresOrUnavailable, type ProcedureOption } from '../procedure-api';
import * as api from '../workspace-api';
import { PRIORITY_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { useDirectory } from './use-directory';

export interface StandaloneTaskFormProps {
  readonly open: boolean;
  /** Rỗng nghĩa là giao việc mới. */
  readonly task?: StandaloneTask;
  /** Tạo làm việc con của việc này. */
  readonly parent?: StandaloneTaskRef;
  /** Lập công việc điều chỉnh cho việc đã huỷ hiệu lực này: điền sẵn từ việc cũ. */
  readonly adjustmentOf?: StandaloneTask;
  readonly onClose: () => void;
  /** Ném lỗi ra để hộp thoại hiện ngay thông điệp của server. */
  readonly onSubmit: (input: CreateStandaloneTaskRequest) => Promise<void>;
  /** Giá trị ban đầu khi giao việc mới (bản nháp của Trợ lý); `seq` mới thì gộp vào form đang mở. */
  readonly prefill?: FormPrefill<StandaloneTaskPrefill>;
}

interface FormState {
  title: string;
  description: string;
  priority: WorkItemPriority;
  assigneeUserId: string;
  participantUserIds: string[];
  followerUserIds: string[];
  plannedStart: string;
  dueDate: string;
  executionType: StandaloneTaskExecutionType;
  procedureDefinitionId: string;
}

function initialState(task?: StandaloneTask, adjustmentOf?: StandaloneTask): FormState {
  if (!task && adjustmentOf) {
    // Làm lại phần việc cũ: giữ nội dung, người làm và cách thực hiện; lịch để
    // trống vì lịch cũ thường đã qua.
    return {
      title: `Điều chỉnh ${adjustmentOf.code}: ${adjustmentOf.title}`.slice(0, 200),
      description: adjustmentOf.description ?? '',
      priority: adjustmentOf.priority,
      assigneeUserId: adjustmentOf.assigneeUserId,
      participantUserIds: [...adjustmentOf.participantUserIds],
      followerUserIds: [...adjustmentOf.followerUserIds],
      plannedStart: '',
      dueDate: '',
      executionType: adjustmentOf.executionType,
      procedureDefinitionId: adjustmentOf.procedure?.definitionId ?? '',
    };
  }
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'normal',
    assigneeUserId: task?.assigneeUserId ?? '',
    participantUserIds: [...(task?.participantUserIds ?? [])],
    followerUserIds: [...(task?.followerUserIds ?? [])],
    plannedStart: task?.plannedStart ?? '',
    dueDate: task?.dueDate ?? '',
    executionType: task?.executionType ?? 'manual',
    procedureDefinitionId: task?.procedure?.definitionId ?? '',
  };
}

/**
 * Hộp thoại giao việc ngoài dự án (tạo mới và sửa).
 *
 * Người nhận chọn từ cả danh bạ tổ chức, không giới hạn theo dự án hay đơn vị.
 * Một người chỉ giữ một vai: chọn ai làm người phụ trách thì họ rời hai danh
 * sách bên dưới.
 */
export function StandaloneTaskForm({
  open,
  task,
  parent,
  adjustmentOf,
  onClose,
  onSubmit,
  prefill,
}: StandaloneTaskFormProps) {
  const directory = useDirectory();
  const embedded = useAssistantEmbed();
  const [form, setForm] = useState<FormState>(() => initialState(task, adjustmentOf));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  /**
   * Quy trình chính người này khởi tạo được (có vai S). `undefined` là đang
   * tải; `'unavailable'` là không đọc được module Quy trình.
   */
  const [procedures, setProcedures] = useState<readonly ProcedureOption[] | 'unavailable'>();

  useEffect(() => {
    if (!open) return;
    setForm(initialState(task, adjustmentOf));
    setError(undefined);
  }, [open, task, adjustmentOf]);

  // Chạy sau bước dựng form ở trên: chỉ gộp các ô có trong bản nháp, ô người dùng đã sửa mà bản nháp không nhắc thì giữ.
  useEffect(() => {
    if (!open || task || !prefill) return;
    setForm((current) => {
      const next = { ...current, ...prefill.values };
      // Một người chỉ giữ một vai, như khi chọn trên form.
      const participantUserIds = next.participantUserIds.filter((id) => id !== next.assigneeUserId);
      return {
        ...next,
        participantUserIds,
        followerUserIds: next.followerUserIds.filter(
          (id) => id !== next.assigneeUserId && !participantUserIds.includes(id),
        ),
      };
    });
  }, [open, task, prefill]);

  // Hồ sơ mở dưới danh nghĩa người giao việc, nên chỉ đưa ra quy trình họ có vai S.
  useEffect(() => {
    if (!open || task || !directory.loaded) return;
    let alive = true;
    void api.loadCurrentUserId().then(async (me) => {
      const options = await loadStartableProceduresOrUnavailable(
        me,
        directory.find(me)?.orgNodeIds ?? [],
      );
      if (alive) setProcedures(options ?? 'unavailable');
    });
    return () => {
      alive = false;
    };
  }, [open, task, directory]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const peopleOptions = useMemo(
    () =>
      directory.people.map((person) => ({
        value: person.userId,
        label: person.unitNames.length
          ? `${person.displayName} · ${person.unitNames.join(', ')}`
          : person.displayName,
      })),
    [directory.people],
  );

  const submit = async () => {
    if (!form.title.trim()) {
      setError('Hãy nhập tên công việc.');
      return;
    }
    if (!form.assigneeUserId) {
      setError('Hãy chọn người phụ trách.');
      return;
    }
    if (!task && form.executionType === 'procedure' && !form.procedureDefinitionId) {
      setError('Hãy chọn quy trình.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        assigneeUserId: form.assigneeUserId,
        participantUserIds: form.participantUserIds,
        followerUserIds: form.followerUserIds,
        plannedStart: form.plannedStart || undefined,
        dueDate: form.dueDate || undefined,
        // Cách thực hiện chỉ chọn lúc tạo; sửa việc không gửi hai trường này.
        ...(task
          ? {}
          : {
              parentId: parent?.id,
              adjustmentOfId: adjustmentOf?.id,
              executionType: form.executionType,
              procedureDefinitionId:
                form.executionType === 'procedure' ? form.procedureDefinitionId : undefined,
            }),
      });
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được công việc.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={
        task
          ? 'Sửa công việc'
          : adjustmentOf
            ? 'Lập công việc điều chỉnh'
            : parent
              ? 'Thêm việc con'
              : 'Giao việc'
      }
      subtitle={
        task
          ? `${task.code} · ${task.title}`
          : adjustmentOf
            ? `Điều chỉnh cho ${adjustmentOf.code} · ${adjustmentOf.title} (đã huỷ hiệu lực).`
            : parent
            ? `Việc con của ${parent.code} · ${parent.title}. Việc con không cần duyệt: người thực hiện tự hoàn thành.`
            : 'Công việc không thuộc dự án nào.'
      }
      submitLabel={task ? 'Lưu' : adjustmentOf ? 'Lập việc điều chỉnh' : parent ? 'Thêm việc con' : 'Giao việc'}
      submitting={submitting}
      submitDisabled={
        !form.title.trim() ||
        !form.assigneeUserId ||
        (!task && form.executionType === 'procedure' && !form.procedureDefinitionId)
      }
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên công việc" required>
        <input
          value={form.title}
          maxLength={200}
          // Card của Trợ lý hiện ra khi người dùng còn đang gõ trong khung chat: không giành con trỏ khỏi ô chat.
          autoFocus={!embedded}
          placeholder="Ví dụ: Soạn báo giá cho khách hàng A"
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>

      <Field label="Mô tả">
        <textarea
          rows={3}
          value={form.description}
          placeholder="Yêu cầu, kết quả cần nộp, lưu ý"
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Người phụ trách" required>
          <Choice
            label="Người phụ trách"
            value={form.assigneeUserId}
            placeholder={directory.loaded ? 'Chọn người' : 'Đang tải danh bạ…'}
            options={peopleOptions}
            onChange={(assigneeUserId) =>
              set({
                assigneeUserId,
                participantUserIds: form.participantUserIds.filter((id) => id !== assigneeUserId),
                followerUserIds: form.followerUserIds.filter((id) => id !== assigneeUserId),
              })
            }
          />
        </Field>
        <Field label="Mức ưu tiên">
          <Choice
            label="Mức ưu tiên"
            value={form.priority}
            options={WORK_ITEM_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_LABELS[priority],
            }))}
            onChange={(priority) => set({ priority: priority as WorkItemPriority })}
          />
        </Field>
      </div>

      {task ? null : (
        <div className={styles.fieldRow}>
          <Field label="Cách thực hiện">
            <Choice
              label="Cách thực hiện"
              value={form.executionType}
              options={[
                { value: 'manual', label: 'Thủ công' },
                { value: 'procedure', label: 'Theo quy trình' },
              ]}
              onChange={(value) =>
                set({ executionType: value === 'procedure' ? 'procedure' : 'manual' })
              }
            />
          </Field>
          {form.executionType === 'procedure' ? (
            <Field
              label="Quy trình"
              required
              hint={
                procedures === 'unavailable'
                  ? 'Không tải được danh sách quy trình: module Quy trình đang không phản hồi. Thử lại sau ít phút.'
                  : procedures && procedures.length === 0
                    ? 'Bạn chưa có quy trình nào được phép khởi tạo (cần vai S trong quy trình).'
                    : 'Hồ sơ mở dưới tên bạn; hồ sơ hoàn tất thì công việc tự chuyển sang Chờ duyệt.'
              }
            >
              <Choice
                label="Quy trình"
                value={form.procedureDefinitionId}
                placeholder={
                  procedures === 'unavailable'
                    ? 'Không tải được quy trình'
                    : procedures
                      ? 'Chọn quy trình'
                      : 'Đang tải quy trình…'
                }
                options={(procedures === 'unavailable' ? [] : (procedures ?? [])).map((option) => ({
                  value: option.id,
                  label: `${option.code} · ${option.name}`,
                }))}
                onChange={(procedureDefinitionId) => set({ procedureDefinitionId })}
              />
            </Field>
          ) : null}
        </div>
      )}

      <Field label="Người cùng thực hiện" hint="Cùng làm và được gửi duyệt như người phụ trách.">
        <PeoplePicker
          people={directory.people}
          selected={form.participantUserIds}
          exclude={form.assigneeUserId ? [form.assigneeUserId] : []}
          nameOf={directory.nameOf}
          placeholder="Tìm người trong tổ chức"
          degraded={directory.degraded}
          loaded={directory.loaded}
          onChange={(participantUserIds) =>
            set({
              participantUserIds,
              followerUserIds: form.followerUserIds.filter(
                (id) => !participantUserIds.includes(id),
              ),
            })
          }
        />
      </Field>

      <Field label="Người theo dõi" hint="Chỉ xem và nhận thông báo khi việc hoàn thành.">
        <PeoplePicker
          people={directory.people}
          selected={form.followerUserIds}
          exclude={[
            ...(form.assigneeUserId ? [form.assigneeUserId] : []),
            ...form.participantUserIds,
          ]}
          nameOf={directory.nameOf}
          placeholder="Tìm người trong tổ chức"
          degraded={directory.degraded}
          loaded={directory.loaded}
          onChange={(followerUserIds) => set({ followerUserIds })}
        />
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Ngày bắt đầu">
          <DatePickerInput
            height={36}
            value={form.plannedStart}
            onChange={(value) => set({ plannedStart: value })}
          />
        </Field>
        <Field label="Hạn hoàn thành">
          <DatePickerInput
            height={36}
            value={form.dueDate}
            min={form.plannedStart || undefined}
            onChange={(value) => set({ dueDate: value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
