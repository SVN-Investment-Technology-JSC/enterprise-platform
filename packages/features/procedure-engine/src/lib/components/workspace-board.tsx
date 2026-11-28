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
  RelinkProcedureWorkspaceRequest,
  ProcedureInstanceStep,
  ProcedureRaciRole,
  ProcedureApplyAction,
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
import {
  MinimalPopupForm,
  SearchableSelect,
  formatDateTime as formatSharedDateTime,
  retainProcedureRoom,
} from '@enterprise-platform/shared-ui';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Download, FileText, Paperclip, Plus, Search, X } from 'lucide-react';
import type { AssetCatalogItem, MaterialCatalogItem } from '../procedure-api';
import { AttachmentPanel } from './attachment-panel';
import { DeleteInstanceDialog, RelinkWorkspaceDialog } from './instance-admin-dialogs';
import { AttributeForm, AttributeValues, attributeSlots, type AttributeDraft } from './attribute-form';
import { useInstanceProjectLookup } from './use-instance-project';
import { usePayeePicker } from './use-payee-picker';
import {
  instanceProgress,
  progressLabel,
  progressPercent,
  timelineEntries,
} from './instance-flow-view';
import { chatPeopleOf } from '../chat-people';
import { ChatPanel } from './chat-panel';
import { FinanceVoucherCard, FinanceWaitingNote } from './finance-voucher-card';
import { HistoryPanel } from './history-panel';
import {
  InstanceProjectValue,
  InstanceSourceValue,
  SourceSummaryCard,
  instanceWorkspaceProject,
} from './instance-source';
import { LinkedPanel } from './linked-panel';
import { SlaBadge } from './sla-badge';
import { StartInstanceForm, type StartHandoff, type StartProcedureInput } from './start-instance-form';
import { StepDetailDialog, stepDetail } from './step-detail-dialog';
import { stepCommentPrompt } from './comment-prompt';
import { SubtaskPanel } from './subtask-panel';
import type { TimelineEntry } from './instance-flow-view';
import {
  DATE_SORT_OPTIONS,
  PAGE_SIZE_OPTIONS,
  ROLE_HUMAN_LABEL,
  SLA_FILTER_OPTIONS,
  SOURCE_FILTER_OPTIONS,
  STATUS_LABEL,
  STEP_STATUS_LABEL,
} from './workspace-board-options';
import { CaseLayoutA, CASE_LAYOUT_A_DOCK, type CaseOpenMode } from './case-layout-a/case-layout-a';
import { CaseLayoutToggle, useCaseLayout } from './case-layout-a/case-layout';
import { StepPeopleProgress } from './case-layout-a/case-flow';
import caseStyles from './case-layout-a/case-layout-a.module.scss';
import { isMyActive, isMyDone } from '../procedure-overview';
import { currentWaiting, type SubjectResolver } from '../step-people';
import styles from './workspace-board.module.scss';

/**
 * Chỉ có ở giao diện mới: `watching` — hồ sơ đang chạy mình thấy được nhưng chưa tới lượt mình; `mine-done` — "Bạn đã xử
 * lý", hồ sơ mình đã làm xong phần mình (luật `isMyDone`, trước là tab "Bạn thực hiện – Hoàn thành" của Tổng quan).
 */
type Filter = 'all' | 'urgent' | 'watching' | 'mine-done' | ProcedureInstance['status'];

const ACTION_LABEL: Record<ProcedureRuntimeAction, string> = {
  approve: 'Phê duyệt',
  reject: 'Từ chối',
  return: 'Trả lại',
  complete: 'Hoàn tất',
  cancel: 'Huỷ hồ sơ',
  comment: 'Ghi nhận trao đổi',
};

const ROLE_ORDER: readonly ProcedureRaciRole[] = ['S', 'R', 'E', 'C', 'A', 'I'];
/** Thứ tự ưu tiên khi người chốt bước giữ nhiều vai ở bước đó. */
const PERFORMER_ROLE_ORDER: readonly ProcedureRaciRole[] = ['A', 'R', 'E', 'C', 'S', 'I'];

