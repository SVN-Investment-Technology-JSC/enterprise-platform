'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import {
  describeConditionRule,
  formatAttributeValue,
  type ProcedureAttributeValue,
  type ProcedureGatewayDecision,
} from '@enterprise-platform/contracts-procedure-engine';
import type {
  ProcedureAttachment,
  ProcedureDefinition,
  ProcedureInstance,
  ReverseProcedureInstanceRequest,
  ProcedureInstanceStep,
  ProcedureRaciRole,
  ProcedureRuntimeAction,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
  RequestProcedureMaterialsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  evaluateInstanceSla,
  evaluateStepSla,
  type ProcedureSlaView,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Download, FileText, Plus, Search, X } from 'lucide-react';
import type { AssetCatalogItem, MaterialCatalogItem } from '../procedure-api';
import {
  loadProjectFinanceEnabled,
  loadProjectPeople,
  loadProjectWorkItems,
  loadRelatedProjects,
  procedureNameFor,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
  formatVndInput,
  parseVndInput,
  type ProjectPerson,
  type ProjectWorkItemInput,
  type ProjectWorkItemOption,
  type RelatedProject,
  type WorkItemPriority,
  type WorkItemType,
} from '../workspace-api';
import { AttachmentPanel } from './attachment-panel';
import { AttributeForm, attributeSlots, type AttributeDraft } from './attribute-form';
import {
  instanceProgress,
  progressLabel,
  progressPercent,
  timelineEntries,
} from './instance-flow-view';
import { ChatPanel } from './chat-panel';
import { HistoryPanel } from './history-panel';
import { LinkedPanel } from './linked-panel';
import { SlaBadge } from './sla-badge';
import { SubtaskPanel } from './subtask-panel';
import styles from './workspace-board.module.scss';

type Filter = 'all' | 'urgent' | ProcedureInstance['status'];

interface StartProcedureInput {
  title: string;
  startDueAt: string;
  endDueAt: string;
  isHourlyScheduling: boolean;
  /** Gắn dự án: đơn này là một công việc mới của dự án bên Workspace. */
  workItem?: ProjectWorkItemInput & { readonly projectCode: string };
}

function toIsoDateTime(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function formatDateForDisplay(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function parseDisplayedDate(value: string): string | undefined {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) return undefined;
  return `${year}-${month}-${day}`;
}

const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
  reversed: 'Đã huỷ hiệu lực',
};

const STEP_STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ xử lý',
  running: 'Đang thực hiện',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  returned: 'Trả lại',
  skipped: 'Nhánh không đi',
  cancelled: 'Đã huỷ',
};

const ACTION_LABEL: Record<ProcedureRuntimeAction, string> = {
  approve: 'Phê duyệt',
  reject: 'Từ chối',
  return: 'Trả lại',
  complete: 'Hoàn tất',
  cancel: 'Huỷ hồ sơ',
  comment: 'Ghi nhận trao đổi',
};

