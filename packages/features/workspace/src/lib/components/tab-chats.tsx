'use client';

import type {
  ChatMessage,
  DocumentSummary,
  ProjectMember,
  WorkItem,
} from '@enterprise-platform/contracts-workspace';
import {
  CHAT_FEED_PAGE_SIZE,
  CHAT_FEED_PAGE_SIZES,
  CHAT_FEED_SEARCH_MAX_LENGTH,
} from '@enterprise-platform/contracts-workspace';
import { ExternalLink, Paperclip, Search, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Provider } from 'react-redux';
import { buildChatFeedRows, previewOf, splitByTerm, type ChatFeedRow } from '../chat-feed.model';
import {
  chatFeedStore,
  useChatFeedPageQuery,
  useChatFeedThreadInfiniteQuery,
} from '../chat-feed-store';
import { groupThread } from '../chat.model';
import { mentionHandles, scanMentions, splitByMentions } from '../mention.model';
import { formatDateTime } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Pager } from './pager';
import { useDirectory } from './use-directory';

/** Chờ người dùng ngừng gõ rồi mới tìm, để không gọi API ở từng phím. */
const SEARCH_DEBOUNCE_MS = 350;
/** Cách đáy tối đa chừng này (px) vẫn coi là "đang đọc tin mới nhất" và tự kéo xuống khi có tin mới. */
const STICK_TO_BOTTOM_PX = 80;