function formatDateTime(value?: string): string {
  return formatSharedDateTime(value, '—');
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
  onRefreshInstance,
  handoffTitle,
  handoff,
  canReverse = false,
  onReverse,
  onDeleteInstance,
  onRelinkWorkspace,
  onSupplementFile,
  headSlot,
  embedded = false,
  onChanged,
  onNotice,
  onError,
}: {
  /**
   * Giao diện mới: nạp lại danh sách sau khi duyệt / không duyệt hàng loạt trên bảng (vắng thì nạp lại từng hồ sơ đã chọn
   * bằng `onRefreshInstance`).
   */
  onChanged?: () => void | Promise<void>;
  /** Giao diện mới: báo kết quả / lỗi của thao tác hàng loạt trên bảng. */
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
  /**
   * Chỉ hiện chi tiết MỘT hồ sơ (`instances` chỉ có hồ sơ đó), không có thanh công cụ, danh sách và nút tạo đơn:
   * dùng khi nhúng màn xử lý hồ sơ vào khung khác như drawer ngoài Dashboard.
   */
  embedded?: boolean;
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
    action: ProcedureApplyAction,
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
  /** Trả Promise (và từ chối khi lỗi) để hành động kèm tệp chỉ chạy khi tệp đã lên. */
  onUploadFile?: (instanceId: string, file: File) => void | Promise<void>;
  onSendComment?: (instanceId: string, body: string, mentions: string[], replyToId?: string) => void;
  /** Tải lại đúng một hồ sơ khi người khác có trao đổi mới (thời gian thực). */
  onRefreshInstance?: (instanceId: string) => void | Promise<void>;
  handoffTitle?: string;
  handoff?: StartHandoff;
  /** Quản trị viên Quy trình: được huỷ hiệu lực hồ sơ đã hoàn thành. */
  canReverse?: boolean;
  onReverse?: (instanceId: string, input: ReverseProcedureInstanceRequest) => Promise<void>;
  /** Xoá đơn (xoá mềm); nút hiện theo `authorization.canDelete` của từng hồ sơ. */
  onDeleteInstance?: (instanceId: string, reason: string) => Promise<void>;
  /** Đổi công việc liên kết; nút hiện theo `authorization.canRelinkWorkspace`. */
  onRelinkWorkspace?: (instanceId: string, input: RelinkProcedureWorkspaceRequest) => Promise<void>;
  /** Bổ sung tài liệu ngoài bước; nút hiện theo `authorization.canSupplement`. */
  onSupplementFile?: (instanceId: string, file: File) => void;
  initialInstanceId?: string;
}) {
  // Mặc định mở vào "Đang xử lý" (việc cần làm), "Tất cả" đưa xuống cuối thanh tab.
  const [filter, setFilter] = useState<Filter>(embedded ? 'all' : 'running');
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list');
  const [query, setQuery] = useState('');
  const [slaFilter, setSlaFilter] = useState<'all' | ProcedureSlaView['state']>('all');
  const [source, setSource] = useState<'all' | 'manual' | 'maintenance_occurrence' | 'auto_from_parent'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => { if (initialInstanceId) setSelectedId(initialInstanceId); }, [initialInstanceId]);
  // Mở thẳng một hồ sơ qua đường dẫn (`#workspace/<mã hồ sơ>`, như link từ Công việc): hồ sơ có thể nằm ngoài tab đang xem
  // (đã hoàn tất, đã huỷ...) hay bị bộ lọc loại, nên đưa bộ lọc về đúng tab của hồ sơ đó, bỏ các lọc phụ, rồi nhảy tới trang
  // chứa nó. Chỉ làm một lần cho mỗi mã hồ sơ để không giành quyền với người đang tự lọc.
  const deepLinked = useRef<string | undefined>(undefined);
  const [jumpToPageOf, setJumpToPageOf] = useState<string>();
  useEffect(() => {
    if (!initialInstanceId || deepLinked.current === initialInstanceId) return;
    const target = instances.find((instance) => instance.id === initialInstanceId);
    if (!target) return;
    deepLinked.current = initialInstanceId;
    setFilter((current) =>
      current === 'all' || current === target.status ? current : (target.status as Filter),
    );
    setSource('all');
    setSlaFilter('all');
    setFrom('');
    setTo('');
    setQuery('');
    setJumpToPageOf(initialInstanceId);
  }, [initialInstanceId, instances]);
  // Trao đổi, tệp và nhật ký mở thành tab ngay trong khung chi tiết.
  const [detailTab, setDetailTab] = useState<'flow' | 'chat' | 'files' | 'history'>('flow');
  // Lưu id bước (không lưu cả bước): hồ sơ nạp lại thì drawer đọc bước mới nhất, không giữ bản chụp cũ.
  const [activeStepDrawer, setActiveStepDrawer] = useState<{ stepId: string; tab: 'execution' | 'chat' | 'files' } | null>(null);
  // Bước đã đi qua đang mở popup xem lại; lưu id để popup theo dữ liệu mới nhất của hồ sơ.
  const [detailStepId, setDetailStepId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [creating, setCreating] = useState(false);
  const [attachQueue, setAttachQueue] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Giao diện của màn (A mới hoặc cũ), nhớ theo trình duyệt. Nhúng trong khung khác luôn dùng giao diện cũ.
  const [caseLayout, setCaseLayout] = useCaseLayout();
  const layoutA = !embedded && caseLayout === 'a';
  // Tab "Đang theo dõi" và "Bạn đã xử lý" chỉ có ở giao diện mới; sang giao diện cũ thì coi như "Đang xử lý".
  const activeFilter: Filter = !layoutA && (filter === 'watching' || filter === 'mine-done') ? 'running' : filter;
  // Giao diện mới: hồ sơ mở trong cửa sổ theo `#workspace/<id>`; đóng cửa sổ (hay Back về `#workspace`) là bỏ chọn.
  const previousInitialId = useRef(initialInstanceId);
  useEffect(() => {
    const previous = previousInitialId.current;
    previousInitialId.current = initialInstanceId;
    if (layoutA && previous && !initialInstanceId) setSelectedId(undefined);
  }, [initialInstanceId, layoutA]);

  // Nội dung do module hoặc hồ sơ khác chuyển sang: mở form tạo đơn, form tự điền theo `handoff`.
  useEffect(() => {
    if (handoffTitle && canCreateInstances) setCreating(true);
  }, [handoffTitle, handoff, canCreateInstances]);

  const published = definitions.filter((item) => item.status === 'published');
  const roleLabels = useMemo(() => subjectRoleLabels(organization), [organization]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;

    const matched = instances.filter((instance) => {
      // Giao diện mới: "Đang xử lý" và "Duyệt gấp / SLA" chỉ gồm hồ sơ tới lượt mình (`isMyActive`); hồ sơ đang chạy mà
      // chưa tới lượt nằm ở "Đang theo dõi"; "Bạn đã xử lý" gồm hồ sơ mình đã làm xong phần mình. Giao diện cũ giữ nguyên.
      if (layoutA && (activeFilter === 'running' || activeFilter === 'urgent') && !isMyActive(instance)) return false;
      if (activeFilter === 'watching') {
        if (instance.status !== 'running' || isMyActive(instance)) return false;
      } else if (activeFilter === 'mine-done') {
        if (!isMyDone(instance, actorId ?? '')) return false;
      } else if (activeFilter === 'urgent') {
        const sla = evaluateInstanceSla(instance);
        if (instance.status !== 'running' || (sla.state !== 'breached' && sla.state !== 'warning')) return false;
      } else if (activeFilter !== 'all' && instance.status !== activeFilter) {
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
  }, [activeFilter, layoutA, instances, actorId, query, source, slaFilter, from, to, dateSort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  useEffect(() => {
    if (!jumpToPageOf) return;
    // Giao diện mới: bảng tự đưa trang tới hồ sơ đang mở (theo thứ tự của bảng). Hồ sơ đang chạy thì đưa về đúng tab tới
    // lượt mình ("Đang xử lý", "Duyệt gấp / SLA") hay "Đang theo dõi".
    if (layoutA) {
      const target = instances.find((instance) => instance.id === jumpToPageOf);
      if (target?.status === 'running') {
        const mine = isMyActive(target);
        setFilter((current) =>
          current === 'all' ? current : !mine ? 'watching' : current === 'urgent' ? current : 'running',
        );
      }
      setJumpToPageOf(undefined);
      return;
    }
    const index = visible.findIndex((instance) => instance.id === jumpToPageOf);
    if (index < 0) return;
    setPage(Math.floor(index / pageSize) + 1);
    setJumpToPageOf(undefined);
  }, [jumpToPageOf, visible, pageSize, layoutA, instances]);
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const filtersActive =
    source !== 'all' || slaFilter !== 'all' || Boolean(from) || Boolean(to);

  // Hồ sơ đang mở tìm trong TOÀN BỘ danh sách, không chỉ phần khớp bộ lọc: nạp lại ngầm (thời gian thực / định kỳ) mà
  // hồ sơ rời bộ lọc (vd vừa hoàn tất khi đang ở "Đang xử lý") thì vẫn giữ nguyên hồ sơ đó cùng ý kiến đang gõ, không
  // nhảy sang hồ sơ khác. Chưa chọn gì, hoặc hồ sơ đã chọn không còn, mới lấy hồ sơ đầu trang.
  // Giao diện mới: chỉ có hồ sơ đang chọn khi cửa sổ hồ sơ mở (không tự lấy hồ sơ đầu trang).
  const selected =
    (selectedId ? instances.find((instance) => instance.id === selectedId) : undefined) ??
    (layoutA ? undefined : (paged[0] ?? visible[0]));
  const drawerStep = activeStepDrawer
    ? selected?.steps.find((step) => step.id === activeStepDrawer.stepId)
    : undefined;
  // Vào phòng thời gian thực của hồ sơ đang mở; màn cha nghe `procedure.instance.changed` và nạp lại.
  useEffect(() => (selected?.id ? retainProcedureRoom(selected.id) : undefined), [selected?.id]);
  // Những NGƯỜI có thể được nhắc: vai giao cho chức danh/đơn vị được mở rộng thành từng người đang giữ.
  const chatPeople = useMemo(
    () => (selected ? chatPeopleOf(selected, organization, actorId) : []),
    [selected, organization, actorId],
  );

  const [headerCancelOpen, setHeaderCancelOpen] = useState(false);
  const [headerWithdrawOpen, setHeaderWithdrawOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  /** Hộp "Xoá đơn" / "Đổi công việc liên kết" đang mở cho hồ sơ đang chọn. */
  const [adminDialog, setAdminDialog] = useState<'delete' | 'relink'>();
  const [reverseReason, setReverseReason] = useState('');
  const [reverseAdjust, setReverseAdjust] = useState(true);
  const [reverseError, setReverseError] = useState<string>();
  const [reverseBusy, setReverseBusy] = useState(false);

  useEffect(() => {
    setComment('');
    setAttachQueue([]);
    setHeaderCancelOpen(false);
    setHeaderWithdrawOpen(false);
  }, [selected?.id]);

  /** Upload queued files first, then execute the workflow action */
  const handleActionWithAttach = async (
    instanceId: string,
    action: ProcedureApplyAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) => {
    setIsSubmitting(true);
    try {
      if (attachQueue.length > 0 && onUploadFile) {
        // Chờ từng tệp lên xong rồi mới chạy hành động. `onUploadFile` ném lỗi khi tệp không lên được: dừng tại đó, giữ
        // lại các tệp chưa lên trong hàng chờ, và không chạy hành động (nơi gọi đã hiện lỗi của việc tải tệp).
        let uploaded = 0;
        try {
          for (const file of attachQueue) {
            await onUploadFile(instanceId, file);
            uploaded += 1;
          }
        } catch {
          setAttachQueue(attachQueue.slice(uploaded));
          return;
        }
        setAttachQueue([]);
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
    const isUrgent = (inst: ProcedureInstance) => {
      const sla = evaluateInstanceSla(inst);
      return inst.status === 'running' && (sla.state === 'breached' || sla.state === 'warning');
    };
    const urgent = instances.filter(isUrgent).length;
    // Giao diện mới: tách hồ sơ đang chạy thành tới lượt mình / đang theo dõi.
    const myTurn = instances.filter((i) => i.status === 'running' && isMyActive(i)).length;
    const myUrgent = instances.filter((i) => isUrgent(i) && isMyActive(i)).length;
    const watching = processing - myTurn;
    const myDone = instances.filter((i) => isMyDone(i, actorId ?? '')).length;
    return { total, processing, completed, rejected, cancelled, reversed, urgent, myTurn, myUrgent, watching, myDone };
  }, [instances, actorId]);

  // Giao diện mới: mở / chuyển / đóng cửa sổ hồ sơ, ghi theo `#workspace/<id>` để tải lại trang hay gửi đường dẫn vẫn mở
  // đúng hồ sơ. Đánh dấu đã xử lý đường dẫn để hiệu ứng "mở thẳng qua đường dẫn" không đặt lại bộ lọc người dùng đang dùng.
  const writeCaseHash = (instanceId: string | undefined, mode: CaseOpenMode) => {
    if (typeof window === 'undefined') return;
    const current = window.location.hash;
    if (current && current !== '#workspace' && !current.startsWith('#workspace/')) return;
    const next = instanceId ? `#workspace/${encodeURIComponent(instanceId)}` : '#workspace';
    if (current === next) return;
    try {
      if (mode === 'push') window.location.hash = next.slice(1);
      else window.location.replace(next);
    } catch {
      // Trình duyệt không cho đổi địa chỉ: cửa sổ vẫn mở / đóng theo lựa chọn.
    }
  };
  const openCase = (instanceId: string, mode: CaseOpenMode) => {
    deepLinked.current = encodeURIComponent(instanceId);
    setSelectedId(instanceId);
    writeCaseHash(instanceId, mode);
  };
  const closeCase = () => {
    setSelectedId(undefined);
    writeCaseHash(undefined, 'replace');
  };
  /** Chọn hồ sơ từ trong chi tiết (hồ sơ điều chỉnh, hồ sơ liên quan): giao diện mới thì chuyển cửa sổ sang hồ sơ đó. */
  const selectCase = (instanceId: string | undefined) => {
    if (layoutA && instanceId) openCase(instanceId, 'replace');
    else setSelectedId(instanceId);
  };

  // Xuất Excel và Tạo đơn: dùng ở cả hai giao diện (giao diện cũ thêm nút Thẻ / Bảng phía trước).
  const exportCreateActions = (
    <>
      <button type="button" className={styles.ghost} onClick={exportExcel}>
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
      {exportCreateActions}
    </>
  );

  // Giao diện mới: tra chức danh / đơn vị / nhân sự ra người đang giữ, để hiện "đang chờ ai" bằng tên người.
  const resolveSubject: SubjectResolver = (subjectId) => {
    const subject = roleLabels.get(subjectId);
    return subject ? { title: subject.title, people: subject.holderNames } : undefined;
  };
  const selectedCurrent = selected?.steps.find((step) => step.id === selected.currentStepId);
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
      classNames={layoutA ? CASE_LAYOUT_A_DOCK : undefined}
      concise={layoutA}
      resolveSubject={layoutA ? resolveSubject : undefined}
      leading={
        layoutA && selectedCurrent ? (
          <>
            {/* Ai trong bước đã xong phần mình (vd người xem xét đã xem xét), ai đang được chờ. */}
            <StepPeopleProgress
              instance={selected}
              step={selectedCurrent}
              resolveSubject={resolveSubject}
              className={caseStyles.stageListPanel}
              full
            />
            <FinanceVoucherCard step={selectedCurrent} onRefresh={() => onRefreshInstance?.(selected.id)} />
            <StepDocuments
              files={(attachments ?? []).filter(
                (file) => file.instanceId === selected.id && file.stepInstanceId === selectedCurrent.id,
              )}
            />
          </>
        ) : undefined
      }
    />
  ) : null;

  const entries = selected ? timelineEntries(selected) : [];
  // Thông tin hồ sơ luôn nêu dự án bằng tên; hồ sơ cũ chưa lưu tên dự án thì đọc bộ nhớ chung (bảng đã tra sẵn), thiếu mới
  // tra bù từ Workspace.
  const { project: selectedProject, pending: selectedProjectPending } = useInstanceProjectLookup(selected);
  // Bước sẽ được mở lại khi hoàn duyệt: đặt nút ngay trên dòng bước đó của tiến trình, để người vừa duyệt xong (đã
  // rời bước, không còn vai ở bước hiện tại) thấy rõ mình rút lại được.
  const withdrawStepId = selected?.status === 'running' && selected.authorization?.canWithdraw
    ? selected.authorization.withdrawStepId
    : undefined;
  // Người submit thực tế của hồ sơ (vai S của bước đầu): dùng cho QT-U3.
  const submitterName = selected?.activity.find((entry) => entry.action === 'start')?.actorName;
  // Vai của người đã chốt một bước, theo phân công của bước (giao cho chính người đó, hay cho chức danh / đơn vị người đó
  // đang giữ); nhiều vai thì lấy vai quyết định trước. Chỉ để hiện cạnh tên người xử lý trên tiến trình.
  const performerRole = (step: ProcedureInstanceStep, performerId?: string, performerName?: string) => {
    const roles = step.assignments
      .filter(
        (item) =>
          (performerId && item.subjectId === performerId) ||
          (performerName && roleLabels.get(item.subjectId)?.holderNames?.includes(performerName)),
      )
      .map((item) => item.role);
    return PERFORMER_ROLE_ORDER.find((role) => roles.includes(role));
  };
  const detailStep = selected?.steps.find((step) => step.id === detailStepId);
  const currentInTimeline = entries.some(
    (entry) => entry.kind === 'step' && entry.step.id === selected?.currentStepId,
  );
  const pageStart = (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, visible.length);

  // Đổi bộ lọc, tìm kiếm, sắp xếp, cỡ trang: luôn về trang 1 (dùng chung cho cả hai giao diện).
  const selectFilter = (value: Filter) => {
    setFilter(value);
    setPage(1);
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const changeSlaFilter = (value: string) => {
    setSlaFilter((value || 'all') as typeof slaFilter);
    setPage(1);
  };
  const changeSource = (value: string) => {
    setSource((value || 'all') as typeof source);
    setPage(1);
  };
  const changeDateSort = (value: string) => {
    setDateSort((value || 'newest') as 'newest' | 'oldest');
    setPage(1);
  };
  const changePageSize = (value: string) => {
    setPageSize(Number(value) || 15);
    setPage(1);
  };
  const canReset = filtersActive || Boolean(query) || filter !== 'all';
  const resetFilters = () => {
    setFilter('all');
    setSlaFilter('all');
    setSource('all');
    setFrom('');
    setTo('');
    setQuery('');
    setPage(1);
  };
  // Nút đổi giao diện, hiện ở cả hai giao diện (không có khi nhúng).
  const layoutToggle = embedded ? null : <CaseLayoutToggle value={caseLayout} onChange={setCaseLayout} />;

  // Các tab trạng thái của thanh lọc (dùng chung cho giao diện cũ và giao diện A).
  // Giao diện mới: "Đang xử lý" / "Duyệt gấp / SLA" đếm hồ sơ tới lượt mình, thêm "Đang theo dõi" cho phần còn lại và
  // "Bạn đã xử lý" cho hồ sơ mình đã làm xong phần mình.
  const statusTabItems: ReadonlyArray<readonly [Filter, string, number]> = layoutA
    ? [
        ['running', 'Đang xử lý', stats.myTurn],
        ['urgent', 'Duyệt gấp / SLA', stats.myUrgent],
        ['watching', 'Đang theo dõi', stats.watching],
        ['mine-done', 'Bạn đã xử lý', stats.myDone],
        ['completed', 'Hoàn thành', stats.completed],
        ['rejected', 'Từ chối', stats.rejected],
        ['cancelled', 'Đã huỷ', stats.cancelled],
        ['reversed', 'Đã huỷ hiệu lực', stats.reversed],
        ['all', 'Tất cả', stats.total],
      ]
    : [
        ['running', 'Đang xử lý', stats.processing],
        ['urgent', 'Duyệt gấp / SLA', stats.urgent],
        ['completed', 'Hoàn thành', stats.completed],
        ['rejected', 'Từ chối', stats.rejected],
        ['cancelled', 'Đã huỷ', stats.cancelled],
        ['reversed', 'Đã huỷ hiệu lực', stats.reversed],
        ['all', 'Tất cả', stats.total],
      ];

  // Hộp thoại của màn (tạo đơn, xoá đơn, đổi công việc, huỷ hiệu lực): dùng chung cho cả hai giao diện.
  const overlaysTop = (
    <>
      {canCreateInstances && !embedded ? (
        <StartInstanceForm
          open={creating}
          onClose={() => setCreating(false)}
          definitions={published}
          busy={busy}
          // Gửi xong thì đóng form; lỗi (nếu có) hiện ở băng thông báo của màn.
          onStart={(definition, input) =>
            onStart(definition, input).then(() => setCreating(false))
          }
          actorId={actorId}
          actorName={actorName}
          organization={organization}
          handoffTitle={handoffTitle}
          handoff={handoff}
        />
      ) : null}

      {adminDialog === 'delete' && selected && onDeleteInstance ? (
        <DeleteInstanceDialog
          instance={selected}
          onClose={() => setAdminDialog(undefined)}
          onDelete={onDeleteInstance}
        />
      ) : null}
      {adminDialog === 'relink' && selected && onRelinkWorkspace ? (
        <RelinkWorkspaceDialog
          instance={selected}
          onClose={() => setAdminDialog(undefined)}
          onRelink={onRelinkWorkspace}
        />
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
                : selected.sourceType === 'finance_voucher'
                  ? ' Phiếu tài chính đã ghi sổ thì không huỷ hiệu lực được: huỷ phiếu (đảo bút toán) trong Tài chính trước.'
                  : ''}
              {selected.workspaceLink?.status === 'linked'
                ? ` Công việc ${selected.workspaceLink.workItemCode ?? ''} của dự án ${selected.workspaceLink.projectCode} được báo để xử lý theo.`
                : ''}
              {selected.steps.some((step) => step.financeVoucher?.state === 'posted')
                ? ' Phiếu của bước Tài chính đã ghi sổ sẽ được đảo bút toán vào hôm nay; bị chặn nếu sổ đã khoá hoặc tài khoản không đủ số dư.'
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
    </>
  );

  // Bảng danh sách khi xem dạng Bảng.
  const masterTable = (
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
  );

  // Nút ở đầu khung chi tiết (Hoàn duyệt, Huỷ hồ sơ, Huỷ hiệu lực, Đổi dự án / công việc, Xoá đơn).
  const headerActions = selected ? (
    <>
      {/* Hoàn duyệt: người vừa duyệt xong rút lại khi bước kế tiếp chưa ai xử lý. */}
      {selected.status === 'running' && selected.authorization?.canWithdraw ? (
        <div className={styles.popconfirmWrapper}>
          <button
            type="button"
            className={styles.headerWithdrawBtn}
            disabled={busy === `withdraw:${selected.id}` || isSubmitting}
            onClick={() => setHeaderWithdrawOpen((prev) => !prev)}
          >
            Hoàn duyệt
          </button>

          {headerWithdrawOpen ? (
            <div className={`${styles.popconfirmBox} ${styles.popconfirmBelow}`}>
              <div className={styles.popconfirmArrow} />
              <div className={styles.popconfirmTitle}>
                Hoàn duyệt và quay lại bước “{selected.authorization.withdrawStepName}”?
              </div>
              <div className={styles.popconfirmDesc}>
                Hồ sơ trở về chỗ bạn vừa xử lý để bạn làm lại. Chỉ rút lại được khi bước kế tiếp chưa ai xử lý.
              </div>
              <div className={styles.popconfirmActions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setHeaderWithdrawOpen(false)}
                >
                  Không
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    setHeaderWithdrawOpen(false);
                    void handleActionWithAttach(selected.id, 'withdraw');
                  }}
                >
                  Hoàn duyệt
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

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

      {/* Đổi dự án / công việc: người tham gia đơn trừ người chỉ xem. Xoá đơn: vai A của đơn hoặc quản trị. */}
      {onRelinkWorkspace && selected.authorization?.canRelinkWorkspace ? (
        <button
          type="button"
          className={styles.headerCancelBtn}
          onClick={() => setAdminDialog('relink')}
        >
          Đổi dự án / công việc
        </button>
      ) : null}
      {onDeleteInstance && selected.authorization?.canDelete ? (
        <button
          type="button"
          className={styles.headerCancelBtn}
          onClick={() => setAdminDialog('delete')}
        >
          Xoá đơn
        </button>
      ) : null}
    </>
  ) : null;

  // Ghi chú huỷ hiệu lực và hồ sơ điều chỉnh dưới tên hồ sơ.
  const reversalNotes = selected ? (
    <>
      {selected.reversal ? (
        <div className={styles.reversalNote} role="note">
          <strong className={styles.reversalTitle}>Đã huỷ hiệu lực</strong>
          <span className={styles.reversalMeta}>
            {selected.reversal.reversedByName ?? 'Quản trị viên'} ·{' '}
            {formatDateTime(selected.reversal.reversedAt)}
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
                        onClick={() => selectCase(item.id)}
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
              onClick={() => selectCase(selected.adjustmentOf?.instanceId)}
            >
              {selected.adjustmentOf.instanceCode}
            </button>
          ) : (
            <strong>{selected.adjustmentOf.instanceCode}</strong>
          )}
          {' '}đã bị huỷ hiệu lực.
        </p>
      ) : null}
    </>
  ) : null;

  // Ghi chú công việc liên kết bên Workspace.
  const workspaceLinkNote = selected?.workspaceLink ? (
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
  ) : null;

  // Các tab nội dung hồ sơ cùng số đếm.
  const detailTabItems = selected
    ? [
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
      ]
    : [];

  // Một dòng trên tiến trình: bước, thẻ rẽ nhánh hoặc nhóm nhánh không đi. Bước đang chạy chứa khung xử lý.
  const renderEntry = (entry: TimelineEntry) => {
    if (!selected) return null;
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

    // Bước đã đi qua bấm được để xem lại ai làm, lúc nào, đã nhập gì.
    const canReview = !isCur && (isDone || isRejected);
    const openReview = (event: ReactMouseEvent | ReactKeyboardEvent) => {
      if ((event.target as HTMLElement).closest('a, button, input, textarea')) return;
      setDetailStepId(step.id);
    };

    // Giao diện mới: bước đang làm là MỘT khung "Việc cần làm" (đầu khung, phiếu, tài liệu, ô nhập, ý kiến, nút) do
    // `ActionPanel` vẽ; không lặp tên bước, dòng vai và khung vàng của thẻ cũ.
    if (layoutA && isCur) {
      return (
        <li key={step.id} className={`${styles.timelineItem} ${caseStyles.taskItem}`}>
          <span className={`${styles.timelineNode} ${styles.nodeActive}`} aria-hidden>
            {step.order}
          </span>
          <div className={`${styles.timelineBody} ${caseStyles.taskBody}`}>{actionPanel}</div>
        </li>
      );
    }

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
        <div
          className={`${styles.timelineBody} ${canReview ? styles.timelineBodyClickable : ''}`}
          {...(canReview
            ? {
                role: 'button',
                tabIndex: 0,
                title: 'Xem chi tiết bước',
                onClick: openReview,
                onKeyDown: (event: ReactKeyboardEvent) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openReview(event);
                  }
                },
              }
            : {})}
        >
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

          <FinanceVoucherCard step={step} onRefresh={() => onRefreshInstance?.(selected.id)} />

          {/* Bước đã qua: giá trị nhập ở bước này, cùng khối chỉ đọc với khung xử lý (giao diện mới, cũ và khung nhúng). */}
          {!isCur && (isDone || isRejected || step.status === 'returned') ? (
            <AttributeValues
              instance={selected}
              items={stepDetail(selected, step).values}
              contextStepId={step.definitionStepId}
              members={organization?.members}
              attachments={(attachments ?? []).filter((file) => file.instanceId === selected.id)}
              heading="Thông tin đã nhập"
            />
          ) : null}

          {/* QT-U1: tài liệu nộp ở chính bước này, để bước sau xem được bước trước up gì. */}
          <StepDocuments
            files={(attachments ?? []).filter(
              (file) =>
                file.instanceId === selected.id && file.stepInstanceId === step.id,
            )}
          />

          {/* Bước vừa xong mà người này còn rút lại được: nút Hoàn duyệt nằm ngay trên bước đó. */}
          {withdrawStepId === step.id && !isCur ? (
            <WithdrawCallout
              text="Bạn còn hoàn duyệt được bước này."
              busy={busy === `withdraw:${selected.id}` || isSubmitting}
              onWithdraw={() => void handleActionWithAttach(selected.id, 'withdraw')}
            />
          ) : null}

          {isCur ? actionPanel : null}
        </div>
      </li>
    );
  };

  // Vật tư của bước hiện tại và hồ sơ liên quan, dưới tiến trình.
  const flowExtras = selected ? (
    <>
      <MaterialStatus
        instance={selected}
        busy={busy}
        onRecheck={onRecheckMaterials ? () => onRecheckMaterials(selected.id) : undefined}
      />

      <LinkedPanel
        instance={selected}
        instances={instances}
        onOpen={(instanceId) => selectCase(instanceId)}
      />
    </>
  ) : null;

  // Nội dung tab Trao đổi / Tệp & tài liệu / Nhật ký.
  const otherTabPanel = selected ? (
    <div className={styles.tabPanel}>
      {detailTab === 'chat' ? (
        <ChatPanel
          key={selected.id}
          instance={selected}
          busy={busy}
          participants={chatPeople}
          currentUserId={actorId}
          onRefreshInstance={onRefreshInstance}
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
          onSupplement={
            onSupplementFile ? (file) => onSupplementFile(selected.id, file) : undefined
          }
        />
      ) : (
        <HistoryPanel instance={selected} />
      )}
    </div>
  ) : null;

  // Popup xem lại bước đã qua và ngăn kéo bước.
  const overlaysBottom = (
    <>
      {selected && detailStep ? (
        <StepDetailDialog
          instance={selected}
          step={detailStep}
          statusLabel={STEP_STATUS_LABEL[detailStep.status] ?? detailStep.status}
          roles={roleLines(detailStep, roleLabels).map((line) => (
            <RoleLine key={line.role} line={line} submitterName={submitterName} />
          ))}
          extra={
            <>
              <FinanceVoucherCard step={detailStep} onRefresh={() => onRefreshInstance?.(selected.id)} />
              <StepDocuments
                files={(attachments ?? []).filter(
                  (file) => file.instanceId === selected.id && file.stepInstanceId === detailStep.id,
                )}
              />
            </>
          }
          members={organization?.members}
          attachments={(attachments ?? []).filter((file) => file.instanceId === selected.id)}
          onClose={() => setDetailStepId(null)}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* 4. SLIDE-OVER NODE WORKSPACE DRAWER (3 AXES: XỬ LÝ · TRAO ĐỔI · TỆP)       */}
      {/* ========================================================================= */}
      {activeStepDrawer && selected && drawerStep ? (
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
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      BƯỚC {drawerStep.order}
                    </span>
                    <span className={`${styles.badge} ${styles[drawerStep.status]}`}>
                      {STEP_STATUS_LABEL[drawerStep.status] ?? drawerStep.status}
                    </span>
                    {drawerStep.slaHours ? (
                      <span
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted)',
                          background: '#e2e8f0',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        SLA: {drawerStep.slaHours}h
                      </span>
                    ) : null}
                  </div>
                  <h3 style={{ margin: '6px 0 2px', fontSize: '16px', fontWeight: 800, color: 'var(--ink)' }}>
                    {drawerStep.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--faint)' }}>
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
                    fontSize: '13px',
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
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'chat' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'chat' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  2. Trao đổi ({selected.activity.filter((a) => !a.stepInstanceId || a.stepInstanceId === drawerStep.id).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'files' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'files' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'files' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  3. Tệp ({attachments.filter((a) => a.instanceId === selected.id && a.stepInstanceId === drawerStep.id).length})
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeStepDrawer.tab === 'execution' ? (
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Phân vai RCSI cho bước này
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                    {drawerStep.assignments.map((asgn) => {
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
                              <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{holderLabel}</strong>
                              <div style={{ fontSize: '12px', color: 'var(--faint)' }}>
                                Loại: {asgn.subjectType === 'user' ? 'Nhân sự' : asgn.subjectType === 'organization_unit' ? 'Đơn vị' : 'Chức vụ'}
                              </div>
                            </div>
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--blue)' }}>
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
                  {drawerStep.materials && drawerStep.materials.length > 0 ? (
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                        Vật tư / Thiết bị yêu cầu cho bước
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {drawerStep.materials.map((mat) => (
                          <li
                            key={mat.materialCode}
                            style={{
                              padding: '8px 12px',
                              background: '#f1f5f9',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '13px',
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
                    key={selected.id}
                    instance={selected}
                    busy={busy}
                    participants={chatPeople}
                    currentUserId={actorId}
                    onRefreshInstance={onRefreshInstance}
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
                      (a) => !a.stepInstanceId || a.stepInstanceId === drawerStep.id,
                    )}
                    busy={busy}
                    onUpload={(file) => onUploadFile?.(selected.id, file)}
                    onSupplement={
                      onSupplementFile ? (file) => onSupplementFile(selected.id, file) : undefined
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  // Giao diện mới: cùng state, cùng khối, chỉ sắp lại (bảng + cửa sổ hồ sơ). Bỏ giao diện cũ sau này: giữ nhánh này, xoá
  // phần `return` cũ bên dưới.
  if (layoutA) {
    return (
      <CaseLayoutA
        toolbar={{
          statusTabs: statusTabItems,
          filter,
          onFilter: selectFilter,
          query,
          onQuery: changeQuery,
          slaFilter,
          onSlaFilter: changeSlaFilter,
          source,
          onSource: changeSource,
          canReset,
          onReset: resetFilters,
          headActions: exportCreateActions,
          layoutToggle,
        }}
        board={{
          instances,
          visible,
          totalCount: instances.length,
          definitions,
          actorId,
          // "Bạn đã xử lý": dòng hiện bước mình xử lý gần nhất, như tab "Hoàn thành" của Tổng quan cũ.
          rowTab: activeFilter === 'mine-done' ? 'mine-done' : 'all',
          page: currentPage,
          pageSize,
          onPage: setPage,
          onPageSize: changePageSize,
          // Thao tác trên dòng đi đúng đường xử lý hồ sơ của màn (báo bận, lỗi, nạp lại do màn cha lo).
          runAction: (instance, kind, text) => onAction(instance.id, kind, text),
          afterBulk: async (ids) => {
            if (onChanged) await onChanged();
            else await Promise.all(ids.map((id) => onRefreshInstance?.(id)));
          },
          onNotice,
          onError,
          openId: selected?.id,
          onOpen: openCase,
          onClose: closeCase,
        }}
        detail={
          selected
            ? {
                instance: selected,
                project: selectedProject,
                projectPending: selectedProjectPending,
                headerActions,
                reversalNotes,
                tabs: detailTabItems,
                tab: detailTab,
                onTab: setDetailTab,
                entries,
                currentInTimeline,
                actionPanel,
                renderEntry,
                flowExtras,
                otherTabPanel,
                withdrawStepId,
                attachments: attachments ?? [],
                renderRoles: (step) =>
                  roleLines(step, roleLabels).map((line) => (
                    <RoleLine key={line.role} line={line} submitterName={submitterName} />
                  )),
                performerRole,
                resolveSubject,
              }
            : undefined
        }
        overlaysTop={overlaysTop}
        overlaysBottom={overlaysBottom}
      />
    );
  }

  return (
    <section className={`${styles.workspace} ${embedded ? styles.embedded : ''}`}>
      {embedded ? null : headSlot ? (
        createPortal(<>{headActions}{layoutToggle}</>, headSlot)
      ) : (
        <div className={styles.topBar}>{headActions}{layoutToggle}</div>
      )}

      {overlaysTop}

      {/* Thanh lọc: trạng thái thành tab có số đếm, bộ lọc khác gọn trên cùng một hàng. */}
      {embedded ? null : <div className={styles.toolbar}>
        <div className={styles.statusTabs} role="tablist" aria-label="Lọc theo trạng thái">
          {statusTabItems.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={activeFilter === value}
              className={`${styles.statusTab} ${activeFilter === value ? styles.statusTabOn : ''} ${
                value === 'urgent' && count > 0 ? styles.statusTabUrgent : ''
              }`}
              onClick={() => selectFilter(value)}
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
              onChange={(event) => changeQuery(event.target.value)}
            />
          </label>
          <SearchableSelect
            className={styles.filterCombo}
            clearable={false}
            value={slaFilter}
            options={SLA_FILTER_OPTIONS}
            onChange={changeSlaFilter}
          />
          <SearchableSelect
            className={styles.filterCombo}
            clearable={false}
            value={source}
            options={SOURCE_FILTER_OPTIONS}
            onChange={changeSource}
          />
          {canReset ? (
            <button
              type="button"
              className={styles.resetBtn}
              onClick={resetFilters}
              title="Đặt lại tất cả bộ lọc"
            >
              Đặt lại
            </button>
          ) : null}
        </div>
      </div>}

      {/* Danh sách bên trái, chi tiết bên phải; mỗi bên tự cuộn trong khung của mình. */}
      <div className={`${styles.split} ${viewMode === 'table' ? styles.splitTable : ''}`}>
        {embedded ? null : <section className={styles.listPane} aria-label="Danh sách hồ sơ">
          <div className={styles.listHead}>
            <span>
              <strong>{visible.length}</strong> hồ sơ
            </span>
            <SearchableSelect
              className={styles.sortCombo}
              clearable={false}
              value={dateSort}
              options={DATE_SORT_OPTIONS}
              onChange={changeDateSort}
            />
          </div>

          {visible.length === 0 ? (
            <div className={styles.empty}>
              <h2>Không có hồ sơ nào khớp bộ lọc</h2>
            </div>
          ) : viewMode === 'table' ? (
            <div className={styles.listBody}>
              {masterTable}
            </div>
          ) : (
            <div className={styles.listBody}>
              {paged.map((instance) => {
                const progress = instanceProgress(instance);
                const percent = progressPercent(progress);
                const current = instance.steps.find((step) => step.id === instance.currentStepId);
                const project = instanceWorkspaceProject(instance);
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
                      {/* Hồ sơ của dự án: tên dự án ngay trên thẻ (mã khi hồ sơ cũ chưa lưu tên), mã khi rê chuột. */}
                      {project ? (
                        <span
                          className={styles.caseRowProject}
                          title={`Dự án ${project.projectName ? `${project.projectName} · ` : ''}${project.projectCode}`}
                        >
                          {project.projectName || project.projectCode}
                        </span>
                      ) : null}
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
                options={PAGE_SIZE_OPTIONS}
                onChange={changePageSize}
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
        </section>}

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

                  {headerActions}
                </div>

                <h2 className={styles.detailTitle}>{selected.title}</h2>
                {/* QT-U6: mã hồ sơ hiện ngay dưới tên (đã ẩn ở thẻ preview). */}
                <div className={styles.detailCode}>{selected.code}</div>
                {reversalNotes}

                <SourceSummaryCard summary={selected.sourceSummary} />

                <dl className={styles.metaLine}>
                  <div>
                    <dt>Khởi tạo</dt>
                    <dd>
                      {selected.activity.find((entry) => entry.action === 'start')?.actorName ?? '—'}
                      {selected.createdOnBehalfBy ? ` (do ${selected.createdOnBehalfBy.name} tạo hộ)` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Quy trình</dt>
                    <dd>
                      {selected.definitionName} · v{selected.definitionVersion}
                    </dd>
                  </div>
                  <div>
                    <dt>Nguồn</dt>
                    <dd>
                      <InstanceSourceValue instance={selected} />
                    </dd>
                  </div>
                  {/* Hồ sơ của dự án: hiện dự án nào, bấm mở thẳng dự án / công việc bên Workspace. */}
                  {selectedProject ? (
                    <div>
                      <dt>Dự án</dt>
                      <dd>
                        <InstanceProjectValue project={selectedProject} />
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{selected.completedAt ? 'Hoàn tất' : 'Mở đơn'}</dt>
                    <dd>{formatDateTime(selected.completedAt ?? selected.startedAt)}</dd>
                  </div>
                </dl>

                {workspaceLinkNote}

                <div className={styles.detailTabs} role="tablist" aria-label="Nội dung hồ sơ">
                  {detailTabItems.map((tab) => (
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
                      {entries.map(renderEntry)}
                    </ol>

              {flowExtras}
                  </>
                ) : (
                  otherTabPanel
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

      {overlaysBottom}

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
 * Lời mời hoàn duyệt cho người vừa xử lý xong, đặt ngay chỗ người đó nhìn: dòng bước sẽ được mở lại trên tiến trình,
 * hoặc khung xử lý của bước hiện tại khi họ không còn vai ở đó. Quyền vẫn do server quyết (`canWithdraw`).
 */
function WithdrawCallout({
  text,
  busy,
  onWithdraw,
}: {
  text: string;
  busy: boolean;
  onWithdraw: () => void;
}) {
  return (
    // Chặn bấm chuột và phím Enter/Space nổi lên dòng bước (dòng bước bấm được để mở popup xem lại): bấm vào lời mời
    // không mở popup, và nút vẫn bấm bằng bàn phím được.
    <div
      className={styles.withdrawCallout}
      role="note"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className={styles.withdrawCalloutText}>{text}</span>
      <button type="button" className={styles.headerWithdrawBtn} disabled={busy} onClick={onWithdraw}>
        {busy ? 'Đang xử lý…' : 'Hoàn duyệt'}
      </button>
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
  classNames,
  concise = false,
  resolveSubject,
  leading,
}: {
  /**
   * Chỉ đổi cách trình bày (không đổi logic, nút, xác nhận): cửa sổ hồ sơ của giao diện mới. Bỏ chữ giải thích dài; khung
   * thành một khung "Việc cần làm" có một dòng đầu (tên bước, vai của bạn; hạn đã có ở đầu cửa sổ, không có Lưu nháp: giá
   * trị vừa nhập đi cùng Hoàn tất / Phê duyệt), ô nhập một lưới co giãn, ô ý kiến một dòng có nút "Đính kèm tệp" bên phải
   * (pha khởi tạo S không có ô ý kiến, nút đính kèm ở đầu trái hàng nút), tệp đã chọn dạng chip.
   */
  concise?: boolean;
  /** Giao diện mới: tra chủ thể phân công ra người, để dòng đầu ghi "Đang chờ <tên người>". */
  resolveSubject?: SubjectResolver;
  /** Giao diện mới: khối của bước đang làm đặt ngay dưới dòng đầu (phiếu Tài chính, tài liệu của bước). */
  leading?: ReactNode;
  /**
   * Chỉ thêm class (không đổi logic): giao diện A dùng để ghim hàng nút thao tác ở đáy khung chi tiết.
   * `dock` gắn vào khối ý kiến + nút, `actionRow` gắn vào hàng nút thao tác.
   */
  classNames?: { readonly dock?: string; readonly actionRow?: string };
  busy?: string;
  isSubmitting?: boolean;
  comment: string;
  instance: ProcedureInstance;
  attachments: readonly ProcedureAttachment[];
  attachQueue: File[];
  onAttachQueue: (files: File[]) => void;
  onAction: (
    action: ProcedureApplyAction,
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
  // Hồ sơ thanh toán: "Người nhận" là ô chọn nhân sự, mặc định người tạo hồ sơ; STK, ngân hàng lấy theo hồ sơ nhân sự
  // của người được chọn (HRM che STK nếu người đang nhập không phải chính chủ và không có quyền xem dữ liệu nhạy cảm).
  // Phải đứng sau effect xoá nháp ở trên.
  const payee = usePayeePicker({ instance, draft: attributeDraft, setDraft: setAttributeDraft, members, actorId });
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

  const commentCopy = stepCommentPrompt(
    authorization?.currentRoleStage,
    myRoles,
    Boolean(authorization?.isOverride),
  );

  // Pure "I" (Informed) role check — read-only notice
  const isRoleI = myRoles.length === 1 && myRoles[0] === 'I' && actions.length === 0;

  const isActionBusy = (action: ProcedureApplyAction) =>
    busy === `${action}:${instance.id}` || isSubmitting;

  const saveDraft = onSaveAttributes
    ? () => void onSaveAttributes(attributeDraft).then(() => setAttributeDraft({}))
    : undefined;
  // Thêm tệp vào hàng chờ (tải lên khi bấm thao tác), dùng cho cả hai cách trình bày.
  const queueFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      onAttachQueue([...attachQueue, ...files]);
    }
    event.target.value = '';
  };
  const queuedChips =
    attachQueue.length > 0 ? (
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
    ) : null;

  // Giao diện mới: ô ý kiến một dòng, tự cao theo nội dung (tính cả viền để không hiện thanh cuộn thừa).
  const commentRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = commentRef.current;
    if (!concise || !field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, [comment, concise]);

  // Giao diện mới: dòng đầu duy nhất của khung "Việc cần làm".
  const running = instance.status === 'running';
  const stage = authorization?.currentRoleStage ?? current?.currentRoleStage ?? undefined;
  const myRole = stage && myRoles.includes(stage) ? stage : PERFORMER_ROLE_ORDER.find((role) => myRoles.includes(role));
  const waiting = concise && effectiveActions.length === 0 ? currentWaiting(instance, resolveSubject) : undefined;
  const taskHead =
    concise && running && current ? (
      <header className={caseStyles.taskHead} data-task-head="">
        <div className={caseStyles.taskTitle}>
          <h3 className={caseStyles.taskName} title={`Bước ${current.order} · ${current.name}`}>
            <span className={caseStyles.taskOrder}>Bước {current.order}</span>
            {current.name}
          </h3>
          {myRole ? (
            <span className={caseStyles.youChip} title={`Vai của bạn ở bước này: ${myRoles.map((role) => ROLE_HUMAN_LABEL[role]).join(', ')}`}>
              Bạn · {ROLE_HUMAN_LABEL[myRole]}
            </span>
          ) : authorization?.isOverride && effectiveActions.length > 0 ? (
            <span className={caseStyles.youChip}>Bạn · Xử lý thay</span>
          ) : null}
          {authorization?.isDelegated ? <span className={caseStyles.taskTag}>được uỷ quyền</span> : null}
          {authorization?.isEscalated ? <span className={caseStyles.taskTag}>xử lý thay cấp dưới</span> : null}
          {waiting ? (
            <span className={caseStyles.taskWaiting} title={`Đang chờ ${waiting.title}`}>
              Đang chờ <b>{waiting.text}</b>
            </span>
          ) : null}
        </div>
      </header>
    ) : null;

  // Giao diện mới, pha khởi tạo (S): không có ô ý kiến (người duyệt đọc các ô đã nhập; thao tác vẫn gửi ý kiến rỗng như
  // khi để trống ô). Nút "Đính kèm tệp" chuyển sang đầu trái hàng nút thao tác, cùng hàng chờ và cách tải lên như cũ.
  const hideComment = concise && stage === 'S';
  const attachControl = concise ? (
    <>
      <input ref={fileInputRef} type="file" multiple hidden onChange={queueFiles} />
      <button type="button" className={caseStyles.attachBtn} onClick={() => fileInputRef.current?.click()}>
        <Paperclip size={14} aria-hidden /> Đính kèm tệp
      </button>
    </>
  ) : null;

  // Ô ý kiến (dùng cho cả hai cách trình bày). Giao diện mới: một dòng, nhãn chỉ dành cho trình đọc màn hình.
  const commentField = (
    <label className={concise ? `${styles.commentField} ${caseStyles.taskComment}` : styles.commentField}>
      <span className={concise ? `${styles.commentLabel} ${caseStyles.srOnly}` : styles.commentLabel}>
        {concise ? 'Ý kiến / ghi chú' : commentCopy.label}
      </span>
      <textarea
        ref={commentRef}
        rows={concise ? 1 : 2}
        placeholder={concise ? 'Ý kiến / ghi chú…' : commentCopy.placeholder}
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
  );

  return (
    <div
      className={concise ? `${styles.actionPanel} ${caseStyles.taskPanel}` : styles.actionPanel}
      {...(concise ? { role: 'region', 'aria-label': 'Việc cần làm' } : {})}
    >
      {taskHead}
      {concise && running ? leading : null}
      {/* Role badges */}
      {!concise && (myRoles.length > 0 || authorization?.isDelegated || authorization?.isEscalated) ? (
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
      ) : isRoleI || !canAct ? (
        <>
          <p className={styles.panelHint}>
            {isRoleI ? 'Bạn giữ vai I ở bước này.' : 'Bạn không giữ vai ở bước này.'}
          </p>
          {/* Người vừa duyệt xong bước trước đã rời bước đó: vẫn rút lại được ngay tại đây khi bước này chưa ai xử lý. */}
          {authorization?.canWithdraw ? (
            <WithdrawCallout
              text={`Bạn còn hoàn duyệt được bước “${authorization.withdrawStepName ?? 'trước'}”.`}
              busy={Boolean(isActionBusy('withdraw'))}
              onWithdraw={() => onAction('withdraw')}
            />
          ) : null}
        </>
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
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--blue)', fontWeight: 600 }}>
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
            payee={payee}
            onSaveDraft={saveDraft}
            variant={concise ? 'modal' : 'default'}
          />

          {/* QT-U5: ô "trả lại về bước" + xác nhận nằm trong pop-up nền mờ (xem cuối panel). */}

          {!concise && current?.integration?.module === 'finance' && current.status === 'active' ? (
            <FinanceWaitingNote />
          ) : null}

          {/* Ý kiến và nút thao tác ghim ở đáy khung chi tiết: bước dài vẫn bấm được ngay. */}
          <div className={classNames?.dock ? `${styles.actionDock} ${classNames.dock}` : styles.actionDock}>
            {/* 2. Textarea (Adaptable by RACIE role) */}
            {/* 3. Đính kèm: giao diện mới là ô ý kiến một dòng + nút mở chọn tệp ngay bên phải, tệp đã chọn dạng chip bên
                dưới; giao diện cũ là ô ý kiến rồi khung thả tệp. */}
            {hideComment ? (
              queuedChips ? <div className={caseStyles.taskComposer}>{queuedChips}</div> : null
            ) : concise ? (
              <div className={caseStyles.taskComposer}>
                <div className={caseStyles.taskCommentRow} data-comment-row="">
                  {commentField}
                  {attachControl}
                </div>
                {queuedChips}
              </div>
            ) : (
            <>
            {commentField}
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
                    onChange={queueFiles}
                  />

                  {queuedChips}

                  <div className={styles.attachActionsRow}>
                    <button
                      type="button"
                      className={styles.primaryGhostBtn}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Chọn tệp từ máy tính
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            </>
            )}

            {/* Action buttons */}
            {effectiveActions.length === 0 ? (
              <>
                {/* Giao diện mới: dòng đầu khung đã ghi "Đang chờ <ai>". */}
                {concise ? null : (
                  <p className={styles.panelHint}>
                    Chưa tới lượt bạn: bước này đang ở pha {current?.currentRoleStage ?? '—'}.
                  </p>
                )}
                {/* Người vừa xử lý pha trước đó rút lại được ngay tại đây khi pha sau chưa ai làm. */}
                {authorization?.canWithdraw ? (
                  <div
                    className={classNames?.actionRow ? `${styles.actionRow} ${classNames.actionRow}` : styles.actionRow}
                    data-pinned-actions={classNames ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      className={styles.ghost}
                      disabled={isActionBusy('withdraw')}
                      onClick={() => onAction('withdraw')}
                    >
                      {isActionBusy('withdraw') ? 'Đang xử lý…' : 'Hoàn duyệt'}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div
                  className={classNames?.actionRow ? `${styles.actionRow} ${classNames.actionRow}` : styles.actionRow}
                  data-pinned-actions={classNames ? 'true' : undefined}
                >
                  {hideComment ? <span className={caseStyles.barAttach}>{attachControl}</span> : null}
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
                                    style={{ fontSize: '12px', padding: '3px 8px' }}
                                    onClick={() => setConfirmRejectOpen(false)}
                                  >
                                    Huỷ
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.danger}
                                    style={{ fontSize: '12px', padding: '3px 10px' }}
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
          Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng.
        </p>
      ) : step.materialReservations?.length ? (
        <p className={styles.materialHeld}>
          Đã giữ hàng trong kho cho bước này —{' '}
          {step.materialReservations.map((code) => (
            <code key={code} style={{ background: '#d1fae5', padding: '1px 5px', borderRadius: '4px', margin: '0 2px' }}>{code}</code>
          ))}
          .
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
          Kiểm lúc {formatSharedDateTime(check.checkedAt)}
        </small>
      ) : null}
    </article>
  );
}