/** Nội dung điền sẵn vào form tạo đơn khi module/hồ sơ khác chuyển sang. */
export interface StartHandoff {
  readonly definitionId?: string;
  readonly startDueAt?: string;
  readonly endDueAt?: string;
  readonly projectId?: string;
  /** Dòng giải thích hiện trên form, ví dụ "Hồ sơ điều chỉnh cho QT-001". */
  readonly note?: string;
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

const ROLE_ORDER: readonly ProcedureRaciRole[] = ['S', 'R', 'E', 'C', 'A', 'I'];

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDateTime(value?: string): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

function subjectNames(snapshot?: TenantOrganizationSnapshot) {
  const label = new Map<string, string>();
  if (!snapshot) return label;

  const units = snapshot.units ?? [];
  const positions = snapshot.positions ?? [];
  const members = snapshot.members ?? [];

  for (const unit of units) {
    label.set(unit.id, unit.headName ? `${unit.headName} (${unit.name})` : unit.name);
  }
  for (const position of positions) {
    const holders = members
      .filter((member) => member.positionId === position.id)
      .map((member) => member.displayName);
    label.set(position.id, holders.length > 0 ? holders.join(', ') : position.name);
  }
  for (const member of members) label.set(member.userId, member.displayName);
  return label;
}

function participantsOf(
  instance: ProcedureInstance,
  names: ReadonlyMap<string, string>,
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const step of instance.steps) {
    for (const assignment of step.assignments) {
      const label = names.get(assignment.subjectId) ?? assignment.subjectLabel;
      if (label) seen.set(assignment.subjectId, label);
    }
  }
  for (const subtask of instance.subtasks ?? []) {
    if (subtask.assigneeId && subtask.assigneeName) seen.set(subtask.assigneeId, subtask.assigneeName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * Nhãn cho dòng vai trên timeline.
 *
 * Vai được giao cho CHỨC DANH (hoặc đơn vị), không cho một người cụ thể: người
 * đổi thì chức danh vẫn giữ vai. Nên nhãn chính là tên chức danh/đơn vị, người
 * đang giữ chỉ là thông tin phụ. Trước đây nhãn là tên người — vai S gán cho cả
 * công ty hiện thành tên trưởng công ty, dễ hiểu nhầm là người đó lập đơn.
 */
type RoleSubject = {
  title: string;
  holders?: string;
  /** Đơn vị chứa chức danh — để gom nhóm khi danh sách dài. */
  unitName?: string;
  /** Người đang giữ, từng tên — để đếm và tìm khi danh sách dài. */
  holderNames?: readonly string[];
};

function subjectRoleLabels(snapshot?: TenantOrganizationSnapshot) {
  const label = new Map<string, RoleSubject>();
  if (!snapshot) return label;
  const units = snapshot.units ?? [];
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  for (const unit of units) {
    if (unit.typeCategory !== 'position') label.set(unit.id, { title: unit.name });
  }
  const members = snapshot.members ?? [];
  const positions = [
    ...(snapshot.positions ?? []).map((position) => ({ id: position.id, name: position.name, unitId: position.unitId })),
    ...units
      .filter((unit) => unit.typeCategory === 'position')
      .map((unit) => ({ id: unit.id, name: unit.name, unitId: unit.parentId })),
  ];
  for (const position of positions) {
    const holders = [
      ...new Set(
        members
          .filter((member) => (member.positionId ?? member.unitId) === position.id)
          .map((member) => member.displayName),
      ),
    ];
    label.set(position.id, {
      title: position.name,
      holders: holders.length ? holders.join(', ') : 'đang trống',
      unitName: position.unitId ? unitName.get(position.unitId) : undefined,
      holderNames: holders,
    });
  }
  for (const member of members) {
    if (!label.has(member.userId)) label.set(member.userId, { title: member.displayName });
  }
  return label;
}

function roleLines(step: ProcedureInstanceStep, labels: ReadonlyMap<string, RoleSubject>) {
  return ROLE_ORDER.flatMap((role) => {
    const items = step.assignments
      .filter((item) => item.role === role)
      .map((item): RoleSubject => {
        const known = labels.get(item.subjectId);
        return known ?? { title: item.subjectLabel ?? item.subjectId };
      });
    return items.length > 0
      ? [{ role, items, names: items.map((item) => item.title).join(', '), holders: items.map((item) => item.holders).filter(Boolean).join(', ') }]
      : [];
  });
}

/**
 * Một dòng vai trên timeline. Hiển thị theo NGƯỜI (ẩn chức danh): `[icon vai] -
 * Tên người` (QT-U2). Bước submit hiện đúng người đã submit thay vì cả danh sách
 * chức danh (QT-U3). Vai có nhiều người: hiện 1 người + badge `+N`, hover/focus
 * mới xổ danh sách còn lại (QT-U4).
 */
function RoleLine({
  line,
  submitterName,
}: {
  line: ReturnType<typeof roleLines>[number];
  submitterName?: string;
}) {
  const people =
    line.role === 'S' && submitterName
      ? [submitterName]
      : [
          ...new Set(
            line.items.flatMap((item) =>
              item.holderNames && item.holderNames.length ? item.holderNames : [item.title],
            ),
          ),
        ];

  const roleIcon = <i className={`${styles.role} ${styles[`role${line.role}`]}`}>{line.role}</i>;

  if (people.length <= 1) {
    return (
      <span className={styles.roleTag}>
        {roleIcon}
        <span className={styles.roleName}>{people[0] ?? 'Chưa phân công'}</span>
      </span>
    );
  }

  const [first, ...rest] = people;
  return (
    <span className={`${styles.roleTag} ${styles.rolePeople}`} tabIndex={0}>
      {roleIcon}
      <span className={styles.roleName}>{first}</span>
      <span className={styles.roleMoreBadge} aria-label={`Thêm ${rest.length} người`}>
        +{rest.length}
      </span>
      <span className={styles.rolePopover} role="list">
        <span className={styles.rolePopoverHead}>{people.length} người</span>
        {people.map((name, index) => (
          <span key={`${name}-${index}`} role="listitem" className={styles.rolePopoverItem}>
            {name}
          </span>
        ))}
      </span>
    </span>
  );
}

export function WorkspaceBoard({
  initialInstanceId,
  busy,
  materialCatalog = [],
  assetCatalog = [],
  groups = [],
  onPickAsset,
  onRequestMaterials,
  actorName,
  actorId,
  organization,
  definitions,
  instances,
  onAction,
  onSaveAttributes,
  onOpenDefinitions,
  onStart,
  canCreateInstances,
  attachments = [],
  onSeedSubtasks,
  onRecheckMaterials,
  onSetSubtasks,
  onCompleteSubtask,
  onCancelSubtask,
  onUploadEvidence,
  onUploadFile,
  onSendComment,
  handoffTitle,
  handoff,
  canReverse = false,
  onReverse,
  headSlot,
}: {
  /**
   * Ô trên dòng đường dẫn của khung module. Có thì nút của trang nằm ở đó,
   * nhường cả chiều cao cho danh sách và chi tiết.
   */
  headSlot?: HTMLElement | null;
  busy?: string;
  groups?: readonly { code: string; label: string }[];
  materialCatalog?: readonly MaterialCatalogItem[];
  assetCatalog?: readonly { code: string; name: string }[];
  onPickAsset?: (instanceId: string, assetCode: string) => void;
  onRequestMaterials?: (
    instanceId: string,
    input: RequestProcedureMaterialsRequest,
  ) => void;
  actorName?: string;
  actorId?: string;
  organization?: TenantOrganizationSnapshot;
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
  onAction: (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) => Promise<void>;
  onSaveAttributes?: (
    instanceId: string,
    values: Record<string, ProcedureAttributeValue | null>,
  ) => Promise<void>;
  onOpenDefinitions: () => void;
  onStart: (definition: ProcedureDefinition, input: StartProcedureInput) => Promise<void>;
  canCreateInstances: boolean;
  attachments?: readonly ProcedureAttachment[];
  onSeedSubtasks?: (instanceId: string) => void;
  onRecheckMaterials?: (instanceId: string) => void;
  onSetSubtasks?: (
    instanceId: string,
    items: ProcedureSubtaskInput[],
    executionMode: ProcedureSubtaskExecutionMode,
  ) => void;
  onCompleteSubtask?: (instanceId: string, subtaskId: string) => void;
  onCancelSubtask?: (instanceId: string, subtaskId: string) => void;
  onUploadEvidence?: (instanceId: string, subtaskId: string, file: File) => void;
  onUploadFile?: (instanceId: string, file: File) => void;
  onSendComment?: (instanceId: string, body: string, mentions: string[], replyToId?: string) => void;
  handoffTitle?: string;
  handoff?: StartHandoff;
  /** Quản trị viên Quy trình: được huỷ hiệu lực hồ sơ đã hoàn thành. */
  canReverse?: boolean;
  onReverse?: (instanceId: string, input: ReverseProcedureInstanceRequest) => Promise<void>;
  initialInstanceId?: string;
}) {
  // Mặc định mở vào "Đang xử lý" (việc cần làm), "Tất cả" đưa xuống cuối thanh tab.
  const [filter, setFilter] = useState<Filter>('running');
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list');
  const [query, setQuery] = useState('');
  const [slaFilter, setSlaFilter] = useState<'all' | ProcedureSlaView['state']>('all');
  const [source, setSource] = useState<'all' | 'manual' | 'maintenance_occurrence' | 'auto_from_parent'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => { if (initialInstanceId) setSelectedId(initialInstanceId); }, [initialInstanceId]);
  // Trao đổi, tệp và nhật ký mở thành tab ngay trong khung chi tiết.
  const [detailTab, setDetailTab] = useState<'flow' | 'chat' | 'files' | 'history'>('flow');
  const [activeStepDrawer, setActiveStepDrawer] = useState<{ step: ProcedureInstanceStep; tab: 'execution' | 'chat' | 'files' } | null>(null);
  const [comment, setComment] = useState('');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [creating, setCreating] = useState(false);
  const [selectedCreateDefId, setSelectedCreateDefId] = useState<string>();
  const [jobTitle, setJobTitle] = useState('');
  const [startTime, setStartTime] = useState('07:30');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [startDateText, setStartDateText] = useState(() =>
    formatDateForDisplay(new Date().toISOString().split('T')[0]),
  );
  const [endTime, setEndTime] = useState('17:00');
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [endDateText, setEndDateText] = useState(() =>
    formatDateForDisplay(new Date().toISOString().split('T')[0]),
  );
  const [attachQueue, setAttachQueue] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dự án liên quan: chọn một dự án Workspace thì đơn này thành công việc mới
  // của dự án đó, kèm các trường của form tạo công việc bên Workspace.
  const [relatedProjects, setRelatedProjects] = useState<RelatedProject[]>();
  const [projectId, setProjectId] = useState('');
  const [projectPeople, setProjectPeople] = useState<ProjectPerson[]>([]);
  const [projectWorkItems, setProjectWorkItems] = useState<ProjectWorkItemOption[]>([]);
  const [itemParentId, setItemParentId] = useState('');
  const [itemSubmitter, setItemSubmitter] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPriority, setItemPriority] = useState<WorkItemPriority>('normal');
  const [itemAssignee, setItemAssignee] = useState('');
  const [itemHours, setItemHours] = useState('');
  const [itemType, setItemType] = useState<WorkItemType>('task');
  const [itemCost, setItemCost] = useState('');
  const [financeEnabled, setFinanceEnabled] = useState(false);
  const project = relatedProjects?.find((item) => item.id === projectId);

  useEffect(() => {
    if (!creating || relatedProjects) return;
    void loadRelatedProjects().then(setRelatedProjects);
  }, [creating, relatedProjects]);

  useEffect(() => {
    setItemAssignee('');
    setProjectPeople([]);
    setProjectWorkItems([]);
    setItemParentId('');
    setItemSubmitter('');
    setFinanceEnabled(false);
    setItemCost('');
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
    void loadProjectFinanceEnabled(projectId).then((enabled) => {
      if (!cancelled) setFinanceEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Đóng form thì bỏ lựa chọn dự án, lần mở sau nạp lại danh sách cho tươi.
  useEffect(() => {
    if (creating) return;
    setRelatedProjects(undefined);
    setProjectId('');
    setItemDescription('');
    setItemPriority('normal');
    setItemHours('');
    setItemType('task');
    setItemCost('');
  }, [creating]);

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
  const submitterOptions = useMemo(
    () =>
      projectPeople.map((person) => ({
        value: person.userId,
        label:
          person.userId === actorId && person.displayName === person.userId && actorName
            ? actorName
            : person.displayName,
      })),
    [projectPeople, actorId, actorName],
  );
  const hoursValue = itemHours.trim() ? Number(itemHours) : undefined;
  const isHoursInvalid = hoursValue !== undefined && !(hoursValue > 0);
  const startDueAt = useMemo(
    () => toIsoDateTime(startDate, startTime),
    [startDate, startTime],
  );
  const endDueAt = useMemo(
    () => toIsoDateTime(endDate, endTime),
    [endDate, endTime],
  );
  const hasValidStartDate = parseDisplayedDate(startDateText) === startDate;
  const hasValidEndDate = parseDisplayedDate(endDateText) === endDate;
  const isScheduleInvalid =
    !hasValidStartDate ||
    !hasValidEndDate ||
    !startDueAt ||
    !endDueAt ||
    Date.parse(endDueAt) <= Date.parse(startDueAt);
  const scheduleErrorMessage =
    !hasValidStartDate || !hasValidEndDate
      ? 'Nhập ngày theo định dạng dd/mm/yyyy.'
      : 'Thời gian kết thúc phải sau thời gian bắt đầu.';

  useEffect(() => {
    if (handoffTitle && canCreateInstances) {
      setCreating(true);
      setJobTitle(handoffTitle);
      if (handoff?.definitionId) setSelectedCreateDefId(handoff.definitionId);
      if (handoff?.projectId) setProjectId(handoff.projectId);
      const start = splitLocalDateTime(handoff?.startDueAt);
      const end = splitLocalDateTime(handoff?.endDueAt);
      if (start && end) {
        setStartDate(start.date);
        setStartDateText(formatDateForDisplay(start.date));
        setStartTime(start.time);
        setEndDate(end.date);
        setEndDateText(formatDateForDisplay(end.date));
        setEndTime(end.time);
      }
    }
  }, [handoffTitle, handoff, canCreateInstances]);

  const published = definitions.filter((item) => item.status === 'published');
  const names = useMemo(() => subjectNames(organization), [organization]);
  const roleLabels = useMemo(() => subjectRoleLabels(organization), [organization]);

  const selectedCreateDef = useMemo(() => {
    return published.find((d) => d.id === selectedCreateDefId);
  }, [published, selectedCreateDefId]);

  const procedureSelectOptions = useMemo(() => {
    return published.map((def) => ({
      value: def.id,
      label: `${def.name} (${def.code})`,
      description: def.description || `Mã quy trình: ${def.code}`,
      badge: def.code,
    }));
  }, [published]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;

    const matched = instances.filter((instance) => {
      if (filter === 'urgent') {
        const sla = evaluateInstanceSla(instance);
        if (instance.status !== 'running' || (sla.state !== 'breached' && sla.state !== 'warning')) return false;
      } else if (filter !== 'all' && instance.status !== filter) {
        return false;
      }

      if (source !== 'all' && (instance.sourceType ?? 'manual') !== source) return false;
      if (slaFilter !== 'all' && evaluateInstanceSla(instance).state !== slaFilter) return false;

      const started = Date.parse(instance.startedAt);
      if (fromTime !== undefined && started < fromTime) return false;
      if (toTime !== undefined && started > toTime) return false;

      if (!needle) return true;
      return (
        instance.code.toLowerCase().includes(needle) ||
        instance.title.toLowerCase().includes(needle) ||
        instance.definitionName.toLowerCase().includes(needle)
      );
    });

    return [...matched].sort((left, right) =>
      dateSort === 'newest'
        ? right.startedAt.localeCompare(left.startedAt)
        : left.startedAt.localeCompare(right.startedAt),
    );
  }, [filter, instances, query, source, slaFilter, from, to, dateSort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const filtersActive =
    source !== 'all' || slaFilter !== 'all' || Boolean(from) || Boolean(to);

  const selected =
    visible.find((instance) => instance.id === selectedId) ?? paged[0] ?? visible[0];

  const [headerCancelOpen, setHeaderCancelOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseAdjust, setReverseAdjust] = useState(true);
  const [reverseError, setReverseError] = useState<string>();
  const [reverseBusy, setReverseBusy] = useState(false);

  useEffect(() => {
    setComment('');
    setAttachQueue([]);
    setHeaderCancelOpen(false);
  }, [selected?.id]);

  /** Upload queued files first, then execute the workflow action */
  const handleActionWithAttach = async (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) => {
    setIsSubmitting(true);
    try {
      if (attachQueue.length > 0 && onUploadFile) {
        for (const file of attachQueue) {
          onUploadFile(instanceId, file);
        }
        setAttachQueue([]);
        await new Promise<void>((r) => setTimeout(r, 300));
      }
      await onAction(instanceId, action, comment, returnToStepId, attributeValues);
      // Chỉ xoá sau khi action thành công, để không mất nội dung khi API trả lỗi.
      setComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportExcel = () => {
    const csvContent = [
      ['Mã hồ sơ', 'Tiêu đề', 'Quy trình', 'Trạng thái', 'Ngày bắt đầu'].join(','),
      ...visible.map((i) => [
        `"${i.code}"`,
        `"${i.title.replace(/"/g, '""')}"`,
        `"${i.definitionName.replace(/"/g, '""')}"`,
        `"${STATUS_LABEL[i.status]}"`,
        `"${formatDateTime(i.startedAt)}"`,
      ].join(',')),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Workspace_Ho_So_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Thống kê tổng quan 5 chỉ số
  const stats = useMemo(() => {
    const total = instances.length;
    const processing = instances.filter((i) => i.status === 'running').length;
    const completed = instances.filter((i) => i.status === 'completed').length;
    const rejected = instances.filter((i) => i.status === 'rejected').length;
    const cancelled = instances.filter((i) => i.status === 'cancelled').length;
    const reversed = instances.filter((i) => i.status === 'reversed').length;
    const urgent = instances.filter((inst) => {
      const sla = evaluateInstanceSla(inst);
      return inst.status === 'running' && (sla.state === 'breached' || sla.state === 'warning');
    }).length;
    return { total, processing, completed, rejected, cancelled, reversed, urgent };
  }, [instances]);

  const headActions = (
    <>
      <div className={styles.viewToggle} role="group" aria-label="Kiểu xem">
        <button
          type="button"
          className={viewMode === 'list' ? styles.viewToggleOn : undefined}
          aria-pressed={viewMode === 'list'}
          onClick={() => setViewMode('list')}
        >
          Thẻ
        </button>
        <button
          type="button"
          className={viewMode === 'table' ? styles.viewToggleOn : undefined}
          aria-pressed={viewMode === 'table'}
          onClick={() => setViewMode('table')}
        >
          Bảng
        </button>
      </div>
      <button type="button" className={styles.ghost} onClick={exportExcel} title="Xuất file danh sách CSV">
        <Download size={15} aria-hidden /> Xuất Excel
      </button>
      {published.length > 0 && canCreateInstances ? (
        <button
          type="button"
          className={styles.primary}
          onClick={() => setCreating(true)}
          aria-haspopup="dialog"
          aria-expanded={creating}
        >
          <Plus size={15} strokeWidth={2.2} aria-hidden /> Tạo đơn / yêu cầu
        </button>
      ) : null}
    </>
  );

  const actionPanel = selected ? (
    <ActionPanel
      busy={busy}
      comment={comment}
      instance={selected}
      isSubmitting={isSubmitting}
      attachments={attachments ?? []}
      attachQueue={attachQueue}
      onAttachQueue={setAttachQueue}
      onAction={(action, comment, returnToStepId, attributeValues) =>
        void handleActionWithAttach(selected.id, action, comment, returnToStepId, attributeValues)
      }
      onSaveAttributes={
        onSaveAttributes ? (values) => onSaveAttributes(selected.id, values) : undefined
      }
      onComment={setComment}
      materialCatalog={materialCatalog}
      assetCatalog={assetCatalog}
      onPickAsset={onPickAsset ? (assetCode) => onPickAsset(selected.id, assetCode) : undefined}
      definitions={definitions}
      organization={organization}
      actorId={actorId}
      onSeedSubtasks={onSeedSubtasks ? () => onSeedSubtasks(selected.id) : undefined}
      onSetSubtasks={
        onSetSubtasks
          ? (items, mode) => onSetSubtasks(selected.id, items, mode)
          : undefined
      }
      onCompleteSubtask={
        onCompleteSubtask
          ? (subtaskId) => onCompleteSubtask(selected.id, subtaskId)
          : undefined
      }
      onCancelSubtask={
        onCancelSubtask
          ? (subtaskId) => onCancelSubtask(selected.id, subtaskId)
          : undefined
      }
      onUploadEvidence={
        onUploadEvidence
          ? (subtaskId, file) => onUploadEvidence(selected.id, subtaskId, file)
          : undefined
      }
      onRequestMaterials={
        onRequestMaterials
          ? (input) => onRequestMaterials(selected.id, input)
          : undefined
      }
    />
  ) : null;

  const entries = selected ? timelineEntries(selected) : [];
  // Người submit thực tế của hồ sơ (vai S của bước đầu): dùng cho QT-U3.
  const submitterName = selected?.activity.find((entry) => entry.action === 'start')?.actorName;
  const currentInTimeline = entries.some(
    (entry) => entry.kind === 'step' && entry.step.id === selected?.currentStepId,
  );
  const pageStart = (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, visible.length);

  return (
    <section className={styles.workspace}>
      {headSlot ? createPortal(headActions, headSlot) : <div className={styles.topBar}>{headActions}</div>}

      {creating && canCreateInstances ? (
        <MinimalPopupForm
          isOpen={creating}
          title="Tạo Đơn / Yêu cầu Mới"
          subtitle="Khởi tạo phiếu công việc / yêu cầu xử lý theo quy trình vận hành"
          onClose={() => setCreating(false)}
          maxWidth={640}
        >
          <form
            className={styles.createFormBody}
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !selectedCreateDef ||
                !jobTitle.trim() ||
                !startDueAt ||
                !endDueAt ||
                isScheduleInvalid
              ) return;
              if (project && isHoursInvalid) return;
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
                      estimatedCost: financeEnabled ? parseVndInput(itemCost) : undefined,
                      parentId: itemParentId || undefined,
                      submitterUserId: itemSubmitter || undefined,
                    }
                  : undefined,
              }).then(() => setCreating(false));
            }}
          >
            {handoff?.note ? (
              <p className={styles.reversalNote}>{handoff.note}</p>
            ) : null}

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
                autoFocus
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
                  const found = published.find((d) => d.id === val);
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
              <p className={styles.createFormHint}>
                {project
                  ? `Tạo kèm công việc “${jobTitle.trim() || 'Tên công việc'}” trong dự án ${project.code}. Tên hồ sơ sẽ là “${procedureNameFor(project.code, 'CVxxx', jobTitle.trim() || 'Tên công việc')}”, với CVxxx là mã công việc tự sinh.`
                  : 'Chọn dự án để đơn này trở thành một công việc mới trong dự án đó.'}
              </p>
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
                      placeholder={
                        projectWorkItems.length === 0 ? 'Gốc dự án' : 'Tìm công việc cha…'
                      }
                      emptyText="Dự án chưa có công việc nào"
                      onChange={(value) => setItemParentId(value || '')}
                    />
                  </div>
                  <div className={styles.createFieldGroup}>
                    <label className={styles.createFieldLabel}>Người Submit</label>
                    <SearchableSelect
                      options={submitterOptions}
                      value={itemSubmitter}
                      placeholder="Chọn người submit"
                      emptyText="Dự án chưa có người tham gia"
                      onChange={setItemSubmitter}
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

                {financeEnabled ? (
                  <div className={styles.createTimeDateGrid}>
                    <div className={styles.createFieldGroup}>
                      <label className={styles.createFieldLabel} htmlFor="create-item-cost">
                        Chi phí dự toán (VND)
                      </label>
                      <input
                        id="create-item-cost"
                        inputMode="decimal"
                        className={styles.createTextInput}
                        placeholder="Ví dụ 150.000.000"
                        value={itemCost}
                        onChange={(event) => setItemCost(formatVndInput(event.target.value))}
                      />
                    </div>
                    <div className={styles.createFieldGroup}>
                      <label className={styles.createFieldLabel} htmlFor="create-item-actual">
                        Chi phí thực tế (VND)
                      </label>
                      {/* Chi phí thực tế ghi qua sổ chi phí ở tab Tài chính bên Workspace. */}
                      <input id="create-item-actual" readOnly className={styles.createTextInput} value="0" />
                    </div>
                  </div>
                ) : null}

                <p className={styles.createFormHint}>
                  {isHoursInvalid
                    ? 'Giờ ước lượng phải lớn hơn 0.'
                    : 'Cách thực hiện: Theo quy trình. Bắt đầu và kết thúc dự kiến của công việc lấy theo thời gian của đơn bên dưới.'}
                </p>
              </>
            ) : null}

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
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{2}/\d{2}/\d{4}"
                      className={styles.createDateInput}
                      style={{ width: '100%' }}
                      placeholder="dd/mm/yyyy"
                      value={startDateText}
                      onChange={(e) => {
                        const nextText = e.target.value;
                        setStartDateText(nextText);
                        const nextStartDate = parseDisplayedDate(nextText);
                        if (!nextStartDate) return;
                        setStartDate(nextStartDate);
                        if (endDate < nextStartDate) {
                          setEndDate(nextStartDate);
                          setEndDateText(formatDateForDisplay(nextStartDate));
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
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{2}/\d{2}/\d{4}"
                      className={styles.createDateInput}
                      style={{ width: '100%' }}
                      placeholder="dd/mm/yyyy"
                      value={endDateText}
                      onChange={(e) => {
                        const nextText = e.target.value;
                        setEndDateText(nextText);
                        const nextEndDate = parseDisplayedDate(nextText);
                        if (nextEndDate) setEndDate(nextEndDate);
                      }}
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
            <p className={styles.createFormHint} aria-live="polite">
              {selectedCreateDef ? (
                <>
                  Quy trình được chọn: <strong style={{ color: '#0f172a' }}>{selectedCreateDef.name}</strong> ({selectedCreateDef.code})
                </>
              ) : (
                'Vui lòng chọn quy trình để kích hoạt khởi tạo đơn'
              )}
            </p>

            {/* Footer with Đóng and Tạo đơn buttons */}
            <div className={styles.createFormActions}>
              <button
                type="button"
                className={styles.createCancelBtn}
                onClick={() => setCreating(false)}
              >
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
                  (selectedCreateDef && busy === `start:${selectedCreateDef.id}`)
                }
              >
                {selectedCreateDef && busy === `start:${selectedCreateDef.id}`
                  ? 'Đang tạo…'
                  : 'Tạo đơn'}
              </button>
            </div>
          </form>
        </MinimalPopupForm>
      ) : null}

      {reverseOpen && selected && onReverse ? (
        <MinimalPopupForm
          isOpen={reverseOpen}
          title="Huỷ hiệu lực hồ sơ"
          subtitle={`${selected.code} · ${selected.title}`}
          onClose={() => setReverseOpen(false)}
          maxWidth={560}
        >
          <form
            className={styles.createFormBody}
            onSubmit={(event) => {
              event.preventDefault();
              const reason = reverseReason.trim();
              if (reason.length < 3) return;
              setReverseBusy(true);
              setReverseError(undefined);
              onReverse(selected.id, { reason, createAdjustment: reverseAdjust })
                .then(() => setReverseOpen(false))
                .catch((cause: unknown) =>
                  setReverseError(
                    cause instanceof Error ? cause.message : 'Không huỷ hiệu lực được hồ sơ.',
                  ),
                )
                .finally(() => setReverseBusy(false));
            }}
          >
            <p className={styles.reversalNote}>
              Hồ sơ không mở lại: chuyển sang "Đã huỷ hiệu lực", giữ nguyên lịch sử phê duyệt.
              {selected.sourceType === 'hrm_request'
                ? ' Đơn HRM đứng sau hồ sơ cũng bị huỷ hiệu lực (công, phép, tạm ứng được hoàn lại).'
                : ''}
              {selected.workspaceLink?.status === 'linked'
                ? ` Công việc ${selected.workspaceLink.workItemCode ?? ''} của dự án ${selected.workspaceLink.projectCode} được báo để xử lý theo.`
                : ''}{' '}
              Bị chặn nếu kỳ công/kỳ lương đã chốt hoặc vật tư đã xuất kho.
            </p>

            <div className={styles.createFieldGroup}>
              <label className={styles.createFieldLabel} htmlFor="reverse-reason">
                Lý do huỷ hiệu lực <span className={styles.createRequiredStar}>*</span>
              </label>
              <textarea
                id="reverse-reason"
                className={styles.createTextInput}
                rows={3}
                maxLength={1000}
                placeholder="VD: Sai thông tin số ngày nghỉ, cần lập lại đơn"
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                autoFocus
              />
            </div>

            <label className={styles.reverseCheck}>
              <input
                type="checkbox"
                checked={reverseAdjust}
                onChange={(event) => setReverseAdjust(event.target.checked)}
              />
              <span>
                <strong>Lập hồ sơ điều chỉnh</strong>
                <br />
                <span style={{ color: 'var(--muted)' }}>
                  {selected.sourceType === 'hrm_request'
                    ? 'Người gửi đơn HRM nhận thông báo kèm form đơn mới điền sẵn ở HRM.'
                    : 'Người khởi tạo (vai S) nhận thông báo kèm form tạo đơn điền sẵn, liên kết với hồ sơ này.'}
                </span>
              </span>
            </label>

            {reverseError ? (
              <p className={styles.createScheduleError} role="alert">
                {reverseError}
              </p>
            ) : null}

            <div className={styles.createFormActions}>
              <button
                type="button"
                className={styles.createCancelBtn}
                onClick={() => setReverseOpen(false)}
              >
                Đóng
              </button>
              <button
                type="submit"
                className={styles.createSubmitBtn}
                disabled={reverseBusy || reverseReason.trim().length < 3}
              >
                {reverseBusy ? 'Đang xử lý…' : 'Huỷ hiệu lực'}
              </button>
            </div>
          </form>
        </MinimalPopupForm>
      ) : null}

      {/* Thanh lọc: trạng thái thành tab có số đếm, bộ lọc khác gọn trên cùng một hàng. */}
      <div className={styles.toolbar}>
        <div className={styles.statusTabs} role="tablist" aria-label="Lọc theo trạng thái">
          {(
            [
              ['running', 'Đang xử lý', stats.processing],
              ['urgent', 'Duyệt gấp / SLA', stats.urgent],
              ['completed', 'Hoàn thành', stats.completed],
              ['rejected', 'Từ chối', stats.rejected],
              ['cancelled', 'Đã huỷ', stats.cancelled],
              ['reversed', 'Đã huỷ hiệu lực', stats.reversed],
              ['all', 'Tất cả', stats.total],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={`${styles.statusTab} ${filter === value ? styles.statusTabOn : ''} ${
                value === 'urgent' && count > 0 ? styles.statusTabUrgent : ''
              }`}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
              <span className={styles.statusTabCount}>{count}</span>
            </button>
          ))}
        </div>

        <div className={styles.toolbarFilters}>
          <label className={styles.searchWrapper}>
            <span className={styles.searchIcon}>
              <Search size={14} strokeWidth={2} aria-hidden />
            </span>
            <input
              className={styles.search}
              aria-label="Tìm hồ sơ"
              placeholder="Tìm mã PROC, tiêu đề..."
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            />
          </label>
          <SearchableSelect
            className={styles.filterCombo}
            clearable={false}
            value={slaFilter}
            options={[
              { value: 'all', label: 'SLA: Tất cả' },
              { value: 'breached', label: 'Quá hạn' },
              { value: 'warning', label: 'Sắp đến hạn' },
              { value: 'ok', label: 'Còn hạn' },
              { value: 'none', label: 'Không cài' },
            ]}
            onChange={(value) => {
              setSlaFilter((value || 'all') as typeof slaFilter);
              setPage(1);
            }}
          />
          <SearchableSelect
            className={styles.filterCombo}
            clearable={false}
            value={source}
            options={[
              { value: 'all', label: 'Nguồn: Tất cả' },
              { value: 'manual', label: 'Thủ công' },
              { value: 'maintenance_occurrence', label: 'Bảo trì' },
              { value: 'auto_from_parent', label: 'Tự động' },
            ]}
            onChange={(value) => {
              setSource((value || 'all') as typeof source);
              setPage(1);
            }}
          />
          {filtersActive || query || filter !== 'all' ? (
            <button
              type="button"
              className={styles.resetBtn}
              onClick={() => {
                setFilter('all');
                setSlaFilter('all');
                setSource('all');
                setFrom('');
                setTo('');
                setQuery('');
                setPage(1);
              }}
              title="Đặt lại tất cả bộ lọc"
            >
              Đặt lại
            </button>
          ) : null}
        </div>
      </div>

      {/* Danh sách bên trái, chi tiết bên phải; mỗi bên tự cuộn trong khung của mình. */}
      <div className={`${styles.split} ${viewMode === 'table' ? styles.splitTable : ''}`}>
        <section className={styles.listPane} aria-label="Danh sách hồ sơ">
          <div className={styles.listHead}>
            <span>
              <strong>{visible.length}</strong> hồ sơ
            </span>
            <SearchableSelect
              className={styles.sortCombo}
              clearable={false}
              value={dateSort}
              options={[
                { value: 'newest', label: 'Mới nhất' },
                { value: 'oldest', label: 'Cũ nhất' },
              ]}
              onChange={(value) => {
                setDateSort((value || 'newest') as 'newest' | 'oldest');
                setPage(1);
              }}
            />
          </div>

          {visible.length === 0 ? (
            <div className={styles.empty}>
              <h2>Không có hồ sơ nào khớp bộ lọc</h2>
              <p>Thử đổi điều kiện lọc hoặc tạo yêu cầu mới.</p>
            </div>
          ) : viewMode === 'table' ? (
            <div className={styles.listBody}>
              <table className={styles.masterTable}>
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>Tiêu đề</th>
                    <th>Quy trình</th>
                    <th>Tiến độ</th>
                    <th>SLA</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((instance) => {
                    const isSel = instance.id === selected?.id;
                    // Tiến độ trên đường đi thực tế: bước ở nhánh không đi không tính.
                    const progress = instanceProgress(instance);
                    return (
                      <tr
                        key={instance.id}
                        onClick={() => setSelectedId(instance.id)}
                        className={`${styles.masterTableRow} ${isSel ? styles.masterTableRowActive : ''}`}
                      >
                        <td className={styles.code}>{instance.code}</td>
                        <td className={styles.tdTitle} title={instance.title}>
                          <span className={styles.clamp2}>{instance.title}</span>
                        </td>
                        <td className={styles.tdMuted} title={instance.definitionName}>
                          {instance.definitionCode}
                        </td>
                        <td
                          className={styles.tdNum}
                          title={progress.isEstimate ? 'Còn điểm rẽ nhánh phía trước nên tổng số bước là ước lượng' : undefined}
                        >
                          {progressLabel(progress)}
                        </td>
                        <td>
                          <SlaBadge view={evaluateInstanceSla(instance)} />
                        </td>
                        <td>
                          <span className={`${styles.badge} ${styles[instance.status]}`}>
                            {STATUS_LABEL[instance.status]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.listBody}>
              {paged.map((instance) => {
                const progress = instanceProgress(instance);
                const percent = progressPercent(progress);
                const current = instance.steps.find((step) => step.id === instance.currentStepId);
                return (
                  <button
                    key={instance.id}
                    type="button"
                    className={`${styles.caseRow} ${instance.id === selected?.id ? styles.caseRowOn : ''}`}
                    aria-current={instance.id === selected?.id ? 'true' : undefined}
                    onClick={() => setSelectedId(instance.id)}
                  >
                    {/* QT-U6: ẩn mã hồ sơ VÀ mã quy trình ở thẻ preview (đã có đủ khi mở
                        chi tiết); vẫn tìm được qua ô tìm kiếm. Chỉ hiện badge SLA khi có. */}
                    {evaluateInstanceSla(instance).state !== 'none' ? (
                      <span className={styles.caseRowTop}>
                        <SlaBadge view={evaluateInstanceSla(instance)} />
                      </span>
                    ) : null}
                    <span className={styles.caseRowTitle} title={instance.title}>
                      {instance.title}
                    </span>
                    <span className={styles.caseRowFoot}>
                      {instance.status === 'running' ? (
                        <span
                          className={styles.caseRowStep}
                          title={progress.isEstimate ? 'Còn điểm rẽ nhánh phía trước nên tổng số bước là ước lượng' : undefined}
                        >
                          Bước {progressLabel(progress)}
                          {current ? ` · ${current.name}` : ''}
                        </span>
                      ) : (
                        <span className={styles.caseRowStep}>
                          <span className={`${styles.badge} ${styles[instance.status]}`}>
                            {STATUS_LABEL[instance.status]}
                          </span>
                        </span>
                      )}
                      <span className={styles.miniProgressBar} title={`Tiến độ ${percent}%`}>
                        <span className={styles.miniProgressFill} style={{ width: `${percent}%` }} />
                      </span>
                      <span className={styles.caseRowPct}>{percent}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {visible.length > 0 ? (
            <div className={styles.pager}>
              <span className={styles.pagerInfo}>
                {pageStart}–{pageEnd} / {visible.length}
              </span>
              <SearchableSelect
                className={styles.pagerCombo}
                clearable={false}
                value={String(pageSize)}
                options={[15, 30, 45, 60].map((size) => ({ value: String(size), label: `${size} / trang` }))}
                onChange={(value) => {
                  setPageSize(Number(value) || 15);
                  setPage(1);
                }}
              />
              <button
                type="button"
                className={styles.pagerBtn}
                aria-label="Trang trước"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={15} aria-hidden />
              </button>
              <span className={styles.pagerPage}>
                {currentPage}/{pageCount}
              </span>
              <button
                type="button"
                className={styles.pagerBtn}
                aria-label="Trang sau"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          ) : null}
        </section>

        <section
          className={styles.detailPane}
          aria-label={selected ? `Chi tiết hồ sơ ${selected.code}` : 'Chi tiết hồ sơ'}
        >
          {selected ? (
            <>
              <header className={styles.detailHead}>
                <div className={styles.detailHeadRow}>
                  {/* QT-U6: ẩn mã Yêu cầu (id hồ sơ) để header gọn hơn. */}
                  <span className={`${styles.badge} ${styles[selected.status]}`}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                  <SlaBadge view={evaluateInstanceSla(selected)} />
                  <span className={styles.spacer} />

                  {/* Nút Huỷ hồ sơ dành cho Admin / Quản trị viên */}
                  {selected.authorization?.availableActions.includes('cancel') && selected.status === 'running' ? (
                    <div className={styles.popconfirmWrapper}>
                      <button
                        type="button"
                        className={styles.headerCancelBtn}
                        disabled={busy === `cancel:${selected.id}` || isSubmitting}
                        onClick={() => setHeaderCancelOpen((prev) => !prev)}
                      >
                        Huỷ hồ sơ
                      </button>

                      {headerCancelOpen ? (
                        <div className={`${styles.popconfirmBox} ${styles.popconfirmBelow}`}>
                          <div className={styles.popconfirmArrow} />
                          <div className={styles.popconfirmTitle}>
                            Xác nhận huỷ hồ sơ này?
                          </div>
                          <div className={styles.popconfirmDesc}>
                            Hành động huỷ chỉ dành cho Quản trị viên, sẽ kết thúc toàn bộ quy trình ngay lập tức và không thể hoàn tác.
                          </div>
                          <div className={styles.popconfirmActions}>
                            <button
                              type="button"
                              className={styles.ghost}
                              onClick={() => setHeaderCancelOpen(false)}
                            >
                              Không
                            </button>
                            <button
                              type="button"
                              className={styles.danger}
                              onClick={() => {
                                setHeaderCancelOpen(false);
                                void handleActionWithAttach(selected.id, 'cancel');
                              }}
                            >
                              Đồng ý huỷ
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Huỷ hiệu lực: hồ sơ đã hoàn thành hoặc đã từ chối, chỉ Quản trị viên Quy trình */}
                  {canReverse &&
                  onReverse &&
                  (selected.status === 'completed' || selected.status === 'rejected') ? (
                    <button
                      type="button"
                      className={styles.headerCancelBtn}
                      disabled={reverseBusy}
                      onClick={() => {
                        setReverseReason('');
                        setReverseAdjust(true);
                        setReverseError(undefined);
                        setReverseOpen(true);
                      }}
                    >
                      Huỷ hiệu lực
                    </button>
                  ) : null}
                </div>

                <h2 className={styles.detailTitle}>{selected.title}</h2>
                {/* QT-U6: mã hồ sơ hiện ngay dưới tên (đã ẩn ở thẻ preview). */}
                <div className={styles.detailCode}>{selected.code}</div>
                {selected.reversal ? (
                  <div className={styles.reversalNote} role="note">
                    <strong className={styles.reversalTitle}>Đã huỷ hiệu lực</strong>
                    <span className={styles.reversalMeta}>
                      {selected.reversal.reversedByName ?? 'Quản trị viên'} ·{' '}
                      {dateTime.format(new Date(selected.reversal.reversedAt))}
                    </span>
                    <span>
                      <b>Lý do:</b> {selected.reversal.reason}
                    </span>
                    {(() => {
                      const adjustments = instances.filter(
                        (item) => item.adjustmentOf?.instanceId === selected.id,
                      );
                      if (adjustments.length)
                        return (
                          <span>
                            <b>Hồ sơ điều chỉnh:</b>{' '}
                            {adjustments.map((item, index) => (
                              <span key={item.id}>
                                {index ? ', ' : ''}
                                <button
                                  type="button"
                                  className={styles.linkButton}
                                  onClick={() => setSelectedId(item.id)}
                                >
                                  {item.code}
                                </button>
                              </span>
                            ))}
                          </span>
                        );
                      if (!selected.reversal.adjustmentRequested) return null;
                      return (
                        <span>
                          <b>Điều chỉnh:</b>{' '}
                          {selected.sourceType === 'hrm_request'
                            ? 'người gửi đơn đã được mời gửi đơn điều chỉnh ở HRM.'
                            : 'đang chờ người giữ vai S lập hồ sơ điều chỉnh.'}
                        </span>
                      );
                    })()}
                  </div>
                ) : null}
                {selected.adjustmentOf ? (
                  <p className={styles.createFormHint} style={{ margin: '0 0 8px' }}>
                    Hồ sơ điều chỉnh cho{' '}
                    {instances.some((item) => item.id === selected.adjustmentOf?.instanceId) ? (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setSelectedId(selected.adjustmentOf?.instanceId)}
                      >
                        {selected.adjustmentOf.instanceCode}
                      </button>
                    ) : (
                      <strong>{selected.adjustmentOf.instanceCode}</strong>
                    )}
                    {' '}đã bị huỷ hiệu lực.
                  </p>
                ) : null}

                <dl className={styles.metaLine}>
                  <div>
                    <dt>Khởi tạo</dt>
                    <dd>{selected.activity.find((entry) => entry.action === 'start')?.actorName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Quy trình</dt>
                    <dd>
                      {selected.definitionName} · v{selected.definitionVersion}
                    </dd>
                  </div>
                  <div>
                    <dt>Nguồn</dt>
                    <dd>{selected.sourceType === 'hrm_request' ? <a className="text-blue-600 underline" href={`/modules/hrm/approvals?workflow=${encodeURIComponent(selected.sourceId||'')}`}>Đơn HRM · Xem nội dung và chứng từ</a> : selected.sourceType === 'maintenance_occurrence' ? 'Lịch bảo trì' : 'Tạo thủ công'}</dd>
                  </div>
                  <div>
                    <dt>{selected.completedAt ? 'Hoàn tất' : 'Mở đơn'}</dt>
                    <dd>{formatDateTime(selected.completedAt ?? selected.startedAt)}</dd>
                  </div>
                </dl>

                {selected.workspaceLink ? (
                  <p
                    className={`${styles.linkNote} ${
                      selected.workspaceLink.status === 'rejected' ? styles.linkNoteError : ''
                    }`}
                  >
                    {selected.workspaceLink.status === 'linked'
                      ? `Công việc ${selected.workspaceLink.workItemCode ?? ''} trong dự án ${selected.workspaceLink.projectCode}.`
                      : selected.workspaceLink.status === 'pending'
                        ? `Đang tạo công việc trong dự án ${selected.workspaceLink.projectCode}…`
                        : `Không tạo được công việc trong dự án ${selected.workspaceLink.projectCode}: ${selected.workspaceLink.error ?? 'lỗi không rõ'}`}
                  </p>
                ) : null}

                <div className={styles.detailTabs} role="tablist" aria-label="Nội dung hồ sơ">
                  {[
                    {
                      key: 'flow' as const,
                      label: 'Tiến trình',
                      count: progressLabel(instanceProgress(selected)),
                    },
                    {
                      key: 'chat' as const,
                      label: 'Trao đổi',
                      count: selected.activity.filter((a) => a.action === 'comment').length,
                    },
                    {
                      key: 'files' as const,
                      label: 'Tệp & tài liệu',
                      count: (attachments ?? []).filter((a) => a.instanceId === selected.id).length,
                    },
                    {
                      key: 'history' as const,
                      label: 'Nhật ký',
                      count: selected.activity.filter((a) => a.action !== 'comment').length,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={detailTab === tab.key}
                      className={`${styles.detailTab} ${detailTab === tab.key ? styles.detailTabOn : ''}`}
                      onClick={() => setDetailTab(tab.key)}
                    >
                      {tab.label}
                      {tab.count ? <span className={styles.detailTabCount}>{tab.count}</span> : null}
                    </button>
                  ))}
                </div>
              </header>

              <div className={styles.detailBody}>
                {detailTab === 'flow' ? (
                  <>
                    {/* Hồ sơ không có bước đang chạy trên dòng thời gian: khung xử lý đứng đầu như cũ. */}
                    {currentInTimeline ? null : actionPanel}

                    <ol className={styles.timeline}>
                      {entries.map((entry) => {
                        if (entry.kind === 'decision') {
                          return (
                            <li key={`decision:${entry.decision.id}`} className={styles.timelineItem}>
                              <span className={`${styles.timelineNode} ${styles.nodeGateway}`} aria-hidden />
                              <div className={styles.timelineBody}>
                                <DecisionCard decision={entry.decision} instance={selected} />
                              </div>
                            </li>
                          );
                        }
                        if (entry.kind === 'skipped') {
                          return (
                            <li key="skipped" className={`${styles.timelineItem} ${styles.timelineItemPending}`}>
                              <span className={`${styles.timelineNode} ${styles.nodeSkipped}`} aria-hidden />
                              <div className={styles.timelineBody}>
                                <div className={styles.timelineSkipped}>
                                  <strong>Nhánh không đi ({entry.steps.length} bước)</strong>
                                  <span>{entry.steps.map((item) => item.name).join(' · ')}</span>
                                </div>
                              </div>
                            </li>
                          );
                        }
                        const step = entry.step;
                        const isCur = step.id === selected.currentStepId;
                        const isDone = step.status === 'completed';
                        const isRejected = step.status === 'rejected';

                        const nodeClass = isDone
                          ? styles.nodeCompleted
                          : isRejected
                            ? styles.nodeRejected
                            : isCur
                              ? styles.nodeActive
                              : styles.nodePending;

                        return (
                          <li
                            key={step.id}
                            className={`${styles.timelineItem} ${isCur ? styles.timelineItemCurrent : ''} ${
                              !isCur && !isDone && !isRejected ? styles.timelineItemPending : ''
                            }`}
                          >
                            <span className={`${styles.timelineNode} ${nodeClass}`} aria-hidden>
                              {isDone ? (
                                <Check size={12} strokeWidth={3} />
                              ) : isRejected ? (
                                <X size={12} strokeWidth={3} />
                              ) : (
                                step.order
                              )}
                            </span>
                            <div className={styles.timelineBody}>
                              <div className={styles.timelineHead}>
                                <span className={styles.timelineOrder}>
                                  Bước {step.order}
                                  {isCur ? ' · Đang thực hiện' : ''}
                                </span>
                                <span className={styles.timelineName}>{step.name}</span>
                                <SlaBadge
                                  view={evaluateStepSla(step, selected)}
                                  slaHours={step.slaHours}
                                  startedAt={step.startedAt}
                                />
                              </div>

                              <div className={styles.roleList}>
                                {roleLines(step, roleLabels).map((line) => (
                                  <RoleLine key={line.role} line={line} submitterName={submitterName} />
                                ))}
                              </div>

                              {/* QT-U1: tài liệu nộp ở chính bước này, để bước sau xem được bước trước up gì. */}
                              <StepDocuments
                                files={(attachments ?? []).filter(
                                  (file) =>
                                    file.instanceId === selected.id && file.stepInstanceId === step.id,
                                )}
                              />

                              {isCur ? actionPanel : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>

              <MaterialStatus
                instance={selected}
                busy={busy}
                onRecheck={onRecheckMaterials ? () => onRecheckMaterials(selected.id) : undefined}
              />

              <LinkedPanel
                instance={selected}
                instances={instances}
                onOpen={(instanceId) => setSelectedId(instanceId)}
              />
                  </>
                ) : (
                  <div className={styles.tabPanel}>
                    {detailTab === 'chat' ? (
                      <ChatPanel
                        instance={selected}
                        busy={busy}
                        participants={participantsOf(selected, names)}
                        onSend={(body, mentions, replyToId) =>
                          onSendComment?.(selected.id, body, mentions, replyToId)
                        }
                      />
                    ) : detailTab === 'files' ? (
                      <AttachmentPanel
                        instance={selected}
                        attachments={attachments ?? []}
                        busy={busy}
                        onUpload={(file) => onUploadFile?.(selected.id, file)}
                      />
                    ) : (
                      <HistoryPanel instance={selected} />
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className={styles.empty}>
              <p>Chọn một hồ sơ bên trái để xem chi tiết</p>
            </div>
          )}
        </section>
      </div>

      {/* ========================================================================= */}
      {/* 4. SLIDE-OVER NODE WORKSPACE DRAWER (3 AXES: XỬ LÝ · TRAO ĐỔI · TỆP)       */}
      {/* ========================================================================= */}
      {activeStepDrawer && selected ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setActiveStepDrawer(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              background: '#ffffff',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 32px rgba(15, 23, 42, 0.2)',
              animation: 'fadeIn 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line)',
                background: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span
                      style={{
                        background: 'rgba(37, 99, 235, 0.1)',
                        color: '#2563eb',
                        fontWeight: 700,
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      BƯỚC {activeStepDrawer.step.order}
                    </span>
                    <span className={`${styles.badge} ${styles[activeStepDrawer.step.status]}`}>
                      {STEP_STATUS_LABEL[activeStepDrawer.step.status] ?? activeStepDrawer.step.status}
                    </span>
                    {activeStepDrawer.step.slaHours ? (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          background: '#e2e8f0',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        SLA: {activeStepDrawer.step.slaHours}h
                      </span>
                    ) : null}
                  </div>
                  <h3 style={{ margin: '6px 0 2px', fontSize: '17px', fontWeight: 800, color: 'var(--ink)' }}>
                    {activeStepDrawer.step.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--faint)' }}>
                    Hồ sơ: <strong style={{ color: 'var(--ink)' }}>{selected.code}</strong> · {selected.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: 'var(--faint)',
                  }}
                >

                </button>
              </div>

              {/* 3 Drawer Tabs */}
              <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'execution' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'execution' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'execution' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  1. Xử lý &amp; Phân công RACI
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'chat' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'chat' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'chat' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  2. Trao đổi ({selected.activity.filter((a) => !a.stepInstanceId || a.stepInstanceId === activeStepDrawer.step.id).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'files' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'files' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'files' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  3. Tệp ({attachments.filter((a) => a.instanceId === selected.id && a.stepInstanceId === activeStepDrawer.step.id).length})
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeStepDrawer.tab === 'execution' ? (
                <div>
                  <h4 style={{ fontSize: '12px', fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Phân vai RCSI cho bước này
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                    {activeStepDrawer.step.assignments.map((asgn) => {
                      // Vai thuộc chức danh/đơn vị; người đang giữ chỉ là thông tin phụ.
                      const subject = roleLabels.get(asgn.subjectId);
                      const holderLabel = subject
                        ? subject.holders
                          ? `${subject.title} · ${subject.holders}`
                          : subject.title
                        : asgn.subjectLabel ?? asgn.subjectId;
                      return (
                        <div
                          key={asgn.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid var(--line)',
                            background: '#f8fafc',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <i className={`${styles.role} ${styles[`role${asgn.role}`]}`}>
                              {asgn.role}
                            </i>
                            <div>
                              <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>{holderLabel}</strong>
                              <div style={{ fontSize: '11px', color: 'var(--faint)' }}>
                                Loại: {asgn.subjectType === 'user' ? 'Nhân sự' : asgn.subjectType === 'organization_unit' ? 'Đơn vị' : 'Chức vụ'}
                              </div>
                            </div>
                          </div>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--blue)' }}>
                            {asgn.role === 'R'
                              ? 'Thực hiện chính'
                              : asgn.role === 'A'
                                ? 'Phê duyệt cuối'
                                : asgn.role === 'C'
                                  ? 'Kiểm soát / Tham vấn'
                                  : asgn.role === 'S'
                                    ? 'Hỗ trợ'
                                    : asgn.role === 'E'
                                      ? 'Chuyên gia'
                                      : 'Thông báo'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Step Material Requirements */}
                  {activeStepDrawer.step.materials && activeStepDrawer.step.materials.length > 0 ? (
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                      <h4 style={{ fontSize: '12px', fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                        Vật tư / Thiết bị yêu cầu cho bước
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {activeStepDrawer.step.materials.map((mat) => (
                          <li
                            key={mat.materialCode}
                            style={{
                              padding: '8px 12px',
                              background: '#f1f5f9',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '12.5px',
                            }}
                          >
                            <span>{mat.materialName ?? mat.materialCode}</span>
                            <strong>{mat.quantity} {mat.unit ?? 'cái'}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : activeStepDrawer.tab === 'chat' ? (
                <div>
                  <ChatPanel
                    instance={selected}
                    busy={busy}
                    participants={participantsOf(selected, names)}
                    onSend={(body, mentions, replyToId) =>
                      onSendComment?.(selected.id, body, mentions, replyToId)
                    }
                  />
                </div>
              ) : (
                <div>
                  <AttachmentPanel
                    instance={selected}
                    attachments={attachments.filter(
                      (a) => !a.stepInstanceId || a.stepInstanceId === activeStepDrawer.step.id,
                    )}
                    busy={busy}
                    onUpload={(file) => onUploadFile?.(selected.id, file)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

/**
 * QT-U1: Tài liệu đính kèm ngay dưới mỗi bước trên dòng thời gian (chỉ đọc).
 * Nhờ vậy ở bước sau vẫn thấy được tệp các bước trước đã nộp, thay vì mọi tệp
 * dồn hết vào mục tài liệu chung.
 */
function StepDocuments({ files }: { files: readonly ProcedureAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className={styles.stepDocs}>
      <span className={styles.stepDocsLabel}>Tài liệu bước này ({files.length})</span>
      <div className={styles.stepDocsList}>
        {files.map((file) =>
          file.downloadUrl ? (
            <a
              key={file.id}
              href={file.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className={styles.stepDocChip}
              title={file.fileName}
            >
              <FileText size={12} strokeWidth={2} aria-hidden />
              <span className={styles.stepDocName}>{file.fileName}</span>
            </a>
          ) : (
            <span key={file.id} className={styles.stepDocChip} title={file.fileName}>
              <FileText size={12} strokeWidth={2} aria-hidden />
              <span className={styles.stepDocName}>{file.fileName}</span>
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Thẻ quyết định rẽ nhánh trên timeline: đi nhánh nào, căn cứ giá trị nào.
 * Người đọc hồ sơ cần thấy vì sao hồ sơ tới tay người duyệt này mà không phải người khác.
 */
function DecisionCard({
  decision,
  instance,
}: {
  decision: ProcedureGatewayDecision;
  instance: ProcedureInstance;
}) {
  const slots = attributeSlots(instance);
  const definitionOf = (key: string) => slots.find((slot) => slot.key === key)?.definition;
  const keyOf = (ref: ProcedureGatewayDecision['inputs'][number]['ref']) =>
    ref.scope === 'process' ? `process:${ref.code}` : `step:${ref.stepId}:${ref.code}`;
  const gateway = instance.flow?.gateways.find((item) => item.id === decision.gatewayId);
  const branch = gateway?.branches.find((item) => item.id === decision.chosenBranchId);
  const rule = branch?.condition?.rules
    .map((item) => describeConditionRule(item, definitionOf(keyOf(item.attribute))))
    .join(branch.condition.combinator === 'or' ? ' hoặc ' : ' và ');
  return (
    <div className={styles.timelineDecision}>
      <span className={styles.timelineDecisionTag}>Rẽ nhánh</span>
      <div>
        <strong>
          {decision.gatewayName}: {decision.chosenBranchLabel}
        </strong>
        <p>
          {decision.inputs
            .map((input) => {
              const definition = definitionOf(keyOf(input.ref));
              return `${definition?.name ?? input.ref.code} = ${formatAttributeValue(input.value, definition)}`;
            })
            .join(' · ')}
          {decision.usedDefault ? ' — không nhánh nào khớp, đi nhánh mặc định' : rule ? ` — khớp: ${rule}` : ''}
        </p>
      </div>
    </div>
  );
}

function ActionPanel({
  busy,
  isSubmitting,
  comment,
  instance,
  attachments,
  attachQueue,
  onAttachQueue,
  onAction,
  onComment,
  materialCatalog = [],
  assetCatalog = [],
  onPickAsset,
  definitions = [],
  organization,
  actorId,
  onSeedSubtasks,
  onSetSubtasks,
  onCompleteSubtask,
  onCancelSubtask,
  onUploadEvidence,
  onRequestMaterials,
  onSaveAttributes,
}: {
  busy?: string;
  isSubmitting?: boolean;
  comment: string;
  instance: ProcedureInstance;
  attachments: readonly ProcedureAttachment[];
  attachQueue: File[];
  onAttachQueue: (files: File[]) => void;
  onAction: (
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) => void;
  onSaveAttributes?: (values: Record<string, ProcedureAttributeValue | null>) => Promise<void>;
  onComment: (value: string) => void;
  materialCatalog?: readonly MaterialCatalogItem[];
  assetCatalog?: readonly AssetCatalogItem[];
  onPickAsset?: (assetCode: string) => void;
  definitions?: readonly ProcedureDefinition[];
  organization?: TenantOrganizationSnapshot;
  actorId?: string;
  onSeedSubtasks?: () => void;
  onSetSubtasks?: (items: ProcedureSubtaskInput[], mode: ProcedureSubtaskExecutionMode) => void;
  onCompleteSubtask?: (subtaskId: string) => void;
  onCancelSubtask?: (subtaskId: string) => void;
  onUploadEvidence?: (subtaskId: string, file: File) => void;
  onRequestMaterials?: (input: RequestProcedureMaterialsRequest) => void;
}) {
  const authorization = instance.authorization;
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const actions = authorization?.availableActions ?? [];
  const myRoles = authorization?.myRoles ?? [];
  const canAct = actions.length > 0 || myRoles.length > 0;
  // QT-L2: ở pha Review (R) chỉ được Phê duyệt — ẩn Trả lại / Từ chối kể cả khi
  // server còn trả về (phòng thủ ở client; server hiện cũng không cấp cho R).
  const stageIsReview = authorization?.currentRoleStage === 'R';
  const effectiveActions = stageIsReview
    ? actions.filter((action) => action !== 'return' && action !== 'reject')
    : actions;

  const fixedRollback =
    current?.currentRoleStage === 'C'
      ? current.assignments.find((item) => item.role === 'C' && item.fixedRollbackStepId)
          ?.fixedRollbackStepId
      : undefined;
  // Bước được trả về lấy từ server, theo ĐƯỜNG ĐÃ ĐI: khi có nhánh, bước đứng
  // trước theo thứ tự có thể thuộc nhánh không đi.
  const returnTargets = (authorization?.returnTargetStepIds ?? [])
    .map((id) => instance.steps.find((step) => step.id === id))
    .filter((step): step is ProcedureInstanceStep => Boolean(step));
  const canPickReturnStep = !fixedRollback && returnTargets.length > 1;

  const [returnTo, setReturnTo] = useState('');
  const [attributeDraft, setAttributeDraft] = useState<AttributeDraft>({});
  useEffect(() => {
    setAttributeDraft({});
    setReturnOpen(false);
    setConfirmPrimary(null);
  }, [instance.id, instance.currentStepId]);
  const draftValues = (): Record<string, ProcedureAttributeValue> =>
    Object.fromEntries(
      Object.entries(attributeDraft).filter(
        (entry): entry is [string, ProcedureAttributeValue] => entry[1] !== null,
      ),
    );
  // Hoàn tất/duyệt gửi kèm giá trị vừa nhập, để server ghi và đánh giá rẽ nhánh
  // trong cùng một lần — không có khoảng hở giữa "lưu" và "hoàn tất".
  const act = (action: ProcedureRuntimeAction, text?: string, returnToStepId?: string) =>
    onAction(
      action,
      text,
      returnToStepId,
      action === 'complete' || action === 'approve' ? draftValues() : undefined,
    );
  const members = useMemo(() => {
    const seen = new Map<string, string>();
    for (const member of organization?.members ?? []) seen.set(member.userId, member.displayName);
    return [...seen].map(([userId, displayName]) => ({ userId, displayName }));
  }, [organization]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [wbsOpen, setWbsOpen] = useState(false);
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  // QT-U5: với vai A, select "trả lại về bước" chỉ hiện sau khi bấm "Trả lại".
  const [returnOpen, setReturnOpen] = useState(false);
  // QT-L3: xác nhận bằng modal lớn, nền mờ trước khi Phê duyệt / Hoàn tất.
  const [confirmPrimary, setConfirmPrimary] = useState<ProcedureRuntimeAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WBS / E role: check if current step has an E assignment the actor can manage
  const eAssignment = current?.assignments.find((a) => a.role === 'E');
  const canManageSubtasks = authorization?.canManageSubtasks ?? false;
  const mySubtaskCount = authorization?.mySubtaskIds?.length ?? 0;
  const showWbs =
    Boolean(eAssignment) &&
    (canManageSubtasks || mySubtaskCount > 0) &&
    Boolean(onSeedSubtasks && onSetSubtasks && onCompleteSubtask && onCancelSubtask && onUploadEvidence);

  // WBS progress summary (for collapsed header)
  const stepSubtasks = (instance.subtasks ?? []).filter(
    (s) => s.stepInstanceId === current?.id,
  );
  const subtasksResolved = stepSubtasks.filter(
    (s) => s.status === 'completed' || s.status === 'cancelled',
  ).length;
  const subtasksDoneWeight = stepSubtasks
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + s.weight, 0);

  // Role-adaptive textarea label
  const textareaLabel = myRoles.includes('R')
    ? 'Mô tả kết quả thực hiện'
    : myRoles.includes('C')
      ? 'Ý kiến chuyên môn / thẩm định'
      : 'Ghi chú phản hồi / lý do từ chối';

  // Pure "I" (Informed) role check — read-only notice
  const isRoleI = myRoles.length === 1 && myRoles[0] === 'I' && actions.length === 0;

  const isActionBusy = (action: ProcedureRuntimeAction) =>
    busy === `${action}:${instance.id}` || isSubmitting;

  return (
    <div className={styles.actionPanel}>
      {/* Role badges */}
      {myRoles.length > 0 || authorization?.isDelegated || authorization?.isEscalated ? (
        <p className={styles.myRoles}>
          Vai của bạn:{' '}
          {myRoles.map((role) => (
            <i key={role} className={`${styles.role} ${styles[`role${role}`]}`}>
              {role}
            </i>
          ))}
          {authorization?.isDelegated ? <span className={styles.tag}>được uỷ quyền</span> : null}
          {authorization?.isEscalated ? <span className={styles.tag}>xử lý thay cấp dưới</span> : null}
        </p>
      ) : null}

      {/* Pure I (Informed) notice */}
      {instance.status !== 'running' ? (
        <p className={styles.panelHint}>
          {instance.status === 'reversed'
            ? 'Hồ sơ đã huỷ hiệu lực, không còn bước cần xử lý.'
            : instance.status === 'completed'
              ? 'Hồ sơ đã hoàn thành, không còn bước cần xử lý.'
              : 'Hồ sơ đã kết thúc, không còn bước cần xử lý.'}
        </p>
      ) : isRoleI ? (
        <p className={styles.panelHint}>
          Bạn giữ vai I ở bước này.
        </p>
      ) : !canAct ? (
        <p className={styles.panelHint}>
          Bạn không giữ vai ở bước này.
        </p>
      ) : (
        <>
          {/* 4. WBS Inline Section (for E role, collapsible) */}
          {showWbs ? (
            <div className={styles.wbsInlinePanel}>
              <button
                type="button"
                className={styles.wbsCollapseBtn}
                onClick={() => setWbsOpen((prev) => !prev)}
              >
                <span>
                  <i className={`${styles.role} ${styles.roleE}`} style={{ display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px' }}>E</i>
                  Phân rã công việc (WBS)
                  {stepSubtasks.length > 0 ? (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--blue)', fontWeight: 600 }}>
                      ({subtasksResolved}/{stepSubtasks.length} xử lý · {Math.round(subtasksDoneWeight * 100) / 100}%)
                    </span>
                  ) : null}
                </span>
                <span>{wbsOpen ? '▲ Thu gọn' : '▼ Mở phân rã'}</span>
              </button>

              {wbsOpen ? (
                <div className={styles.wbsContent}>
                  <SubtaskPanel
                    instance={instance}
                    materialCatalog={materialCatalog}
                    assetCatalog={assetCatalog}
                    onPickAsset={onPickAsset}
                    definitions={definitions}
                    onRequestMaterials={onRequestMaterials}
                    organization={organization}
                    actorId={actorId}
                    busy={busy}
                    attachments={attachments}
                    onSeed={onSeedSubtasks!}
                    onSetItems={onSetSubtasks!}
                    onComplete={onCompleteSubtask!}
                    onCancel={onCancelSubtask!}
                    onUpload={onUploadEvidence!}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Rollback picker (for A stage) */}
          {/* Thông tin cần nhập ở bước này (thuộc tính do người thiết kế khai) */}
          <AttributeForm
            instance={instance}
            draft={attributeDraft}
            onChange={setAttributeDraft}
            busy={busy === 'attributes' || isSubmitting}
            members={members}
            attachments={attachments.filter((file) => file.instanceId === instance.id)}
            onSaveDraft={
              onSaveAttributes
                ? () => void onSaveAttributes(attributeDraft).then(() => setAttributeDraft({}))
                : undefined
            }
          />

          {/* QT-U5: ô "trả lại về bước" + xác nhận nằm trong pop-up nền mờ (xem cuối panel). */}

          {/* Ý kiến và nút thao tác ghim ở đáy khung chi tiết: bước dài vẫn bấm được ngay. */}
          <div className={styles.actionDock}>
            {/* 2. Textarea (Adaptable by RACIE role) */}
            <label className={styles.commentField}>
              <span className={styles.commentLabel}>{textareaLabel}</span>
              <textarea
                rows={2}
                placeholder="Nhập nhận xét hoặc phương án điều chỉnh…"
                value={comment}
                onChange={(event) => onComment(event.target.value)}
                onKeyDown={(e) => {
                  if (e.ctrlKey && e.key === 'Enter') {
                    const primaryAction = effectiveActions.find((a) => a === 'approve' || a === 'complete');
                    // QT-L3: vẫn đi qua bước xác nhận modal thay vì chạy thẳng.
                    if (primaryAction && !isActionBusy(primaryAction)) {
                      setConfirmPrimary(primaryAction);
                    }
                  }
                }}
              />
            </label>

            {/* 3. Attachment section — Toggle Dropzone */}
            <div className={styles.attachSection}>
              <button
                type="button"
                className={`${styles.attachToggleBtn} ${attachOpen ? styles.attachToggleBtnActive : ''}`}
                onClick={() => setAttachOpen((prev) => !prev)}
              >
                <span className={styles.attachToggleIcon}></span>
                <span>{attachOpen ? 'Thu gọn đính kèm' : 'Đính kèm tài liệu kèm lượt duyệt'}</span>
                {attachQueue.length > 0 ? (
                  <span className={styles.attachCountBadge}>
                    {attachQueue.length} tệp đã chọn
                  </span>
                ) : (
                  <span className={styles.attachToggleHint}>+ Thêm tệp</span>
                )}
              </button>

              {attachOpen ? (
                <div className={styles.attachDropzone}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 0) {
                        onAttachQueue([...attachQueue, ...files]);
                      }
                      e.target.value = '';
                    }}
                  />

                  {attachQueue.length > 0 ? (
                    <div className={styles.attachChipList}>
                      {attachQueue.map((file, idx) => (
                        <span key={idx} className={styles.attachChip}>
                          <span className={styles.attachChipName} title={file.name}>{file.name}</span>
                          <span className={styles.attachChipSize}>
                            ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                          <button
                            type="button"
                            className={styles.attachChipRemove}
                            aria-label="Xoá tệp"
                            onClick={() =>
                              onAttachQueue(attachQueue.filter((_, i) => i !== idx))
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className={styles.attachActionsRow}>
                    <button
                      type="button"
                      className={styles.primaryGhostBtn}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Chọn tệp từ máy tính
                    </button>
                    <span className={styles.attachSubtext}>
                      Tệp sẽ được tải lên tự động khi bạn bấm gửi phê duyệt
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Action buttons */}
            {effectiveActions.length === 0 ? (
              <p className={styles.panelHint}>
                Chưa tới lượt bạn: bước này đang ở pha {current?.currentRoleStage ?? '—'}.
              </p>
            ) : (
              <>
                <div className={styles.actionRow}>
                  {effectiveActions
                    .filter((action) => action !== 'approve' && action !== 'complete' && action !== 'comment' && action !== 'cancel')
                    .map((action) => {
                      if (action === 'reject') {
                        return (
                          <div key={action} className={styles.popconfirmWrapper}>
                            <button
                              key={action}
                              type="button"
                              className={styles.danger}
                              disabled={isActionBusy(action)}
                              onClick={() => {
                                setConfirmRejectOpen((prev) => !prev);
                              }}
                            >
                              {isActionBusy(action) ? 'Đang xử lý…' : ACTION_LABEL[action]}
                            </button>

                            {confirmRejectOpen ? (
                              <div className={styles.popconfirmBox}>
                                <div className={styles.popconfirmArrow} />
                                <div className={styles.popconfirmTitle}>
                                  Xác nhận từ chối hồ sơ này?
                                </div>
                                <div className={styles.popconfirmDesc}>
                                  Hành động từ chối sẽ chuyển hồ sơ sang trạng thái bị từ chối và ngừng xử lý bước tiếp theo.
                                </div>
                                <div className={styles.popconfirmActions}>
                                  <button
                                    type="button"
                                    className={styles.ghost}
                                    style={{ fontSize: '11px', padding: '3px 8px' }}
                                    onClick={() => setConfirmRejectOpen(false)}
                                  >
                                    Huỷ
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.danger}
                                    style={{ fontSize: '11px', padding: '3px 10px' }}
                                    onClick={() => {
                                      setConfirmRejectOpen(false);
                                      act('reject', comment || undefined);
                                    }}
                                  >
                                    Đồng ý từ chối
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      // QT-U5: "Trả lại" chỉ mở ô chọn bước + nút xác nhận, không chạy ngay.
                      if (action === 'return') {
                        return (
                          <button
                            key={action}
                            type="button"
                            className={`${styles.ghost} ${returnOpen ? styles.ghostActive : ''}`}
                            disabled={isActionBusy(action)}
                            aria-expanded={returnOpen}
                            onClick={() => setReturnOpen((prev) => !prev)}
                          >
                            {ACTION_LABEL[action]}
                          </button>
                        );
                      }

                      return (
                        <button
                          key={action}
                          type="button"
                          className={styles.ghost}
                          disabled={isActionBusy(action)}
                          onClick={() => act(action, comment || undefined)}
                        >
                          {isActionBusy(action) ? 'Đang xử lý…' : ACTION_LABEL[action]}
                        </button>
                      );
                    })}
                  {effectiveActions
                    .filter((action) => action === 'approve' || action === 'complete')
                    .map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={styles.primary}
                        disabled={isActionBusy(action)}
                        // QT-L3: mở modal xác nhận lớn, nền mờ trước khi thực thi.
                        onClick={() => setConfirmPrimary(action)}
                      >
                        {isActionBusy(action)
                          ? attachQueue.length > 0
                            ? 'Đang tải tệp & xử lý…'
                            : 'Đang xử lý…'
                          : attachQueue.length > 0
                            ? `${ACTION_LABEL[action]} & Gửi ${attachQueue.length} tệp`
                            : ACTION_LABEL[action]}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>

          {/* QT-L3: hộp thoại xác nhận giữa màn hình, nền mờ, trước Phê duyệt / Hoàn tất. */}
          {confirmPrimary ? (
            <MinimalPopupForm
              isOpen={confirmPrimary !== null}
              title={
                confirmPrimary === 'complete'
                  ? 'Xác nhận hoàn tất bước này?'
                  : 'Xác nhận phê duyệt bước này?'
              }
              subtitle={`${instance.code} · ${instance.title}`}
              onClose={() => setConfirmPrimary(null)}
              maxWidth={520}
            >
              <div className={styles.confirmModalBody}>
                <p className={styles.confirmModalText}>
                  {confirmPrimary === 'complete'
                    ? 'Bước sẽ được ghi nhận hoàn tất và hồ sơ chuyển sang bước tiếp theo. Hành động này không thể hoàn tác.'
                    : 'Lượt phê duyệt sẽ được ghi nhận và hồ sơ chuyển tiếp theo luồng. Hành động này không thể hoàn tác.'}
                </p>
                {attachQueue.length > 0 ? (
                  <p className={styles.confirmModalNote}>
                    Kèm theo {attachQueue.length} tệp đính kèm sẽ được tải lên.
                  </p>
                ) : null}
                {comment.trim() ? (
                  <p className={styles.confirmModalNote}>Ghi chú: “{comment.trim()}”</p>
                ) : null}
                <div className={styles.confirmModalActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setConfirmPrimary(null)}
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={isActionBusy(confirmPrimary)}
                    onClick={() => {
                      const action = confirmPrimary;
                      if (!action) return;
                      setConfirmPrimary(null);
                      act(action, comment || undefined);
                    }}
                  >
                    {confirmPrimary === 'complete' ? 'Đồng ý hoàn tất' : 'Đồng ý phê duyệt'}
                  </button>
                </div>
              </div>
            </MinimalPopupForm>
          ) : null}

          {/* QT-U5: trả lại về bước — pop-up giữa màn hình, nền mờ (như xác nhận duyệt). */}
          {returnOpen && effectiveActions.includes('return') ? (
            <MinimalPopupForm
              isOpen={returnOpen}
              title="Xác nhận trả lại hồ sơ"
              subtitle={`${instance.code} · ${instance.title}`}
              onClose={() => setReturnOpen(false)}
              maxWidth={520}
            >
              <div className={styles.confirmModalBody}>
                {canPickReturnStep ? (
                  <>
                    <span className={styles.returnPickerLabel}>Trả lại về bước</span>
                    <SearchableSelect
                      options={returnTargets.map((step) => ({
                        value: step.id,
                        label: `${step.order} · ${step.name}`,
                      }))}
                      value={returnTo}
                      placeholder={`Bước liền trước (${returnTargets[returnTargets.length - 1]?.name ?? ''})`}
                      onChange={setReturnTo}
                    />
                  </>
                ) : fixedRollback ? (
                  <p className={styles.confirmModalText}>
                    Bước quay về đã cấu hình sẵn:{' '}
                    <strong>
                      {instance.steps.find((step) => step.definitionStepId === fixedRollback)
                        ?.name ?? 'bước trước'}
                    </strong>
                  </p>
                ) : (
                  <p className={styles.confirmModalText}>Hồ sơ sẽ trả về bước liền trước.</p>
                )}
                {comment.trim() ? (
                  <p className={styles.confirmModalNote}>Ghi chú: “{comment.trim()}”</p>
                ) : null}
                <div className={styles.confirmModalActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setReturnOpen(false)}
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={isActionBusy('return')}
                    onClick={() => {
                      setReturnOpen(false);
                      act('return', comment || undefined, returnTo || undefined);
                    }}
                  >
                    {isActionBusy('return') ? 'Đang xử lý…' : 'Xác nhận trả lại'}
                  </button>
                </div>
              </div>
            </MinimalPopupForm>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Tình trạng vật tư của bước hiện tại.
 */
function MaterialStatus({
  instance,
  busy,
  onRecheck,
}: {
  instance: ProcedureInstance;
  busy?: string;
  onRecheck?: () => void;
}) {
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  if (!step?.materials?.length) return null;

  const check = step.materialCheck;
  const short = check?.state === 'short';

  return (
    <article className={`${styles.panel} ${short ? styles.materialShort : ''}`}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>Vật tư cần cho bước này</h3>
        {onRecheck ? (
          <button
            type="button"
            className={styles.ghost}
            disabled={busy === 'materials'}
            onClick={onRecheck}
          >
            {busy === 'materials' ? 'Đang kiểm…' : 'Kiểm lại tồn kho'}
          </button>
        ) : null}
      </header>

      {short ? (
        <p className={styles.materialAlert}>
          Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng. Nhập kho xong thì bấm “Kiểm lại tồn kho”.
        </p>
      ) : step.materialReservations?.length ? (
        <p className={styles.materialHeld}>
          Đã giữ hàng trong kho cho bước này —{' '}
          {step.materialReservations.map((code) => (
            <code key={code} style={{ background: '#d1fae5', padding: '1px 5px', borderRadius: '4px', margin: '0 2px' }}>{code}</code>
          ))}
          . Hàng được trả lại kho khi bước xong hoặc hồ sơ đóng.
        </p>
      ) : null}

      <ul className={styles.materialList}>
        {step.materials.map((item) => {
          const line = check?.lines.find((row) => row.materialCode === item.materialCode);
          return (
            <li key={item.materialCode} className={line && line.short > 0 ? styles.lineShort : ''}>
              <span>{item.materialName ?? item.materialCode}</span>
              <em style={{ color: 'var(--muted)', fontStyle: 'normal' }}>
                cần {item.quantity}
                {item.unit ? ` ${item.unit}` : ''}
              </em>
              <strong>
                {line
                  ? line.short > 0
                    ? `thiếu ${line.short}`
                    : `còn ${line.available}`
                  : 'chưa kiểm'}
              </strong>
            </li>
          );
        })}
      </ul>

      {check ? (
        <small className={styles.panelHint}>
          Kiểm lúc {new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
          }).format(new Date(check.checkedAt))}
        </small>
      ) : null}
    </article>
  );
}
