'use client';

import {
  MY_WORK_PAGE_SIZES,
  MY_WORK_SEARCH_FIELDS,
  MY_WORK_SEARCH_MAX_LENGTH,
  allowedStandaloneTaskTransitions,
  canTransitionWorkItem,
  type MyWorkSearch,
  type MyWorkSearchField,
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
  type StandaloneTaskDetail,
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
  AlarmClock,
  AtSign,
  CalendarClock,
  CalendarDays,
  Clock3,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  ExternalLink,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
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
import { finishProjectCreate } from '../related-objects-link';
import type { PendingRelatedObject } from '../related-objects.model';
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
  externalStatusLabel,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ErrorToast } from './error-toast';
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
import { STANDALONE_PROGRESS_ADAPTER, useProgressReport } from './use-progress-report';
import { progressCellMode } from '../progress-cell-rules';
import { useFillViewportHeight } from './use-fill-viewport';
import { Tooltip } from './tooltip';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { buildMyWorkSearch, searchWords, splitHighlight } from '../my-work-search';
import { explicitTableStyle, useColumnOrder, useColumnWidths } from '../column-order';
import { ReorderableTh, ResetColumnLayoutButton } from './reorderable-th';

/** Nhãn các trường tìm trong bảng "Tìm theo". */
const SEARCH_FIELD_LABELS: Record<MyWorkSearchField, string> = {
  code: 'Mã việc',
  title: 'Tên việc',
  description: 'Mô tả',
  project: 'Dự án',
  people: 'Người giao / người liên quan',
};

/** Từ đủ ít nhóm thì tự mở các nhóm khớp để thấy kết quả ngay. */
const SEARCH_AUTO_OPEN_MAX_GROUPS = 5;
const SEARCH_DEBOUNCE_MS = 300;

/** Các từ cần tô đậm theo từng cột (chỉ mã và tên việc). */
interface SearchHighlight {
  readonly code: readonly string[];
  readonly title: readonly string[];
}

