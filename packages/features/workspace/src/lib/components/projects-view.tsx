'use client';

import type {
  CalendarOccurrence,
  ChatEntityType,
  CreateEventRequest,
  CreateProjectRequest,
  CreateWorkItemRequest,
  DocumentFolder,
  DocumentSummary,
  ExternalReference,
  ProjectMember,
  ProjectSummary,
  RecurrenceScope,
  UpdateEventRequest,
  UpdateProjectRequest,
  UnreadSummary,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemDependency,
  WorkItemStatusHistoryEntry,
} from '@enterprise-platform/contracts-workspace';
import { CHAT_UNREAD_POLL_MS } from '@enterprise-platform/contracts-workspace';
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadInstance,
  loadStartableProcedures,
  startProcedureForWorkItem,
  PROCEDURE_LAUNCH_URL,
  type ProcedureInstanceView,
  type ProcedureOption,
} from '../procedure-api';
import { buildWorkItemTree } from '../project-tree.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { CancelProjectDialog } from './cancel-project-dialog';
import { ChatDrawer } from './chat-drawer';
import { DocumentPanel } from './document-panel';
import { EventForm } from './event-form';
import { GanttChart } from './gantt-chart';
import { MembersDialog } from './members-dialog';
import { MoveDialog } from './move-dialog';
import { ProcedureRetryDialog } from './procedure-retry-dialog';
import { ProjectForm } from './project-form';
import { ProjectTree, type ContextAction, type SelectedNode } from './project-tree';
import { ProjectDashboard } from './project-dashboard';
import { TabActivity } from './tab-activity';
import { TabCalendar } from './tab-calendar';
import { TabFinance } from './tab-finance';
import { TabKanban } from './tab-kanban';
import { TabOverview } from './tab-overview';
import { TabWorkItems } from './tab-work-items';
import { useDirectory } from './use-directory';
import { WorkItemForm, type WorkItemCostInput } from './work-item-form';

type TabId =
  | 'overview'
  | 'work-items'
  | 'kanban'
  | 'gantt'
  | 'calendar'
  | 'documents'
  | 'finance'
  | 'activity';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'work-items', label: 'Công việc' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'calendar', label: 'Lịch biểu' },
  { id: 'documents', label: 'Tài liệu' },
  { id: 'finance', label: 'Tài chính' },
  { id: 'activity', label: 'Hoạt động' },
];

