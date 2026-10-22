'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import { useAssistantEmbed } from '@enterprise-platform/feature-module-shell';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { StartPrefillValues } from '../assistant-start-draft';
import {
  loadProjectPeople,
  loadProjectWorkItems,
  loadRelatedProjects,
  procedureNameFor,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
  type ProjectPerson,
  type ProjectWorkItemInput,
  type ProjectWorkItemOption,
  type RelatedProject,
  type WorkItemPriority,
  type WorkItemType,
} from '../workspace-api';
import { submitterOptionsOf } from '../submitter-options';
import styles from './workspace-board.module.scss';

export interface StartProcedureInput {
  title: string;
  startDueAt: string;
  endDueAt: string;
  isHourlyScheduling: boolean;
  /** Gắn dự án: đơn này là một công việc mới của dự án bên Workspace. */
  workItem?: ProjectWorkItemInput & { readonly projectCode: string };
  /** Người submit (giữ vai S). Khác người đang tạo là tạo đơn hộ. */
  submitterUserId?: string;
  submitterName?: string;
}

/** Nội dung điền sẵn vào form tạo đơn khi module/hồ sơ khác chuyển sang. */
export interface StartHandoff {
  readonly definitionId?: string;
  readonly startDueAt?: string;
  readonly endDueAt?: string;
  readonly projectId?: string;
  /** Dòng giải thích hiện trên form, ví dụ "Hồ sơ điều chỉnh cho QT-001". */
  readonly note?: string;
}

