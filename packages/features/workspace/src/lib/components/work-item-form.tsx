'use client';

import {
  WORK_ITEM_PRIORITIES,
  type CreateWorkItemRequest,
  type DirectoryPerson,
  type ProjectMember,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import { fromLocalInput } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormPrefill, WorkItemPrefill } from '../assistant-drafts';
import { loadProcedureOptions, type ProcedureOption } from '../procedure-api';
import { PRIORITY_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { TagPicker } from './tag-picker';
import { TitleInput, useRecentTitles } from './title-input';
import { TransportSection } from './transport-section';
import { useSourceTransport, type SourceTransportState } from './use-source-transport';
import { draftRow, WorkItemDraftEditor, type DraftFields, type DraftRow } from './work-item-draft';

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
    /**
     * Người được giao/cùng làm nhưng chưa thuộc dự án. Nơi gọi thêm họ vào dự
     * án (vai 'member') trước khi tạo công việc, để server chấp nhận người phụ
     * trách/cùng làm.
     */
    addMemberUserIds?: string[],
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
  /** Đang hỏi xác nhận thêm người ngoài dự án vào dự án trước khi tạo việc. */
  const [confirmOutside, setConfirmOutside] = useState(false);
  /** Các việc sẽ tạo, mỗi việc đủ trường riêng (chỉ dùng khi tạo mới); sửa việc thì dùng `form`. */
  const [rows, setRows] = useState<DraftRow[]>(() => [draftRow()]);
  /** Tên công việc đã dùng, gợi ý khi gõ tên. */
  const titleHistory = useRecentTitles(open);

  // Chỉ hỏi module Quy trình khi người dùng thật sự chọn "Theo quy trình",
  // và chỉ một lần mỗi lần mở form.
  const wantsProcedures = item
    ? form.executionType === 'procedure'
    : rows.some((row) => row.executionType === 'procedure');
  useEffect(() => {
    if (!open || !wantsProcedures || procedures) return;
    void loadProcedureOptions().then(setProcedures);
  }, [open, wantsProcedures, procedures]);

  useEffect(() => {
    if (!open) return;
    setProcedures(undefined);
    const initial: FormState =
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
          : { ...EMPTY, parentId: defaultParentId ?? parent?.id ?? '' };
    setForm(initial);
    setRows([draftRow(initial)]);
    setError(undefined);
    setSubmitting(false);
    setConfirmOutside(false);
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
    // Bản nháp của Trợ lý là một công việc: gộp vào việc đầu tiên.
    const fields: Partial<DraftFields> = Object.fromEntries(
      Object.entries(prefill.values).filter(([key]) => key !== 'projectId'),
    );
    setRows((current) => {
      const [first, ...rest] = current;
      return first ? [{ ...first, ...fields }, ...rest] : [draftRow(fields)];
    });
  }, [open, item, prefill]);

  const setRow = (key: number, patch: Partial<DraftFields>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  /** Mọi trường của một việc trừ tên — để nhân bản hay dán nhiều dòng. */
  const copyOf = (row: DraftRow, title = ''): DraftRow => draftRow({ ...row, title });

  /** Thêm việc mới: chép công việc cha, loại, ưu tiên, người phụ trách và ngày của việc cuối cho đỡ chọn lại. */
  const addRow = () =>
    setRows((current) => {
      const last = current[current.length - 1];
      return [
        ...current,
        draftRow(
          last
            ? {
                parentId: last.parentId,
                itemType: last.itemType,
                priority: last.priority,
                assigneeUserId: last.assigneeUserId,
                plannedStart: last.plannedStart,
                plannedEnd: last.plannedEnd,
              }
            : {},
        ),
      ];
    });

  /** Nhân bản: chép mọi trường trừ tên, đặt ngay dưới việc gốc. */
  const duplicateRow = (key: number) =>
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      const base = current[index];
      if (!base) return current;
      return [...current.slice(0, index + 1), copyOf(base), ...current.slice(index + 1)];
    });

  /** Dán nhiều dòng vào ô tên: dòng đầu điền vào ô đó, các dòng sau thành việc mới chép mọi trường khác. */
  const pasteLines = (key: number, lines: string[]) =>
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      const base = current[index];
      if (!base) return current;
      const [head, ...tail] = lines;
      return [
        ...current.slice(0, index),
        { ...base, title: head ?? base.title },
        ...tail.map((title) => copyOf(base, title)),
        ...current.slice(index + 1),
      ];
    });

  /** Khối phương tiện của từng việc (mỗi việc tự giữ hook riêng), để kiểm và lấy payload khi gửi. */
  const transports = useRef(new Map<number, SourceTransportState>());
  const registerTransport = useCallback((key: number, state: SourceTransportState | undefined) => {
    if (state) transports.current.set(key, state);
    else transports.current.delete(key);
  }, []);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  // Công việc chỉ có ngày dự kiến, nên khung giờ dùng xe gợi ý là 8 giờ ngày bắt đầu đến 17 giờ ngày kết thúc;
  // người dùng chỉnh được ngay trên khối phương tiện.
  // Chỉ dùng khi sửa; tạo mới thì mỗi việc có khối riêng.
  const transport = useSourceTransport({
    open: open && Boolean(item),
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

  // Tạo mới thì tìm người trong toàn bộ danh bạ công ty, không bó trong thành
  // viên dự án — người ngoài dự án sẽ được gắn nhãn và thêm vào dự án sau khi
  // người tạo xác nhận. Sửa việc vẫn chỉ chọn trong thành viên dự án.
  const isCreate = !item;
  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);

  /** Nguồn người cho ô "Người thực hiện cùng". */
  const participantPeople =
    !isCreate || directory.people.length === 0
      ? memberPeople
      : canAssignOthers
        ? directory.people
        : directory.people.filter((person) => person.userId === currentUserId);

  /** Lựa chọn cho ô "Người phụ trách". */
  const assigneeOptions = isCreate
    ? (directory.people.length > 0
        ? (canAssignOthers
            ? directory.people
            : directory.people.filter((person) => person.userId === currentUserId)
          ).map((person) => person.userId)
        : members
            .filter((member) => canAssignOthers || member.userId === currentUserId)
            .map((member) => member.userId)
      ).map((userId) => ({
        value: userId,
        label: memberIds.has(userId)
          ? directory.nameOf(userId)
          : `${directory.nameOf(userId)} · Ngoài dự án`,
      }))
    : members
        .filter(
          (member) =>
            canAssignOthers ||
            member.userId === currentUserId ||
            // Giữ người đang phụ trách để ô chọn không tự đổi giá trị.
            member.userId === item?.assigneeUserId,
        )
        .map((member) => ({ value: member.userId, label: directory.nameOf(member.userId) }));

  /** Người được chọn (phụ trách + cùng làm) nhưng chưa thuộc dự án. */
  const outsidePeople = useMemo<DirectoryPerson[]>(() => {
    if (!isCreate) return [];
    const ids = new Set<string>();
    for (const row of rows) {
      // Nhóm công việc không có người làm.
      if (!row.title.trim() || row.itemType === 'phase') continue;
      if (row.assigneeUserId) ids.add(row.assigneeUserId);
      for (const userId of row.participantUserIds) ids.add(userId);
    }
    return [...ids]
      .filter((userId) => !memberIds.has(userId))
      .map(
        (userId) =>
          directory.find(userId) ?? {
            userId,
            displayName: directory.nameOf(userId),
            unitNames: [],
            orgNodeIds: [],
          },
      );
  }, [isCreate, rows, memberIds, directory]);

  const submit = async () => {
    setError(undefined);
    if (item) {
      // Nhóm công việc không đi lại; các loại khác: xe công ty phải chọn đủ xe, tài xế và giờ.
      if (!isPhase && transport.value.mode && transport.problem) {
        setError(transport.problem);
        return;
      }
      const transportBlock = isPhase ? undefined : transport.payload();
      const hours = form.estimateHours.trim() ? Number(form.estimateHours) : undefined;
      // Người phụ trách đã có ô riêng, không lặp lại trong người thực hiện cùng.
      const participants = form.participantUserIds.filter(
        (userId) => userId !== form.assigneeUserId,
      );
      setSubmitting(true);
      try {
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
        onClose();
      } catch (cause) {
        setError((cause as { message?: string })?.message ?? 'Không lưu được công việc.');
        setSubmitting(false);
      }
      return;
    }

    if (projectOptions && !form.projectId) {
      setError('Hãy chọn dự án cho công việc này.');
      return;
    }
    const filled = rows.filter((row) => row.title.trim());
    if (filled.length === 0) {
      setError('Nhập tên cho ít nhất một công việc.');
      return;
    }
    for (const row of filled) {
      const label = filled.length > 1 ? `Công việc ${rows.indexOf(row) + 1}: ` : '';
      if (row.itemType !== 'phase' && row.executionType === 'procedure' && !row.procedureDefinitionId) {
        setError(`${label}hãy chọn quy trình sẽ mở cho công việc này.`);
        return;
      }
      const rowTransport = transports.current.get(row.key);
      if (row.itemType !== 'phase' && rowTransport?.value.mode && rowTransport.problem) {
        setError(`${label}${rowTransport.problem}`);
        return;
      }
    }
    // Có người ngoài dự án: hỏi xác nhận trước khi thêm họ vào dự án.
    if (outsidePeople.length > 0 && !confirmOutside) {
      setConfirmOutside(true);
      return;
    }
    await runCreate(outsidePeople.map((person) => person.userId));
  };

  /** Số dòng đã có tên — chính là số công việc sẽ tạo. */
  const filledRows = rows.filter((row) => row.title.trim()).length;

  /**
   * Tạo lần lượt từng dòng có tên. Dòng nào tạo xong thì rút khỏi danh sách ngay: hỏng giữa chừng thì người
   * dùng sửa rồi bấm lại, không tạo trùng các việc đã xong.
   */
  const runCreate = async (addMemberUserIds: string[]) => {
    setConfirmOutside(false);
    setError(undefined);
    const pending = rows.filter((row) => row.title.trim());
    setSubmitting(true);
    let created = 0;
    try {
      for (const row of pending) {
        const phase = row.itemType === 'phase';
        const hours = row.estimateHours.trim() ? Number(row.estimateHours) : undefined;
        // Người phụ trách đã có ô riêng, không lặp lại trong người thực hiện cùng.
        const participants = row.participantUserIds.filter((userId) => userId !== row.assigneeUserId);
        const procedure = !phase && row.executionType === 'procedure';
        await onCreate(
          {
            parentId: row.parentId || undefined,
            title: row.title.trim(),
            description: row.description || undefined,
            itemType: row.itemType,
            executionType: phase ? 'manual' : row.executionType,
            priority: row.priority,
            assigneeUserId: phase ? undefined : row.assigneeUserId || undefined,
            participantUserIds: phase ? undefined : participants,
            tagIds: row.tagIds,
            plannedStart: row.plannedStart || undefined,
            plannedEnd: row.plannedEnd || undefined,
            estimateHours: phase ? undefined : hours,
            adjustmentOfId: adjustmentOf?.id,
            transport: phase ? undefined : (transports.current.get(row.key)?.payload() ?? undefined),
          },
          procedure ? row.procedureDefinitionId : undefined,
          // Người ngoài dự án chỉ cần thêm vào dự án một lần, ở việc đầu tiên.
          created === 0 && addMemberUserIds.length > 0 ? addMemberUserIds : undefined,
        );
        created += 1;
        setRows((current) => {
          const rest = current.filter((entry) => entry.key !== row.key);
          return rest.length > 0 ? rest : [draftRow()];
        });
      }
      onClose();
    } catch (cause) {
      const message = (cause as { message?: string })?.message ?? 'Không lưu được công việc.';
      setError(
        created > 0
          ? `Đã tạo ${created}/${pending.length} công việc. Việc tiếp theo bị lỗi: ${message}`
          : message,
      );
      setSubmitting(false);
    }
  };

  return (
    <>
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
      size={item ? 'default' : 'extraWide'}
      submitLabel={
        item
          ? 'Lưu thay đổi'
          : filledRows > 1
            ? `Tạo ${filledRows} công việc`
            : 'Tạo công việc'
      }
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {item ? (
        <EditFields
          form={form}
          set={set}
          isPhase={isPhase}
          titleHistory={titleHistory}
          assigneeOptions={assigneeOptions}
          participantPeople={participantPeople}
          nameOf={directory.nameOf}
          directoryLoaded={directory.loaded}
          transport={transport}
        />
      ) : (
        <>
          {projectOptions ? (
            <Field label="Dự án">
              <Choice
                label="Dự án"
                value={form.projectId}
                required
                placeholder="Chọn dự án…"
                options={projectOptions.map((option) => ({ value: option.id, label: option.label }))}
                onChange={(value) => {
                  // Đổi dự án thì cây công việc cha cũng khác: về "Gốc dự án" ở mọi việc và báo
                  // nơi gọi nạp lại danh sách công việc cha của dự án mới.
                  set({ projectId: value });
                  setRows((current) => current.map((row) => ({ ...row, parentId: '' })));
                  onProjectChange?.(value);
                }}
              />
            </Field>
          ) : null}

          <div className={styles.draftList}>
            {rows.map((row, index) => (
              <WorkItemDraftEditor
                key={row.key}
                open={open}
                index={index}
                row={row}
                removable={rows.length > 1}
                onChange={(patch) => setRow(row.key, patch)}
                onRemove={() =>
                  setRows((current) => current.filter((entry) => entry.key !== row.key))
                }
                onDuplicate={() => duplicateRow(row.key)}
                onPasteLines={(lines) => pasteLines(row.key, lines)}
                onTransport={registerTransport}
                history={titleHistory}
                assigneeOptions={assigneeOptions}
                participantPeople={participantPeople}
                nameOf={directory.nameOf}
                directoryLoaded={directory.loaded}
                outsideTag={(userId) => (memberIds.has(userId) ? undefined : 'Ngoài dự án')}
                parentOptions={(parentOptions ?? []).map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                procedures={procedures}
              />
            ))}
          </div>

          <div className={styles.draftFoot}>
            <button type="button" className={styles.buttonSmall} onClick={addRow}>
              <Plus size={13} /> Thêm công việc
            </button>
            <span className={styles.fieldHint}>
              Mỗi công việc có thông tin riêng. Nút nhân bản chép mọi trường trừ tên; dán nhiều dòng
              vào ô tên để tạo nhiều việc cùng thông tin.
            </span>
          </div>
        </>
      )}
    </Dialog>

    {/* Chọn người ngoài dự án: xác nhận trước khi thêm họ vào dự án rồi mới tạo việc. */}
    <Dialog
      open={confirmOutside}
      title="Thêm thành viên vào dự án"
      subtitle="Những người sau sẽ được thêm vào dự án:"
      submitLabel="Xác nhận"
      submitting={submitting}
      onClose={() => setConfirmOutside(false)}
      onSubmit={() => void runCreate(outsidePeople.map((person) => person.userId))}
    >
      <ul className={styles.memberList}>
        {outsidePeople.map((person) => (
          <li key={person.userId}>
            <span className={styles.memberName}>{person.displayName}</span>
            <span className={styles.memberRole}>{person.positionName ?? 'Chưa có chức danh'}</span>
          </li>
        ))}
      </ul>
    </Dialog>
    </>
  );
}

/** Các trường khi SỬA một công việc: mã, loại, công việc cha và cách thực hiện không đổi được sau khi tạo. */
function EditFields({
  form,
  set,
  isPhase,
  titleHistory,
  assigneeOptions,
  participantPeople,
  nameOf,
  directoryLoaded,
  transport,
}: {
  readonly form: FormState;
  readonly set: (patch: Partial<FormState>) => void;
  readonly isPhase: boolean;
  readonly titleHistory: readonly string[];
  readonly assigneeOptions: ReadonlyArray<{ value: string; label: string }>;
  readonly participantPeople: readonly DirectoryPerson[];
  readonly nameOf: (userId: string) => string;
  readonly directoryLoaded: boolean;
  readonly transport: SourceTransportState;
}) {
  return (
    <>
      <Field label="Tên công việc">
        <TitleInput value={form.title} history={titleHistory} onChange={(title) => set({ title })} />
      </Field>

      <Field label="Mô tả">
        <textarea
          rows={3}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

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

      {isPhase ? null : (
        <div className={styles.fieldRow}>
          <Field label="Người phụ trách">
            <Choice
              label="Người phụ trách"
              value={form.assigneeUserId}
              emptyOption="Chưa giao"
              options={assigneeOptions}
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
            people={participantPeople}
            selected={form.participantUserIds}
            exclude={form.assigneeUserId ? [form.assigneeUserId] : []}
            nameOf={nameOf}
            placeholder="Tìm thành viên dự án"
            loaded={directoryLoaded}
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

      {isPhase ? null : (
        <TransportSection state={transport} editableRange idPrefix="work-item-transport" />
      )}
    </>
  );
}
