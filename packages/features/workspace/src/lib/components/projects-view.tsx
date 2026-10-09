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
import { MessageSquare, MoreHorizontal, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  loadInstance,
  loadStartableProcedures,
  procedureTitleFor,
  startProcedureForWorkItem,
  PROCEDURE_LAUNCH_URL,
  type ProcedureInstanceView,
  type ProcedureOption,
} from '../procedure-api';
import { branchOf } from '../project-tree.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { CancelProjectDialog } from './cancel-project-dialog';
import { CancelWorkItemDialog } from './cancel-work-item-dialog';
import { ChatDrawer } from './chat-drawer';
import { DocumentPanel } from './document-panel';
import { EventForm } from './event-form';
import { MembersDialog } from './members-dialog';
import { MoveDialog } from './move-dialog';
import { NodeHeader } from './node-header';
import { ProcedureRetryDialog } from './procedure-retry-dialog';
import { ProjectForm } from './project-form';
import { ProjectHeader } from './project-header';
import { ContextMenu, type ContextAction, type SelectedNode } from './project-tree';
import { TabActivity } from './tab-activity';
import { TabCalendar } from './tab-calendar';
import { TabFinance } from './tab-finance';
import { TabOverview } from './tab-overview';
import { TabWork } from './tab-work';
import { useDirectory } from './use-directory';
import { ChildItems, WorkItemDialog } from './work-item-dialog';
import { WorkItemForm, type WorkItemCostInput } from './work-item-form';

/**
 * Các tab của dự án. Chi tiết một công việc không còn là tab: bấm một dòng
 * trong bảng WBS thì mở hộp chi tiết của công việc đó.
 */
type TabId = 'work-items' | 'calendar' | 'documents' | 'finance' | 'activity';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'work-items', label: 'Công việc' },
  { id: 'calendar', label: 'Lịch' },
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
  readonly notificationTarget?: string;
  /** Được xoá tài liệu và thư mục; mặc định tắt, chỉ quản trị tenant có. */
  readonly canDelete?: boolean;
  /**
   * Báo dự án đang mở, để thanh bên tô sáng đúng dòng dự án đó. `project` có
   * mặt khi chi tiết đã tải: thanh bên dùng nó để giữ dòng của dự án đang mở
   * dù dự án đó không nằm trong vài dự án đầu.
   */
  readonly onOpenProjectChange?: (
    projectId: string | undefined,
    project?: ProjectSummary,
  ) => void;
  /**
   * Mở một dự án. Trang cha đổi `?project=` trên đường dẫn; trang này đọc lại
   * từ đó, nên nút Back của trình duyệt cũng đi đúng.
   */
  readonly onOpenProject?: (projectId: string) => void;
  /**
   * Chỗ nút thao tác ở đầu trang (cạnh breadcrumb), nơi trang này đặt nút
   * Trao đổi và "⋯" của dự án đang mở.
   */
  readonly actionsSlot?: HTMLElement | null;
  /** Đã tạo, sửa hay huỷ dự án: trang cha nạp lại danh sách trên thanh bên. */
  readonly onProjectsChanged?: () => void;
  /** Tăng lên mỗi lần bấm lại dự án đang mở trên thanh bên: về tab Công việc. */
  readonly focusProjectRequest?: number;
  /**
   * Tăng lên một mỗi lần nút "+" ở mục Dự án trên thanh bên được bấm: mở hộp
   * tạo dự án. Dùng bộ đếm chứ không dùng hash, để bấm lần hai vẫn mở lại.
   */
  readonly createProjectRequest?: number;
  /** Đã mở hộp tạo dự án theo yêu cầu trên; trang cha đặt bộ đếm về 0. */
  readonly onCreateProjectHandled?: () => void;
}