function toIsoDateTime(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function splitLocalDateTime(iso?: string): { date: string; time: string } | undefined {
  if (!iso) return undefined;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return undefined;
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

const FORM_TITLE = 'Tạo Đơn / Yêu cầu Mới';

/**
 * Khung của form: popup trên màn Hồ sơ xử lý; trong card Trợ lý (`useAssistantEmbed`) thì hiện ngay tại chỗ, hết bề
 * ngang card, không lớp phủ.
 */
function StartFormFrame({
  embedded,
  onClose,
  children,
}: {
  embedded: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (embedded) {
    return (
      <section className={styles.startInline} aria-labelledby="create-request-heading">
        <h2 id="create-request-heading" className={styles.startInlineTitle}>
          {FORM_TITLE}
        </h2>
        {children}
      </section>
    );
  }
  return (
    <MinimalPopupForm
      isOpen
      title={FORM_TITLE}
      subtitle="Khởi tạo phiếu công việc / yêu cầu xử lý theo quy trình vận hành"
      onClose={onClose}
      maxWidth={640}
    >
      {children}
    </MinimalPopupForm>
  );
}

export interface StartInstanceFormProps {
  /**
   * Form đang mở. Bảng Hồ sơ xử lý giữ component này suốt (đóng rồi mở lại vẫn còn tên, quy trình, thời gian đã
   * nhập); trang form nhúng của Trợ lý luôn mở.
   */
  readonly open: boolean;
  readonly onClose: () => void;
  /** Quy trình đã công bố, để chọn quy trình áp dụng. */
  readonly definitions: readonly ProcedureDefinition[];
  /** Thao tác đang chạy; `start:<mã quy trình>` là đang mở hồ sơ theo quy trình đó. */
  readonly busy?: string;
  readonly onStart: (
    definition: ProcedureDefinition,
    input: StartProcedureInput,
  ) => Promise<void> | void;
  readonly actorId?: string;
  readonly actorName?: string;
  /** Sơ đồ tổ chức, để gợi ý người submit (người giữ vai S của quy trình). */
  readonly organization?: TenantOrganizationSnapshot;
  /** Tên hồ sơ do module hoặc hồ sơ khác chuyển sang; có thì điền form theo `handoff`. */
  readonly handoffTitle?: string;
  readonly handoff?: StartHandoff;
  /** Bản nháp của Trợ lý: `revision` mới thì điền các ô có trong `values`, ô khác giữ nguyên. */
  readonly prefill?: { readonly revision: number; readonly values: StartPrefillValues };
  /** Lỗi khi mở hồ sơ (trang form nhúng của Trợ lý), hiện ngay trên hàng nút. */
  readonly error?: string;
}

/** Form "Tạo đơn / yêu cầu": mở hồ sơ theo một quy trình đã công bố, có thể gắn thành công việc của một dự án. */
export function StartInstanceForm({
  open,
  onClose,
  definitions,
  busy,
  onStart,
  actorId,
  actorName,
  organization,
  handoffTitle,
  handoff,
  prefill,
  error,
}: StartInstanceFormProps) {
  // Trong card Trợ lý: bỏ các dòng gợi ý để card gọn, chỉ giữ nhãn, giá trị và lỗi.
  const embedded = useAssistantEmbed();
  const [selectedCreateDefId, setSelectedCreateDefId] = useState<string>();
  const [jobTitle, setJobTitle] = useState('');
  const [startTime, setStartTime] = useState('07:30');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [endTime, setEndTime] = useState('17:00');
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  // Dự án liên quan: chọn một dự án Workspace thì đơn này thành công việc mới
  // của dự án đó, kèm các trường của form tạo công việc bên Workspace.
  const [relatedProjects, setRelatedProjects] = useState<RelatedProject[]>();
  const [projectId, setProjectId] = useState('');
  const [projectPeople, setProjectPeople] = useState<ProjectPerson[]>([]);
  const [projectWorkItems, setProjectWorkItems] = useState<ProjectWorkItemOption[]>([]);
  const [itemParentId, setItemParentId] = useState('');
  /** Người submit; mặc định là chính người tạo đơn, chọn người khác là tạo đơn hộ. */
  const [submitter, setSubmitter] = useState(actorId ?? '');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPriority, setItemPriority] = useState<WorkItemPriority>('normal');
  const [itemAssignee, setItemAssignee] = useState('');
  const [itemHours, setItemHours] = useState('');
  const [itemType, setItemType] = useState<WorkItemType>('task');
  const project = relatedProjects?.find((item) => item.id === projectId);

  useEffect(() => {
    if (!open || relatedProjects) return;
    void loadRelatedProjects().then(setRelatedProjects);
  }, [open, relatedProjects]);

  useEffect(() => {
    setItemAssignee('');
    setProjectPeople([]);
    setProjectWorkItems([]);
    setItemParentId('');
    if (!projectId) return;
    let cancelled = false;
    void loadProjectPeople(projectId)
      .then((people) => {
        if (!cancelled) setProjectPeople(people);
      })
      .catch(() => undefined);
    void loadProjectWorkItems(projectId)
      .then((items) => {
        if (!cancelled) setProjectWorkItems(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Đóng form thì bỏ lựa chọn dự án, lần mở sau nạp lại danh sách cho tươi.
  useEffect(() => {
    if (open) return;
    setRelatedProjects(undefined);
    setProjectId('');
    setItemDescription('');
    setItemPriority('normal');
    setItemHours('');
    setItemType('task');
  }, [open]);

  const assigneeOptions = useMemo(
    () =>
      projectPeople
        // `member` chỉ tự nhận việc cho mình; giao người khác cần `manager`.
        .filter((person) => project?.canAssignOthers || person.userId === actorId)
        .map((person) => ({
          value: person.userId,
          // Danh bạ thiếu tên (tenant chưa có cơ cấu) thì ít nhất chính mình
          // vẫn hiện bằng tên, không phải id.
          label:
            person.userId === actorId && person.displayName === person.userId && actorName
              ? actorName
              : person.displayName,
        })),
    [projectPeople, project, actorId, actorName],
  );
  // "Công việc cha": mặc định "Gốc dự án" (value rỗng), rồi tới cây công việc.
  const parentOptions = useMemo(
    () => [
      { value: '', label: 'Gốc dự án' },
      ...projectWorkItems.map((item) => ({
        value: item.id,
        // Thụt theo độ sâu để thấy cấu trúc cây trong danh sách phẳng.
        label: `${'— '.repeat(Math.min(item.depth, 6))}${item.code} · ${item.title}`,
      })),
    ],
    [projectWorkItems],
  );

  const hoursValue = itemHours.trim() ? Number(itemHours) : undefined;
  const isHoursInvalid = hoursValue !== undefined && !(hoursValue > 0);
  const startDueAt = useMemo(() => toIsoDateTime(startDate, startTime), [startDate, startTime]);
  const endDueAt = useMemo(() => toIsoDateTime(endDate, endTime), [endDate, endTime]);
  const hasValidStartDate = Boolean(startDate);
  const hasValidEndDate = Boolean(endDate);
  const isScheduleInvalid =
    !hasValidStartDate ||
    !hasValidEndDate ||
    !startDueAt ||
    !endDueAt ||
    Date.parse(endDueAt) <= Date.parse(startDueAt);
  const scheduleErrorMessage =
    !hasValidStartDate || !hasValidEndDate
      ? 'Chọn ngày bắt đầu và ngày kết thúc.'
      : 'Thời gian kết thúc phải sau thời gian bắt đầu.';

  // Nội dung do module hoặc hồ sơ khác chuyển sang; bảng Hồ sơ xử lý mở form cùng lúc.
  useEffect(() => {
    if (!handoffTitle) return;
    setJobTitle(handoffTitle);
    if (handoff?.definitionId) setSelectedCreateDefId(handoff.definitionId);
    if (handoff?.projectId) setProjectId(handoff.projectId);
    const start = splitLocalDateTime(handoff?.startDueAt);
    const end = splitLocalDateTime(handoff?.endDueAt);
    if (start && end) {
      setStartDate(start.date);
      setStartTime(start.time);
      setEndDate(end.date);
      setEndTime(end.time);
    }
  }, [handoffTitle, handoff]);

  const appliedPrefill = useRef<number>(undefined);
  useEffect(() => {
    if (!prefill || appliedPrefill.current === prefill.revision) return;
    appliedPrefill.current = prefill.revision;
    const { values } = prefill;
    if (values.title !== undefined) setJobTitle(values.title);
    if (values.definitionId !== undefined) setSelectedCreateDefId(values.definitionId);
    if (values.projectId !== undefined) setProjectId(values.projectId);
    if (values.description !== undefined) setItemDescription(values.description);
    const start = splitLocalDateTime(values.startDueAt);
    if (start) {
      setStartDate(start.date);
      setStartTime(start.time);
    }
    const end = splitLocalDateTime(values.endDueAt);
    if (end) {
      setEndDate(end.date);
      setEndTime(end.time);
    } else if (start) {
      // Như khi người dùng đổi ngày bắt đầu: ngày kết thúc không đứng trước ngày bắt đầu.
      setEndDate((current) => (current < start.date ? start.date : current));
    }
  }, [prefill]);

  const selectedCreateDef = useMemo(() => {
    return definitions.find((d) => d.id === selectedCreateDefId);
  }, [definitions, selectedCreateDefId]);

  // Mọi người trong tenant; người tạo đứng đầu (mặc định hai người là một).
  const submitters = useMemo(
    () => submitterOptionsOf(organization, { id: actorId, name: actorName }),
    [organization, actorId, actorName],
  );
  /** Thành viên dự án đang chọn, để gắn thẻ "Trong dự án" / "Ngoài dự án". */
  const projectMemberIds = useMemo(
    () => new Set(projectPeople.map((person) => person.userId)),
    [projectPeople],
  );
  /**
   * Có dự án: thành viên dự án đứng đầu, người ngoài dự án gập sau nút "Ngoài dự án" (kèm chức danh / bộ phận).
   * Chưa chọn dự án, hoặc chưa tải xong thành viên: mọi người một danh sách.
   */
  const submitterChoices = useMemo(() => {
    const all = submitters.map((person) => ({
      value: person.userId,
      label: person.userId === actorId ? `${person.name} (tôi)` : person.name,
      description: person.hint,
    }));
    if (!projectId || projectMemberIds.size === 0) return { options: all, extra: undefined };
    const outside = all.filter((option) => !projectMemberIds.has(option.value));
    return {
      options: all.filter((option) => projectMemberIds.has(option.value)),
      extra:
        outside.length > 0
          ? {
              label: 'Ngoài dự án',
              options: outside,
              filters: { label: 'Tên', description: 'Chức danh / bộ phận' },
            }
          : undefined,
    };
  }, [submitters, actorId, projectId, projectMemberIds]);
  /** Dòng của ô "Người submit": tên, thẻ trong / ngoài dự án (xanh / vàng), chức danh. */
  const renderSubmitter = (option: { value: string; label: string; description?: string }) => {
    const inside = projectMemberIds.has(option.value);
    return (
      <span className={styles.submitterOption}>
        <span className={styles.submitterOptionRow}>
          <span>{option.label}</span>
          {projectId ? (
            <span className={inside ? styles.submitterTagIn : styles.submitterTagOut}>
              {inside ? 'Trong dự án' : 'Ngoài dự án'}
            </span>
          ) : null}
        </span>
        {option.description ? (
          <span className={styles.submitterOptionHint}>{option.description}</span>
        ) : null}
      </span>
    );
  };
  const onBehalf = Boolean(submitter && actorId && submitter !== actorId);
  /** Người submit chưa thuộc dự án đang chọn: sẽ được thêm vào dự án khi tạo đơn. */
  const submitterOutsideProject = Boolean(
    project && submitter && projectPeople.length > 0 && !projectMemberIds.has(submitter),
  );
  /** Thêm người vào dự án cần quyền quản lý thành viên của dự án đó. */
  const cannotAddSubmitter = submitterOutsideProject && !project?.canManageMembers;

  const procedureSelectOptions = useMemo(() => {
    return definitions.map((def) => ({
      value: def.id,
      label: `${def.name} (${def.code})`,
      description: def.description || `Mã quy trình: ${def.code}`,
      badge: def.code,
    }));
  }, [definitions]);

  if (!open) return null;

  const starting = Boolean(selectedCreateDef) && busy === `start:${selectedCreateDef?.id}`;

  // Người submit: mặc định chính người tạo; chọn người khác là tạo đơn hộ. Đặt sau phần dự án, nên chỉ
  // cần báo khi người được chọn chưa thuộc dự án.
  const submitterField = (
    <div className={styles.createFieldGroup}>
      <label className={styles.createFieldLabel}>Người submit</label>
      <SearchableSelect
        options={submitterChoices.options}
        extra={submitterChoices.extra}
        value={submitter}
        renderOption={renderSubmitter}
        placeholder="Chọn người submit"
        emptyText="Không tìm thấy người trong tenant"
        onChange={(value) => setSubmitter(value || actorId || '')}
      />
      {cannotAddSubmitter ? (
        <p className={styles.createScheduleError} role="alert">
          Người này chưa thuộc dự án {project?.code} và bạn không có quyền thêm thành viên vào dự án đó.
          Chọn người trong dự án, hoặc nhờ chủ nhiệm thêm họ vào dự án trước.
        </p>
      ) : submitterOutsideProject ? (
        <p className={styles.createFormHint}>
          Người này chưa thuộc dự án {project?.code}; sẽ được thêm vào dự án (vai Thành viên) khi tạo đơn.
        </p>
      ) : null}
    </div>
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCreateDef || !jobTitle.trim() || !startDueAt || !endDueAt || isScheduleInvalid)
      return;
    if (project && isHoursInvalid) return;
    if (cannotAddSubmitter) return;
    void onStart(selectedCreateDef, {
      title: jobTitle,
      startDueAt,
      endDueAt,
      isHourlyScheduling: true,
      workItem: project
        ? {
            projectId: project.id,
            projectCode: project.code,
            itemType,
            description: itemDescription.trim() || undefined,
            priority: itemPriority,
            assigneeUserId: itemAssignee || undefined,
            // Lịch dự kiến của công việc theo đúng lịch của đơn.
            plannedStart: startDate,
            plannedEnd: endDate,
            estimateHours: hoursValue,
            parentId: itemParentId || undefined,
          }
        : undefined,
      ...(onBehalf
        ? {
            submitterUserId: submitter,
            submitterName: submitters.find((person) => person.userId === submitter)?.name,
          }
        : {}),
    });
  };

  return (
    <StartFormFrame embedded={embedded} onClose={onClose}>
      <form className={styles.createFormBody} onSubmit={submit}>
        {handoff?.note ? <p className={styles.reversalNote}>{handoff.note}</p> : null}

        {/* Tên công việc * */}
        <div className={styles.createFieldGroup}>
          <label className={styles.createFieldLabel} htmlFor="create-request-title">
            Tên công việc <span className={styles.createRequiredStar}>*</span>
          </label>
          <input
            id="create-request-title"
            type="text"
            className={styles.createTextInput}
            placeholder="Tiêu đề hồ sơ"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            // Trong card Trợ lý không giành con trỏ khỏi ô chat.
            autoFocus={!embedded}
          />
        </div>

        {/* Áp dụng quy trình * */}
        <div className={styles.createFieldGroup}>
          <label className={styles.createFieldLabel}>
            Áp dụng quy trình <span className={styles.createRequiredStar}>*</span>
          </label>
          <SearchableSelect
            options={procedureSelectOptions}
            value={selectedCreateDef?.id ?? ''}
            placeholder="Tìm mã hoặc tên quy trình áp dụng…"
            clearable
            onChange={(val) => {
              if (!val) {
                setSelectedCreateDefId(undefined);
                return;
              }
              const found = definitions.find((d) => d.id === val);
              if (found) {
                setSelectedCreateDefId(found.id);
                if (!jobTitle.trim()) {
                  setJobTitle(found.name);
                }
              }
            }}
          />
        </div>

        {/* Dự án liên quan */}
        <div className={styles.createFieldGroup}>
          <label className={styles.createFieldLabel}>Dự án liên quan</label>
          <SearchableSelect
            options={(relatedProjects ?? []).map((item) => ({
              value: item.id,
              label: `${item.code} - ${item.name}`,
            }))}
            value={projectId}
            placeholder={
              relatedProjects === undefined ? 'Đang tải danh sách dự án…' : 'Không gắn dự án'
            }
            emptyText="Bạn chưa tham gia dự án nào bên Workspace"
            clearable
            onChange={setProjectId}
          />
          {embedded ? null : (
            <p className={styles.createFormHint}>
              {project
                ? `Tạo kèm công việc “${jobTitle.trim() || 'Tên công việc'}” trong dự án ${project.code}. Tên hồ sơ sẽ là “${procedureNameFor(project.code, 'CVxxx', jobTitle.trim() || 'Tên công việc')}”, với CVxxx là mã công việc tự sinh.`
                : 'Chọn dự án để đơn này trở thành một công việc mới trong dự án đó.'}
            </p>
          )}
        </div>

        {project ? (
          <>
            <div className={styles.createTimeDateGrid}>
              <div className={styles.createFieldGroup}>
                <label className={styles.createFieldLabel}>Công việc cha</label>
                <SearchableSelect
                  options={parentOptions}
                  value={itemParentId}
                  clearable={false}
                  placeholder={projectWorkItems.length === 0 ? 'Gốc dự án' : 'Tìm công việc cha…'}
                  emptyText="Dự án chưa có công việc nào"
                  onChange={(value) => setItemParentId(value || '')}
                />
              </div>

            </div>

            <div className={styles.createFieldGroup}>
              <label className={styles.createFieldLabel} htmlFor="create-item-description">
                Mô tả công việc
              </label>
              <textarea
                id="create-item-description"
                className={styles.createTextInput}
                rows={3}
                value={itemDescription}
                onChange={(event) => setItemDescription(event.target.value)}
              />
            </div>

            {submitterField}

            <div className={styles.createTimeDateGrid}>
              <div className={styles.createFieldGroup}>
                <label className={styles.createFieldLabel}>Loại</label>
                <SearchableSelect
                  options={WORK_ITEM_TYPE_OPTIONS}
                  value={itemType}
                  clearable={false}
                  onChange={(value) => setItemType((value || 'task') as WorkItemType)}
                />
              </div>
              <div className={styles.createFieldGroup}>
                <label className={styles.createFieldLabel}>Độ ưu tiên</label>
                <SearchableSelect
                  options={WORK_ITEM_PRIORITY_OPTIONS}
                  value={itemPriority}
                  clearable={false}
                  onChange={(value) => setItemPriority((value || 'normal') as WorkItemPriority)}
                />
              </div>
            </div>

            <div className={styles.createTimeDateGrid}>
              <div className={styles.createFieldGroup}>
                <label className={styles.createFieldLabel}>Người phụ trách</label>
                <SearchableSelect
                  options={assigneeOptions}
                  value={itemAssignee}
                  placeholder="Chưa giao"
                  emptyText="Không có thành viên phù hợp"
                  onChange={setItemAssignee}
                />
              </div>
              <div className={styles.createFieldGroup}>
                <label className={styles.createFieldLabel} htmlFor="create-item-hours">
                  Giờ ước lượng
                </label>
                <input
                  id="create-item-hours"
                  type="number"
                  min={0}
                  step="0.5"
                  className={styles.createTextInput}
                  value={itemHours}
                  onChange={(event) => setItemHours(event.target.value)}
                />
              </div>
            </div>

            {embedded && !isHoursInvalid ? null : (
              <p className={styles.createFormHint}>
                {isHoursInvalid
                  ? 'Giờ ước lượng phải lớn hơn 0.'
                  : 'Cách thực hiện: Theo quy trình. Bắt đầu và kết thúc dự kiến của công việc lấy theo thời gian của đơn bên dưới.'}
              </p>
            )}
          </>
        ) : (
          submitterField
        )}

        {/* Bắt đầu & Kết thúc Grid */}
        <div className={styles.createTimeDateGrid}>
          {/* Bắt đầu */}
          <div className={styles.createFieldGroup}>
            <label className={styles.createFieldLabel}>Thời gian Bắt đầu</label>
            <div className={styles.createTimeDateInputRow}>
              <div style={{ position: 'relative', width: '100px' }}>
                <input
                  type="time"
                  className={styles.createTimeInput}
                  style={{ width: '100%' }}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div style={{ position: 'relative', flex: 1 }}>
                <DatePickerInput
                  height={36}
                  value={startDate}
                  onChange={(nextStartDate) => {
                    setStartDate(nextStartDate);
                    if (nextStartDate && endDate < nextStartDate) {
                      setEndDate(nextStartDate);
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Kết thúc */}
          <div className={styles.createFieldGroup}>
            <label className={styles.createFieldLabel}>Thời gian Kết thúc</label>
            <div className={styles.createTimeDateInputRow}>
              <div style={{ position: 'relative', width: '100px' }}>
                <input
                  type="time"
                  className={styles.createTimeInput}
                  style={{ width: '100%' }}
                  value={endTime}
                  min={endDate === startDate ? startTime : undefined}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
              <div style={{ position: 'relative', flex: 1 }}>
                <DatePickerInput
                  height={36}
                  value={endDate}
                  min={startDate || undefined}
                  onChange={setEndDate}
                />
              </div>
            </div>
          </div>
        </div>

        {isScheduleInvalid ? (
          <p className={styles.createScheduleError} role="alert">
            {scheduleErrorMessage}
          </p>
        ) : null}

        {/* Hint trạng thái quy trình */}
        {embedded ? null : (
          <p className={styles.createFormHint} aria-live="polite">
            {selectedCreateDef ? (
              <>
                Quy trình được chọn:{' '}
                <strong style={{ color: '#0f172a' }}>{selectedCreateDef.name}</strong> (
                {selectedCreateDef.code})
              </>
            ) : (
              'Vui lòng chọn quy trình để kích hoạt khởi tạo đơn'
            )}
          </p>
        )}

        {error ? (
          <p className={styles.createScheduleError} role="alert">
            {error}
          </p>
        ) : null}

        {/* Footer with Đóng and Tạo đơn buttons */}
        <div className={styles.createFormActions}>
          <button type="button" className={styles.createCancelBtn} onClick={onClose}>
            Đóng
          </button>
          <button
            type="submit"
            className={styles.createSubmitBtn}
            disabled={
              !selectedCreateDef ||
              !jobTitle.trim() ||
              isScheduleInvalid ||
              (Boolean(project) && isHoursInvalid) ||
              cannotAddSubmitter ||
              starting
            }
          >
            {starting ? 'Đang tạo…' : 'Tạo đơn'}
          </button>
        </div>
      </form>
    </StartFormFrame>
  );
}
