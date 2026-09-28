'use client';

import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_TYPES,
  type CreateWorkItemRequest,
  type ProjectMember,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemCost,
  type WorkItemPriority,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { formatVndWhileTyping, parseVndInput, toVndInput } from '../money';
import { loadProcedureOptions, type ProcedureOption } from '../procedure-api';
import { ITEM_TYPE_LABELS, PRIORITY_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

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
    costs?: WorkItemCostInput,
  ) => Promise<void>;
  readonly onUpdate: (input: UpdateWorkItemRequest, costs?: WorkItemCostInput) => Promise<void>;
  /**
   * Người dùng được nhập chi phí — chỉ `owner`, `manager` và quản trị viên.
   * Tắt thì hai ô chi phí **không được dựng**, không phải bị vô hiệu hoá.
   */
  readonly financeEnabled?: boolean;
  /** Chi phí hiện có khi sửa; lấy từ payload tài chính của dự án. */
  readonly initialCost?: WorkItemCost;
}

/**
 * Chi phí gửi kèm khi lưu công việc.
 *
 * Nơi gọi ghi chúng qua endpoint riêng `PATCH /work-items/:id/costs` — số
 * tiền không bao giờ đi chung payload với các trường thường của công việc.
 */
export interface WorkItemCostInput {
  readonly estimatedCost: number | null;
}

interface FormState {
  title: string;
  description: string;
  itemType: WorkItemType;
  executionType: 'manual' | 'procedure';
  priority: WorkItemPriority;
  assigneeUserId: string;
  plannedStart: string;
  plannedEnd: string;
  estimateHours: string;
  procedureDefinitionId: string;
  estimatedCost: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  itemType: 'task',
  executionType: 'manual',
  priority: 'normal',
  assigneeUserId: '',
  plannedStart: '',
  plannedEnd: '',
  estimateHours: '',
  procedureDefinitionId: '',
  estimatedCost: '',
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
  financeEnabled = false,
  initialCost,
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
            title: item.title,
            description: item.description ?? '',
            itemType: item.itemType,
            executionType: item.executionType,
            priority: item.priority,
            assigneeUserId: item.assigneeUserId ?? '',
            plannedStart: item.plannedStart ?? '',
            plannedEnd: item.plannedEnd ?? '',
            estimateHours: item.estimateHours == null ? '' : String(item.estimateHours),
            procedureDefinitionId: '',
            estimatedCost: toVndInput(initialCost?.estimatedCost),
          }
        : EMPTY,
    );
    setError(undefined);
    setSubmitting(false);
  }, [open, item, initialCost]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  // Nhóm công việc chỉ là vỏ chứa: server từ chối người phụ trách và giờ ước
  // lượng trên nó, nên ẩn hai ô đó thay vì để người dùng nhập rồi báo lỗi.
  const isPhase = form.itemType === 'phase';

  // Chi phí chỉ có nghĩa với việc thật, không với nhóm công việc — server
  // cũng từ chối chi phí trên `phase` vì nó sẽ bị cộng hai lần cùng việc con.
  const showCosts = financeEnabled && !isPhase;

  /**
   * Đọc ô chi phí dự toán. Chi phí thực tế không nhập ở đây — nó ghi qua sổ
   * chi phí (tab Tài chính) để mỗi khoản có lý do và người ghi. Chặn số âm và chuỗi không đọc được ngay ở đây để báo
   * sớm; server vẫn kiểm lại — client chỉ là tiện lợi, không phải hàng rào.
   */
  const readCosts = (): WorkItemCostInput | string | undefined => {
    if (!showCosts) return undefined;
    const estimated = parseVndInput(form.estimatedCost);
    if (estimated === undefined) return 'Chi phí dự toán: không đọc được số.';
    if ((estimated ?? 0) < 0) return 'Chi phí dự toán không được là số âm.';
    return { estimatedCost: estimated };
  };

  const submit = async () => {
    setError(undefined);
    const costs = readCosts();
    if (typeof costs === 'string') {
      setError(costs);
      return;
    }
    setSubmitting(true);
    try {
      const hours = form.estimateHours.trim() ? Number(form.estimateHours) : undefined;
      if (item) {
        await onUpdate({
          title: form.title,
          description: form.description || undefined,
          priority: form.priority,
          assigneeUserId: isPhase ? null : form.assigneeUserId || null,
          plannedStart: form.plannedStart || null,
          plannedEnd: form.plannedEnd || null,
          estimateHours: isPhase ? null : (hours ?? null),
        }, costs);
      } else {
        if (form.executionType === 'procedure' && !form.procedureDefinitionId) {
          setError('Hãy chọn quy trình sẽ mở cho công việc này.');
          setSubmitting(false);
          return;
        }
        await onCreate({
          parentId: parent?.id,
          title: form.title,
          description: form.description || undefined,
          itemType: form.itemType,
          executionType: form.executionType,
          priority: form.priority,
          assigneeUserId: isPhase ? undefined : form.assigneeUserId || undefined,
          plannedStart: form.plannedStart || undefined,
          plannedEnd: form.plannedEnd || undefined,
          estimateHours: isPhase ? undefined : hours,
        },
        form.executionType === 'procedure' ? form.procedureDefinitionId : undefined,
        costs,
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
      title={item ? `Sửa ${item.code}` : 'Công việc mới'}
      subtitle={
        item
          ? 'Mã và loại công việc không thay đổi được sau khi tạo.'
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
        <Field
          label="Cách thực hiện"
          hint="Chọn “Theo quy trình” để mở một hồ sơ bên module Quy trình sau khi lưu."
        >
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
        <Field
          label="Quy trình"
          hint="Chỉ hiện quy trình đã công bố mà bạn được thấy. Quyền mở hồ sơ do module Quy trình tự kiểm."
        >
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
          <Field label="Giờ ước lượng" hint="Dùng làm trọng số khi cuộn tiến độ lên cấp trên.">
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

      <div className={styles.fieldRow}>
        <Field label="Bắt đầu dự kiến">
          <input
            type="date"
            value={form.plannedStart}
            onChange={(event) => set({ plannedStart: event.target.value })}
          />
        </Field>
        <Field label="Kết thúc dự kiến">
          <input
            type="date"
            value={form.plannedEnd}
            onChange={(event) => set({ plannedEnd: event.target.value })}
          />
        </Field>
      </div>

      {showCosts ? (
        <div className={styles.fieldRow}>
          <Field label="Chi phí dự toán (VND)" hint="Tính vào chi phí dự kiến khi việc còn mở.">
            <input
              inputMode="decimal"
              value={form.estimatedCost}
              placeholder="Ví dụ 150.000.000"
              // Chấm ngăn nghìn hiện ngay khi gõ; đếm số 0 bằng mắt là cách
              // chắc chắn nhập sai một bậc.
              onChange={(event) =>
                set({ estimatedCost: formatVndWhileTyping(event.target.value) })
              }
            />
          </Field>
          <Field label="Chi phí thực tế (VND)" hint="Ghi từng khoản kèm lý do ở tab Tài chính.">
            {/* Đơn vị đã nằm ở nhãn "(VND)", không lặp lại ký hiệu đ trong ô. */}
            <input readOnly value={toVndInput(initialCost?.actualCost ?? 0)} />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}