/** Chi tiết của dự án đang mở; gom lại để một lần tải nạp đủ mọi tab. */
interface ProjectDetail {
  readonly project: ProjectSummary;
  readonly items: readonly WorkItem[];
  readonly members: readonly ProjectMember[];
  readonly activity: readonly WorkItemStatusHistoryEntry[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly externalRefs: readonly ExternalReference[];
  /** Không đọc được module gốc; nhãn đang hiện là bản cache có thể cũ. */
  readonly externalDegraded: boolean;
}

export interface ProjectsViewProps {
  /**
   * Rail của shell đang thu.
   *
   * Thu rail là để nhường chỗ cho khung trao đổi, nên khi đó chat mở sẵn; rail
   * mở lại thì chat đóng để nội dung có đủ bề ngang.
   */
  readonly railCollapsed?: boolean;
  /** Được xoá tài liệu và thư mục; mặc định tắt, chỉ quản trị tenant có. */
  readonly canDelete?: boolean;
}

export function ProjectsView({ railCollapsed = false, canDelete = false }: ProjectsViewProps = {}) {
  const directory = useDirectory();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  /** Từ khoá dùng chung: lọc danh mục dự án và cây công việc của dự án đang mở. */
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string>();
  const [detail, setDetail] = useState<ProjectDetail>();
  const [selected, setSelected] = useState<SelectedNode>({ kind: 'project' });
  const [tab, setTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const [projectForm, setProjectForm] = useState<{ open: boolean; edit?: ProjectSummary }>({
    open: false,
  });
  const [itemForm, setItemForm] = useState<{
    open: boolean;
    edit?: WorkItem;
    parent?: WorkItem;
  }>({ open: false });
  const [eventForm, setEventForm] = useState<{
    open: boolean;
    occurrence?: CalendarOccurrence;
    date?: string;
  }>({ open: false });
  // Lưới lịch tự tải theo khoảng đang xem, nên nó cần một tín hiệu riêng để
  // tải lại sau khi ghi; `refreshDetail` không chạm tới nó.
  const [calendarToken, setCalendarToken] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  /** Màn hình tổng quan toàn hệ thống, mở từ đầu danh mục dự án. */
  const [dashboard, setDashboard] = useState(false);
  const [unread, setUnread] = useState<UnreadSummary>();
  const [me, setMe] = useState('');
  const [projectDocuments, setProjectDocuments] = useState<readonly DocumentSummary[]>([]);
  /** Thư mục tài liệu của dự án, để khung trao đổi tải tệp mới lên được. */
  const [projectFolders, setProjectFolders] = useState<readonly DocumentFolder[]>([]);
  // Quy trình người dùng đã chọn cho từng công việc, giữ trong phiên để Thử
  // lại chỉ cần một cú bấm. CSDL không lưu lựa chọn này: công việc chưa có
  // con trỏ thì chưa có gì trỏ tới quy trình nào.
  const [procedureChoice, setProcedureChoice] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [startableProcedures, setStartableProcedures] = useState<readonly ProcedureOption[]>([]);
  /** Hồ sơ quy trình của công việc đang chọn, đã đọc tiến độ từ module Quy trình. */
  const [procedureView, setProcedureView] = useState<ProcedureInstanceView>();
  const [retryFor, setRetryFor] = useState<WorkItem>();
  const [cancelling, setCancelling] = useState<ProjectSummary>();
  const [membersOpen, setMembersOpen] = useState(false);
  const [moving, setMoving] = useState<WorkItem>();

  const message = (cause: unknown, fallback: string) =>
    (cause as { message?: string })?.message ?? fallback;

  const refreshList = useCallback(async () => {
    try {
      const page = await api.listProjects({ pageSize: 60 });
      setProjects(page.items);
      setError(undefined);
      // Mở sẵn dự án đầu tiên: màn hình trống không nói được điều gì hữu ích.
      setOpenId((current) => current ?? page.items[0]?.id);
    } catch (cause) {
      setError(message(cause, 'Không tải được danh sách dự án.'));
    }
  }, []);

  const refreshDetail = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const [project, tree, members, activity, dependencies, external] = await Promise.all([
        api.getProject(projectId),
        api.listWorkItems(projectId),
        api.listMembers(projectId),
        api.listProjectActivity(projectId),
        api.listProjectDependencies(projectId),
        // Con trỏ sang module khác là phụ trợ: hỏng thì coi như rỗng và
        // đánh dấu degraded, không được kéo đổ cả màn Dự án.
        api
          .listProjectExternalReferences(projectId)
          .catch(() => ({ items: [] as ExternalReference[], degraded: true })),
      ]);
      setDetail({
        project,
        items: tree.items,
        members: members.items,
        activity: activity.items,
        dependencies: dependencies.items,
        externalRefs: external.items,
        externalDegraded: external.degraded,
      });
      setError(undefined);
    } catch (cause) {
      setDetail(undefined);
      setError(message(cause, 'Không tải được dữ liệu dự án.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUnread = useCallback(async (projectId: string) => {
    try {
      setUnread(await api.loadUnread(projectId));
    } catch {
      // Chấm đỏ là phụ trợ: hỏng thì bỏ qua, không phá cả màn hình.
      setUnread(undefined);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    void api.loadCurrentUserId().then(setMe);
  }, [refreshList]);

  useEffect(() => {
    if (!openId) return;
    setSelected({ kind: 'project' });
    // Khung trao đổi bám theo rail chứ không tự đóng khi đổi dự án.
    setChatOpen(railCollapsed);
    void refreshDetail(openId);
  }, [openId, refreshDetail, railCollapsed]);

  // Danh sách tài liệu của dự án, để Drawer chat đính kèm được. Chỉ CHỌN từ
  // những gì đã có trong dự án — không tải tệp mới lên từ khung chat.
  useEffect(() => {
    if (!openId) {
      setProjectDocuments([]);
      return;
    }
    api
      .listDocuments({ projectId: openId })
      .then((response) => setProjectDocuments(response.items))
      .catch(() => setProjectDocuments([]));
    api
      .listFolders(openId)
      .then((response) => setProjectFolders(response.items.filter((folder) => folder.isActive)))
      .catch(() => setProjectFolders([]));
  }, [openId, calendarToken]);

  // Không có WebSocket trong repo, nên chấm đỏ cập nhật theo nhịp hỏi lại.
  // 30 giây là đủ nhanh để không ai bỏ lỡ, và đủ thưa để không dồn tải.
  useEffect(() => {
    if (!openId) return;
    void refreshUnread(openId);
    const timer = setInterval(() => void refreshUnread(openId), CHAT_UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [openId, refreshUnread]);

  /**
   * Quy trình người dùng khởi tạo được, lọc theo vai S.
   *
   * Nạp một lần cho cả trang: danh sách này đổi rất chậm và không phụ thuộc
   * công việc đang chọn.
   */
  useEffect(() => {
    if (!me || !directory.loaded) return;
    const nodes = directory.find(me)?.orgNodeIds ?? [];
    void loadStartableProcedures(me, nodes).then(setStartableProcedures);
  }, [me, directory]);

  const selectedItem = useMemo(
    () =>
      selected.kind === 'work-item'
        ? detail?.items.find((item) => item.id === selected.id)
        : undefined,
    [selected, detail],
  );

  /** Con trỏ sang hồ sơ quy trình của công việc đang chọn, nếu có. */
  const procedureRef = useMemo(
    () =>
      selectedItem
        ? (detail?.externalRefs ?? []).find(
            (ref) =>
              ref.moduleKey === 'procedure-engine' &&
              ref.entityType === 'work_item' &&
              ref.entityId === selectedItem.id,
          )
        : undefined,
    [detail, selectedItem],
  );


  /**
   * Danh mục sau khi lọc theo từ khoá.
   *
   * Dự án đang mở luôn được giữ lại dù tên nó không khớp: người dùng gõ mã một
   * công việc thì phải thấy công việc đó trong cây, chứ không phải mất luôn cả
   * dự án đang xem.
   */
  const catalogProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter(
      (project) =>
        project.id === openId ||
        project.code.toLowerCase().includes(term) ||
        project.name.toLowerCase().includes(term),
    );
  }, [projects, search, openId]);


  /**
   * Công việc chạy theo quy trình mà CHƯA có con trỏ sang Quy trình.
   *
   * Đó là dấu vết của bước 4 hoặc 5 thất bại: công việc đã tạo, hồ sơ quy
   * trình thì chưa. Cây hiện badge "Chưa mở được quy trình" cho đúng những
   * việc này, kèm lệnh Thử lại trên menu chuột phải.
   */
  const pendingProcedure = useMemo(() => {
    const linked = new Set(
      (detail?.externalRefs ?? [])
        .filter((ref) => ref.moduleKey === 'procedure-engine')
        .map((ref) => ref.entityId),
    );
    return new Set(
      (detail?.items ?? [])
        .filter(
          (item) =>
            item.executionType === 'procedure' &&
            item.status !== 'cancelled' &&
            !linked.has(item.id),
        )
        .map((item) => item.id),
    );
  }, [detail]);

  /**
   * Bước 4 và 5, dùng chung cho lần tạo đầu và cho Thử lại.
   *
   * Khoá chống trùng suy từ id công việc, nên chạy lại bao nhiêu lần cũng chỉ
   * ra một hồ sơ bên Quy trình.
   */
  const startProcedure = async (item: WorkItem, definitionId: string) => {
    setProcedureChoice((current) => new Map(current).set(item.id, definitionId));
    try {
      await startProcedureForWorkItem({
        workItemId: item.id,
        definitionId,
        title: `${item.code} · ${item.title}`,
      });
      setProcedureChoice((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
    } catch (cause) {
      setError(
        `Đã tạo ${item.code} nhưng chưa mở được quy trình: ${message(cause, 'lỗi không rõ')}. ` +
          'Bấm chuột phải vào công việc và chọn "Thử mở lại quy trình".',
      );
    } finally {
      if (openId) await refreshDetail(openId);
    }
  };


  /**
   * Tab Tài chính chỉ có mặt khi server đã gửi số liệu xuống.
   *
   * Dựa vào sự có mặt của `project.finance` thay vì tự suy từ vai trò: server
   * là nơi quyết định, và với `member` hay `viewer` trường đó vắng hẳn khỏi
   * payload. Tab bị gỡ khỏi thanh — không làm mờ, không để một tab trống.
   */
  const visibleTabs = useMemo(
    () => TABS.filter((entry) => entry.id !== 'finance' || Boolean(detail?.project.finance)),
    [detail],
  );

  // Đang đứng ở tab Tài chính mà chuyển sang dự án không được xem tài chính
  // thì lùi về Tổng quan, thay vì để một vùng nội dung trống.
  useEffect(() => {
    if (tab === 'finance' && detail && !detail.project.finance) setTab('overview');
  }, [tab, detail]);

  // Gantt cần đúng thứ tự và độ sâu của cây bên trái, không phải thứ tự trả
  // về từ server. Dựng lại bằng chính hàm cây dùng cho cột trái.
  const ganttRows = useMemo(
    () =>
      buildWorkItemTree(
        detail?.items ?? [],
        new Set((detail?.items ?? []).map((item) => item.id)),
      ).map((row) => ({ item: row.item, depth: row.depth })),
    [detail],
  );

  // Node đang chọn có thể biến mất sau khi tải lại (bị xoá, hoặc bộ lọc đổi).
  // Không lùi về gốc thì các tab sẽ hiển thị dữ liệu của một node không còn.
  useEffect(() => {
    if (selected.kind === 'work-item' && detail && !selectedItem) {
      setSelected({ kind: 'project' });
    }
  }, [selected, detail, selectedItem]);

  // `myRole` rỗng chỉ xảy ra với quản trị viên tenant: người không phải thành
  // viên và không phải quản trị đã nhận 403 ngay ở lời gọi chi tiết.
  const role = detail?.project.myRole;
  const canWrite = role === 'owner' || role === 'manager' || role === 'member' || !role;
  const canManage = role === 'owner' || role === 'manager' || !role;

  /**
   * Kéo tiến độ của hồ sơ quy trình về công việc, mỗi lần mở công việc đó.
   *
   * Module Quy trình không bắn sự kiện sang đây, nên Workspace phải tự hỏi —
   * bằng **chính phiên của người đang xem**, đúng như mọi lời gọi liên module
   * khác trong mã nguồn này. Ghi đè chỉ áp cho **việc lá**: việc có con lấy
   * tiến độ bằng cách cuộn từ con lên, hai nguồn ghi vào một chỗ sẽ đá nhau.
   */
  useEffect(() => {
    if (!selectedItem || !procedureRef) {
      setProcedureView(undefined);
      return;
    }
    let alive = true;
    void loadInstance(procedureRef.externalId).then(async (instance) => {
      if (!alive || !instance) return;
      setProcedureView(instance);
      const hasChildren = (detail?.items ?? []).some((item) => item.parentId === selectedItem.id);
      if (hasChildren || !canWrite) return;
      if (instance.progressPercent === selectedItem.progressPercent) return;
      try {
        await api.updateWorkItem(selectedItem.id, {
          progressPercent: instance.progressPercent,
        });
        if (openId) await refreshDetail(openId);
      } catch {
        // Không ghi được thì thôi: số của hồ sơ vẫn hiện ngay cạnh nút Quy
        // trình, người dùng không mất thông tin.
      }
    });
    return () => {
      alive = false;
    };
  }, [selectedItem, procedureRef, detail, canWrite, openId, refreshDetail]);
  const canOwn = role === 'owner' || !role;

  /** Tin chưa đọc của node đang chọn, để đánh số lên nút Trao đổi. */
  const nodeUnread =
    selected.kind === 'project'
      ? (unread?.total ?? 0)
      : (unread?.rolledUp[selected.id] ?? 0);

  // Thu rail là để lấy chỗ cho khung trao đổi, nên hai thứ đi cùng nhau.
  useEffect(() => {
    setChatOpen(railCollapsed);
  }, [railCollapsed]);

  /* --------------------------------------------------- Menu chuột phải */

  const actionsFor = (node: SelectedNode): ContextAction[] => {
    if (node.kind === 'project') {
      return [
        { id: 'add-root-item', label: 'Thêm công việc cấp gốc', disabled: !canWrite },
        { id: 'edit-project', label: 'Sửa thông tin dự án', disabled: !canManage },
        { id: 'open-chat', label: 'Mở trao đổi', separatorBefore: true },
        { id: 'refresh', label: 'Tải lại' },
        {
          id: 'cancel-project',
          label: 'Huỷ dự án',
          danger: true,
          disabled: !canOwn,
          separatorBefore: true,
        },
      ];
    }

    const item = detail?.items.find((candidate) => candidate.id === node.id);
    const atMaxDepth = (item?.depth ?? 0) >= 9;
    return [
      {
        id: 'add-child',
        label: 'Thêm công việc con',
        // Cây tối đa 10 cấp; cấp 9 là sâu nhất nên không còn chỗ cho con.
        disabled: !canWrite || atMaxDepth,
      },
      { id: 'add-sibling', label: 'Thêm công việc ngang cấp', disabled: !canWrite },
      { id: 'edit-item', label: 'Sửa công việc', disabled: !canWrite, separatorBefore: true },
      { id: 'start', label: 'Bắt đầu làm', disabled: !canWrite || item?.status !== 'todo' },
      {
        id: 'complete',
        label: 'Đánh dấu hoàn thành',
        disabled: !canWrite || (item?.status !== 'in_progress' && item?.status !== 'review'),
      },
      { id: 'move-to', label: 'Chuyển sang nhóm khác…', disabled: !canManage },
      { id: 'move-to-root', label: 'Đưa lên cấp gốc', disabled: !canManage || !item?.parentId },
      ...(item && pendingProcedure.has(item.id)
        ? [
            {
              id: 'retry-procedure',
              label: 'Thử mở lại quy trình',
              disabled: !canWrite,
              separatorBefore: true,
            },
          ]
        : []),
      { id: 'open-chat', label: 'Mở trao đổi', separatorBefore: true },
      { id: 'refresh', label: 'Tải lại' },
      {
        id: 'cancel-item',
        label: 'Huỷ công việc',
        danger: true,
        disabled: !canWrite || item?.status === 'cancelled',
        separatorBefore: true,
      },
    ];
  };

  const run = async (operation: () => Promise<unknown>, fallback: string) => {
    try {
      await operation();
      if (openId) await refreshDetail(openId);
      await refreshList();
      setError(undefined);
    } catch (cause) {
      setError(message(cause, fallback));
    }
  };

  const onAction = (actionId: string, node: SelectedNode) => {
    const item =
      node.kind === 'work-item'
        ? detail?.items.find((candidate) => candidate.id === node.id)
        : undefined;

    switch (actionId) {
      case 'refresh':
        if (openId) void refreshDetail(openId);
        return;
      case 'open-chat':
        setChatOpen(true);
        return;
      case 'retry-procedure': {
        if (!item) return;
        // Còn nhớ quy trình đã chọn trong phiên thì thử lại ngay; không thì
        // hỏi lại người dùng — CSDL không lưu lựa chọn này.
        const remembered = procedureChoice.get(item.id);
        if (remembered) void startProcedure(item, remembered);
        else setRetryFor(item);
        return;
      }
      case 'add-root-item':
        setItemForm({ open: true });
        return;
      case 'add-child':
        setItemForm({ open: true, parent: item });
        return;
      case 'add-sibling':
        setItemForm({
          open: true,
          parent: item?.parentId
            ? detail?.items.find((candidate) => candidate.id === item.parentId)
            : undefined,
        });
        return;
      case 'edit-project':
        setProjectForm({ open: true, edit: detail?.project });
        return;
      case 'edit-item':
        setItemForm({ open: true, edit: item });
        return;
      case 'start':
        if (item) void run(() => api.changeWorkItemStatus(item.id, { status: 'in_progress' }), 'Không đổi được trạng thái.');
        return;
      case 'complete':
        if (item) void run(() => api.changeWorkItemStatus(item.id, { status: 'done' }), 'Không đổi được trạng thái.');
        return;
      case 'cancel-item':
        if (item) void run(() => api.changeWorkItemStatus(item.id, { status: 'cancelled' }), 'Không huỷ được công việc.');
        return;
      case 'move-to':
        if (item) setMoving(item);
        return;
      case 'move-to-root':
        if (item) void run(() => api.moveWorkItem(item.id, { parentId: null }), 'Không di chuyển được công việc.');
        return;
      case 'cancel-project':
        // Hỏi lại bằng mã dự án trước khi huỷ — xem CancelProjectDialog.
        if (detail) setCancelling(detail.project);
        return;
      default:
        return;
    }
  };

  /* ------------------------------------------------------------ Render */

  return (
    <div className={styles.workspacePage}>
      {/*
        Thanh công cụ của trang: một ô tìm dùng chung cho cả danh mục dự án lẫn
        cây công việc, và lối tạo dự án mới thấy được ngay chứ không nấp trong
        một nút biểu tượng.
      */}
      <div className={styles.pageToolbar}>
        <label className={styles.toolbarSearch}>
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={search}
            placeholder="Tìm kiếm dự án, công việc"
            aria-label="Tìm kiếm dự án, công việc"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.buttonPrimary}
          onClick={() => setProjectForm({ open: true })}
        >
          <Plus size={15} /> Tạo dự án mới
        </button>
      </div>

      <div className={styles.workspaceLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <span className={styles.sidebarHeadTitle}>Danh mục dự án</span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Mở trao đổi"
            title="Trao đổi về mục đang chọn"
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare size={15} />
            {unread && unread.total > 0 ? <span className={styles.iconBadge} /> : null}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Tải lại"
            title="Tải lại"
            onClick={() => openId && void refreshDetail(openId)}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Dự án mới"
            title="Dự án mới"
            onClick={() => setProjectForm({ open: true })}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Tổng quan toàn phạm vi; khác trang Báo cáo ở chỗ chỉ xem nhanh. */}
        <button
          type="button"
          className={dashboard ? styles.catalogDashboardOn : styles.catalogDashboard}
          aria-current={dashboard ? 'page' : undefined}
          onClick={() => setDashboard(true)}
        >
          <LayoutGrid size={15} /> Tổng quan Dashboard
        </button>

        {/*
          Danh mục liệt kê **mọi** dự án trong phạm vi, dự án đang mở thì bung
          ra thành cây công việc. Trước đây chỗ này là một ô chọn: muốn biết có
          những dự án nào phải bấm mở ô ra xem, và không thấy được tiến độ hay
          tin chưa đọc của dự án khác.
        */}
        <div className={styles.catalogList}>
          {catalogProjects.length === 0 ? (
            <p className={styles.treeEmpty}>
              {loading
                ? 'Đang tải danh mục dự án…'
                : search.trim()
                  ? 'Không có dự án nào khớp từ khoá.'
                  : 'Chưa có dự án nào.'}
            </p>
          ) : null}

          {catalogProjects.map((project) => {
            const open = project.id === openId;
            return (
              <div key={project.id} className={styles.catalogItem}>
                <div className={styles.treeRow}>
                  <button
                    type="button"
                    className={styles.treeToggle}
                    aria-label={open ? 'Thu gọn dự án' : 'Mở dự án'}
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? undefined : project.id)}
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button
                    type="button"
                    className={
                      open && !dashboard && selected.kind === 'project'
                        ? styles.treeNodeActive
                        : styles.treeNode
                    }
                    title={`${project.code} · ${project.name}`}
                    data-project={project.id}
                    onClick={() => {
                      setDashboard(false);
                      setOpenId(project.id);
                      setSelected({ kind: 'project' });
                    }}
                  >
                    <Briefcase size={14} aria-hidden />
                    <span className={styles.treeCode}>{project.code}</span>
                    <span className={styles.treeTitle}>{project.name}</span>
                    {open && unread && unread.rolledUp[project.id] ? (
                      <span
                        className={styles.treeUnread}
                        title={`${unread.rolledUp[project.id]} tin chưa đọc`}
                      >
                        {unread.rolledUp[project.id]}
                      </span>
                    ) : null}
                    <span className={styles.treePercent}>{project.progressPercent}%</span>
                  </button>
                </div>

                {open && detail ? (
                  <ProjectTree
                    project={detail.project}
                    items={detail.items}
                    selected={selected}
                    onSelect={(node) => {
                      setDashboard(false);
                      setSelected(node);
                    }}
                    actionsFor={actionsFor}
                    onAction={onAction}
                    unread={unread?.rolledUp}
                    pendingProcedure={pendingProcedure}
                    embedded
                    searchTerm={search}
                  />
                ) : null}
                {open && !detail ? (
                  <p className={styles.treeEmpty}>
                    {loading ? 'Đang tải cây công việc…' : 'Không đọc được cây công việc.'}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Mở khung trao đổi thì cột này hẹp đi: tab bó lại cho đủ chỗ. */}
      <section className={chatOpen ? `${styles.content} ${styles.contentNarrow}` : styles.content}>
        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}

        {dashboard ? (
          <ProjectDashboard
            onOpenProject={(projectId) => {
              setDashboard(false);
              setOpenId(projectId);
              setSelected({ kind: 'project' });
            }}
          />
        ) : detail ? (
          <>
            <nav className={styles.breadcrumb} aria-label="Đường dẫn node">
              {breadcrumbOf(detail, selectedItem).map((crumb, index, all) => (
                <span key={`${index}-${crumb}`}>
                  {crumb}
                  {index < all.length - 1 ? <span aria-hidden> / </span> : null}
                </span>
              ))}
            </nav>

            <div className={styles.tabRow}>
              <div className={styles.tabBar} role="tablist">
                {visibleTabs.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.id}
                    className={tab === entry.id ? styles.tabActive : styles.tab}
                    onClick={() => setTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={chatOpen ? styles.chatToggleOn : styles.chatToggle}
                aria-pressed={chatOpen}
                aria-label={chatOpen ? 'Đóng khung trao đổi' : 'Mở khung trao đổi'}
                title={chatOpen ? 'Đóng khung trao đổi' : 'Mở khung trao đổi'}
                onClick={() => setChatOpen((current) => !current)}
              >
                <MessageSquare size={17} />
                {!chatOpen && nodeUnread > 0 ? (
                  <span className={styles.chatToggleBadge}>{nodeUnread}</span>
                ) : null}
              </button>
            </div>

            {tab === 'overview' ? (
              <TabOverview
                project={detail.project}
                items={detail.items}
                members={detail.members}
                selected={selectedItem}
                externalRefs={detail.externalRefs}
                externalDegraded={detail.externalDegraded}
                procedurePending={selectedItem ? pendingProcedure.has(selectedItem.id) : false}
                canWrite={canWrite}
                canEdit={selectedItem ? canWrite : canManage}
                onEdit={() => onAction(selectedItem ? 'edit-item' : 'edit-project', selected)}
                onAddChild={() =>
                  onAction(selectedItem ? 'add-child' : 'add-root-item', selected)
                }
                startableProcedures={startableProcedures}
                procedureLink={
                  procedureRef
                    ? {
                        code: procedureRef.externalCode ?? procedureView?.code ?? '',
                        launchUrl: procedureRef.launchUrl ?? PROCEDURE_LAUNCH_URL,
                        status: procedureView?.status,
                        progressPercent: procedureView?.progressPercent,
                        doneSteps: procedureView?.doneSteps,
                        totalSteps: procedureView?.totalSteps,
                      }
                    : undefined
                }
                onStartProcedure={
                  selectedItem
                    ? async (definitionId) => {
                        await startProcedure(selectedItem, definitionId);
                      }
                    : undefined
                }
                canManageMembers={canManage}
                onManageMembers={() => setMembersOpen(true)}
                dependencies={detail.dependencies}
                canEditDependencies={canManage}
                // Ném lỗi ra để khung Phụ thuộc tự hiện ngay dưới hàng nhập.
                onAddDependency={async (successorId, input) => {
                  await api.addDependency(successorId, input);
                  await refreshDetail(detail.project.id);
                }}
                onRemoveDependency={async (successorId, dependencyId) => {
                  await api.removeDependency(successorId, dependencyId);
                  await refreshDetail(detail.project.id);
                }}
                canUnlinkRefs={canWrite}
                onUnlinkRef={(workItemId, referenceId) =>
                  run(() => api.unlinkWorkItem(workItemId, referenceId), 'Không gỡ được liên kết.')
                }
              />
            ) : null}
            {tab === 'work-items' ? (
              <TabWorkItems
                items={detail.items}
                selected={selectedItem}
                canWrite={canWrite}
                onOpen={(item) => {
                  setSelected({ kind: 'work-item', id: item.id });
                  setTab('overview');
                }}
                onChangeStatus={(item, next) =>
                  void run(
                    () => api.changeWorkItemStatus(item.id, { status: next }),
                    'Không đổi được trạng thái.',
                  )
                }
              />
            ) : null}
            {tab === 'kanban' ? (
              <TabKanban
                items={detail.items}
                selected={selectedItem}
                canWrite={canWrite}
                onOpen={(item) => {
                  setSelected({ kind: 'work-item', id: item.id });
                  setTab('overview');
                }}
                onChangeStatus={async (item, next) => {
                  await api.changeWorkItemStatus(item.id, { status: next });
                  await refreshDetail(detail.project.id);
                }}
              />
            ) : null}
            {tab === 'gantt' ? (
              <GanttChart
                rows={ganttRows}
                dependencies={detail.dependencies}
                onOpen={(item) => {
                  setSelected({ kind: 'work-item', id: item.id });
                  setTab('overview');
                }}
              />
            ) : null}
            {tab === 'calendar' ? (
              <TabCalendar
                projectId={detail.project.id}
                items={detail.items}
                canWrite={canWrite}
                reloadToken={calendarToken}
                onCreate={(date) => setEventForm({ open: true, date })}
                onOpenEvent={(occurrence) => setEventForm({ open: true, occurrence })}
                onOpenWorkItem={(workItemId) => {
                  setSelected({ kind: 'work-item', id: workItemId });
                  setTab('overview');
                }}
              />
            ) : null}
            {tab === 'documents' ? (
              <DocumentPanel
                projectId={detail.project.id}
                // Chọn một công việc thì chỉ hiện tài liệu đã gắn vào nó;
                // chọn dự án thì hiện toàn bộ tài liệu của dự án.
                linkedTo={
                  selectedItem
                    ? { entityType: 'work_item', entityId: selectedItem.id }
                    : undefined
                }
                canWrite={canWrite}
                canDelete={canDelete}
                currentUserId={me}
                compact
                workItems={detail.items}
              />
            ) : null}
            {tab === 'finance' && detail.project.finance ? (
              <TabFinance
                projectId={detail.project.id}
                initial={detail.project.finance}
                onChanged={() => void refreshDetail(detail.project.id)}
              />
            ) : null}
            {tab === 'activity' ? (
              <TabActivity
                entries={detail.activity}
                items={detail.items}
                selected={selectedItem}
              />
            ) : null}
          </>
        ) : null}
      </section>

      {/* Khung trao đổi nằm trong bố cục, cạnh nội dung — không che mất nó. */}
      <ChatDrawer
        variant="pane"
        open={chatOpen && Boolean(detail)}
        entityType={(selected.kind === 'project' ? 'project' : 'work_item') as ChatEntityType}
        entityId={selected.kind === 'project' ? (detail?.project.id ?? '') : selected.id}
        title={
          selectedItem
            ? `${selectedItem.code} · ${selectedItem.title}`
            : detail
              ? `${detail.project.code} · ${detail.project.name}`
              : ''
        }
        members={detail?.members ?? []}
        canWrite={canWrite}
        canModerate={canManage}
        documents={projectDocuments}
        folders={projectFolders}
        projectId={openId}
        onDocumentUploaded={() => setCalendarToken((token) => token + 1)}
        currentUserId={me}
        onClose={() => setChatOpen(false)}
        onChanged={() => openId && void refreshUnread(openId)}
      />

      <ProjectForm
        open={projectForm.open}
        project={projectForm.edit}
        onClose={() => setProjectForm({ open: false })}
        // Người tạo tự thành chủ nhiệm, nên luôn được đặt giá trị hợp đồng.
        financeEnabled={projectForm.edit ? Boolean(detail?.project.finance) : true}
        onCreate={async (input: CreateProjectRequest, contractValue) => {
          const created = await api.createProject(input);
          // Số tiền đi đường riêng: endpoint tài chính có hàng rào quyền khác.
          if (contractValue !== undefined) {
            await api.updateProjectFinance(created.id, { contractValue });
          }
          await refreshList();
          setOpenId(created.id);
        }}
        onUpdate={async (input: UpdateProjectRequest, contractValue) => {
          if (!detail) return;
          await api.updateProject(detail.project.id, input);
          if (contractValue !== undefined) {
            await api.updateProjectFinance(detail.project.id, { contractValue });
          }
          await refreshDetail(detail.project.id);
          await refreshList();
        }}
      />

      <WorkItemForm
        open={itemForm.open}
        item={itemForm.edit}
        parent={itemForm.parent}
        members={detail?.members ?? []}
        currentUserId={me}
        canAssignOthers={canManage}
        // Có `project.finance` nghĩa là server đã xác nhận người dùng được
        // xem tài chính; không có thì hai ô chi phí không được dựng.
        financeEnabled={Boolean(detail?.project.finance)}
        initialCost={
          itemForm.edit
            ? detail?.project.finance?.items.find(
                (entry) => entry.workItemId === itemForm.edit?.id,
              )
            : undefined
        }
        onClose={() => setItemForm({ open: false })}
        onCreate={async (
          input: Omit<CreateWorkItemRequest, 'projectId'>,
          procedureDefinitionId?: string,
          costs?: WorkItemCostInput,
        ) => {
          if (!detail) return;
          // Bước 3: tạo công việc. Hỏng ở đây thì form giữ nguyên và báo lỗi.
          const created = await api.createWorkItem({ ...input, projectId: detail.project.id });
          // Chi phí đi qua endpoint riêng, không chung payload với công việc.
          if (costs) await api.updateWorkItemCost(created.id, costs);
          if (procedureDefinitionId) {
            // Bước 4 và 5 chạy SAU khi form đã đóng: công việc đã tồn tại, nên
            // thất bại ở đây không được giữ người dùng lại trong form — nó
            // thành badge trên cây kèm lệnh Thử lại.
            void startProcedure(created, procedureDefinitionId);
          } else {
            await refreshDetail(detail.project.id);
          }
        }}
        onUpdate={async (input: UpdateWorkItemRequest, costs?: WorkItemCostInput) => {
          if (!itemForm.edit || !detail) return;
          await api.updateWorkItem(itemForm.edit.id, input);
          if (costs) await api.updateWorkItemCost(itemForm.edit.id, costs);
          await refreshDetail(detail.project.id);
        }}
      />

      <EventForm
        open={eventForm.open}
        occurrence={eventForm.occurrence}
        defaultDate={eventForm.date}
        currentUserId={me}
        // `myRole` rỗng chỉ xảy ra với quản trị viên tenant — xem `role` ở trên.
        isTenantAdmin={Boolean(detail) && !detail?.project.myRole}
        loadDetail={api.getEvent}
        onClose={() => setEventForm({ open: false })}
        onRespond={async (response) => {
          if (!eventForm.occurrence) return;
          await api.respondToEvent(eventForm.occurrence.eventId, { responseStatus: response });
          setCalendarToken((current) => current + 1);
        }}
        onCreate={async (input: Omit<CreateEventRequest, 'projectId'>) => {
          if (!detail) return [];
          const result = await api.createEvent({ ...input, projectId: detail.project.id });
          setCalendarToken((current) => current + 1);
          return [...result.warnings];
        }}
        onUpdate={async (input: UpdateEventRequest) => {
          if (!eventForm.occurrence) return [];
          const result = await api.updateEvent(eventForm.occurrence.eventId, input);
          setCalendarToken((current) => current + 1);
          return [...result.warnings];
        }}
        onCancelEvent={async (scope: RecurrenceScope, occurrenceDate?: string) => {
          if (!eventForm.occurrence) return;
          await api.cancelEvent(eventForm.occurrence.eventId, scope, occurrenceDate);
          setCalendarToken((current) => current + 1);
        }}
      />

      <MoveDialog
        item={moving}
        items={detail?.items ?? []}
        onClose={() => setMoving(undefined)}
        onMove={async (parentId) => {
          if (!moving) return;
          // Lỗi ném ra để hộp thoại tự hiện.
          await api.moveWorkItem(moving.id, { parentId });
          if (openId) await refreshDetail(openId);
        }}
      />

      <MembersDialog
        open={membersOpen && Boolean(detail)}
        members={detail?.members ?? []}
        canTransferOwner={canOwn}
        onClose={() => setMembersOpen(false)}
        onSave={async (members) => {
          if (!detail) return;
          await api.setMembers(detail.project.id, { members });
          await refreshDetail(detail.project.id);
        }}
      />

      <CancelProjectDialog
        project={cancelling}
        onClose={() => setCancelling(undefined)}
        onConfirm={async (project) => {
          setCancelling(undefined);
          await run(() => api.cancelProject(project.id), 'Không huỷ được dự án.');
        }}
      />

      <ProcedureRetryDialog
        item={retryFor}
        onClose={() => setRetryFor(undefined)}
        onPick={async (definitionId) => {
          if (!retryFor) return;
          const target = retryFor;
          setRetryFor(undefined);
          await startProcedure(target, definitionId);
        }}
      />
      </div>
    </div>
  );
}

/** `Dự án / Nhà máy ABC / Hợp đồng / Soạn hợp đồng` */
function breadcrumbOf(detail: ProjectDetail, selected?: WorkItem): string[] {
  // Mã đứng trước tên ở mọi nơi, để đọc breadcrumb là biết đang ở node nào.
  const crumbs = [`${detail.project.code} · ${detail.project.name}`];
  if (!selected) return crumbs;

  const byId = new Map(detail.items.map((item) => [item.id, item]));
  const chain: string[] = [];
  let cursor: WorkItem | undefined = selected;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(`${cursor.code} · ${cursor.title}`);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return [...crumbs, ...chain];
}
