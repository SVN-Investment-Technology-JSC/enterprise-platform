'use client';

import {
  MY_WORK_PAGE_SIZES,
  allowedStandaloneTaskTransitions,
  canTransitionWorkItem,
  type CreateProjectRequest,
  type CreateWorkItemRequest,
  type MyWorkEvent,
  type MyWorkGroupCounts,
  type MyWorkGroupSummary,
  type MyWorkItem,
  type MyWorkSortKey,
  type MyWorkStandaloneTask,
  type ParticipantResponse,
  type ProjectMember,
  type ProjectRole,
  type ProjectSummary,
  type UpdateStandaloneTaskRequest,
  type UpdateWorkItemRequest,
  type WorkItemPriority,
  type WorkItem,
  type WorkItemStatus,
  WORKSPACE_ASSISTANT_ACTIONS,
} from '@enterprise-platform/contracts-workspace';
import { assistantActionKeys, useAssistantSaved } from '@enterprise-platform/feature-module-shell';
import { formatTime, toast } from '@enterprise-platform/shared-ui';
import { statusToastText, toastStatusChanged } from '../status-toast';
import {
  AtSign,
  CalendarClock,
  CalendarDays,
  Clock3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  ListFilter,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Provider } from 'react-redux';
import { initialTasksWarning } from '../project-created';
import * as api from '../workspace-api';
import {
  MY_WORK_STANDALONE_KEY,
  invalidateMyWork,
  myWorkStore,
  resetMyWork,
  useMyWorkGroupItemsQuery,
  useMyWorkOverviewQuery,
  useMyWorkStandaloneQuery,
  useMyWorkUi,
  type MyWorkError,
  type MyWorkUiState,
} from '../my-work-store';
import { mergeNewProjectMembers } from '../project-tree.model';
import {
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
  formatDateTime,
  priorityKeys,
  priorityLabel,
  priorityTone,
  workItemStatusKeys,
  workItemStatusLabel,
  workItemStatusTone,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import {
  ChipButton,
  ChipSelect,
  DateChip,
  PriorityIcon,
  ProgressCell,
  GroupCounts,
} from './inline-cells';
import { BlockedReasonMark, useBlockedReasonPrompt } from './blocked-reason-dialog';
import { Choice } from './choice';
import { CompleteWorkItemDialog, type CompleteWorkItemTarget } from './complete-work-item-dialog';
import { Pager } from './pager';
import { ProjectForm } from './project-form';
import { WorkItemForm } from './work-item-form';
import { useDirectory } from './use-directory';
import { useFillViewportHeight } from './use-fill-viewport';
import { Tooltip } from './tooltip';

const INVITATION_RESPONSES: readonly {
  value: ParticipantResponse;
  label: string;
}[] = [
  { value: 'accepted', label: 'Tham gia' },
  { value: 'tentative', label: 'Có thể' },
  { value: 'declined', label: 'Từ chối' },
];

const WORKSPACE_ACTION_KEYS = assistantActionKeys(WORKSPACE_ASSISTANT_ACTIONS);

/** Cách xếp nhóm dự án và công việc trong bảng; chạy cùng lúc với bộ lọc. */
const SORT_OPTIONS: readonly { value: MyWorkSortKey; label: string }[] = [
  { value: 'due', label: 'Theo hạn (gấp trước)' },
  { value: 'name', label: 'Theo tên' },
  { value: 'code', label: 'Theo mã' },
  { value: 'updated', label: 'Cập nhật gần nhất' },
];

const PAGE_SIZE_OPTIONS = MY_WORK_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));

/** Số cột của bảng (Công việc, Dự án, Ưu tiên, Trạng thái, Hạn, Tiến độ). */
const TABLE_COLUMNS = 6;

const messageOf = (cause: unknown, fallback: string): string =>
  (cause as { message?: string })?.message ?? fallback;

/**
 * Trang "Công việc của tôi".
 *
 * Chỉ hiển thị dữ liệu của chính người đang đăng nhập — kể cả quản trị viên
 * tenant. Có một dòng giải thích ngay đầu trang để người quản trị không tưởng
 * màn hình bị lọc sai.
 *
 * Bố cục: thẻ đầu trang (tiêu đề + vài con số), dải lịch hôm nay và lời mời khi có, rồi bên trái MỘT bảng chia nhóm theo
 * dự án (thẻ cao vừa phần còn lại, chỉ phần bảng cuộn), bên phải một cột phụ gộp "Có người nhắc bạn" và "Từ module
 * khác" (màn hẹp thì xuống dưới bảng).
 *
 * Dữ liệu nạp theo trang, không tải mọi việc một lượt: `overview` cho số liệu và tóm tắt từng nhóm, mở nhóm nào mới nạp
 * dòng việc của nhóm đó, mỗi lần một trang. Bộ nhớ đệm và trạng thái xem nằm trong `my-work-store`.
 */
export interface MyWorkViewProps {
  /** Mở một node trong trang Dự án: công việc, sự kiện hay luồng trao đổi. */
  readonly onOpen?: (projectId: string, target: string) => void;
  /** Mở một việc ở trang "Công việc ngoài dự án". */
  readonly onOpenTask?: (taskId: string) => void;
}

/** Bọc store riêng để bộ nhớ đệm và trạng thái xem nằm ngoài vòng đời của trang. */
/** Cột phụ (nhắc tên, thẻ module khác): ẩn mặc định, mở bằng nút ở đầu trang, kéo vạch giữa để đổi độ rộng. */
const SIDE_STORAGE = 'workspace.my-work.side.v1';
const SIDE_MIN_PX = 260;
const SIDE_MAX_PX = 560;
const SIDE_DEFAULT_PX = 340;
const SIDE_STEP_PX = 20;
/** Bảng chính luôn giữ ít nhất chừng này (px) khi kéo cột phụ rộng ra. */
const MAIN_MIN_PX = 480;

/** Người dùng của lần mở trang gần nhất trong phiên này (cấp mô-đun, vì bộ nhớ đệm cũng ở cấp mô-đun). */
let lastUserId = '';

export function MyWorkView(props: MyWorkViewProps = {}) {
  return (
    <Provider store={myWorkStore}>
      <MyWorkBody {...props} />
    </Provider>
  );
}