const PAGE_SIZE_OPTIONS = CHAT_FEED_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} / trang` }));

export interface TabChatsProps {
  readonly projectId: string;
  readonly items: readonly WorkItem[];
  readonly members: readonly ProjectMember[];
  readonly documents: readonly DocumentSummary[];
  /** Bấm tên công việc ở đầu khung trao đổi để mở hộp chi tiết của nó. */
  readonly onOpen: (item: WorkItem) => void;
}

/** Bọc store riêng để bộ nhớ đệm nằm ngoài vòng đời của tab. */
export function TabChats(props: TabChatsProps) {
  return (
    <Provider store={chatFeedStore}>
      {/* Đổi dự án thì dựng lại: trang, từ khoá, bộ lọc và công việc đang chọn không thể sang dự án khác. */}
      <TabChatsBody key={props.projectId} {...props} />
    </Provider>
  );
}

/** Chữ có tô sáng chỗ khớp từ khoá tìm kiếm. */
function Highlight({ text, term }: { text: string; term?: string }) {
  const parts = splitByTerm(text, term);
  if (parts.length === 1 && !parts[0].match) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className={styles.chatFeedMark}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/**
 * Trao đổi của các công việc trong dự án (kể cả việc lồng nhau), chỉ để đọc.
 *
 * Bên trái là danh sách công việc theo trang (10, 20 hoặc 50 mỗi trang, mới có tin nhắn lên trước) kèm ô tìm kiếm và
 * bộ lọc "chỉ công việc có trao đổi"; bấm một công việc thì bên phải hiện trao đổi của nó, có "Xem tin cũ hơn". Mỗi
 * trang và mỗi trao đổi gọi API riêng khi cần và được nhớ lại (RTK Query), nên quay lại không gọi lại. Có tin mới thì
 * bộ nhớ bị huỷ và màn hình tự cập nhật (realtime, xem chat-feed-store). Đọc ở đây không đánh dấu đã đọc: số tin chưa đọc không đổi.
 */
function TabChatsBody({ projectId, items, members, documents, onOpen }: TabChatsProps) {
  const directory = useDirectory();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(CHAT_FEED_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string>();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [onlyWithChat, setOnlyWithChat] = useState(false);
  const list = useChatFeedPageQuery({
    projectId,
    page,
    pageSize,
    search: search || undefined,
    onlyWithChat,
  });

  // Đợi người dùng gõ xong mới tìm; đổi từ khoá thì về trang 1 và chọn lại công việc đầu danh sách.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
      setSelectedId(undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  // Giữ tổng của lần tải trước khi đang tải trang khác, để thanh phân trang không biến mất rồi hiện lại.
  const total = list.currentData?.total ?? list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Kết quả vừa ít đi (bộ lọc, xoá công việc) làm trang hiện tại vượt quá: lùi về trang cuối.
  useEffect(() => {
    if (list.currentData && page > pages) setPage(pages);
  }, [list.currentData, page, pages]);

  // `currentData` chỉ có khi đã có đúng trang đang xin, nên đổi trang không hiện nhầm danh sách trang cũ.
  const rows = useMemo(() => buildChatFeedRows(list.currentData?.items ?? [], items), [list.currentData, items]);
  // Công việc đang đọc được giữ lại ngay cả khi có tin mới làm nó trôi khỏi trang đang xem, để khung bên phải
  // không tự nhảy sang công việc khác giữa lúc đang đọc. Chưa chọn gì thì chốt luôn công việc đầu danh sách.
  const lastSelected = useRef<ChatFeedRow | undefined>(undefined);
  const found = rows.find((row) => row.item.id === selectedId);
  useEffect(() => {
    if (found) lastSelected.current = found;
  }, [found]);
  useEffect(() => {
    if (!selectedId && rows[0]) setSelectedId(rows[0].item.id);
  }, [selectedId, rows]);
  const selected: ChatFeedRow | undefined =
    found ?? (selectedId && lastSelected.current?.item.id === selectedId ? lastSelected.current : undefined) ?? (selectedId ? undefined : rows[0]);
  const filtering = Boolean(search) || onlyWithChat;

  const goToPage = (next: number) => {
    setPage(next);
    setSelectedId(undefined);
  };
  const changePageSize = (value: string) => {
    setPageSize(Number(value));
    goToPage(1);
  };
  const toggleOnlyWithChat = (checked: boolean) => {
    setOnlyWithChat(checked);
    goToPage(1);
  };
  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
    goToPage(1);
  };

  return (
    <div className={styles.tabBody}>
      {list.error ? (
        <p role="alert" className={styles.alert}>
          {'message' in list.error ? list.error.message : 'Không tải được danh sách trao đổi của dự án.'}
        </p>
      ) : null}
      <div className={styles.chatFeed}>
        <aside className={styles.chatFeedList} aria-label="Công việc">
          <div className={styles.chatFeedTools}>
            <label className={styles.searchField}>
              <Search size={14} aria-hidden />
              <input
                type="search"
                value={searchInput}
                maxLength={CHAT_FEED_SEARCH_MAX_LENGTH}
                placeholder="Tìm công việc hoặc nội dung tin"
                aria-label="Tìm công việc hoặc nội dung tin"
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && searchInput) {
                    event.stopPropagation();
                    clearSearch();
                  }
                }}
              />
              {searchInput ? (
                <button type="button" className={styles.chatFeedClear} aria-label="Xoá từ khoá" onClick={clearSearch}>
                  <X size={13} aria-hidden />
                </button>
              ) : null}
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={onlyWithChat}
                onChange={(event) => toggleOnlyWithChat(event.target.checked)}
              />
              Chỉ công việc có trao đổi
            </label>
          </div>
          <div className={styles.chatFeedRows}>
            {!list.currentData && list.isFetching ? <p className={styles.muted}>Đang tải…</p> : null}
            {list.currentData && rows.length === 0 ? (
              <p className={styles.muted}>
                {filtering ? 'Không có công việc phù hợp.' : 'Dự án chưa có công việc nào.'}
              </p>
            ) : null}
            {rows.map((row) => (
              <FeedRowButton
                key={row.item.id}
                row={row}
                active={row.item.id === selected?.item.id}
                preview={previewOf(row, directory.nameOf)}
                term={search}
                onSelect={() => setSelectedId(row.item.id)}
              />
            ))}
          </div>
          <div className={styles.chatFeedFoot}>
            <Choice
              label="Số công việc mỗi trang"
              value={String(pageSize)}
              options={PAGE_SIZE_OPTIONS}
              onChange={changePageSize}
              selectOnly
              height={32}
            />
            <Pager page={page} pages={pages} total={total} pageSize={pageSize} onPage={goToPage} />
          </div>
        </aside>
        <section className={styles.chatFeedThread} aria-label="Trao đổi">
          {selected ? (
            <ThreadPane
              key={selected.item.id}
              projectId={projectId}
              row={selected}
              // Dòng không còn trên trang (vừa trôi đi vì có tin mới) là bản cũ: không tin số tin của nó.
              fresh={Boolean(found)}
              members={members}
              documents={documents}
              term={search}
              onOpen={onOpen}
            />
          ) : (
            <p className={styles.muted}>
              {filtering ? 'Không có công việc phù hợp.' : 'Chọn một công việc để xem trao đổi.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function FeedRowButton({
  row,
  active,
  preview,
  term,
  onSelect,
}: {
  row: ChatFeedRow;
  active: boolean;
  preview?: { author?: string; text: string };
  term: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? styles.chatFeedRowActive : styles.chatFeedRow}
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
    >
      <span className={styles.chatFeedRowTop}>
        <span className={styles.activityCode}>
          <Highlight text={row.item.code} term={term} />
        </span>
        {row.latestAt ? <span className={styles.chatFeedWhen}>{formatDateTime(row.latestAt)}</span> : null}
      </span>
      <span className={styles.chatFeedRowTitle}>
        <Highlight text={row.item.title} term={term} />
      </span>
      <span className={preview ? styles.chatFeedRowPreview : styles.chatFeedRowEmpty}>
        {preview ? (
          <>
            {preview.author ? `${preview.author}: ` : ''}
            <Highlight text={preview.text} term={term} />
          </>
        ) : (
          'Chưa có trao đổi'
        )}
      </span>
    </button>
  );
}

function ThreadPane({
  projectId,
  row,
  fresh,
  members,
  documents,
  term,
  onOpen,
}: {
  projectId: string;
  row: ChatFeedRow;
  /** Dòng lấy từ trang hiện tại; không thì `messageCount` có thể đã cũ. */
  fresh: boolean;
  members: readonly ProjectMember[];
  documents: readonly DocumentSummary[];
  term: string;
  onOpen: (item: WorkItem) => void;
}) {
  const directory = useDirectory();
  const { item } = row;
  // Việc chưa có tin thì khỏi gọi API (chỉ khi số tin còn mới).
  const knownEmpty = fresh && row.messageCount === 0;
  const thread = useChatFeedThreadInfiniteQuery({ projectId, workItemId: item.id }, { skip: knownEmpty });
  const pages = thread.data?.pages;
  // Trang đầu là tin mới nhất, các trang sau cũ dần: đảo lại để đọc từ cũ tới mới.
  const messages = useMemo(() => (pages ? [...pages].reverse().flatMap((entry) => entry.messages) : []), [pages]);
  const { roots, repliesOf } = useMemo(() => groupThread(messages), [messages]);
  const handles = useMemo(() => mentionHandles(members, directory.nameOf), [members, directory]);
  const documentName = useMemo(() => new Map(documents.map((entry) => [entry.id, entry.name])), [documents]);
  const renderText = useCallback(
    (text: string): ReactNode =>
      splitByMentions(text, scanMentions(text, members, handles)).map((part, index) =>
        part.mention ? (
          <span key={index} className={styles.mentionTag}>
            {part.text}
          </span>
        ) : (
          <Highlight key={index} text={part.text} term={term} />
        ),
      ),
    [members, handles, term],
  );
  const message = (entry: ChatMessage) => (
    <FeedMessage
      message={entry}
      authorName={directory.nameOf(entry.createdBy)}
      renderText={renderText}
      attachmentName={entry.attachmentDocumentId ? documentName.get(entry.attachmentDocumentId) : undefined}
    />
  );

  // Cuộn: mở công việc hoặc có tin mới thì xuống đáy (nếu đang đọc ở đáy); nạp tin cũ thì giữ nguyên chỗ đang đọc.
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const heightBeforeOlder = useRef<number | undefined>(undefined);
  const newestId = messages[messages.length - 1]?.id;
  const oldestId = messages[0]?.id;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (heightBeforeOlder.current !== undefined) {
      element.scrollTop = element.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = undefined;
    } else if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [newestId, oldestId, messages.length]);
  const onScroll = () => {
    const element = scroller.current;
    if (element) {
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_PX;
    }
  };
  const loadOlder = () => {
    if (scroller.current) heightBeforeOlder.current = scroller.current.scrollHeight - scroller.current.scrollTop;
    // Tải lỗi thì bỏ mốc cuộn đã nhớ, kẻo lần cập nhật sau cuộn sai chỗ.
    void thread.fetchNextPage().then((result) => {
      if (result.isError) heightBeforeOlder.current = undefined;
    });
  };

  return (
    <>
      <header className={styles.chatFeedThreadHead}>
        {row.ancestors.length > 0 ? (
          <p className={styles.chatFeedPath}>{row.ancestors.map((ancestor) => ancestor.code).join(' › ')} ›</p>
        ) : null}
        <button
          type="button"
          className={styles.chatFeedLink}
          title="Mở chi tiết công việc"
          onClick={() => onOpen(item)}
        >
          <span className={styles.activityCode}>{item.code}</span>
          <span className={styles.chatFeedLinkText}>{item.title}</span>
          <ExternalLink size={14} aria-hidden />
        </button>
      </header>
      <div ref={scroller} className={styles.chatFeedMessages} onScroll={onScroll}>
        {knownEmpty || (thread.data && messages.length === 0) ? <p className={styles.muted}>Chưa có trao đổi nào.</p> : null}
        {!knownEmpty && !thread.data && thread.isFetching ? <p className={styles.muted}>Đang tải…</p> : null}
        {thread.error ? (
          <p role="alert" className={styles.alert}>
            {'message' in thread.error ? thread.error.message : 'Không tải được trao đổi của công việc.'}
          </p>
        ) : null}
        {thread.hasNextPage ? (
          <button
            type="button"
            className={styles.chatFeedOlder}
            disabled={thread.isFetchingNextPage}
            onClick={loadOlder}
          >
            {thread.isFetchingNextPage ? 'Đang tải…' : 'Xem tin cũ hơn'}
          </button>
        ) : null}
        {roots.map((entry) => (
          <div key={entry.id}>
            {message(entry)}
            {repliesOf(entry.id).map((reply) => (
              <div key={reply.id} className={styles.chatFeedReply}>
                {message(reply)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function FeedMessage({
  message,
  authorName,
  renderText,
  attachmentName,
}: {
  message: ChatMessage;
  authorName: string;
  renderText: (text: string) => ReactNode;
  attachmentName?: string;
}) {
  if (message.isDeleted) {
    return <p className={styles.chatFeedDeleted}>Tin nhắn đã được thu hồi.</p>;
  }
  return (
    <div className={styles.chatFeedMessage}>
      <p className={styles.chatMeta}>
        <strong>{authorName}</strong>
        <span>{formatDateTime(message.createdAt)}</span>
        {message.isEdited ? <em>đã sửa</em> : null}
      </p>
      <p className={styles.chatBody}>{renderText(message.body)}</p>
      {message.attachmentDocumentId ? (
        <p className={styles.chatAttachment}>
          <Paperclip size={12} /> {attachmentName ?? 'Tài liệu đính kèm'}
        </p>
      ) : null}
    </div>
  );
}