export function ProjectsView({
  canDelete = false,
  notificationTarget,
  onOpenProjectChange,
  createProjectRequest = 0,
  onCreateProjectHandled,
  onOpenProject,
  actionsSlot,
  onProjectsChanged,
  focusProjectRequest = 0,
}: ProjectsViewProps = {}) {
  const directory = useDirectory();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  /** Đã nạp xong danh sách dự án lần đầu (để biết "chưa có dự án nào" là thật). */
  const [listLoaded, setListLoaded] = useState(false);
  /** Dự án ghi trên đường dẫn (`?project=`). */
  const [urlProject, setUrlProject] = useState<string>();
  // Đường dẫn không chỉ dự án nào thì mở sẵn dự án đầu tiên: trang Dự án luôn
  // là trang của một dự án, không có trang danh sách riêng.
  const openId = urlProject ?? projects[0]?.id;
  const [detail, setDetail] = useState<ProjectDetail>();
  /** Dự án, hoặc công việc đang mở trong hộp chi tiết. */
  const [selected, setSelected] = useState<SelectedNode>({ kind: 'project' });
  const [tab, setTab] = useState<TabId>('work-items');
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
  /** Công việc đang chờ xác nhận huỷ, từ menu chuột phải, bảng hay Kanban. */
  const [cancellingItem, setCancellingItem] = useState<WorkItem>();
  const [membersOpen, setMembersOpen] = useState(false);
  const [moving, setMoving] = useState<WorkItem>();
  /**
   * Menu lệnh đang mở: của dự án (nút "⋯" đầu trang), hay của một công việc
   * (chuột phải trên bảng WBS, nút "⋯" trong hộp chi tiết).
   */
  const [menu, setMenu] = useState<{ x: number; y: number; node: SelectedNode }>();

  // Đường dẫn là nguồn duy nhất của dự án đang mở: thanh bên và link thông
  // báo đều chỉ đổi `?project=`.
  useEffect(() => {
    const sync = () =>
      setUrlProject(new URLSearchParams(window.location.search).get('project') ?? undefined);
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const openProject = useCallback(
    (projectId: string) => {
      if (onOpenProject) onOpenProject(projectId);
      else setUrlProject(projectId);
    },
    [onOpenProject],
  );

  // Bản tóm tắt gửi kèm: chi tiết vừa tải nếu có, không thì dòng của dự án
  // đó trong bảng — đủ để thanh bên dựng dòng cho dự án đang mở.
  useEffect(() => {
    const summary =
      detail?.project.id === openId
        ? detail?.project
        : projects.find((project) => project.id === openId);
    onOpenProjectChange?.(openId, summary);
  }, [openId, detail, projects, onOpenProjectChange]);

  // Bấm lại dự án đang mở trên thanh bên: đóng hộp chi tiết, về tab Công
  // việc. Chỉ phản ứng với lần bấm mới, không phải giá trị có sẵn lúc dựng.
  const seenFocus = useRef(focusProjectRequest);
  useEffect(() => {
    if (focusProjectRequest === seenFocus.current) return;
    seenFocus.current = focusProjectRequest;
    setSelected({ kind: 'project' });
    setTab('work-items');
  }, [focusProjectRequest]);

  // Nút "+" ở mục Dự án trên thanh bên mở thẳng hộp tạo dự án.
  // Báo lại ngay để quay lại trang này sau đó không tự mở hộp lần nữa.
  useEffect(() => {
    if (createProjectRequest <= 0) return;
    setProjectForm({ open: true });
    onCreateProjectHandled?.();
  }, [createProjectRequest, onCreateProjectHandled]);

  /**
   * Đích của đường dẫn đã được áp dụng chưa.
   *
   * Hash giữ nguyên sau khi mở, còn chi tiết dự án tải lại sau mỗi thao tác;
   * không đánh dấu thì mỗi lần tải lại lại kéo người dùng về đúng node đó.
   */
  const appliedTarget = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!notificationTarget || appliedTarget.current === notificationTarget) return;
    if (!detail || detail.project.id !== openId) return;
    const [kind, first, second] = notificationTarget.split('/');
    // `#projects/project/{id}`: mở dự án ở tab Công việc.
    if (kind === 'project') {
      appliedTarget.current = notificationTarget;
      setSelected({ kind: 'project' });
      setTab('work-items');
    }
    // `#projects/work-item/{id}`: mở thẳng hộp chi tiết của công việc đó.
    if (kind === 'work-item' && first && detail.items.some((item) => item.id === first)) {
      appliedTarget.current = notificationTarget;
      setSelected({ kind: 'work-item', id: first });
    }
    // `#projects/chat/{work_item|project}/{id}`: mở node rồi mở luôn khung trao đổi.
    if (kind === 'chat' && first && second) {
      appliedTarget.current = notificationTarget;
      if (first === 'work_item' && detail.items.some((item) => item.id === second)) {
        setSelected({ kind: 'work-item', id: second });
      } else {
        setSelected({ kind: 'project' });
      }
      setChatOpen(true);
    }
  }, [notificationTarget, detail, openId]);

  useEffect(() => {
    const [kind, targetId] = notificationTarget?.split('/') ?? [];
    if (kind !== 'calendar' || !targetId) return;
    let active = true;
    void api.getEvent(targetId).then(({ event }) => {
      if (!active) return;
      const requestedStart = new URLSearchParams(window.location.search).get('occurrence');
      const start = requestedStart && Number.isFinite(Date.parse(requestedStart)) ? new Date(requestedStart) : new Date(event.startAt);
      const end = new Date(start.getTime() + Date.parse(event.endAt) - Date.parse(event.startAt));
      const occurrenceDate = new Intl.DateTimeFormat('sv-SE', { timeZone: event.timezone }).format(start);
      setTab('calendar');
      setEventForm({ open: true, occurrence: {
        ...event, eventId: event.id, occurrenceDate, startAt: start.toISOString(), endAt: end.toISOString(),
        isException: false, isRecurring: Boolean(event.recurrenceRule),
      } });
    }).catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [notificationTarget]);

  const message = (cause: unknown, fallback: string) =>
    (cause as { message?: string })?.message ?? fallback;

  /**
   * Trang đầu của danh sách dự án: chỉ để biết dự án nào mở sẵn khi đường dẫn
   * không chỉ dự án nào. Danh sách để chọn nằm ở mục Dự án trên thanh bên.
   */
  const refreshList = useCallback(async () => {
    try {
      const page = await api.listProjects({ pageSize: api.PROJECT_PAGE_SIZE });
      setProjects(page.items);
      setError(undefined);
    } catch (cause) {
      setError(message(cause, 'Không tải được danh sách dự án.'));
    } finally {
      setListLoaded(true);
    }
  }, []);

  /**
   * Số thứ tự của lần tải chi tiết gần nhất.
   *
   * Nhiều lần tải có thể chạy chồng nhau (ghi chi phí hai lần liền, đồng bộ
   * tiến độ quy trình...). Lần gọi trước mà trả về SAU sẽ ghi đè số mới bằng
   * số cũ: sổ chi phí đã có dòng mới nhưng thẻ tổng vẫn hiện giá trị trước.
   * Chỉ nhận kết quả của lần gọi mới nhất.
   */
  const detailSeq = useRef(0);

  const refreshDetail = useCallback(async (projectId: string) => {
    const seq = ++detailSeq.current;
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
      if (seq !== detailSeq.current) return;
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
      if (seq !== detailSeq.current) return;
      setDetail(undefined);
      setError(message(cause, 'Không tải được dữ liệu dự án.'));
    } finally {
      if (seq === detailSeq.current) setLoading(false);
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
  }, [refreshList]);

  useEffect(() => {
    void api.loadCurrentUserId().then(setMe);
  }, []);

  useEffect(() => {
    setSelected({ kind: 'project' });
    if (!openId) {
      // Về bảng Tất cả dự án: bỏ chi tiết cũ, để lần mở dự án khác không
      // thoáng hiện khối đầu của dự án trước.
      setDetail(undefined);
      setChatOpen(false);
      return;
    }
    void refreshDetail(openId);
  }, [openId, refreshDetail]);

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
        title: procedureTitleFor(
          detail?.project.id === item.projectId ? detail.project.code : '',
          item.code,
          item.title,
        ),
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
    if (tab === 'finance' && detail && !detail.project.finance) setTab('work-items');
  }, [tab, detail]);

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
      onProjectsChanged?.();
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
        // Hỏi lại kèm lý do — xem CancelWorkItemDialog.
        if (item) setCancellingItem(item);
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

  const openItem = (item: WorkItem) => setSelected({ kind: 'work-item', id: item.id });

  /** Con số nhỏ cạnh tên tab, như bản thiết kế: số công việc, số tài liệu. */
  const tabCount = (id: TabId) =>
    id === 'work-items'
      ? detail?.items.length
      : id === 'documents'
        ? projectDocuments.length
        : undefined;

  return (
    <div className={styles.projectPage}>
      {/* Trao đổi và "⋯" của dự án nằm ở đầu trang, cạnh breadcrumb. */}
      {actionsSlot && detail
        ? createPortal(
            <>
              <button
                type="button"
                className={styles.buttonGhost}
                aria-label={
                  (unread?.total ?? 0) > 0
                    ? `Trao đổi, ${unread?.total} tin chưa đọc`
                    : 'Trao đổi'
                }
                onClick={() => {
                  setSelected({ kind: 'project' });
                  setChatOpen(true);
                }}
              >
                <MessageSquare size={15} /> Trao đổi
                {(unread?.total ?? 0) > 0 ? (
                  <span className={styles.countBadge}>{unread?.total}</span>
                ) : null}
              </button>
              <button
                type="button"
                className={styles.buttonGhost}
                aria-label="Thao tác với dự án"
                title="Thao tác với dự án"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: box.right - 220, y: box.bottom + 4, node: { kind: 'project' } });
                }}
              >
                <MoreHorizontal size={15} />
              </button>
            </>,
            actionsSlot,
          )
        : null}

      {menu && detail ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={actionsFor(menu.node)}
          onClose={() => setMenu(undefined)}
          onPick={(actionId) => {
            const { node } = menu;
            setMenu(undefined);
            onAction(actionId, node);
          }}
        />
      ) : null}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {listLoaded && !openId ? (
        <div className={styles.emptyState}>
          <p>Chưa có dự án nào trong phạm vi của bạn.</p>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={() => setProjectForm({ open: true })}
          >
            <Plus size={14} /> Tạo dự án mới
          </button>
        </div>
      ) : null}

      {openId && !detail && loading ? <p className={styles.muted}>Đang tải dự án…</p> : null}

      {detail ? (
        <>
          <ProjectHeader
            project={detail.project}
            members={detail.members}
            documentCount={projectDocuments.length}
            onOpenMembers={() => setMembersOpen(true)}
          />

          <div className={styles.tabBar} role="tablist" aria-label="Mục của dự án">
            {visibleTabs.map((entry) => {
              const count = tabCount(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={tab === entry.id ? styles.tabActive : styles.tab}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                  {count ? <span className={styles.tabCount}>{count}</span> : null}
                </button>
              );
            })}
          </div>

          {tab === 'work-items' ? (
            <TabWork
              items={detail.items}
              dependencies={detail.dependencies}
              externalRefs={detail.externalRefs}
              pendingProcedure={pendingProcedure}
              unread={unread?.rolledUp}
              canWrite={canWrite}
              currentUserId={me}
              onOpen={openItem}
              onAddRoot={() => setItemForm({ open: true })}
              onMenu={(item, at) => setMenu({ ...at, node: { kind: 'work-item', id: item.id } })}
              onChangeStatus={async (item, next) => {
                // Kéo sang cột Đã huỷ cũng phải qua bước xác nhận.
                if (next === 'cancelled') {
                  setCancellingItem(item);
                  return;
                }
                await api.changeWorkItemStatus(item.id, { status: next });
                await refreshDetail(detail.project.id);
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
              onOpenWorkItem={(workItemId) => setSelected({ kind: 'work-item', id: workItemId })}
            />
          ) : null}
          {tab === 'documents' ? (
            <DocumentPanel
              projectId={detail.project.id}
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
            <TabActivity entries={detail.activity} items={detail.items} />
          ) : null}
        </>
      ) : null}

      {detail && selectedItem ? (
        <WorkItemDialog
          item={selectedItem}
          // Đường dẫn bấm được (dự án › nhóm › việc) đã nằm ngay dưới, trong
          // khối đầu công việc; dải đầu chỉ cần nói đây là hộp nào.
          heading={`Chi tiết công việc · ${selectedItem.code}`}
          escapeBlocked={chatOpen || Boolean(menu)}
          onClose={() => setSelected({ kind: 'project' })}
          aside={
            <section className={styles.panel}>
              <h3>Lịch sử hoạt động</h3>
              <TabActivity entries={detail.activity} items={detail.items} selected={selectedItem} />
            </section>
          }
        >
          <NodeHeader
            project={detail.project}
            items={detail.items}
            selected={selectedItem}
            onSelect={setSelected}
            canEdit={canWrite}
            // Cây tối đa 10 cấp; cấp 9 là sâu nhất nên không còn chỗ cho con.
            canWrite={canWrite && selectedItem.depth < 9}
            onEdit={() => onAction('edit-item', selected)}
            onAddChild={() => onAction('add-child', selected)}
            unread={nodeUnread}
            onOpenChat={() => setChatOpen(true)}
            onMore={(at) => setMenu({ ...at, node: selected })}
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
            onStartProcedure={async (definitionId) => {
              await startProcedure(selectedItem, definitionId);
            }}
          />
          <ChildItems
            items={detail.items}
            parent={selectedItem}
            canAdd={canWrite && selectedItem.depth < 9}
            onOpen={openItem}
            onAdd={() => onAction('add-child', selected)}
          />
          <TabOverview
            project={detail.project}
            items={detail.items}
            members={detail.members}
            selected={selectedItem}
            externalRefs={detail.externalRefs}
            externalDegraded={detail.externalDegraded}
            procedurePending={pendingProcedure.has(selectedItem.id)}
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
          {/* Tài liệu đã gắn vào công việc này. */}
          <DocumentPanel
            projectId={detail.project.id}
            linkedTo={{ entityType: 'work_item', entityId: selectedItem.id }}
            canWrite={canWrite}
            canDelete={canDelete}
            currentUserId={me}
            compact
            workItems={detail.items}
          />
        </WorkItemDialog>
      ) : null}

      {/* Trao đổi là ngăn kéo trượt từ cạnh phải, không chiếm một cột cố định. */}
      <ChatDrawer
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
          onProjectsChanged?.();
          openProject(created.id);
        }}
        onUpdate={async (input: UpdateProjectRequest, contractValue) => {
          if (!detail) return;
          await api.updateProject(detail.project.id, input);
          if (contractValue !== undefined) {
            await api.updateProjectFinance(detail.project.id, { contractValue });
          }
          await refreshDetail(detail.project.id);
          await refreshList();
          onProjectsChanged?.();
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
        memberUserIds={detail?.members.map((member) => member.userId)}
        loadDetail={api.getEvent}
        onClose={() => setEventForm({ open: false })}
        onRespond={async (response) => {
          if (!eventForm.occurrence) return;
          await api.respondToEvent(eventForm.occurrence.eventId, { responseStatus: response });
          setCalendarToken((current) => current + 1);
        }}
        onCreate={async (input: Omit<CreateEventRequest, 'projectId'>) => {
          if (!detail) return [];
          // Đang đứng ở một công việc thì sự kiện mới gắn luôn vào việc đó,
          // để nó hiện trong lịch của nhánh đang xem.
          const result = await api.createEvent({
            ...input,
            projectId: detail.project.id,
            workItemId: input.workItemId ?? selectedItem?.id,
          });
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

      <CancelWorkItemDialog
        item={cancellingItem}
        openChildren={
          cancellingItem
            ? (detail?.items ?? []).filter(
                (candidate) =>
                  candidate.id !== cancellingItem.id &&
                  branchOf(detail?.items ?? [], cancellingItem.id).has(candidate.id) &&
                  candidate.status !== 'done' &&
                  candidate.status !== 'cancelled',
              ).length
            : 0
        }
        onClose={() => setCancellingItem(undefined)}
        onConfirm={async (item, note) => {
          await api.changeWorkItemStatus(item.id, { status: 'cancelled', note: note || undefined });
          setCancellingItem(undefined);
          if (openId) await refreshDetail(openId);
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
  );
}