function MyWorkBody({ onOpen, onOpenTask }: MyWorkViewProps) {
  const directory = useDirectory();
  const { ui, setFilter, setSort, clearFilter, toggleGroup, toggleStandalone, setPage, setPageSize } = useMyWorkUi();
  const overviewQuery = useMyWorkOverviewQuery({
    sort: ui.sort,
    status: (ui.status || undefined) as WorkItemStatus | undefined,
    priority: (ui.priority || undefined) as WorkItemPriority | undefined,
    projectId: ui.projectId || undefined,
  });
  // `data` giữ bản của lần trước trong lúc đổi bộ lọc nạp lại, nên số liệu và danh sách không nháy trống.
  const overview = overviewQuery.data;
  const overviewError = (overviewQuery.error as MyWorkError | undefined)?.message;

  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [error, setError] = useState<string>();
  const [responding, setResponding] = useState<string>();
  const [panelOpen, setPanelOpen] = useState(false);
  const panelBox = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  // Cột phụ: mặc định ẩn; mở/đóng và độ rộng nhớ theo trình duyệt của người dùng.
  const [sideOpen, setSideOpen] = useState(false);
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT_PX);
  const mainRef = useRef<HTMLDivElement>(null);
  const sideDragging = useRef(false);
  /** Độ rộng mới nhất khi đang kéo: lúc nhả chuột lưu đúng giá trị này, không phụ thuộc lần vẽ lại. */
  const sideWidthLive = useRef(SIDE_DEFAULT_PX);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SIDE_STORAGE) ?? 'null') as
        | { open?: boolean; width?: number }
        | null;
      if (saved?.open) setSideOpen(true);
      if (typeof saved?.width === 'number') {
        const width = Math.min(SIDE_MAX_PX, Math.max(SIDE_MIN_PX, saved.width));
        sideWidthLive.current = width;
        setSideWidth(width);
      }
    } catch {
      // localStorage có thể bị chặn (chế độ riêng tư); dùng mặc định.
    }
  }, []);
  const saveSide = (open: boolean, width: number) => {
    try {
      window.localStorage.setItem(SIDE_STORAGE, JSON.stringify({ open, width }));
    } catch {
      // bỏ qua nếu không ghi được.
    }
  };
  const toggleSide = () => {
    setSideOpen((current) => {
      saveSide(!current, sideWidth);
      return !current;
    });
  };
  /** Độ rộng tối đa theo bề ngang hiện có: bảng chính không bị ép dưới `MAIN_MIN_PX`. */
  const clampSide = (value: number) => {
    // Khung chưa có bề ngang (đang ẩn, chưa đo): không ép theo bề ngang.
    const measured = mainRef.current?.getBoundingClientRect().width ?? 0;
    const total = measured > 0 ? measured : Number.POSITIVE_INFINITY;
    return Math.round(Math.max(SIDE_MIN_PX, Math.min(SIDE_MAX_PX, value, total - MAIN_MIN_PX)));
  };
  const onSideHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sideDragging.current = true;
  };
  const onSideHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = mainRef.current?.getBoundingClientRect();
    if (!sideDragging.current || !box) return;
    const next = clampSide(box.right - event.clientX);
    sideWidthLive.current = next;
    setSideWidth(next);
  };
  const onSideHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sideDragging.current) return;
    sideDragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    saveSide(true, sideWidthLive.current);
  };
  const onSideHandleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Cột phụ nằm bên phải: mũi tên trái = mở rộng, mũi tên phải = thu hẹp.
    const delta = event.key === 'ArrowLeft' ? SIDE_STEP_PX : event.key === 'ArrowRight' ? -SIDE_STEP_PX : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clampSide(sideWidth + delta);
    sideWidthLive.current = next;
    setSideWidth(next);
    saveSide(true, next);
  };
  const resetSideWidth = () => {
    sideWidthLive.current = SIDE_DEFAULT_PX;
    setSideWidth(SIDE_DEFAULT_PX);
    saveSide(true, SIDE_DEFAULT_PX);
  };
  // Thẻ bảng chiếm đúng phần cao còn lại và cuộn bên trong, nên trang không bị cuộn thêm dù có 600 việc.
  // Phần phía trên khung (dải lịch, thông báo quản trị, báo lỗi) hiện hoặc ẩn muộn thì phải đo lại, nếu không đáy khung tràn.
  const aboveKey = [
    isTenantAdmin,
    Boolean(error),
    (overview?.todayEvents.length ?? 0) + (overview?.pendingInvitations.length ?? 0) > 0,
  ].join(':');
  useFillViewportHeight(frame, undefined, aboveKey);

  /** Việc đang được lưu sau khi sửa trên bảng: khoá ô của dòng đó cho tới khi xong. */
  const [savingItem, setSavingItem] = useState<string>();
  /** Việc đang hỏi xác nhận hoàn thành. */
  const [completing, setCompleting] = useState<CompleteWorkItemTarget>();
  const blockedPrompt = useBlockedReasonPrompt();

  // Nút "Tạo mới" ở góc trên phải: hai hộp thoại tạo dự án / tạo công việc.
  const [me, setMe] = useState('');
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  /** Mọi dự án người dùng thấy, dùng cho ô chọn "Dự án" trong form Công việc mới. */
  const [projectList, setProjectList] = useState<readonly ProjectSummary[]>([]);
  /** Dự án đang chọn trong form Công việc mới (chưa có dự án nào mở ở trang này). */
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [members, setMembers] = useState<readonly ProjectMember[]>([]);
  const [parentOptions, setParentOptions] = useState<{ id: string; label: string; done: boolean }[]>([]);

  useEffect(() => {
    void api.loadIsTenantAdmin().then(setIsTenantAdmin);
    void api.loadCurrentUserId().then((userId) => {
      setMe(userId);
      // Bộ nhớ đệm là của một người dùng: đổi tài khoản trong cùng phiên thì bỏ hết, kẻo thấy dữ liệu của người trước.
      if (userId && lastUserId && lastUserId !== userId) resetMyWork();
      lastUserId = userId || lastUserId;
    });
  }, []);

  // Card Trợ lý vừa tạo cuộc họp, công việc hay việc ngoài dự án: cả ba đều hiện ở trang này.
  useAssistantSaved(WORKSPACE_ACTION_KEYS, () => {
    invalidateMyWork();
  });

  // Bấm ra ngoài bảng lọc thì đóng; bấm vào danh sách xổ của ô chọn (nằm trong bảng) thì không.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!panelBox.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [panelOpen]);

  /** Nạp danh sách dự án cho ô chọn "Dự án" khi mở form Công việc mới. */
  const openNewWorkItem = useCallback(() => {
    setSelectedProjectId('');
    setMembers([]);
    setParentOptions([]);
    setItemFormOpen(true);
    api
      .listAllProjects(20)
      .then(setProjectList)
      .catch(() => undefined);
  }, []);

  /**
   * Đổi dự án trong form Công việc mới: nạp thành viên và cây công việc của dự
   * án đó để ô "Người phụ trách" và "Công việc cha" có đúng nguồn dữ liệu.
   */
  const onProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setMembers([]);
    setParentOptions([]);
    if (!projectId) return;
    api
      .listMembers(projectId)
      .then((result) => setMembers(result.items))
      .catch(() => undefined);
    api
      .listWorkItems(projectId)
      .then((tree) =>
        setParentOptions(
          tree.items
            .filter((item) => item.status !== 'cancelled')
            .map((item) => ({
              id: item.id,
              label: `${item.code} · ${item.title}${item.status === 'done' ? ' (đã hoàn thành)' : ''}`,
              done: item.status === 'done',
            })),
        ),
      )
      .catch(() => undefined);
  }, []);

  const respond = async (eventId: string, response: ParticipantResponse) => {
    setResponding(eventId);
    setError(undefined);
    try {
      await api.respondToEvent(eventId, { responseStatus: response });
      // Trả lời xong thì lời mời rời dải lịch ở lần nạp lại.
      invalidateMyWork();
    } catch (cause) {
      setError(messageOf(cause, 'Không gửi được phản hồi.'));
    } finally {
      setResponding(undefined);
    }
  };

  /**
   * Chuyển sang Vướng mắc luôn hỏi lý do trước (server từ chối nếu thiếu). Lỗi ném ra để hộp tự hiện và giữ hộp mở.
   * Việc dự án và việc giao lẻ dùng chung một hộp, chỉ khác endpoint.
   */
  const promptBlocked = (
    target: { readonly code: string; readonly title: string; readonly blockedReason?: string },
    submit: (reason: string) => Promise<unknown>,
  ) =>
    blockedPrompt.ask(target, async (reason) => {
      await submit(reason);
      invalidateMyWork();
    });

  const changeStatus = async (item: WorkItem, next: WorkItemStatus) => {
    const itemId = item.id;
    setError(undefined);
    setSavingItem(itemId);
    try {
      // Cùng endpoint với màn Dự án, nên mọi ràng buộc — việc con chưa đóng,
      // tiền nhiệm FS chưa xong — vẫn áp dụng nguyên vẹn ở đây.
      await api.changeWorkItemStatus(itemId, { status: next });
      // Báo ngay khi Bắt đầu hoặc Hoàn tác xong, trước khi bảng nạp lại.
      toastStatusChanged(item.status, next, item.code);
      // Việc đóng thì rời bảng, số đếm đầu trang cũng đổi: huỷ bộ nhớ để nạp lại.
      invalidateMyWork();
    } catch (cause) {
      toast.error(messageOf(cause, 'Không đổi được trạng thái.'));
    } finally {
      setSavingItem(undefined);
    }
  };

  /** Việc ngoài dự án: đổi trạng thái hay sửa xong thì nạp lại (nhóm hạn, việc chờ duyệt, số đếm đều có thể đổi). */
  const runTask = async (
    taskId: string,
    operation: () => Promise<unknown>,
    fallback: string,
    /** Chỉ truyền khi thao tác là đổi trạng thái: báo thành công (và lỗi) bằng toast. */
    onStatusChanged?: () => void,
  ) => {
    setError(undefined);
    setSavingItem(taskId);
    try {
      await operation();
      onStatusChanged?.();
      invalidateMyWork();
    } catch (cause) {
      const text = messageOf(cause, fallback);
      setError(text);
      if (onStatusChanged) toast.error(text);
    } finally {
      setSavingItem(undefined);
    }
  };

  const patchItem = async (itemId: string, patch: UpdateWorkItemRequest, fallback: string) => {
    setError(undefined);
    setSavingItem(itemId);
    try {
      await api.updateWorkItem(itemId, patch);
      // Ưu tiên, hạn hay tiến độ đổi đều làm đổi dòng tóm tắt của nhóm (ưu tiên cao nhất, hạn gần nhất, tiến độ
      // trung bình, nhóm quá hạn) và số đếm đầu trang: nạp lại thay vì vá cục bộ từng chỗ.
      invalidateMyWork();
    } catch (cause) {
      setError(messageOf(cause, fallback));
    } finally {
      setSavingItem(undefined);
    }
  };

  const onItemStatus = (entry: MyWorkItem, next: WorkItemStatus) =>
    next === 'done'
      ? setCompleting(entry.item)
      : next === 'blocked'
        ? promptBlocked(entry.item, (reason) =>
            api.changeWorkItemStatus(entry.item.id, { status: 'blocked', note: reason }),
          )
        : void changeStatus(entry.item, next);

  const onTaskStatus = (entry: MyWorkStandaloneTask, next: WorkItemStatus) =>
    next === 'blocked'
      ? promptBlocked(entry.task, (reason) =>
          api.changeStandaloneTaskStatus(entry.task.id, { status: 'blocked', note: reason }),
        )
      : void runTask(
          entry.task.id,
          () => api.changeStandaloneTaskStatus(entry.task.id, { status: next }),
          'Không đổi được trạng thái.',
          () => toastStatusChanged(entry.task.status, next, entry.task.code),
        );

  const onTaskPatch = (entry: MyWorkStandaloneTask, patch: UpdateStandaloneTaskRequest, fallback: string) =>
    void runTask(entry.task.id, () => api.updateStandaloneTask(entry.task.id, patch), fallback);

  const events = overview?.todayEvents ?? [];
  const invitations = overview?.pendingInvitations ?? [];
  const groups = overview?.groups ?? [];
  const standalone = overview?.standalone;
  const mentions = overview?.mentions ?? [];
  const externalCards = overview?.externalCards ?? [];
  const counters = overview?.counters;
  const options = overview?.filterOptions;

  const facets = [ui.status, ui.priority, ui.projectId].filter(Boolean).length;
  const hasFilter = facets > 0;
  const statusOptions = (options?.statuses ?? []).map((status) => ({
    value: status,
    label: WORK_ITEM_STATUS_LABELS[status],
  }));
  const priorityOptions = (options?.priorities ?? []).map((priority) => ({
    value: priority,
    label: priorityLabel(priority),
  }));
  const projectOptions = (options?.projects ?? []).map((project) => ({
    value: project.id,
    label: `${project.code} · ${project.name}`,
  }));
  const totalItems = groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <div className={styles.tabBody}>
      {isTenantAdmin ? (
        <p className={styles.notice}>
          Bạn là quản trị viên tenant, nhưng màn hình này{' '}
          <strong>luôn chỉ hiện việc của chính bạn</strong>. Muốn xem toàn bộ dự án, hãy dùng trang
          Dự án hoặc Báo cáo.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <div className={styles.myWorkHead}>
        <div className={`${styles.pageHeadCard} ${styles.myWorkHeadCard}`}>
          <h1 className={styles.pageTitle}>Công việc của tôi</h1>
          <div className={styles.myWorkStats}>
            <span className={styles.myWorkStat}>
              <b>{counters?.openItems ?? '—'}</b> đang mở
            </span>
            {counters && counters.overdueItems > 0 ? (
              <span className={styles.myWorkStat}>
                <b className={styles.textDanger}>{counters.overdueItems}</b> quá hạn
              </span>
            ) : null}
            <span className={styles.myWorkStat}>
              <b className={styles.textSuccess}>{counters?.completedThisWeek ?? '—'}</b> xong tuần này
            </span>
          </div>
        </div>
        <div className={styles.pageHeadEnd}>
          {overviewQuery.isFetching ? <span className={styles.muted}>Đang tải…</span> : null}
          <Tooltip content={sideOpen ? 'Ẩn nhắc tên và việc từ module khác' : 'Xem ai nhắc tên bạn và việc từ module khác'}>
            <button
              type="button"
              className={sideOpen ? styles.timelineToggleOn : styles.timelineToggle}
              aria-pressed={sideOpen}
              aria-label="Nhắc tên và việc từ module khác"
              onClick={toggleSide}
            >
              <AtSign size={13} aria-hidden />
              Nhắc tên
              {mentions.length + externalCards.length > 0 ? (
                <span className={styles.countBadge}>{mentions.length + externalCards.length}</span>
              ) : null}
            </button>
          </Tooltip>
          <Tooltip content="Tải lại">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Tải lại"
              onClick={() => {
                invalidateMyWork();
                // Truy vấn đang lỗi không mang tag nên không tự nạp lại theo invalidation.
                if (overviewQuery.isError) void overviewQuery.refetch();
              }}
            >
              <RefreshCw size={15} />
            </button>
          </Tooltip>
          <CreateMenu
            onNewProject={() => setProjectFormOpen(true)}
            onNewWorkItem={openNewWorkItem}
          />
        </div>
      </div>

      {events.length > 0 || invitations.length > 0 ? (
        <section className={styles.dayStrip} aria-label="Lịch hôm nay và lời mời">
          <CalendarClock size={16} aria-hidden className={styles.dayStripIcon} />
          <span className={styles.dayStripTitle}>
            {events.length > 0
              ? `Hôm nay bạn có ${events.length} lịch`
              : 'Hôm nay bạn không có lịch nào'}
          </span>
          {events.map((event) => (
            <span key={`event-${event.eventId}`} className={styles.dayChip}>
              <EventTitle event={event} onOpen={onOpen}>
                <b>{event.allDay ? 'Cả ngày' : formatTime(event.startAt)}</b> {event.title}
              </EventTitle>
              {event.location ? <span className={styles.muted}> · {event.location}</span> : null}
            </span>
          ))}
          {invitations.map((event) => (
            <InvitationChip
              key={`invite-${event.eventId}`}
              event={event}
              onOpen={onOpen}
              busy={responding === event.eventId}
              onRespond={(response) => void respond(event.eventId, response)}
            />
          ))}
        </section>
      ) : null}

      <div
        ref={mainRef}
        className={sideOpen ? `${styles.myWorkMain} ${styles.myWorkMainOpen}` : styles.myWorkMain}
        style={{ '--my-work-side': `${sideWidth}px` } as CSSProperties}
      >
        <div ref={frame} className={styles.ledgerCard}>
          <header className={styles.ledgerHead}>
            <div className={styles.reqHeadLeft}>
              <div ref={panelBox} className={styles.timelinePanelBox}>
                <button
                  type="button"
                  className={
                    facets > 0 || ui.sort !== 'due' || panelOpen ? styles.timelineToggleOn : styles.timelineToggle
                  }
                  aria-haspopup="dialog"
                  aria-expanded={panelOpen}
                  onClick={() => setPanelOpen((value) => !value)}
                >
                  <ListFilter size={13} aria-hidden />
                  Bộ lọc
                  {facets > 0 ? <span className={styles.countBadge}>{facets}</span> : null}
                </button>
                {panelOpen ? (
                  <div
                    className={`${styles.timelinePanel} ${styles.timelinePanelLeft} ${styles.reqPanel}`}
                    role="dialog"
                    aria-label="Bộ lọc công việc"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setPanelOpen(false);
                      }
                    }}
                  >
                    <div className={styles.reqPanelGrid}>
                      <div className={styles.filterField}>
                        <span className={styles.filterLabel}>Trạng thái</span>
                        <Choice
                          label="Trạng thái"
                          selectOnly
                          value={ui.status}
                          emptyOption="Tất cả"
                          options={statusOptions}
                          onChange={(value) => setFilter({ status: value })}
                        />
                      </div>
                      <div className={styles.filterField}>
                        <span className={styles.filterLabel}>Ưu tiên</span>
                        <Choice
                          label="Ưu tiên"
                          selectOnly
                          value={ui.priority}
                          emptyOption="Tất cả"
                          options={priorityOptions}
                          onChange={(value) => setFilter({ priority: value })}
                        />
                      </div>
                      <div className={styles.filterField}>
                        <span className={styles.filterLabel}>Dự án</span>
                        <Choice
                          label="Dự án"
                          selectOnly
                          value={ui.projectId}
                          emptyOption="Tất cả"
                          options={projectOptions}
                          onChange={(value) => setFilter({ projectId: value })}
                        />
                      </div>
                      <div className={styles.filterField}>
                        <span className={styles.filterLabel}>Sắp xếp theo</span>
                        <Choice
                          label="Sắp xếp"
                          selectOnly
                          value={ui.sort}
                          options={SORT_OPTIONS}
                          onChange={(value) => setSort((value || 'due') as MyWorkSortKey)}
                        />
                      </div>
                    </div>
                    <div className={styles.reqPanelFoot}>
                      {hasFilter || ui.sort !== 'due' ? (
                        <button type="button" className={styles.linkButton} onClick={clearFilter}>
                          Xoá lọc
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <span className={styles.reqCount}>
                {!overview
                  ? 'Đang tải…'
                  : `${groups.length} dự án · ${totalItems} việc${
                      standalone && standalone.total > 0 ? ` · ${standalone.total} việc ngoài dự án` : ''
                    }`}
              </span>
            </div>
          </header>

          {overviewError && !overview ? (
            <p role="alert" className={styles.alert}>
              {overviewError}{' '}
              <button type="button" className={styles.linkButton} onClick={() => void overviewQuery.refetch()}>
                Thử lại
              </button>
            </p>
          ) : null}

          <div className={styles.ledgerScroll}>
            <table className={`${styles.table} ${styles.ledgerTable}`}>
              <thead>
                <tr>
                  <th>Công việc</th>
                  <th>Dự án / Người giao</th>
                  <th>Ưu tiên</th>
                  <th>Trạng thái</th>
                  <th>Hạn</th>
                  <th>Tiến độ</th>
                </tr>
              </thead>
              {groups.map((group) => (
                <ProjectGroupBody
                  key={group.projectId}
                  group={group}
                  ui={ui}
                  open={ui.expanded.includes(group.projectId)}
                  onToggle={() => toggleGroup(group.projectId)}
                  onOpen={onOpen}
                  savingItem={savingItem}
                  onStatus={onItemStatus}
                  onPatch={(entry, patch, fallback) => void patchItem(entry.item.id, patch, fallback)}
                  onPage={(page) => setPage(group.projectId, page)}
                  onPageSize={setPageSize}
                />
              ))}
              {standalone && standalone.total > 0 ? (
                <StandaloneBody
                  total={standalone.total}
                  counts={standalone.counts}
                  ui={ui}
                  open={ui.standaloneOpen}
                  onToggle={toggleStandalone}
                  onOpenTask={onOpenTask}
                  savingItem={savingItem}
                  assignerName={(entry) => directory.nameOf(entry.task.createdBy)}
                  onStatus={onTaskStatus}
                  onPatch={onTaskPatch}
                  onPage={(page) => setPage(MY_WORK_STANDALONE_KEY, page)}
                  onPageSize={setPageSize}
                />
              ) : null}
            </table>
            {overview && groups.length === 0 ? (
              <p className={styles.emptyRow}>
                {hasFilter
                  ? 'Không có việc nào khớp bộ lọc.'
                  : standalone && standalone.total > 0
                    ? 'Bạn không có việc dự án nào đang mở.'
                    : 'Bạn không có việc nào đang mở.'}
              </p>
            ) : null}
            {!overview && !overviewError ? <p className={styles.emptyRow}>Đang tải…</p> : null}
          </div>
        </div>

        {sideOpen ? (
          <Tooltip content="Kéo để đổi độ rộng. Bấm đúp để về mặc định." side="left">
            <div
              className={styles.myWorkSideHandle}
              role="separator"
              aria-orientation="vertical"
              aria-label="Kéo để đổi độ rộng cột nhắc tên"
              aria-valuenow={sideWidth}
              aria-valuemin={SIDE_MIN_PX}
              aria-valuemax={SIDE_MAX_PX}
              tabIndex={0}
              onPointerDown={onSideHandleDown}
              onPointerMove={onSideHandleMove}
              onPointerUp={onSideHandleUp}
              onPointerCancel={onSideHandleUp}
              onKeyDown={onSideHandleKey}
              onDoubleClick={resetSideWidth}
            />
          </Tooltip>
        ) : null}

        {sideOpen ? (
        <aside className={styles.myWorkSide} aria-label="Nhắc tên và việc từ module khác">
          <div className={styles.myWorkSideCard}>
            <Tooltip content="Ẩn cột này">
              <button type="button" className={styles.myWorkSideClose} aria-label="Ẩn cột nhắc tên" onClick={toggleSide}>
                <X size={14} aria-hidden />
              </button>
            </Tooltip>
            <section className={styles.myWorkSideSection} aria-label="Có người nhắc bạn">
              <h3 className={styles.myWorkSideTitle}>
                <AtSign size={14} aria-hidden /> Có người nhắc bạn
                {mentions.length > 0 ? <span className={styles.countPill}>{mentions.length}</span> : null}
              </h3>
              {mentions.length > 0 ? (
                <ul className={styles.myWorkSideList}>
                  {mentions.map((mention) => (
                    <li key={mention.messageId}>
                      <Tooltip content="Mở luồng trao đổi">
                        <button
                          type="button"
                          className={styles.mentionItem}
                          onClick={() =>
                            onOpen?.(mention.projectId, `chat/${mention.entityType}/${mention.entityId}`)
                          }
                        >
                          <span className={styles.mentionMeta}>
                            {directory.nameOf(mention.createdBy)} · {formatDateTime(mention.createdAt)}
                          </span>
                          {/* Chuỗi dài không có khoảng trắng vẫn bị cắt trong 2 dòng, không tràn ra ngoài thẻ. */}
                          <span className={styles.mentionExcerpt}>{mention.excerpt}</span>
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.sideEmpty}>{overview ? 'Chưa ai nhắc tên bạn.' : 'Đang tải…'}</p>
              )}
            </section>

            <section className={styles.myWorkSideSection} aria-label="Từ module khác">
              <h3 className={styles.myWorkSideTitle}>
                <ExternalLink size={14} aria-hidden /> Từ module khác
                {externalCards.length > 0 ? <span className={styles.countPill}>{externalCards.length}</span> : null}
              </h3>
              {externalCards.length > 0 ? (
                <ul className={styles.myWorkSideList}>
                  {externalCards.map((card) => (
                    <li key={card.id} className={styles.externalItem}>
                      <Tooltip content={`${card.externalCode ?? card.cachedLabel ?? card.moduleKey} — ${card.workItemTitle}`}>
                      <span className={styles.externalText}>
                        {/* Nhãn là bản sao để hiển thị nhanh, có thể cũ. Nguồn sự
                            thật luôn là module gốc. */}
                        <a
                          className={styles.externalLink}
                          href={card.launchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {card.externalCode ?? card.cachedLabel ?? card.moduleKey}
                        </a>{' '}
                        — {card.workItemTitle}
                      </span>
                      </Tooltip>
                      <span className={styles.externalStatus}>{card.cachedStatus ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.sideEmpty}>
                  {overview ? 'Không có hồ sơ nào từ module khác.' : 'Đang tải…'}
                </p>
              )}
            </section>
          </div>
        </aside>
        ) : null}
      </div>

      {/* Dự án mới — người tạo tự thành chủ nhiệm nên luôn được nhập tài chính. */}
      <ProjectForm
        open={projectFormOpen}
        financeEnabled
        onClose={() => setProjectFormOpen(false)}
        onCreate={async (
          input: CreateProjectRequest,
          contractValue,
          members?: ReadonlyArray<{ userId: string; role: ProjectRole }>,
        ) => {
          const created = await api.createProject(input);
          const warning = initialTasksWarning(created);
          if (warning) setError(warning);
          if (contractValue !== undefined) {
            await api.updateProjectFinance(created.id, { contractValue });
          }
          // Lưu thành viên chọn lúc tạo (đi đường PUT .../members, cần đúng một chủ nhiệm).
          if (members && members.length > 0) {
            const existing = await api.listMembers(created.id);
            await api.setMembers(created.id, {
              members: mergeNewProjectMembers(existing.items, members),
            });
          }
          invalidateMyWork();
          onOpen?.(created.id, `project/${created.id}`);
        }}
        // Tạo từ trang này không sửa dự án; onUpdate chỉ để thoả kiểu dữ liệu.
        onUpdate={async () => undefined}
      />

      {/* Công việc mới — trang này chưa mở dự án nào nên form có thêm ô chọn Dự án. */}
      <WorkItemForm
        open={itemFormOpen}
        members={members}
        currentUserId={me}
        canAssignOthers
        projectOptions={projectList.map((project) => ({
          id: project.id,
          label: `${project.code}-${project.name}`,
        }))}
        onProjectChange={onProjectChange}
        parentOptions={parentOptions}
        onClose={() => setItemFormOpen(false)}
        onCreate={async (
          input: Omit<CreateWorkItemRequest, 'projectId'>,
          procedureDefinitionId?: string,
          addMemberUserIds?: string[],
        ) => {
          if (!selectedProjectId) throw new Error('Hãy chọn dự án cho công việc.');
          // Thêm người ngoài dự án vào dự án trước, để server chấp nhận họ làm
          // người phụ trách / cùng làm khi tạo công việc.
          if (addMemberUserIds && addMemberUserIds.length > 0) {
            const existing = await api.listMembers(selectedProjectId);
            await api.setMembers(selectedProjectId, {
              members: mergeNewProjectMembers(
                existing.items,
                addMemberUserIds.map((userId) => ({ userId, role: 'member' })),
              ),
            });
            await api
              .listMembers(selectedProjectId)
              .then((result) => setMembers(result.items))
              .catch(() => undefined);
          }
          await api.createWorkItem({
            ...input,
            projectId: selectedProjectId,
            procedureDefinitionId,
          });
          invalidateMyWork();
        }}
        // Tạo từ trang này không sửa việc; onUpdate chỉ để thoả kiểu dữ liệu.
        onUpdate={async () => undefined}
      />

      {/* Vướng mắc luôn qua hộp ghi lý do (việc dự án lẫn việc giao lẻ). */}
      {blockedPrompt.dialog}

      {/* Hoàn thành luôn qua hộp xác nhận, kèm điều kiện hoàn thành nếu việc có đặt. */}
      <CompleteWorkItemDialog
        target={completing}
        onClose={() => setCompleting(undefined)}
        onConfirm={async (confirmedConditionIds) => {
          if (!completing) return;
          // Lỗi ném ra để hộp thoại tự hiện; cùng endpoint nên việc con chưa đóng, tiền nhiệm FS… vẫn chặn như màn Dự án.
          await api.changeWorkItemStatus(completing.id, { status: 'done', confirmedConditionIds });
          toast.success(statusToastText('complete', completing.code));
          setCompleting(undefined);
          invalidateMyWork();
        }}
      />
    </div>
  );
}

/** Số trang của một nhóm từ tổng số việc và cỡ trang (tối thiểu 1). */
const pagesOf = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** Hàng thông báo trong thân bảng (đang nạp, lỗi) trải hết các cột. */
function NoteRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={TABLE_COLUMNS} className={styles.myWorkNote}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Hàng điều khiển cuối các dòng của một nhóm: chọn cỡ trang (dùng chung cho cả trang) và chuyển trang. Nhóm chỉ vài
 * việc (không hơn cỡ trang nhỏ nhất) thì không cần hàng này.
 */
function PageBar({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  if (total <= MY_WORK_PAGE_SIZES[0]) return null;
  const pages = pagesOf(total, pageSize);
  return (
    <tr className={styles.myWorkPagerRow}>
      <td colSpan={TABLE_COLUMNS}>
        <div className={styles.myWorkPagerBar}>
          <span className={styles.myWorkPageSize}>
            Mỗi trang
            <span className={styles.myWorkPageSizeBox}>
              <Choice
                label="Số việc mỗi trang"
                selectOnly
                height={28}
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(value) => onPageSize(Number(value) || pageSize)}
              />
            </span>
          </span>
          {pages > 1 ? (
            <Pager page={Math.min(page, pages)} pages={pages} total={total} pageSize={pageSize} onPage={onPage} />
          ) : (
            <span className={styles.muted}>{total} việc</span>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Một nhóm dự án: hàng tóm tắt (luôn có, lấy từ overview, tính trên MỌI việc khớp bộ lọc) rồi, khi nhóm đang mở, MỘT
 * trang dòng việc của nhóm (nạp riêng, nhớ lại theo trang) và hàng chuyển trang. Mỗi nhóm một `<tbody>` để làm mờ dòng cũ
 * trong lúc nạp trang khác mà không đụng hàng tóm tắt.
 */
function ProjectGroupBody({
  group,
  ui,
  open,
  onToggle,
  onOpen,
  savingItem,
  onStatus,
  onPatch,
  onPage,
  onPageSize,
}: {
  group: MyWorkGroupSummary;
  ui: MyWorkUiState;
  open: boolean;
  onToggle: () => void;
  onOpen?: MyWorkViewProps['onOpen'];
  savingItem?: string;
  onStatus: (entry: MyWorkItem, next: WorkItemStatus) => void;
  onPatch: (entry: MyWorkItem, patch: UpdateWorkItemRequest, fallback: string) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const page = ui.pages[group.projectId] ?? 1;
  const query = useMyWorkGroupItemsQuery(
    {
      projectId: group.projectId,
      status: (ui.status || undefined) as WorkItemStatus | undefined,
      priority: (ui.priority || undefined) as WorkItemPriority | undefined,
      sort: ui.sort,
      page,
      pageSize: ui.pageSize,
    },
    { skip: !open },
  );
  // `data` còn bản của trang trước trong lúc nạp trang mới: giữ dòng cũ (mờ đi) để bố cục không nhảy.
  const data = query.data;
  const total = data?.total ?? group.total;
  const pages = pagesOf(total, ui.pageSize);

  // Việc rời nhóm (xong, đổi hạn…) làm trang đang xem vượt quá số trang: lùi về trang cuối.
  useEffect(() => {
    if (open && data && !query.isFetching && page > pages) onPage(pages);
  }, [open, data, query.isFetching, page, pages, onPage]);

  const { counts } = group;
  return (
    <tbody className={query.isFetching && data ? styles.myWorkDim : undefined} aria-busy={query.isFetching}>
      <tr className={styles.groupRow}>
        <th scope="row">
          <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            <span className={styles.treeCode}>{group.projectCode}</span>
            {group.projectName}
          </button>
        </th>
        <td>
          {onOpen ? (
            <button
              type="button"
              className={styles.groupOpenButton}
              aria-label={`Mở dự án ${group.projectName}`}
              onClick={() => onOpen(group.projectId, `project/${group.projectId}`)}
            >
              <ExternalLink size={13} aria-hidden />
              Mở dự án
            </button>
          ) : null}
        </td>
        <td>
          {group.topPriority ? (
            <span className={styles.groupSummaryText}>
              <PriorityIcon priority={group.topPriority} />
              {priorityLabel(group.topPriority)}
              {group.topPriorityCount > 1 ? (
                <span className={styles.groupSummaryMuted}>×{group.topPriorityCount}</span>
              ) : null}
            </span>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
        <td>
          <GroupCounts counts={counts} unit="việc" />
        </td>
        <td>
          {counts.overdue > 0 ? (
            <span className={styles.groupOverdue}>Quá hạn {counts.overdue}</span>
          ) : group.nextDue ? (
            <span className={styles.groupSummaryText}>{formatDate(group.nextDue)}</span>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
        <td>
          <Tooltip content={`Tiến độ trung bình của ${group.total} việc`}>
            <span className={styles.progressCell}>
              <span className={styles.progressTrack} aria-label={`Tiến độ trung bình ${group.progress}%`}>
                <span className={styles.progressFill} style={{ width: `${group.progress}%` }} />
              </span>
              <b>{group.progress}%</b>
            </span>
          </Tooltip>
        </td>
      </tr>
      {open && !data && !query.isError ? <NoteRow>Đang tải…</NoteRow> : null}
      {open && query.isError ? (
        <NoteRow>
          <span className={styles.groupOverdue}>
            {(query.error as MyWorkError | undefined)?.message ?? 'Không tải được công việc của dự án.'}
          </span>{' '}
          <button type="button" className={styles.linkButton} onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </NoteRow>
      ) : null}
      {open && data
        ? data.items.map((entry) => (
            <MyWorkRow
              key={entry.item.id}
              entry={entry}
              busy={savingItem === entry.item.id}
              onOpen={onOpen}
              onStatus={(next) => onStatus(entry, next)}
              onPatch={(patch, fallback) => onPatch(entry, patch, fallback)}
            />
          ))
        : null}
      {open && data ? (
        <PageBar total={total} page={page} pageSize={ui.pageSize} onPage={onPage} onPageSize={onPageSize} />
      ) : null}
    </tbody>
  );
}

/** Khối "Công việc khác" (việc ngoài dự án): một nhóm cuối bảng, cùng cách mở và phân trang như nhóm dự án. */
function StandaloneBody({
  total,
  counts,
  ui,
  open,
  onToggle,
  onOpenTask,
  savingItem,
  assignerName,
  onStatus,
  onPatch,
  onPage,
  onPageSize,
}: {
  total: number;
  counts: MyWorkGroupCounts;
  ui: MyWorkUiState;
  open: boolean;
  onToggle: () => void;
  onOpenTask?: (taskId: string) => void;
  savingItem?: string;
  assignerName: (entry: MyWorkStandaloneTask) => string;
  onStatus: (entry: MyWorkStandaloneTask, next: WorkItemStatus) => void;
  onPatch: (entry: MyWorkStandaloneTask, patch: UpdateStandaloneTaskRequest, fallback: string) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const page = ui.pages[MY_WORK_STANDALONE_KEY] ?? 1;
  const query = useMyWorkStandaloneQuery({ sort: ui.sort, page, pageSize: ui.pageSize }, { skip: !open });
  const data = query.data;
  const shownTotal = data?.total ?? total;
  const pages = pagesOf(shownTotal, ui.pageSize);

  useEffect(() => {
    if (open && data && !query.isFetching && page > pages) onPage(pages);
  }, [open, data, query.isFetching, page, pages, onPage]);

  return (
    <tbody
      aria-label="Công việc khác"
      className={query.isFetching && data ? styles.myWorkDim : undefined}
      aria-busy={query.isFetching}
    >
      <tr className={styles.groupRow}>
        <th scope="row">
          <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            <ClipboardList size={14} aria-hidden /> Công việc khác
            <span className={styles.groupSummaryMuted}>· {total} việc</span>
          </button>
        </th>
        <td />
        <td />
        <td>
          <GroupCounts counts={counts} unit="việc" />
        </td>
        <td>
          {counts.overdue > 0 ? <span className={styles.groupOverdue}>Quá hạn {counts.overdue}</span> : null}
        </td>
        <td />
      </tr>
      {open && !data && !query.isError ? <NoteRow>Đang tải…</NoteRow> : null}
      {open && query.isError ? (
        <NoteRow>
          <span className={styles.groupOverdue}>
            {(query.error as MyWorkError | undefined)?.message ?? 'Không tải được công việc ngoài dự án.'}
          </span>{' '}
          <button type="button" className={styles.linkButton} onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </NoteRow>
      ) : null}
      {open && data
        ? data.items.map((entry) => (
            <StandaloneTaskRow
              key={entry.task.id}
              entry={entry}
              busy={savingItem === entry.task.id}
              assignerName={assignerName(entry)}
              onOpenTask={onOpenTask}
              onStatus={(next) => onStatus(entry, next)}
              onPatch={(patch, fallback) => onPatch(entry, patch, fallback)}
            />
          ))
        : null}
      {open && data ? (
        <PageBar total={shownTotal} page={page} pageSize={ui.pageSize} onPage={onPage} onPageSize={onPageSize} />
      ) : null}
    </tbody>
  );
}

/**
 * Một dòng việc: ưu tiên, trạng thái, hạn và tiến độ sửa ngay trên bảng. Trạng thái chỉ đưa ra các bước chuyển hợp
 * lệ; server vẫn kiểm quyền và ràng buộc (việc con chưa đóng, tiền nhiệm chưa xong) rồi báo lỗi nếu không được.
 */
function MyWorkRow({
  entry,
  busy,
  onOpen,
  onStatus,
  onPatch,
}: {
  entry: MyWorkItem;
  busy: boolean;
  onOpen?: MyWorkViewProps['onOpen'];
  onStatus: (next: WorkItemStatus) => void;
  onPatch: (patch: UpdateWorkItemRequest, fallback: string) => void;
}) {
  const { item } = entry;
  const locked = busy || Boolean(item.reversal);
  const statusOptions = workItemStatusKeys()
    .filter((status) => canTransitionWorkItem(item.status, status))
    // Việc đã hoàn thành mà người tạo không cho hoàn tác: không đưa ra lựa chọn mở lại (server cũng chặn).
    .filter((status) => !(item.status === 'done' && status !== 'done' && item.reopenPolicy === 'none'))
    .map((status) => ({
      value: status,
      label: WORK_ITEM_STATUS_LABELS[status],
      tone: WORK_ITEM_STATUS_TONE[status],
    }));
  const priorityOptions = [...priorityKeys()]
    .reverse()
    .map((priority) => ({ value: priority, label: priorityLabel(priority), tone: priorityTone(priority) }));
  if (!priorityOptions.some((option) => option.value === item.priority)) {
    priorityOptions.push({
      value: item.priority,
      label: priorityLabel(item.priority),
      tone: priorityTone(item.priority),
    });
  }

  return (
    <tr>
      <td>
        <button
          type="button"
          className={styles.cellTitleButton}
          onClick={() => onOpen?.(item.projectId, `work-item/${item.id}`)}
        >
          <span className={styles.treeCode}>{item.code}</span>
          {item.title}
        </button>
      </td>
      <td className={styles.cellSub}>
        <Tooltip content={entry.projectName}>
          <span>{entry.projectCode}</span>
        </Tooltip>
      </td>
      <td className={styles.inlineCell}>
        <ChipSelect
          label={`Ưu tiên của ${item.code}`}
          value={item.priority}
          options={priorityOptions}
          toned={false}
          lead={<PriorityIcon priority={item.priority} />}
          disabled={locked}
          onChange={(priority) =>
            onPatch({ priority: priority as WorkItemPriority }, 'Không đổi được mức ưu tiên.')
          }
        />
      </td>
      <td className={styles.inlineCell}>
        {item.reversal ? (
          <ChipButton tone={workItemStatusTone(item)}>{workItemStatusLabel(item)}</ChipButton>
        ) : (
          <span className={styles.blockedCell}>
            <ChipSelect
              label={`Trạng thái của ${item.code}`}
              value={item.status}
              options={statusOptions}
              dot
              disabled={locked}
              onChange={(status) => onStatus(status as WorkItemStatus)}
            />
            {item.status === 'blocked' ? <BlockedReasonMark reason={item.blockedReason} /> : null}
          </span>
        )}
      </td>
      <td className={styles.inlineCell}>
        <DateChip
          label={`Hạn của ${item.code}`}
          value={item.plannedEnd}
          min={item.plannedStart}
          overdue={entry.bucket === 'overdue'}
          disabled={locked}
          onChange={(value) =>
            onPatch({ plannedEnd: value || null }, 'Không đổi được hạn của công việc.')
          }
        />
      </td>
      <td>
        <ProgressCell
          label={`Tiến độ của ${item.code}`}
          value={item.progressPercent}
          manual={Boolean(item.progressManual)}
          auto={item.autoProgressPercent}
          disabled={locked}
          onCommit={(next) =>
            onPatch({ manualProgressPercent: next }, 'Không lưu được tiến độ.')
          }
        />
      </td>
    </tr>
  );
}

/**
 * Một dòng việc ngoài dự án, sửa trên bảng theo đúng vai: người giao đổi ưu tiên và hạn; người giao, người phụ trách
 * và người cùng làm cập nhật tiến độ; trạng thái chỉ đưa ra các bước vai đó được làm. Trả lại và huỷ việc cần ghi lý
 * do nên không có ở đây, làm ở trang Công việc khác.
 */
function StandaloneTaskRow({
  entry,
  busy,
  assignerName,
  onOpenTask,
  onStatus,
  onPatch,
}: {
  entry: MyWorkStandaloneTask;
  busy: boolean;
  assignerName: string;
  onOpenTask?: (taskId: string) => void;
  onStatus: (next: WorkItemStatus) => void;
  onPatch: (patch: UpdateStandaloneTaskRequest, fallback: string) => void;
}) {
  const { task, myRole } = entry;
  const open = task.status !== 'done' && task.status !== 'cancelled' && !task.reversal;
  const isAssigner = myRole === 'assigner';
  const canProgress = open && (isAssigner || myRole === 'assignee' || myRole === 'participant');
  const needsReason = (next: WorkItemStatus) =>
    next === 'cancelled' || (isAssigner && task.status === 'review' && next === 'in_progress');
  const allowed = allowedStandaloneTaskTransitions(task, myRole).filter((next) => !needsReason(next));
  const statusOptions = [task.status, ...allowed]
    .filter((status, index, list) => list.indexOf(status) === index)
    .map((status) => ({
      value: status,
      label: WORK_ITEM_STATUS_LABELS[status],
      tone: WORK_ITEM_STATUS_TONE[status],
    }));
  const priorityOptions = [...priorityKeys()]
    .reverse()
    .map((priority) => ({
      value: priority,
      label: priorityLabel(priority),
      tone: priorityTone(priority),
    }));

  return (
    <tr>
      <td>
        <button type="button" className={styles.cellTitleButton} onClick={() => onOpenTask?.(task.id)}>
          <span className={styles.treeCode}>{task.code}</span>
          {task.title}
        </button>
      </td>
      <td className={styles.cellSub}>
        {entry.awaitingMyApproval ? (
          <span className={styles.inlineIcon}>
            <Clock3 size={13} aria-hidden /> Chờ bạn duyệt
          </span>
        ) : (
          assignerName
        )}
      </td>
      <td className={styles.inlineCell}>
        {isAssigner && open ? (
          <ChipSelect
            label={`Ưu tiên của ${task.code}`}
            value={task.priority}
            options={priorityOptions}
            toned={false}
            lead={<PriorityIcon priority={task.priority} />}
            disabled={busy}
            onChange={(next) =>
              onPatch({ priority: next as WorkItemPriority }, 'Không đổi được mức ưu tiên.')
            }
          />
        ) : (
          <ChipButton>
            <PriorityIcon priority={task.priority} />
            {priorityLabel(task.priority)}
          </ChipButton>
        )}
      </td>
      <td className={styles.inlineCell}>
        <span className={styles.blockedCell}>
          {statusOptions.length > 1 ? (
            <ChipSelect
              label={`Trạng thái của ${task.code}`}
              value={task.status}
              options={statusOptions}
              dot
              disabled={busy}
              onChange={(next) => onStatus(next as WorkItemStatus)}
            />
          ) : (
            <ChipButton tone={WORK_ITEM_STATUS_TONE[task.status]}>
              <span className={styles.chipDot} />
              {WORK_ITEM_STATUS_LABELS[task.status]}
            </ChipButton>
          )}
          {task.status === 'blocked' && !task.reversal ? <BlockedReasonMark reason={task.blockedReason} /> : null}
        </span>
      </td>
      <td className={styles.inlineCell}>
        {isAssigner && open ? (
          <DateChip
            label={`Hạn của ${task.code}`}
            value={task.dueDate}
            min={task.plannedStart}
            overdue={entry.bucket === 'overdue'}
            disabled={busy}
            onChange={(value) =>
              onPatch({ dueDate: value || null }, 'Không đổi được hạn của công việc.')
            }
          />
        ) : (
          <ChipButton dashed={!task.dueDate}>
            <CalendarDays size={13} aria-hidden />
            {formatDate(task.dueDate) || 'Chưa đặt hạn'}
          </ChipButton>
        )}
      </td>
      <td>
        <ProgressCell
          label={`Tiến độ của ${task.code}`}
          value={task.progressPercent}
          manual={Boolean(task.progressManual)}
          auto={task.autoProgressPercent}
          disabled={busy || !canProgress}
          onCommit={(next) => onPatch({ manualProgressPercent: next }, 'Không lưu được tiến độ.')}
        />
      </td>
    </tr>
  );
}

/**
 * Nút "Tạo mới" ở góc trên phải: rê chuột (hoặc bấm/điểm focus) để xổ hai mục
 * "Dự án mới" và "Công việc mới". Đóng lại khi con trỏ rời khỏi cả nút lẫn menu.
 */
function CreateMenu({
  onNewProject,
  onNewWorkItem,
}: {
  onNewProject: () => void;
  onNewWorkItem: () => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };
  // Đóng trễ một nhịp để con trỏ kịp đi từ nút xuống menu mà không bị cụp.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => cancelClose, []);

  return (
    <div
      className={styles.createMenu}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={styles.buttonPrimary}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
      >
        <Plus size={15} /> Tạo mới
      </button>
      {open ? (
        <div className={styles.createMenuList} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.createMenuItem}
            onClick={() => {
              setOpen(false);
              onNewProject();
            }}
          >
            Dự án mới
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.createMenuItem}
            onClick={() => {
              setOpen(false);
              onNewWorkItem();
            }}
          >
            Công việc mới
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Lời mời chờ phản hồi: giờ, tên buổi và ba nút trả lời ngay tại chỗ. */
function InvitationChip({
  event,
  busy,
  onOpen,
  onRespond,
}: {
  event: MyWorkEvent;
  busy: boolean;
  onOpen?: MyWorkViewProps['onOpen'];
  onRespond: (response: ParticipantResponse) => void;
}) {
  return (
    <span className={styles.dayChip}>
      <EventTitle event={event} onOpen={onOpen}>
        <b>{formatDateTime(event.startAt)}</b> {event.title}
      </EventTitle>
      {/* Trả lời xong thì lời mời rời dải này ở lần tải lại. */}
      <span className={styles.responseGroup} role="group" aria-label="Phản hồi lời mời">
        {INVITATION_RESPONSES.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={busy}
            onClick={() => onRespond(option.value)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </span>
  );
}

/**
 * Tên sự kiện: bấm để mở sự kiện trong lịch của dự án. Sự kiện không thuộc
 * dự án nào thì chỉ là chữ — trang Dự án không có chỗ để mở nó.
 */
function EventTitle({
  event,
  onOpen,
  children,
}: {
  event: MyWorkEvent;
  onOpen?: MyWorkViewProps['onOpen'];
  children: ReactNode;
}) {
  if (!event.projectId || !onOpen) return <span>{children}</span>;
  const projectId = event.projectId;
  return (
    <button
      type="button"
      className={styles.chipLink}
      onClick={() => onOpen(projectId, `calendar/${event.eventId}`)}
    >
      {children}
    </button>
  );
}
