'use client';

import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_TYPES,
  type CreateWorkItemRequest,
  type ProjectMember,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import { fromLocalInput } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useEffect, useState } from 'react';
import type { FormPrefill, WorkItemPrefill } from '../assistant-drafts';
import { loadProcedureOptions, type ProcedureOption } from '../procedure-api';
import { ITEM_TYPE_LABELS, PRIORITY_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { TagPicker } from './tag-picker';
import { TransportSection } from './transport-section';
import { useSourceTransport } from './use-source-transport';

export interface WorkItemFormProps {
  readonly open: boolean;
  /** Rỗng nghĩa là tạo mới. */
  readonly item?: WorkItem;
  /** Node cha khi tạo mới; rỗng nghĩa là tạo ở cấp gốc của dự án. */
  readonly parent?: WorkItem;
  readonly members: readonly ProjectMember[];
  readonly currentUserId: string;
  /**
   * Giao việc cho người khác — chỉ chủ nhiệm, quản lý, quản trị tenant. Tắt
   * thì ô người phụ trách chỉ còn "Chưa giao" và chính mình, khớp quy tắc ở
   * server.
   */
  readonly canAssignOthers: boolean;
  readonly onClose: () => void;
  /**
   * `procedureDefinitionId` chỉ có khi chọn "Theo quy trình". Nơi gọi chịu
   * trách nhiệm mở hồ sơ bên Quy trình sau khi công việc đã được tạo.
   */
  readonly onCreate: (
    input: Omit<CreateWorkItemRequest, 'projectId'>,
    procedureDefinitionId?: string,
  ) => Promise<void>;
  readonly onUpdate: (input: UpdateWorkItemRequest) => Promise<void>;
  /** Tạo công việc điều chỉnh cho công việc đã huỷ hiệu lực: điền sẵn từ công việc gốc. */
  readonly adjustmentOf?: WorkItem;
  /**
   * Danh sách chọn "Công việc cha" khi tạo mới — mỗi mục đã thụt lề theo cấp.
   * Ô chọn luôn hiện thêm mục "Gốc dự án" (giá trị rỗng) ở đầu. Vắng thì chỉ
   * có mỗi "Gốc dự án".
   */
  readonly parentOptions?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** Công việc cha chọn sẵn; rỗng nghĩa là "Gốc dự án". */
  readonly defaultParentId?: string;
  /**
   * Danh sách dự án. Có thì form dựng thêm ô "Dự án" (bắt buộc) ở trên cùng —
   * dùng cho trang "Công việc của tôi", nơi chưa có dự án đang mở.
   */
  readonly projectOptions?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** Người dùng đổi dự án: nơi gọi nạp lại danh sách công việc cha của dự án đó. */
  readonly onProjectChange?: (projectId: string) => void;
  /** Giá trị ban đầu khi tạo mới (bản nháp của Trợ lý); `seq` mới thì gộp vào form đang mở. */
  readonly prefill?: FormPrefill<WorkItemPrefill>;
}

interface FormState {
  projectId: string;
  parentId: string;
  title: string;
  description: string;
  itemType: WorkItemType;
  executionType: 'manual' | 'procedure';
  priority: WorkItemPriority;
  assigneeUserId: string;
  participantUserIds: string[];
  tagIds: string[];
  plannedStart: string;
  plannedEnd: string;
  estimateHours: string;
  procedureDefinitionId: string;
}

const EMPTY: FormState = {
  projectId: '',
  parentId: '',
  title: '',
  description: '',
  itemType: 'task',
  executionType: 'manual',
  priority: 'normal',
  assigneeUserId: '',
  participantUserIds: [],
  tagIds: [],
  plannedStart: '',
  plannedEnd: '',
  estimateHours: '',
  procedureDefinitionId: '',
};

export function WorkItemForm({
  open,
  item,
  parent,
  members,
  currentUserId,
  canAssignOthers,
  onClose,
  onCreate,
  onUpdate,
  adjustmentOf,
  parentOptions,
  defaultParentId,
  projectOptions,
  onProjectChange,
  prefill,
}: WorkItemFormProps) {
  const directory = useDirectory();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [procedures, setProcedures] = useState<readonly ProcedureOption[]>();

  // Chỉ hỏi module Quy trình khi người dùng thật sự chọn "Theo quy trình",
  // và chỉ một lần mỗi lần mở form.
  useEffect(() => {
    if (!open || form.executionType !== 'procedure' || procedures) return;
    void loadProcedureOptions().then(setProcedures);
  }, [open, form.executionType, procedures]);

  useEffect(() => {
    if (!open) return;
    setProcedures(undefined);
    setForm(
      item
        ? {
            projectId: '',
            parentId: item.parentId ?? '',
            title: item.title,
            description: item.description ?? '',
            itemType: item.itemType,
            executionType: item.executionType,
            priority: item.priority,
            assigneeUserId: item.assigneeUserId ?? '',
            participantUserIds: [...(item.participantUserIds ?? [])],
            tagIds: [...(item.tagIds ?? [])],
            plannedStart: item.plannedStart ?? '',
            plannedEnd: item.plannedEnd ?? '',
            estimateHours: item.estimateHours == null ? '' : String(item.estimateHours),
            procedureDefinitionId: '',
          }
        : adjustmentOf
          ? {
              ...EMPTY,
              parentId: defaultParentId ?? '',
              // Điều chỉnh làm lại phần việc cũ: giữ nội dung, người làm và lịch,
              // còn cách thực hiện để thủ công — quy trình gắn công việc gốc đã huỷ.
              title: `Điều chỉnh ${adjustmentOf.code}: ${adjustmentOf.title}`.slice(0, 200),
              description: adjustmentOf.description ?? '',
              itemType: adjustmentOf.itemType === 'milestone' ? 'milestone' : 'task',
              priority: adjustmentOf.priority,
              assigneeUserId: adjustmentOf.assigneeUserId ?? '',
              participantUserIds: [...(adjustmentOf.participantUserIds ?? [])],
              tagIds: [...(adjustmentOf.tagIds ?? [])],
              plannedStart: adjustmentOf.plannedStart ?? '',
              plannedEnd: adjustmentOf.plannedEnd ?? '',
              estimateHours:
                adjustmentOf.estimateHours == null ? '' : String(adjustmentOf.estimateHours),
            }
          : { ...EMPTY, parentId: defaultParentId ?? parent?.id ?? '' },
    );
    setError(undefined);
    setSubmitting(false);
  }, [open, item, adjustmentOf, defaultParentId, parent?.id]);

  // Chạy sau bước dựng form ở trên: chỉ gộp các ô có trong bản nháp, ô người dùng đã sửa mà bản nháp không nhắc thì giữ.
  useEffect(() => {
    if (!open || item || !prefill) return;
    setForm((current) => ({
      ...current,
      ...prefill.values,
      // Đổi dự án thì công việc cha của dự án cũ không còn đúng.
      ...(prefill.values.projectId && prefill.values.projectId !== current.projectId
        ? { parentId: '' }
        : {}),
    }));
  }, [open, item, prefill]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  // Công việc chỉ có ngày dự kiến, nên khung giờ dùng xe gợi ý là 8 giờ ngày bắt đầu đến 17 giờ ngày kết thúc;
  // người dùng chỉnh được ngay trên khối phương tiện.
  const transport = useSourceTransport({
    open,
    sourceType: 'WORK_ITEM',
    sourceId: item?.id,
    followsSource: false,
    defaultRange: form.plannedStart
      ? {
          startAt: fromLocalInput(`${form.plannedStart}T08:00`),
          endAt: fromLocalInput(`${form.plannedEnd || form.plannedStart}T17:00`),
        }
      : null,
  });

  // Nhóm công việc chỉ là vỏ chứa: server từ chối người phụ trách và giờ ước
  // lượng trên nó, nên ẩn hai ô đó thay vì để người dùng nhập rồi báo lỗi.
  const isPhase = form.itemType === 'phase';

  // Chỉ thành viên dự án mới cùng làm được; người chưa có trong danh bạ tổ
  // chức vẫn hiện bằng tên server trả về.
  const memberPeople = members
    .filter((member) => canAssignOthers || member.userId === currentUserId)
    .map(
      (member) =>
        directory.find(member.userId) ?? {
          userId: member.userId,
          displayName: directory.nameOf(member.userId),
          unitNames: [],
          orgNodeIds: [],
        },
    );

  const submit = async () => {
    setError(undefined);
    // Nhóm công việc không đi lại; các loại khác: xe công ty phải chọn đủ xe, tài xế và giờ.
    const transportBlock = isPhase ? undefined : transport.payload();
    if (!isPhase && transport.value.mode && transport.problem) {
      setError(transport.problem);
      return;
    }
    setSubmitting(true);
    try {
      const hours = form.estimateHours.trim() ? Number(form.estimateHours) : undefined;
      // Người phụ trách đã có ô riêng, không lặp lại trong người thực hiện cùng.
      const participants = form.participantUserIds.filter(
        (userId) => userId !== form.assigneeUserId,
      );
      if (item) {
        await onUpdate({
          title: form.title,
          description: form.description || undefined,
          priority: form.priority,
          assigneeUserId: isPhase ? null : form.assigneeUserId || null,
          participantUserIds: isPhase ? [] : participants,
          tagIds: form.tagIds,
          plannedStart: form.plannedStart || null,
          plannedEnd: form.plannedEnd || null,
          estimateHours: isPhase ? null : (hours ?? null),
          transport: transportBlock,
        });
      } else {
        if (projectOptions && !form.projectId) {
          setError('Hãy chọn dự án cho công việc này.');
          setSubmitting(false);
          return;
        }
        if (form.executionType === 'procedure' && !form.procedureDefinitionId) {
          setError('Hãy chọn quy trình sẽ mở cho công việc này.');
          setSubmitting(false);
          return;
        }
        await onCreate({
          parentId: form.parentId || undefined,
          title: form.title,
          description: form.description || undefined,
          itemType: form.itemType,
          executionType: form.executionType,
          priority: form.priority,
          assigneeUserId: isPhase ? undefined : form.assigneeUserId || undefined,
          participantUserIds: isPhase ? undefined : participants,
          tagIds: form.tagIds,
          plannedStart: form.plannedStart || undefined,
          plannedEnd: form.plannedEnd || undefined,
          estimateHours: isPhase ? undefined : hours,
          adjustmentOfId: adjustmentOf?.id,
          transport: transportBlock ?? undefined,
        },
        form.executionType === 'procedure' ? form.procedureDefinitionId : undefined,
        );
      }
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được công việc.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={item ? `Sửa ${item.code}` : adjustmentOf ? 'Công việc điều chỉnh' : 'Công việc mới'}
      subtitle={
        item
          ? 'Mã và loại công việc không thay đổi được sau khi tạo.'
          : adjustmentOf
            ? `Thay cho ${adjustmentOf.code} đã huỷ hiệu lực (${adjustmentOf.reversal?.reason ?? ''}).`
          : parent
            ? `Tạo bên dưới ${parent.code} · ${parent.title}`
            : 'Tạo ở cấp gốc của dự án.'
      }
      submitLabel={item ? 'Lưu thay đổi' : 'Tạo công việc'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {!item && projectOptions ? (
        <Field label="Dự án">
          <Choice
            label="Dự án"
            value={form.projectId}
            required
            placeholder="Chọn dự án…"
            options={projectOptions.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => {
              // Đổi dự án thì cây công việc cha cũng khác: về "Gốc dự án" và báo
              // nơi gọi nạp lại danh sách công việc cha của dự án mới.
              set({ projectId: value, parentId: '' });
              onProjectChange?.(value);
            }}
          />
        </Field>
      ) : null}

      <Field label="Tên công việc">
        <input
          value={form.title}
          required
          maxLength={200}
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>

      <Field label="Mô tả">
        <textarea
          rows={3}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      {item ? null : (
        <Field label="Công việc cha" hint="Để trống thì công việc nằm ở cấp gốc của dự án.">
          <Choice
            label="Công việc cha"
            value={form.parentId}
            placeholder="Chọn công việc cha…"
            options={[
              { value: '', label: 'Gốc dự án' },
              ...(parentOptions ?? []).map((option) => ({
                value: option.id,
                label: option.label,
              })),
            ]}
            onChange={(value) => set({ parentId: value })}
          />
        </Field>
      )}

      <div className={styles.fieldRow}>
        {item ? null : (
          <Field label="Loại">
            <Choice
              label="Loại"
              value={form.itemType}
              options={WORK_ITEM_TYPES.map((type) => ({
                value: type,
                label: ITEM_TYPE_LABELS[type],
              }))}
              onChange={(value) => set({ itemType: value as WorkItemType })}
            />
          </Field>
        )}
        <Field label="Độ ưu tiên">
          <Choice
            label="Độ ưu tiên"
            value={form.priority}
            options={WORK_ITEM_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_LABELS[priority],
            }))}
            onChange={(value) => set({ priority: value as WorkItemPriority })}
          />
        </Field>
      </div>

      {item || isPhase ? null : (
        <Field label="Cách thực hiện">
          <Choice
            label="Cách thực hiện"
            value={form.executionType}
            options={[
              { value: 'manual', label: 'Thủ công' },
              { value: 'procedure', label: 'Theo quy trình' },
            ]}
            onChange={(value) => set({ executionType: value as 'manual' | 'procedure' })}
          />
        </Field>
      )}

      {!item && !isPhase && form.executionType === 'procedure' ? (
        <Field label="Quy trình">
          {procedures === undefined ? (
            <span className={styles.muted}>Đang tải danh sách quy trình…</span>
          ) : procedures.length === 0 ? (
            // Quy trình không đọc được thì form vẫn dùng được — chỉ là không
            // chọn được quy trình, nên nói rõ lý do thay vì để ô chọn trống.
            <span className={styles.muted}>
              Không đọc được quy trình nào. Hãy chọn Thủ công, hoặc thử lại sau.
            </span>
          ) : (
            <Choice
              label="Quy trình"
              value={form.procedureDefinitionId}
              required
              placeholder="Chọn quy trình…"
              options={procedures.map((procedure) => ({
                value: procedure.id,
                label: `${procedure.code} · ${procedure.name}`,
              }))}
              onChange={(value) => set({ procedureDefinitionId: value })}
            />
          )}
        </Field>
      ) : null}

      {isPhase ? null : (
        <div className={styles.fieldRow}>
          <Field label="Người phụ trách">
            <Choice
              label="Người phụ trách"
              value={form.assigneeUserId}
              emptyOption="Chưa giao"
              options={members
                .filter(
                  (member) =>
                    canAssignOthers ||
                    member.userId === currentUserId ||
                    // Giữ người đang phụ trách để ô chọn không tự đổi giá trị.
                    member.userId === item?.assigneeUserId,
                )
                .map((member) => ({
                  value: member.userId,
                  label: directory.nameOf(member.userId),
                }))}
              onChange={(value) => set({ assigneeUserId: value })}
            />
          </Field>
          <Field label="Giờ ước lượng">
            <input
              type="number"
              min={0}
              step="0.5"
              value={form.estimateHours}
              onChange={(event) => set({ estimateHours: event.target.value })}
            />
          </Field>
        </div>
      )}

      {isPhase ? null : (
        <Field label="Người thực hiện cùng">
          <PeoplePicker
            people={memberPeople}
            selected={form.participantUserIds}
            exclude={form.assigneeUserId ? [form.assigneeUserId] : []}
            nameOf={directory.nameOf}
            placeholder="Tìm thành viên dự án"
            loaded={directory.loaded}
            onChange={(participantUserIds) => set({ participantUserIds })}
          />
        </Field>
      )}

      <Field label="Nhãn">
        <TagPicker selected={form.tagIds} onChange={(tagIds) => set({ tagIds })} />
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Bắt đầu dự kiến">
          <DatePickerInput
            height={38}
            value={form.plannedStart}
            onChange={(value) => set({ plannedStart: value })}
          />
        </Field>
        <Field label="Kết thúc dự kiến">
          <DatePickerInput
            height={38}
            value={form.plannedEnd}
            onChange={(value) => set({ plannedEnd: value })}
          />
        </Field>
      </div>

      {isPhase ? null : <TransportSection state={transport} editableRange idPrefix="work-item-transport" />}
    </Dialog>
  );
}