/** Chữ có tô đậm phần khớp chữ tìm; không có từ nào thì trả nguyên chữ. */
function Highlight({ text, words }: { text: string; words?: readonly string[] }) {
  if (!words || words.length === 0) return <>{text}</>;
  return (
    <>
      {splitHighlight(text, words).map((segment, index) =>
        segment.hit ? (
          <mark key={index} className={styles.mwSearchMark}>
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

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

/** Các cột bảng theo thứ tự mặc định; người dùng kéo tiêu đề để đổi chỗ (cột "Công việc" được ghim ở đầu). */
const MY_WORK_COLUMNS = ['work', 'assigner', 'priority', 'status', 'due', 'progress'] as const;
type MyWorkColumnId = (typeof MY_WORK_COLUMNS)[number];
const MY_WORK_PINNED: readonly string[] = ['work'];
const MY_WORK_COLUMN_LABELS: Record<MyWorkColumnId, string> = {
  work: 'Công việc',
  assigner: 'Người giao',
  priority: 'Ưu tiên',
  status: 'Trạng thái',
  due: 'Hạn',
  progress: 'Tiến độ',
};
const MY_WORK_COL_CLASS: Record<MyWorkColumnId, string | undefined> = {
  work: undefined,
  assigner: styles.myWorkColAssigner,
  priority: styles.myWorkColPriority,
  status: styles.myWorkColStatus,
  due: styles.myWorkColDue,
  progress: styles.myWorkColProgress,
};

/** Các ô của một hàng theo thứ tự cột hiện tại. */
const renderCells = (order: readonly string[], cells: Record<MyWorkColumnId, ReactNode>) =>
  order.map((id) => <Fragment key={id}>{cells[id as MyWorkColumnId]}</Fragment>);

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
  /**
   * Phần sau `#my-work/` của đường dẫn. `mention/{messageId}` là link của thông báo "Bạn được nhắc đến":
   * tra tin nhắn trong danh sách nhắc tên rồi mở luôn khung trao đổi của việc hay dự án chứa nó.
   */
  readonly target?: string;
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

function MyWorkBody({ onOpen, onOpenTask, target }: MyWorkViewProps) {
  const directory = useDirectory();
  const { ui, setFilter, setSort, clearFilter, setSearch, toggleGroup, toggleStandalone, setPage, setPageSize } =
    useMyWorkUi();

  // Tìm kiếm: `draft` là chữ đang gõ (hiện ngay), vào store sau 300ms hoặc khi bấm Enter.
  const [draft, setDraft] = useState(ui.search.q);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);
  const searchFields = ui.search.fields;
  const commitSearch = useCallback(
    (q: string, fields: readonly MyWorkSearchField[] = searchFields) => setSearch({ q, fields }),
    [setSearch, searchFields],
  );
  useEffect(() => {
    setDraft(ui.search.q);
  }, [ui.search.q]);
  useEffect(() => {
    if (draft === ui.search.q) return undefined;
    const timer = window.setTimeout(() => commitSearch(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, ui.search.q, commitSearch]);
  useEffect(() => {
    if (!searchPanelOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!searchBox.current?.contains(event.target as Node)) setSearchPanelOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [searchPanelOpen]);
  const toggleSearchField = (field: MyWorkSearchField) => {
    const has = searchFields.includes(field);
    if (has && searchFields.length === 1) return;
    const next = MY_WORK_SEARCH_FIELDS.filter((value) => (value === field ? !has : searchFields.includes(value)));
    commitSearch(draft, next);
  };

  // Điều kiện tìm gửi lên server: `personIds` tra từ danh bạ khi có tìm theo người.
  const search = useMemo<MyWorkSearch | undefined>(
    () => buildMyWorkSearch(ui.search.q, ui.search.fields, directory.people),
    [ui.search.q, ui.search.fields, directory.people],
  );
  const searchActive = search !== undefined;
  const highlight = useMemo<SearchHighlight>(() => {
    const words = searchActive ? searchWords(ui.search.q) : [];
    return {
      code: ui.search.fields.includes('code') ? words : [],
      title: ui.search.fields.includes('title') ? words : [],
    };
  }, [searchActive, ui.search.q, ui.search.fields]);
  // Nhóm người dùng tự thu lại trong lúc đang tự mở theo tìm kiếm; về rỗng khi đổi điều kiện tìm.
  const [closedBySearch, setClosedBySearch] = useState<readonly string[]>([]);
  useEffect(() => {
    setClosedBySearch([]);
  }, [ui.search.q, ui.search.fields]);

  const overviewQuery = useMyWorkOverviewQuery({
    sort: ui.sort,
    status: (ui.status || undefined) as WorkItemStatus | undefined,
    priority: (ui.priority || undefined) as WorkItemPriority | undefined,
    projectId: ui.projectId || undefined,
    search,
  });
  // `data` giữ bản của lần trước trong lúc đổi bộ lọc nạp lại, nên số liệu và danh sách không nháy trống.
  const overview = overviewQuery.data;
  const overviewError = (overviewQuery.error as MyWorkError | undefined)?.message;

  // Link của thông báo nhắc tên: `#my-work/mention/{messageId}`. Hỏi server tin nằm ở node nào (hai truy vấn khoá
  // chính, không phụ thuộc danh sách nhắc tên vốn chỉ giữ ít tin mới nhất, cũng không chờ tổng quan tải xong) rồi mở
  // đúng việc/dự án kèm khung trao đổi, cuộn tới tin. Mỗi đích chỉ áp một lần.
  const appliedTarget = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!target || !onOpen || appliedTarget.current === target) return;
    const [kind, messageId] = target.split('/');
    if (kind !== 'mention' || !messageId) return;
    appliedTarget.current = target;
    let id = messageId;
    try {
      id = decodeURIComponent(messageId);
    } catch {
      // giữ nguyên id thô
    }
    void api
      .getChatMessageLocation(id)
      .then((place) => onOpen(place.projectId, `chat/${place.entityType}/${place.entityId}/${encodeURIComponent(id)}`))
      .catch(() =>
        setError('Không mở được tin nhắn được nhắc: tin đã bị xoá hoặc bạn không còn quyền xem dự án chứa nó.'),
      );
  }, [target, onOpen]);

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
  // Phần phía trên khung (dải lịch, báo lỗi) hiện hoặc ẩn muộn thì phải đo lại, nếu không đáy khung tràn.
  const aboveKey = [
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
  const columnOrder = useColumnOrder('my-work', me || undefined, MY_WORK_COLUMNS, MY_WORK_PINNED);
  const sizing = useColumnWidths('my-work', me || undefined, MY_WORK_COLUMNS);
  const tableSizingStyle = explicitTableStyle(columnOrder.order, sizing.widths);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  /** Mọi dự án người dùng thấy, dùng cho ô chọn "Dự án" trong form Công việc mới. */
  const [projectList, setProjectList] = useState<readonly ProjectSummary[]>([]);
  /** Dự án đang chọn trong form Công việc mới (chưa có dự án nào mở ở trang này). */
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [members, setMembers] = useState<readonly ProjectMember[]>([]);
  const [parentOptions, setParentOptions] = useState<{ id: string; label: string; done: boolean }[]>([]);

  useEffect(() => {
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

  /** Tiến độ của việc trong dự án đi qua luồng báo cáo tiến độ (đổi trạng thái theo con số, hộp báo cáo khi 100%). */
  const {
    setProgress: reportItemProgress,
    reportQuantity,
    dialog: progressDialog,
  } = useProgressReport(() => {
    invalidateMyWork();
  });

  const patchItem = async (itemId: string, patch: UpdateWorkItemRequest, fallback: string) => {
    // Chỉ khi có số mới (không phải "về tự động"): các lần sửa khác vẫn là cập nhật thẳng.
    if (typeof patch.manualProgressPercent === 'number') {
      setSavingItem(itemId);
      try {
        // Bản mới nhất của việc: hộp báo cáo và toast cần mã, tên và trạng thái hiện tại.
        await reportItemProgress(await api.getWorkItem(itemId), patch.manualProgressPercent);
      } catch (cause) {
        setError(messageOf(cause, fallback));
      } finally {
        setSavingItem(undefined);
      }
      return;
    }
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

  /** Tiến độ của việc lá ngoài dự án đi qua luồng báo cáo tiến độ (đổi trạng thái theo số, hộp báo cáo khi 100%). */
  const taskProgress = useProgressReport<StandaloneTaskDetail>(() => {
    invalidateMyWork();
  }, STANDALONE_PROGRESS_ADAPTER);

  const onTaskPatch = (entry: MyWorkStandaloneTask, patch: UpdateStandaloneTaskRequest, fallback: string) => {
    if (typeof patch.manualProgressPercent === 'number' && entry.task.childCount === 0) {
      void taskProgress.setProgress(entry.task, patch.manualProgressPercent);
      return;
    }
    void runTask(entry.task.id, () => api.updateStandaloneTask(entry.task.id, patch), fallback);
  };

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
  const hasStandalone = Boolean(standalone && standalone.total > 0);
  const searchEmpty = searchActive && Boolean(overview) && groups.length === 0 && !hasStandalone;
  // Đang tìm và kết quả gọn thì mở sẵn các nhóm khớp; không đụng `ui.expanded` đã nhớ.
  const autoOpen = searchActive && groups.length + (hasStandalone ? 1 : 0) <= SEARCH_AUTO_OPEN_MAX_GROUPS;
  const isOpen = (key: string, remembered: boolean) => (autoOpen ? !closedBySearch.includes(key) : remembered);
  const toggleOpen = (key: string, remembered: () => void) =>
    autoOpen
      ? setClosedBySearch((list) => (list.includes(key) ? list.filter((value) => value !== key) : [...list, key]))
      : remembered();

  return (
    <div className={styles.tabBody}>
      <ErrorToast message={error} />

      <div className={styles.myWorkHead}>
        <div className={`${styles.pageHeadCard} ${styles.myWorkHeadCard}`}>
          <h1 className={styles.pageTitle}>Công việc của tôi</h1>
          {/* Ba số liệu, mỗi số một màu: xanh dương (đang mở), đỏ (quá hạn, xám khi không có), xanh lá (đã xong). */}
          <div className={styles.myWorkStats}>
            <span className={`${styles.myWorkStat} ${styles.myWorkStatOpen}`}>
              <span className={styles.myWorkStatIcon} aria-hidden>
                <ClipboardList size={15} />
              </span>
              <b>{counters?.openItems ?? '—'}</b>
              <span className={styles.myWorkStatLabel}>đang mở</span>
            </span>
            <span
              className={`${styles.myWorkStat} ${
                counters && counters.overdueItems > 0 ? styles.myWorkStatLate : styles.myWorkStatQuiet
              }`}
            >
              <span className={styles.myWorkStatIcon} aria-hidden>
                <AlarmClock size={15} />
              </span>
              <b>{counters?.overdueItems ?? '—'}</b>
              <span className={styles.myWorkStatLabel}>quá hạn</span>
            </span>
            <span className={`${styles.myWorkStat} ${styles.myWorkStatDone}`}>
              <span className={styles.myWorkStatIcon} aria-hidden>
                <CircleCheck size={15} />
              </span>
              <b>{counters?.completedThisWeek ?? '—'}</b>
              <span className={styles.myWorkStatLabel}>xong tuần này</span>
            </span>
          </div>
        </div>
        <div className={styles.pageHeadEnd}>
          {overviewQuery.isFetching ? <span className={styles.muted}>Đang tải…</span> : null}
          <Tooltip content={sideOpen ? 'Ẩn nhắc tên và việc từ module khác' : 'Nhắc tên và việc từ module khác'}>
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
          <ResetColumnLayoutButton order={columnOrder} sizing={sizing} />
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
              <div className={styles.timelinePanelBox}>
                <div className={styles.mwSearchBox} role="search">
                  <Search size={14} aria-hidden className={styles.mwSearchIcon} />
                  <Input
                    type="text"
                    value={draft}
                    maxLength={MY_WORK_SEARCH_MAX_LENGTH}
                    placeholder="Tìm theo mã, tên, mô tả, dự án, người…"
                    aria-label="Tìm công việc"
                    className="pl-8 pr-7"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitSearch(draft);
                      } else if (event.key === 'Escape') {
                        setDraft('');
                        commitSearch('');
                      }
                    }}
                  />
                  {draft ? (
                    <button
                      type="button"
                      className={styles.mwSearchClear}
                      aria-label="Xoá tìm kiếm"
                      onClick={() => {
                        setDraft('');
                        commitSearch('');
                      }}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
              <div ref={searchBox} className={styles.timelinePanelBox}>
                <button
                  type="button"
                  className={
                    searchFields.length < MY_WORK_SEARCH_FIELDS.length || searchPanelOpen
                      ? styles.timelineToggleOn
                      : styles.timelineToggle
                  }
                  aria-haspopup="dialog"
                  aria-expanded={searchPanelOpen}
                  onClick={() => setSearchPanelOpen((value) => !value)}
                >
                  Tìm theo
                  {searchFields.length < MY_WORK_SEARCH_FIELDS.length ? (
                    <span className={styles.countBadge}>{searchFields.length}</span>
                  ) : null}
                </button>
                {searchPanelOpen ? (
                  <div
                    className={`${styles.timelinePanel} ${styles.timelinePanelLeft} ${styles.mwSearchPanel}`}
                    role="dialog"
                    aria-label="Chọn trường để tìm"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setSearchPanelOpen(false);
                      }
                    }}
                  >
                    {MY_WORK_SEARCH_FIELDS.map((field) => (
                      <label key={field} className={styles.mwSearchField}>
                        <Checkbox
                          checked={searchFields.includes(field)}
                          disabled={searchFields.length === 1 && searchFields.includes(field)}
                          onCheckedChange={() => toggleSearchField(field)}
                        />
                        {SEARCH_FIELD_LABELS[field]}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
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
            <table
              hidden={searchEmpty}
              className={`${styles.table} ${styles.ledgerTable} ${styles.treeTable} ${styles.myWorkTable}${sizing.customized ? ` ${styles.columnsResized}` : ''}`}
              style={tableSizingStyle}
            >
              {/* Chiều rộng cột cố định: mở hay thu một nhóm không làm các cột dịch chỗ. */}
              <colgroup>
                {columnOrder.order.map((id) => (
                  <col
                    key={id}
                    className={MY_WORK_COL_CLASS[id as MyWorkColumnId]}
                    style={tableSizingStyle ? { width: sizing.widths?.[id] } : undefined}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columnOrder.order.map((id) => (
                    <ReorderableTh
                      key={id}
                      tableKey="my-work"
                      id={id}
                      order={columnOrder.order}
                      pinned={MY_WORK_PINNED}
                      onMove={columnOrder.move}
                      sizing={sizing}
                      label={MY_WORK_COLUMN_LABELS[id as MyWorkColumnId]}
                    >
                      {MY_WORK_COLUMN_LABELS[id as MyWorkColumnId]}
                    </ReorderableTh>
                  ))}
                </tr>
              </thead>
              {groups.map((group) => (
                <ProjectGroupBody
                  key={group.projectId}
                  order={columnOrder.order}
                  group={group}
                  ui={ui}
                  search={search}
                  highlight={highlight}
                  open={isOpen(group.projectId, ui.expanded.includes(group.projectId))}
                  onToggle={() => toggleOpen(group.projectId, () => toggleGroup(group.projectId))}
                  onOpen={onOpen}
                  assignerName={(entry) => directory.nameOf(entry.item.createdBy)}
                  savingItem={savingItem}
                  onStatus={onItemStatus}
                  onPatch={(entry, patch, fallback) => void patchItem(entry.item.id, patch, fallback)}
                  onQuantity={(entry) => reportQuantity(entry.item)}
                  onPage={(page) => setPage(group.projectId, page)}
                  onPageSize={setPageSize}
                />
              ))}
              {standalone && standalone.total > 0 ? (
                <StandaloneBody
                  order={columnOrder.order}
                  total={standalone.total}
                  counts={standalone.counts}
                  ui={ui}
                  search={search}
                  highlight={highlight}
                  open={isOpen(MY_WORK_STANDALONE_KEY, ui.standaloneOpen)}
                  onToggle={() => toggleOpen(MY_WORK_STANDALONE_KEY, toggleStandalone)}
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
                {searchEmpty
                  ? `Không có việc nào khớp “${ui.search.q.trim()}”${hasFilter ? ' với bộ lọc hiện tại' : ''}.`
                  : hasFilter
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
                      <span className={styles.externalStatus}>{externalStatusLabel(card.cachedStatus) ?? '—'}</span>
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
          relatedObjects?: readonly PendingRelatedObject[],
          reportGroupId?: string,
        ) => {
          const created = await api.createProject(input);
          const warning = initialTasksWarning(created);
          if (warning) setError(warning);
          // Số tiền, thành viên (PUT .../members, cần đúng một chủ nhiệm) và đối tượng liên quan đi đường riêng.
          const warnings = await finishProjectCreate(created, { contractValue, members, relatedObjects, reportGroupId });
          for (const text of warnings) toast.warning(text);
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
          const created = await api.createWorkItem({
            ...input,
            projectId: selectedProjectId,
            procedureDefinitionId,
          });
          invalidateMyWork();
          return created;
        }}
        // Tạo từ trang này không sửa việc; onUpdate chỉ để thoả kiểu dữ liệu.
        onUpdate={async () => undefined}
      />

      {/* Vướng mắc luôn qua hộp ghi lý do (việc dự án lẫn việc giao lẻ). */}
      {blockedPrompt.dialog}
      {progressDialog}
      {taskProgress.dialog}

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
  order,
  group,
  ui,
  search,
  highlight,
  open,
  onToggle,
  onOpen,
  assignerName,
  savingItem,
  onStatus,
  onPatch,
  onQuantity,
  onPage,
  onPageSize,
}: {
  order: readonly string[];
  group: MyWorkGroupSummary;
  ui: MyWorkUiState;
  search?: MyWorkSearch;
  highlight: SearchHighlight;
  open: boolean;
  onToggle: () => void;
  onOpen?: MyWorkViewProps['onOpen'];
  assignerName: (entry: MyWorkItem) => string;
  savingItem?: string;
  onStatus: (entry: MyWorkItem, next: WorkItemStatus) => void;
  onPatch: (entry: MyWorkItem, patch: UpdateWorkItemRequest, fallback: string) => void;
  onQuantity: (entry: MyWorkItem) => void;
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
      search,
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
        {renderCells(order, {
          work: (
        <th scope="row">
          <div className={styles.workCell}>
            <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={onToggle}>
              {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <Tooltip content={group.projectCode}>
                <span className={styles.treeCode}>{group.projectCode}</span>
              </Tooltip>
              <Tooltip content={group.projectName}>
                <span className={styles.workTitle}>{group.projectName}</span>
              </Tooltip>
            </button>
            {onOpen ? (
              <Tooltip content="Mở dự án">
                <button
                  type="button"
                  className={styles.groupOpenIcon}
                  aria-label={`Mở dự án ${group.projectName}`}
                  onClick={() => onOpen(group.projectId, `project/${group.projectId}`)}
                >
                  <ExternalLink size={14} aria-hidden />
                </button>
              </Tooltip>
            ) : null}
          </div>
        </th>
          ),
          assigner: <td />,
          priority: (
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
          ),
          status: (
        <td>
          <GroupCounts counts={counts} unit="việc" />
        </td>
          ),
          due: (
        <td>
          {counts.overdue > 0 ? (
            <span className={styles.groupOverdue}>Quá hạn {counts.overdue}</span>
          ) : group.nextDue ? (
            <span className={styles.groupSummaryText}>{formatDate(group.nextDue)}</span>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
          ),
          progress: (
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
          ),
        })}
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
              order={order}
              entry={entry}
              highlight={highlight}
              busy={savingItem === entry.item.id}
              assignerName={assignerName(entry)}
              onOpen={onOpen}
              onStatus={(next) => onStatus(entry, next)}
              onPatch={(patch, fallback) => onPatch(entry, patch, fallback)}
              onQuantity={() => onQuantity(entry)}
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
  order,
  total,
  counts,
  ui,
  search,
  highlight,
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
  order: readonly string[];
  total: number;
  counts: MyWorkGroupCounts;
  ui: MyWorkUiState;
  search?: MyWorkSearch;
  highlight: SearchHighlight;
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
  const query = useMyWorkStandaloneQuery(
    { sort: ui.sort, page, pageSize: ui.pageSize, search },
    { skip: !open },
  );
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
        {renderCells(order, {
          work: (
            <th scope="row">
              <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={onToggle}>
                {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                <ClipboardList size={14} aria-hidden /> Công việc khác
                <span className={styles.groupSummaryMuted}>· {total} việc</span>
              </button>
            </th>
          ),
          assigner: <td />,
          priority: <td />,
          status: (
            <td>
              <GroupCounts counts={counts} unit="việc" />
            </td>
          ),
          due: (
            <td>
              {counts.overdue > 0 ? <span className={styles.groupOverdue}>Quá hạn {counts.overdue}</span> : null}
            </td>
          ),
          progress: <td />,
        })}
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
              order={order}
              entry={entry}
              highlight={highlight}
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
  order,
  entry,
  highlight,
  busy,
  assignerName,
  onOpen,
  onStatus,
  onPatch,
  onQuantity,
}: {
  order: readonly string[];
  entry: MyWorkItem;
  highlight: SearchHighlight;
  busy: boolean;
  assignerName: string;
  onOpen?: MyWorkViewProps['onOpen'];
  onStatus: (next: WorkItemStatus) => void;
  onPatch: (patch: UpdateWorkItemRequest, fallback: string) => void;
  /** Báo khối lượng đã làm (việc tính tiến độ theo khối lượng). */
  onQuantity: () => void;
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

  const cells: Record<MyWorkColumnId, ReactNode> = {
    work: (
      <td>
        <div className={`${styles.workCell} ${styles.workChild}`}>
          <span className={styles.workIndent} aria-hidden />
          <button
            type="button"
            className={styles.cellTitleButton}
            onClick={() => onOpen?.(item.projectId, `work-item/${item.id}`)}
          >
            <span className={styles.treeCode}>
              <Highlight text={item.code} words={highlight.code} />
            </span>
            <Tooltip content={item.title}>
              <span className={styles.workTitle}>
                <Highlight text={item.title} words={highlight.title} />
              </span>
            </Tooltip>
          </button>
        </div>
      </td>
    ),
    assigner: (
      <td className={styles.cellSub}>
        <span className={styles.workTitle}>{assignerName}</span>
      </td>
    ),
    priority: (
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
    ),
    status: (
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
    ),
    due: (
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
    ),
    progress: (
      <td>
        {(() => {
          // Việc có việc con không có trong bảng này theo cách riêng, nên chỉ xét cách tính của chính nó.
          const mode = progressCellMode(item, { hasChildren: false, canWrite: !locked });
          return (
            <ProgressCell
              label={`Tiến độ của ${item.code}`}
              value={item.progressPercent}
              manual={Boolean(item.progressManual)}
              auto={item.autoProgressPercent}
              expected={item.expectedProgressPercent}
              disabled={!mode.editable}
              lockedReason={mode.reason}
              onOpen={mode.quantity ? onQuantity : undefined}
              onCommit={(next) => onPatch({ manualProgressPercent: next }, 'Không lưu được tiến độ.')}
            />
          );
        })()}
      </td>
    ),
  };

  return <tr>{renderCells(order, cells)}</tr>;
}

/**
 * Một dòng việc ngoài dự án, sửa trên bảng theo đúng vai: người giao đổi ưu tiên và hạn; người giao, người phụ trách
 * và người cùng làm cập nhật tiến độ; trạng thái chỉ đưa ra các bước vai đó được làm. Trả lại và huỷ việc cần ghi lý
 * do nên không có ở đây, làm ở trang Công việc khác.
 */
function StandaloneTaskRow({
  order,
  entry,
  highlight,
  busy,
  assignerName,
  onOpenTask,
  onStatus,
  onPatch,
}: {
  order: readonly string[];
  entry: MyWorkStandaloneTask;
  highlight: SearchHighlight;
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

  const cells: Record<MyWorkColumnId, ReactNode> = {
    work: (
      <td>
        <div className={`${styles.workCell} ${styles.workChild}`}>
          <span className={styles.workIndent} aria-hidden />
          <button type="button" className={styles.cellTitleButton} onClick={() => onOpenTask?.(task.id)}>
            <span className={styles.treeCode}>
              <Highlight text={task.code} words={highlight.code} />
            </span>
            <Tooltip content={task.title}>
              <span className={styles.workTitle}>
                <Highlight text={task.title} words={highlight.title} />
              </span>
            </Tooltip>
          </button>
        </div>
      </td>
    ),
    assigner: (
      <td className={styles.cellSub}>
        {entry.awaitingMyApproval ? (
          <span className={styles.inlineIcon}>
            <Clock3 size={13} aria-hidden /> Chờ bạn duyệt
          </span>
        ) : (
          assignerName
        )}
      </td>
    ),
    priority: (
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
    ),
    status: (
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
    ),
    due: (
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
    ),
    progress: (
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
    ),
  };

  return <tr>{renderCells(order, cells)}</tr>;
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
