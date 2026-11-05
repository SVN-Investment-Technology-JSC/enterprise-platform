'use client';

import type {
  DocumentSummary,
  ProjectChatTimelineItem,
  ProjectMember,
  WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { MAX_CHAT_BODY_LENGTH } from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import { CornerDownRight, MoreHorizontal, Paperclip } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { invalidateChatFeed, useChatTimelineInfiniteQuery } from '../chat-feed-store';
import {
  buildTimelineRows,
  chipHueMap,
  EMPTY_FILTER_DRAFT,
  flattenTimelinePages,
  isTimelineFilterActive,
  splitByQuery,
  splitTimeline,
  toTimelineFilter,
  type TimelineFilterDraft,
  type TimelineMessageRow,
  type TimelineRow,
} from '../chat-timeline.model';
import { extractMentions, mentionHandles, scanMentions, splitByMentions } from '../mention.model';
import { formatDate, formatDateTime } from '../workspace-labels';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { ChatTimelineFilters } from './chat-timeline-filters';
import { ContextMenu, type ContextAction } from './project-tree';
import { Tooltip } from './tooltip';
import { useDirectory } from './use-directory';
import { useFillViewportHeight } from './use-fill-viewport';

/** Cách đáy tối đa chừng này (px) vẫn coi là "đang đọc tin mới nhất" và tự kéo xuống khi có tin mới. */
const STICK_TO_BOTTOM_PX = 80;
const EXCERPT_LENGTH = 90;
/** Các việc làm được trên một tin, mở từ nút "⋯" hiện khi rê chuột vào tin. */
const MESSAGE_ACTIONS: readonly ContextAction[] = [{ id: 'reply', label: 'Trả lời' }];
/** Độ rộng cột trái (% của khung) kéo được trong khoảng này, mặc định 60%; nhớ theo máy người dùng. */
const LEFT_MIN_PCT = 25;
const LEFT_MAX_PCT = 75;
const LEFT_DEFAULT_PCT = 60;
const LEFT_STEP_PCT = 2;
/** Tối đa số trang cũ nạp thêm để tìm tin gốc khi bấm dòng trích. */
const MAX_JUMP_PAGES = 20;
/** Chờ người dùng gõ xong từ khoá chừng này (ms) rồi mới tìm. */
const FILTER_DEBOUNCE_MS = 300;
/** Ô soạn tin cao dần theo số dòng, tối đa chừng này (px). */
const INPUT_MAX_HEIGHT_PX = 120;
/** Số khung hình đứng yên liền nhau thì coi như cuộn xong; quá số khung tối đa thì thôi chờ. */
const SETTLE_STILL_FRAMES = 4;
const SETTLE_MAX_FRAMES = 90;
const LEFT_STORAGE = 'workspace.chat-timeline.left-pct';
const clampLeft = (value: number) => Math.min(LEFT_MAX_PCT, Math.max(LEFT_MIN_PCT, value));

export interface ChatTimelinePaneProps {
  readonly projectId: string;
  readonly items: readonly WorkItem[];
  readonly members: readonly ProjectMember[];
  readonly documents: readonly DocumentSummary[];
  /** Vai trò viewer chỉ đọc nên không có nút "Trả lời" và không có ô chat chung. */
  readonly canReply: boolean;
  /** Bấm chip công việc để mở hộp chi tiết của nó. */
  readonly onOpen: (item: WorkItem) => void;
  /** Chỗ trên hàng tab để đặt thanh lọc (xem `ChatTimelineFilters`). */
  readonly toolbarSlot?: HTMLElement | null;
}

/**
 * Chờ khung cuộn mượt xong: vị trí của phần tử đứng yên vài khung hình liền (hoặc quá hạn). Tin đã nằm sẵn giữa
 * khung thì xong gần như ngay.
 */
function settled(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let lastTop = element.getBoundingClientRect().top;
    let still = 0;
    let frames = 0;
    const tick = () => {
      const top = element.getBoundingClientRect().top;
      still = Math.abs(top - lastTop) < 0.5 ? still + 1 : 0;
      lastTop = top;
      frames += 1;
      if (still >= SETTLE_STILL_FRAMES || frames >= SETTLE_MAX_FRAMES) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const excerpt = (body: string) => {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat;
};

/**
 * Trao đổi của dự án theo thời gian, hai cột, mỗi cột xếp cũ → mới:
 *  - Trái: tin của mọi công việc. Mỗi tin mang chip công việc (mỗi công việc một màu nền nhạt), bấm vào mở công việc đó.
 *    Chỉ đọc, trừ nút "Trả lời": câu trả lời được server ghi vào đúng kênh của tin được trả lời, nên mở trao đổi của
 *    công việc đó vẫn thấy. Không có ô nhập tự do, vì tin không trả lời tin nào thì không biết thuộc công việc nào.
 *  - Phải: chat chung của dự án, có ô nhập để nhắn thẳng vào đó.
 * Đọc ở đây không đánh dấu đã đọc.
 */
export function ChatTimelinePane({
  projectId,
  items,
  members,
  documents,
  canReply,
  onOpen,
  toolbarSlot,
}: ChatTimelinePaneProps) {
  const feed = useRef<HTMLElement>(null);
  useFillViewportHeight(feed);
  const directory = useDirectory();
  // Ô lọc đổi ngay trên màn hình; riêng từ khoá chờ người dùng gõ xong một nhịp rồi mới gọi server.
  const [draft, setDraft] = useState<TimelineFilterDraft>(EMPTY_FILTER_DRAFT);
  const [settledQuery, setSettledQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(draft.q), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft.q]);
  const filter = useMemo(
    () => toTimelineFilter({ ...draft, q: settledQuery }),
    [draft, settledQuery],
  );
  const filtering = isTimelineFilterActive(filter);
  const timeline = useChatTimelineInfiniteQuery({ projectId, filter });
  const pages = timeline.data?.pages;
  const entries = useMemo(() => (pages ? flattenTimelinePages(pages) : []), [pages]);
  const columns = useMemo(() => splitTimeline(entries), [entries]);
  const workRows = useMemo(() => buildTimelineRows(columns.work, items), [columns.work, items]);
  const projectRows = useMemo(() => buildTimelineRows(columns.project, items), [columns.project, items]);
  const hues = useMemo(() => chipHueMap(items), [items]);
  const handles = useMemo(() => mentionHandles(members, directory.nameOf), [members, directory]);
  const documentName = useMemo(() => new Map(documents.map((entry) => [entry.id, entry.name])), [documents]);
  const [replyingId, setReplyingId] = useState<string>();
  // Gửi xong thì cột đó phải kéo xuống đáy để người gửi thấy tin của mình.
  const [workBottom, setWorkBottom] = useState(0);
  const [projectBottom, setProjectBottom] = useState(0);

  const renderText = useCallback(
    (text: string): ReactNode =>
      splitByMentions(text, scanMentions(text, members, handles)).map((part, index) =>
        part.mention ? (
          <span key={index} className={styles.mentionTag}>
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>
            {splitByQuery(part.text, filter.q ?? '').map((piece, pieceIndex) =>
              piece.match ? (
                <mark key={pieceIndex} className={styles.timelineMark}>
                  {piece.text}
                </mark>
              ) : (
                piece.text
              ),
            )}
          </Fragment>
        ),
      ),
    [members, handles, filter.q],
  );

  const loadOlder = () => void timeline.fetchNextPage();

  /**
   * Bấm dòng trích: cuộn tới tin gốc và cho nền nó nháy xám hai lần. Tin gốc cũ hơn phần đã nạp thì nạp thêm trang
   * cũ cho tới khi gặp (hoặc hết tin).
   */
  const jumpTo = async (messageId: string) => {
    const find = () => columnsRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`) ?? null;
    let target = find();
    let hasMore = Boolean(timeline.hasNextPage);
    for (let round = 0; !target && hasMore && round < MAX_JUMP_PAGES; round += 1) {
      const result = await timeline.fetchNextPage();
      hasMore = Boolean(result.hasNextPage);
      // Chờ React vẽ trang vừa nạp rồi mới tìm lại.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      target = find();
    }
    if (!target) {
      toast.error(
        filtering
          ? 'Tin gốc không nằm trong kết quả lọc. Xoá bộ lọc để xem.'
          : 'Không tìm thấy tin gốc: có thể đã bị thu hồi hoặc quá cũ.',
      );
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Nháy khi đã tới nơi, không nháy ngay lúc bấm trong khi khung còn đang cuộn.
    await settled(target);
    target.classList.remove(styles.timelineFlash);
    void target.offsetWidth; // buộc vẽ lại để nháy lại được khi bấm lần nữa
    target.classList.add(styles.timelineFlash);
    target.addEventListener('animationend', () => target.classList.remove(styles.timelineFlash), { once: true });
  };

  // Vạch kéo giữa hai cột, giống vạch đổi độ rộng thanh bên.
  const columnsRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(LEFT_DEFAULT_PCT);
  const dragging = useRef(false);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(LEFT_STORAGE));
      if (saved) setLeftPct(clampLeft(saved));
    } catch {
      // localStorage có thể bị chặn (chế độ riêng tư); dùng mặc định.
    }
  }, []);
  const saveLeft = (value: number) => {
    try {
      window.localStorage.setItem(LEFT_STORAGE, String(value));
    } catch {
      // bỏ qua nếu không ghi được.
    }
  };
  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = columnsRef.current?.getBoundingClientRect();
    if (!dragging.current || !box || box.width === 0) return;
    setLeftPct(clampLeft(((event.clientX - box.left) / box.width) * 100));
  };
  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    saveLeft(leftPct);
  };
  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? -LEFT_STEP_PCT : event.key === 'ArrowRight' ? LEFT_STEP_PCT : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clampLeft(leftPct + delta);
    setLeftPct(next);
    saveLeft(next);
  };
  const resetLeft = () => {
    setLeftPct(LEFT_DEFAULT_PCT);
    saveLeft(LEFT_DEFAULT_PCT);
  };

  const renderMessage = (row: TimelineMessageRow, inProjectColumn: boolean) => (
    <TimelineMessage
      key={row.key}
      row={row}
      hideChip={inProjectColumn}
      hue={row.work ? hues.get(row.work.id) : undefined}
      authorName={directory.nameOf(row.entry.message.createdBy)}
      parentAuthorName={row.entry.parent ? directory.nameOf(row.entry.parent.createdBy) : undefined}
      attachmentName={
        row.entry.message.attachmentDocumentId ? documentName.get(row.entry.message.attachmentDocumentId) : undefined
      }
      renderText={renderText}
      canReply={canReply}
      replying={replyingId === row.key}
      onReply={() => setReplyingId(row.key)}
      onCancelReply={() => setReplyingId(undefined)}
      onSent={() => {
        setReplyingId(undefined);
        // Tín hiệu realtime không gửi cho chính người nhắn, nên tự báo để dòng thời gian và trao đổi
        // của công việc đó tải lại.
        (inProjectColumn ? setProjectBottom : setWorkBottom)((token) => token + 1);
        invalidateChatFeed(projectId, row.work ? [row.work.id] : []);
      }}
      members={members}
      handles={handles}
      onOpen={onOpen}
      onJumpTo={(messageId) => void jumpTo(messageId)}
      nameOf={directory.nameOf}
    />
  );

  const ready = Boolean(timeline.data);
  const older = {
    hasMore: Boolean(timeline.hasNextPage),
    fetching: timeline.isFetchingNextPage,
    onLoadOlder: loadOlder,
  };

  return (
    <section ref={feed} className={styles.timelineFeed} aria-label="Dòng thời gian trao đổi">
      {timeline.error ? (
        <p role="alert" className={styles.alert}>
          {'message' in timeline.error ? timeline.error.message : 'Không tải được dòng thời gian trao đổi của dự án.'}
        </p>
      ) : null}
      <ChatTimelineFilters
        draft={draft}
        onChange={setDraft}
        members={members}
        items={items}
        nameOf={directory.nameOf}
        slot={toolbarSlot}
      />
      <div
        ref={columnsRef}
        className={styles.timelineColumns}
        style={{ '--timeline-left': `${leftPct}%` } as CSSProperties}
      >
        <TimelineColumn
          title="Công việc"
          loading={!ready && timeline.isFetching}
          rows={workRows}
          emptyText={ready ? (filtering ? 'Không có tin nào khớp bộ lọc.' : 'Các công việc chưa có trao đổi nào.') : undefined}
          bottomToken={workBottom}
          {...older}
          renderMessage={(row) => renderMessage(row, false)}
        />
        <TimelineColumn
          title="Chung dự án"
          loading={!ready && timeline.isFetching}
          rows={projectRows}
          emptyText={ready ? (filtering ? 'Không có tin nào khớp bộ lọc.' : 'Chưa có trao đổi chung nào.') : undefined}
          bottomToken={projectBottom}
          {...older}
          renderMessage={(row) => renderMessage(row, true)}
          footer={
            canReply ? (
              <ProjectComposer
                projectId={projectId}
                members={members}
                handles={handles}
                nameOf={directory.nameOf}
                onSent={() => {
                  setProjectBottom((token) => token + 1);
                  invalidateChatFeed(projectId, []);
                }}
              />
            ) : null
          }
        />
        <Tooltip content="Kéo để đổi độ rộng; bấm đúp để đặt lại" side="top">
          <div
            className={styles.timelineResizeHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label="Kéo để đổi độ rộng hai cột trao đổi"
            aria-valuenow={Math.round(leftPct)}
            aria-valuemin={LEFT_MIN_PCT}
            aria-valuemax={LEFT_MAX_PCT}
            tabIndex={0}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onKeyDown={onHandleKey}
            onDoubleClick={resetLeft}
          />
        </Tooltip>
      </div>
    </section>
  );
}

/** Một cột cuộn riêng: tiêu đề, danh sách tin theo ngày, và (nếu có) ô nhập ở đáy. */
function TimelineColumn({
  title,
  rows,
  loading,
  emptyText,
  hasMore,
  fetching,
  onLoadOlder,
  bottomToken,
  renderMessage,
  footer,
}: {
  title: string;
  rows: readonly TimelineRow[];
  loading: boolean;
  emptyText?: string;
  hasMore: boolean;
  fetching: boolean;
  onLoadOlder: () => void;
  /** Đổi giá trị này để buộc cột kéo xuống đáy ở lần cập nhật kế (sau khi chính người xem vừa gửi tin). */
  bottomToken: number;
  renderMessage: (row: TimelineMessageRow) => ReactNode;
  footer?: ReactNode;
}) {
  const messageRows = rows.filter((row): row is TimelineMessageRow => row.kind === 'message');
  const newestId = messageRows[messageRows.length - 1]?.entry.message.id;
  const oldestId = messageRows[0]?.entry.message.id;

  // Cuộn: mở cột hoặc có tin mới thì xuống đáy (nếu đang đọc ở đáy); nạp tin cũ chèn lên đầu thì giữ nguyên chỗ đang đọc.
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const last = useRef<{ oldest?: string; newest?: string; height: number; top: number }>({ height: 0, top: 0 });
  useEffect(() => {
    stickToBottom.current = true;
  }, [bottomToken]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const before = last.current;
    const prepended = before.oldest !== undefined && oldestId !== before.oldest && newestId === before.newest;
    if (prepended) {
      element.scrollTop = element.scrollHeight - before.height + before.top;
    } else if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
    last.current = { oldest: oldestId, newest: newestId, height: element.scrollHeight, top: element.scrollTop };
  }, [newestId, oldestId, messageRows.length]);
  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_PX;
    last.current = { ...last.current, height: element.scrollHeight, top: element.scrollTop };
  };

  return (
    <div className={styles.timelineColumn}>
      <h3 className={styles.timelineColumnHead}>{title}</h3>
      <div ref={scroller} className={styles.timelineMessages} onScroll={onScroll}>
        {loading ? <p className={styles.muted}>Đang tải…</p> : null}
        {emptyText && rows.length === 0 ? <p className={styles.muted}>{emptyText}</p> : null}
        {hasMore ? (
          <button type="button" className={styles.chatFeedOlder} disabled={fetching} onClick={onLoadOlder}>
            {fetching ? 'Đang tải…' : 'Xem tin cũ hơn'}
          </button>
        ) : null}
        {rows.map((row) =>
          row.kind === 'day' ? (
            <p key={row.key} className={styles.timelineDay}>
              <span>{formatDate(row.day)}</span>
            </p>
          ) : (
            renderMessage(row)
          ),
        )}
      </div>
      {footer}
    </div>
  );
}

function TimelineMessage({
  row,
  hideChip,
  hue,
  authorName,
  parentAuthorName,
  attachmentName,
  renderText,
  canReply,
  replying,
  onReply,
  onCancelReply,
  onSent,
  members,
  handles,
  onOpen,
  onJumpTo,
  nameOf,
}: {
  row: TimelineMessageRow;
  /** Cột chung dự án: không cần chip vì cả cột đã là chat chung. */
  hideChip: boolean;
  hue?: number;
  authorName: string;
  parentAuthorName?: string;
  attachmentName?: string;
  renderText: (text: string) => ReactNode;
  canReply: boolean;
  replying: boolean;
  onReply: () => void;
  onCancelReply: () => void;
  onSent: () => void;
  members: readonly ProjectMember[];
  handles: ReturnType<typeof mentionHandles>;
  onOpen: (item: WorkItem) => void;
  /** Bấm dòng trích: đưa về tin gốc. */
  onJumpTo: (messageId: string) => void;
  nameOf: (userId: string) => string;
}) {
  const { entry, work, ancestors } = row;
  const { message, parent } = entry;
  // Vị trí menu "⋯" của tin này (theo cửa sổ); vắng là đang đóng.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number }>();
  const showMore = canReply && !replying;
  return (
    <article className={styles.timelineMessage} data-message-id={message.id}>
      {showMore ? (
        <Tooltip content="Tuỳ chọn" side="top" align="end">
          <button
            type="button"
            className={styles.timelineMore}
            aria-label="Tuỳ chọn tin nhắn"
            aria-haspopup="menu"
            aria-expanded={Boolean(menuAt)}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenuAt(menuAt ? undefined : { x: box.right - 160, y: box.bottom + 4 });
            }}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </Tooltip>
      ) : null}
      {menuAt ? (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          actions={MESSAGE_ACTIONS}
          onClose={() => setMenuAt(undefined)}
          onPick={(actionId) => {
            setMenuAt(undefined);
            if (actionId === 'reply') onReply();
          }}
        />
      ) : null}
      {row.showChip && !hideChip ? (
        <NodeChip entry={entry} work={work} ancestors={ancestors} hue={hue} onOpen={onOpen} />
      ) : null}
      <p className={styles.chatMeta}>
        <strong>{authorName}</strong>
        <span>{formatDateTime(message.createdAt)}</span>
        {message.isEdited ? <em>đã sửa</em> : null}
      </p>
      {parent ? (
        parent.isDeleted ? (
          <p className={styles.timelineQuote}>
            <CornerDownRight size={12} aria-hidden />
            Trả lời một tin đã thu hồi
          </p>
        ) : (
          <Tooltip content="Đi tới tin gốc" side="top" align="start">
            <button
              type="button"
              className={styles.timelineQuote}
              data-slot="reply-quote"
              onClick={() => onJumpTo(parent.id)}
            >
              <CornerDownRight size={12} aria-hidden />
              {`${parentAuthorName ?? ''}: ${excerpt(parent.body)}`}
            </button>
          </Tooltip>
        )
      ) : null}
      <p className={styles.chatBody}>{renderText(message.body)}</p>
      {message.attachmentDocumentId ? (
        <p className={styles.chatAttachment}>
          <Paperclip size={12} /> {attachmentName ?? 'Tài liệu đính kèm'}
        </p>
      ) : null}
      {replying ? (
        <MessageBox
          autoFocus
          label={`Trả lời ${authorName}${work ? ` · ${work.code}` : ''}`}
          members={members}
          handles={handles}
          // Server lấy kênh từ chính tin được trả lời, nên câu trả lời luôn nằm đúng kênh của nó.
          send={(body, mentions) => api.replyChatMessage(message.id, { body, mentions })}
          successText="Đã gửi câu trả lời."
          failureText="Không gửi được câu trả lời."
          nameOf={nameOf}
          onCancel={onCancelReply}
          onSent={onSent}
        />
      ) : null}
    </article>
  );
}

/**
 * Công việc chứa tin: bấm để mở chi tiết. Mỗi công việc một màu nền nhạt (`hue`) để nhìn là biết hai tin cùng hay
 * khác công việc. Công việc đã xoá thì chỉ là nhãn.
 */
function NodeChip({
  entry,
  work,
  ancestors,
  hue,
  onOpen,
}: {
  entry: ProjectChatTimelineItem;
  work?: WorkItem;
  ancestors: readonly WorkItem[];
  hue?: number;
  onOpen: (item: WorkItem) => void;
}) {
  if (!work) {
    return (
      <p className={styles.timelineChipStatic}>
        {entry.entityType === 'project' ? 'Chung dự án' : 'Công việc đã xoá hoặc không còn trong dự án'}
      </p>
    );
  }
  return (
    <Tooltip content="Mở chi tiết công việc" side="top" align="start">
      <button
        type="button"
        className={styles.timelineChip}
        data-slot="node-chip"
        style={hue === undefined ? undefined : ({ '--chip-hue': hue } as CSSProperties)}
        onClick={() => onOpen(work)}
      >
        {ancestors.length > 0 ? (
          <span className={styles.chatFeedPath}>{ancestors.map((ancestor) => ancestor.code).join(' › ')} ›</span>
        ) : null}
        <span className={styles.activityCode}>{work.code}</span>
        <span className={styles.chatFeedLinkText}>{work.title}</span>
      </button>
    </Tooltip>
  );
}

/** Ô nhắn thẳng vào chat chung của dự án (kênh `project`, không gắn công việc nào). */
function ProjectComposer({
  projectId,
  members,
  handles,
  nameOf,
  onSent,
}: {
  projectId: string;
  members: readonly ProjectMember[];
  handles: ReturnType<typeof mentionHandles>;
  nameOf: (userId: string) => string;
  onSent: () => void;
}) {
  return (
    <div className={styles.timelineComposer}>
      <MessageBox
        label="Nhắn vào chat chung của dự án"
        members={members}
        handles={handles}
        send={(body, mentions) => api.sendChatMessage({ entityType: 'project', entityId: projectId, body, mentions })}
        successText="Đã gửi tin."
        failureText="Không gửi được tin nhắn."
        nameOf={nameOf}
        onSent={onSent}
      />
    </div>
  );
}

/**
 * Ô soạn tin dùng chung cho "Trả lời" và chat chung: Enter gửi, Shift+Enter xuống dòng, Esc huỷ (nếu có nút huỷ).
 * Cách gửi do bên gọi truyền vào, nên ô này không biết tin đi vào kênh nào.
 */
function MessageBox({
  label,
  members,
  handles,
  send,
  successText,
  failureText,
  nameOf,
  autoFocus,
  onCancel,
  onSent,
}: {
  label: string;
  members: readonly ProjectMember[];
  handles: ReturnType<typeof mentionHandles>;
  send: (body: string, mentions: readonly string[]) => Promise<{ droppedMentions: readonly string[] }>;
  successText: string;
  failureText: string;
  nameOf: (userId: string) => string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // Mặc định cao bằng nút (một dòng); gõ nhiều dòng thì cao dần tới mức trần rồi mới cuộn.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
  }, [draft]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const result = await send(body, extractMentions(body, members, handles));
      toast.success(
        result.droppedMentions.length > 0
          ? `${successText} Không nhắc được ${result.droppedMentions.map(nameOf).join(', ')} vì họ không thuộc dự án này.`
          : successText,
      );
      setDraft('');
      onSent();
    } catch (cause) {
      toast.error((cause as { message?: string })?.message ?? failureText);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Đang gõ dở bằng bộ gõ tiếng Việt (Telex/VNI): Enter chốt chữ, không phải lệnh.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && onCancel) {
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className={styles.timelineReplyBox}>
      <textarea
        ref={input}
        autoFocus={autoFocus}
        rows={1}
        value={draft}
        maxLength={MAX_CHAT_BODY_LENGTH}
        disabled={busy}
        placeholder={`${label}…`}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.timelineReplyActions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={busy || !draft.trim()}
          onClick={() => void submit()}
        >
          {busy ? 'Đang gửi…' : 'Gửi'}
        </button>
        {onCancel ? (
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={onCancel}>
            Huỷ
          </button>
        ) : null}
      </div>
    </div>
  );
}
