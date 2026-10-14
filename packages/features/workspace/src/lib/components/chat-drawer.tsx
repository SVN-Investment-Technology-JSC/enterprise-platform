'use client';

import {
  CHAT_EDIT_WINDOW_MINUTES,
  CHAT_UNREAD_POLL_MS,
  MAX_CHAT_BODY_LENGTH,
  type ChatEntityType,
  type ChatMessage,
  type ChatReader,
  type DocumentFolder,
  type DocumentSummary,
  type ProjectMember,
} from '@enterprise-platform/contracts-workspace';
import {
  Popconfirm,
  sendRealtime,
  useRealtimeEvent,
  useRealtimeStatus,
  type WorkspaceChatSignal,
  type WorkspaceChatTyping,
} from '@enterprise-platform/shared-ui';
import { CornerDownRight, Ellipsis, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  applyMention,
  extractMentions,
  findMentionQuery,
  mentionHandles,
  nextActiveIndex,
  scanMentions,
  splitByMentions,
  suggestMembers,
  type MentionQuery,
} from '../mention.model';
import {
  activeTypers,
  groupThread,
  mergeLatestPage,
  mergeMessages,
  nextTypingSignal,
  pruneTyping,
  seenByNewest,
  seenLabel,
  typingLabel,
  withReader,
  withTyping,
  type TypingMap,
} from '../chat.model';
import * as api from '../workspace-api';
import { formatDateTime } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { UploadDialog } from './document-panel';
import { useDirectory } from './use-directory';

export interface ChatDrawerProps {
  readonly open: boolean;
  readonly entityType: ChatEntityType;
  readonly entityId: string;
  /** Tiêu đề của node đang mở, ví dụ `CV-003 · Soạn hợp đồng`. */
  readonly title: string;
  readonly members: readonly ProjectMember[];
  readonly canWrite: boolean;
  readonly currentUserId: string;
  readonly onClose: () => void;
  /** Gọi sau mỗi lần ghi, để cây tải lại chấm đỏ. */
  readonly onChanged: () => void;
  /** Tài liệu đã có trong dự án, để chọn nhanh khi đính kèm. */
  readonly documents?: readonly DocumentSummary[];
  /**
   * Thư mục của dự án, để tải tệp mới lên ngay từ khung trao đổi.
   *
   * Vắng (hoặc rỗng) thì chỉ còn cách chọn tài liệu đã có: tài liệu phải nằm
   * trong một thư mục, không có thư mục nào thì chưa tải lên được.
   */
  readonly folders?: readonly DocumentFolder[];
  /** Dự án đang mở, để tệp tải lên được xếp theo dự án và công việc. */
  readonly projectId?: string;
  /** Gọi sau khi tải lên xong, để nơi gọi nạp lại danh sách tài liệu. */
  readonly onDocumentUploaded?: () => void;
}

/** Gần đáy đủ để coi là "đang đọc tin mới nhất", tính bằng px. */
const STICK_TO_BOTTOM_PX = 80;
/** Cuộn gần đỉnh đủ để tự tải tin cũ, tính bằng px. */
const LOAD_OLDER_AT_PX = 48;
/** Gom nhiều tín hiệu dồn dập thành một lần tải. */
const REFRESH_DEBOUNCE_MS = 250;
/** Giá trị khởi tạo của danh sách được hoãn: lần dựng đầu chỉ có khung, tin dựng ngay sau đó. */
const NO_MESSAGES: readonly ChatMessage[] = [];

/**
 * Drawer chat theo node, trượt từ cạnh phải đè lên nội dung.
 *
 * Realtime: máy chủ đẩy tín hiệu `workspace.chat.changed` (chỉ có id, không có
 * nội dung) khi có người gửi/sửa/thu hồi tin. Drawer đang mở thì tải lại luồng
 * qua API có kiểm quyền. Tab đang ở nền thì chưa tải, để tin không bị đánh dấu
 * đã đọc khi chưa ai xem; tải ngay khi tab hiện lại. Nhịp hỏi lại của
 * `projects-view` vẫn là lưới an toàn khi mất kết nối.
 */
export function ChatDrawer({
  open,
  entityType,
  entityId,
  title,
  members,
  canWrite,
  currentUserId,
  onClose,
  onChanged,
  documents = [],
  folders = [],
  projectId,
  onDocumentUploaded,
}: ChatDrawerProps) {
  const directory = useDirectory();
  const live = useRealtimeStatus();
  // Tên gọn sau dấu `@` — `@NguyenThiMai` thay cho id trần trong nội dung tin.
  const handles = useMemo(() => mentionHandles(members, directory.nameOf), [members, directory]);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  // Danh sách tin thực sự vẽ ra được hoãn một nhịp: lần mở đầu tiên vẽ ngay khung và hiệu
  // ứng trượt, rồi mới dựng các tin ở mức ưu tiên thấp, thay vì chặn khung hình ~100ms.
  const shownMessages = useDeferredValue(messages, NO_MESSAGES);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage>();
  const [editing, setEditing] = useState<ChatMessage>();
  const [mention, setMention] = useState<MentionQuery>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [attachmentId, setAttachmentId] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [activeIndex, setActiveIndex] = useState(0);
  // Mỗi người đã đọc tới tin nào (để hiện "Đã xem") và ai đang gõ (hết hạn sau vài giây).
  const [readers, setReaders] = useState<readonly ChatReader[]>([]);
  const [typers, setTypers] = useState<TypingMap>({});
  // Trạng thái báo "tôi đang gõ" đã gửi lên máy chủ, để không báo mỗi phím.
  const typingState = useRef({ typing: false, at: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Đang ở sát đáy thì tin mới tự kéo xuống; đang đọc tin cũ thì không giật.
  const stickToBottom = useRef(true);
  // Vị trí cuộn trước khi chèn tin cũ lên đầu, để giữ nguyên chỗ đang đọc.
  const prependAnchor = useRef<{ height: number; top: number }>();
  // Tín hiệu đến lúc tab ở nền: tải khi tab hiện lại.
  const pendingRefresh = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  // Số thứ tự lần tải, để kết quả đến muộn của luồng cũ không ghi đè luồng mới.
  const loadSeq = useRef(0);
  // Bản sao mới nhất của danh sách tin và `onChanged`, để các hàm ổn định (memo) đọc được
  // mà không phải đổi tham chiếu sau mỗi lần vẽ.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  // Luồng đã nạp lần trước: mở lại đúng luồng đó thì giữ tin cũ trên màn hình, không xoá trống.
  const loadedKey = useRef('');
  // Tải tự động để lấp đầy khung bị lỗi một lần thì dừng, kẻo lặp vô hạn khi mạng hỏng.
  const autoFillBlocked = useRef(false);
  // Cờ đồng bộ chống tải trùng: sự kiện cuộn bắn liên tiếp trước khi `loadingOlder` (state, cập
  // nhật bất đồng bộ) kịp đổi, nên chỉ dựa vào state thì cùng một trang bị gọi hai ba lần.
  const olderInFlight = useRef(false);

  /**
   * Tải trang mới nhất. `silent` là làm mới do realtime: không xoá danh sách
   * khi lỗi và giữ các trang cũ đã tải; lần mở đầu tiên thì thay hẳn.
   */
  const reload = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
      if (!silent) setLoading(true);
      try {
        const thread = await api.loadChatThread(entityType, entityId);
        if (seq !== loadSeq.current) return;
        setReaders((current) => thread.readers ?? current);
        if (silent) {
          // Trang mới nhất chỉ có vài tin: nếu có nhiều tin đến hơn một trang trong lúc chờ
          // thì nó không chạm tới tin đang có, và gộp lại sẽ thiếu tin ở giữa. Khi đó thay
          // hẳn bằng trang mới; tin cũ vẫn tải được bằng cách cuộn lên.
          const merged = mergeLatestPage(
            messagesRef.current,
            thread.messages,
            Boolean(thread.hasMore),
          );
          setMessages(merged.messages);
          // Nếu đã tải trang cũ, `hasMore` của trang mới nhất không nói gì về phần cũ hơn;
          // chỉ đặt lại khi chưa tải thêm gì (hoặc vừa thay hẳn danh sách).
          setHasMore((current) =>
            merged.reset ? Boolean(thread.hasMore) : current ? current : Boolean(thread.hasMore),
          );
        } else {
          setMessages(thread.messages);
          setHasMore(Boolean(thread.hasMore));
        }
        setError(undefined);
      } catch (cause) {
        if (seq !== loadSeq.current || silent) return;
        setMessages([]);
        setHasMore(false);
        setError((cause as { message?: string })?.message ?? 'Không tải được luồng tin.');
      } finally {
        // Lần tải mới nhất luôn tắt cờ, kể cả khi nó là làm mới im lặng đè lên
        // lần tải đầu: nếu không, "Đang tải…" kẹt mãi ở luồng trống.
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [entityType, entityId],
  );

  useEffect(() => {
    if (!open) return;
    setDraft('');
    setReplyTo(undefined);
    setEditing(undefined);
    setNotice(undefined);
    // Mở node khác: bỏ hẳn tin của node trước, kẻo gộp nhầm hai luồng. Mở lại đúng luồng
    // vừa xem thì giữ nguyên tin đang có (không nháy trống rồi nạp lại) và chỉ làm mới ngầm.
    const key = `${entityType}:${entityId}`;
    const sameThread = loadedKey.current === key;
    if (!sameThread) {
      setMessages([]);
      setHasMore(false);
      setReaders([]);
      loadedKey.current = key;
    }
    setTypers({});
    stickToBottom.current = true;
    prependAnchor.current = undefined;
    autoFillBlocked.current = false;
    olderInFlight.current = false;
    void reload(sameThread && messagesRef.current.length > 0);
  }, [open, reload, entityType, entityId]);

  // Luồng đọc từ trên xuống, nên tin mới nhất nằm cuối. Sau khi chèn tin cũ lên
  // đầu thì giữ nguyên chỗ đang đọc; còn lại chỉ kéo xuống đáy khi đang sát đáy.
  //
  // Chạy TRƯỚC khi trình duyệt vẽ (`useLayoutEffect`): nếu để sau, khung hình đầu tiên
  // vẽ danh sách ở đỉnh rồi khung kế mới cuộn xuống đáy, người dùng thấy tin nhảy một cái.
  useLayoutEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    const anchor = prependAnchor.current;
    if (anchor && body) {
      body.scrollTop = body.scrollHeight - anchor.height + anchor.top;
      prependAnchor.current = undefined;
      return;
    }
    // Cuộn riêng vùng tin nhắn: `scrollIntoView` còn kéo cả các khung cuộn cha (trang
    // phía sau) và làm bố cục giật.
    if (stickToBottom.current && body) body.scrollTop = body.scrollHeight;
    // `readers` cũng làm vùng tin dài thêm: dòng "Đã xem: …" hiện ra sau tin cuối khoảng
    // một giây, nếu không cuộn theo thì dòng đó nằm khuất dưới đáy.
  }, [open, shownMessages, readers]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    const body = bodyRef.current;
    if (!oldest || !hasMore || loadingOlder || !body || olderInFlight.current) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    const seq = loadSeq.current;
    try {
      const thread = await api.loadChatThread(entityType, entityId, oldest.id);
      if (seq !== loadSeq.current) return;
      prependAnchor.current = { height: body.scrollHeight, top: body.scrollTop };
      setMessages((current) => mergeMessages(current, thread.messages));
      setHasMore(Boolean(thread.hasMore));
    } catch (cause) {
      autoFillBlocked.current = true;
      setError((cause as { message?: string })?.message ?? 'Không tải được tin cũ hơn.');
    } finally {
      olderInFlight.current = false;
      setLoadingOlder(false);
    }
  }, [messages, hasMore, loadingOlder, entityType, entityId]);

  // Mỗi trang chỉ vài tin: khung cao mà tin ngắn thì chưa đủ để cuộn, nên không có gì kích
  // hoạt "cuộn lên để tải tiếp". Tự tải thêm cho tới khi lấp đầy khung hoặc hết tin cũ.
  useEffect(() => {
    if (!open || !hasMore || loading || loadingOlder || autoFillBlocked.current) return;
    const body = bodyRef.current;
    if (body && shownMessages.length > 0 && body.scrollHeight <= body.clientHeight + 1) {
      void loadOlder();
    }
  }, [open, hasMore, loading, loadingOlder, shownMessages, loadOlder]);

  const onBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    stickToBottom.current =
      body.scrollHeight - body.scrollTop - body.clientHeight <= STICK_TO_BOTTOM_PX;
    if (body.scrollTop <= LOAD_OLDER_AT_PX) void loadOlder();
  };

  // Tải lại do realtime. Tab ở nền thì để dành: tải luồng là đánh dấu đã đọc,
  // mà chưa ai nhìn thấy tin thì chưa được tính là đã đọc.
  const refreshFromRealtime = useCallback(() => {
    if (document.visibilityState !== 'visible') {
      pendingRefresh.current = true;
      return;
    }
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      pendingRefresh.current = false;
      // Kéo xuống đáy khi tin mới đến nếu đang sát đáy (xử lý ở effect trên).
      void reload(true).then(onChanged);
    }, REFRESH_DEBOUNCE_MS);
  }, [reload, onChanged]);

  useRealtimeEvent(
    'workspace.chat.changed',
    (event) => {
      if (!open) return;
      const signal = event.data as Partial<WorkspaceChatSignal> | undefined;
      if (signal?.entityType !== entityType || signal.entityId !== entityId) return;
      if (signal.actorUserId) {
        // Người vừa gửi/sửa tin thì chắc chắn không còn đang gõ nữa.
        setTypers((current) => withTyping(current, signal.actorUserId as string, false, Date.now()));
      }
      if (signal.change === 'read' && signal.actorUserId && signal.messageId) {
        // Có người vừa đọc tới tin này: cập nhật "Đã xem" tại chỗ, không tải lại cả luồng.
        setReaders((current) => withReader(current, signal.actorUserId as string, signal.messageId as string));
        return;
      }
      refreshFromRealtime();
    },
    (connected) => {
      // Nối lại sau khi rớt mạng: có thể đã lỡ tin.
      if (connected && open) refreshFromRealtime();
    },
  );

  // Người khác đang gõ ở node này.
  useRealtimeEvent('workspace.chat.typing', (event) => {
    if (!open) return;
    const typing = event.data as Partial<WorkspaceChatTyping> | undefined;
    if (
      typing?.entityType !== entityType ||
      typing.entityId !== entityId ||
      !typing.userId ||
      typing.userId === currentUserId
    ) {
      return;
    }
    setTypers((current) => withTyping(current, typing.userId as string, typing.typing === true, Date.now()));
  });

  // Mỗi giây dọn người đã hết hạn; không có ai đang gõ thì không chạy gì cả.
  const hasTypers = Object.keys(typers).length > 0;
  useEffect(() => {
    if (!hasTypers) return;
    const timer = setInterval(() => setTypers((current) => pruneTyping(current, Date.now())), 1_000);
    return () => clearInterval(timer);
  }, [hasTypers]);

  // Báo "tôi đang gõ" / "ngừng" lên máy chủ qua socket dùng chung.
  const announceTyping = useCallback(
    (hasText: boolean) => {
      const next = nextTypingSignal(typingState.current, hasText, Date.now());
      typingState.current = next.state;
      if (next.send !== undefined) sendRealtime('chat.typing', { entityType, entityId, typing: next.send });
    },
    [entityType, entityId],
  );

  // Đóng Drawer hoặc chuyển node: báo ngừng, kẻo người khác thấy "đang nhập" tới khi hết hạn.
  useEffect(() => {
    if (!open) return;
    return () => announceTyping(false);
  }, [open, announceTyping]);

  // Không có realtime (mất kết nối hoặc trang không có kênh) thì Drawer đang mở
  // tự hỏi lại theo nhịp, để vẫn thấy tin mới mà không phải đóng mở lại.
  useEffect(() => {
    if (!open || live === true) return;
    const timer = setInterval(refreshFromRealtime, CHAT_UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [open, live, refreshFromRealtime]);

  useEffect(() => {
    if (!open) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pendingRefresh.current) refreshFromRealtime();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(refreshTimer.current);
    };
  }, [open, refreshFromRealtime]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const suggestions = mention ? suggestMembers(members, mention.term, directory.nameOf) : [];

  // Đổi từ khoá thì chọn lại từ đầu danh sách.
  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.start, mention?.term]);

  // Gõ tiếp sau một `@` còn dang dở luôn mở lại danh sách tương ứng, kể cả khi
  // trước đó nó đã bị đóng: không bắt người dùng xoá `@` rồi gõ lại.
  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    setMention(findMentionQuery(value, caret));
    // Đang sửa tin cũ thì không phải đang soạn tin mới, không báo "đang nhập".
    if (!editing) announceTyping(value.trim().length > 0);
  };

  // Bấm ra chỗ khác, rời ô nhập hay nhấn Esc: ẩn danh sách cho tới lần gõ kế tiếp.
  const closeSuggestions = () => {
    if (mention) setMention(undefined);
  };

  // Con trỏ đi ra khỏi lượt nhắc (bấm chuột vào chỗ khác, phím mũi tên trái/phải).
  const onCaretMove = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    if (!mention) return;
    const field = event.currentTarget;
    const query = findMentionQuery(field.value, field.selectionStart ?? 0);
    if (!query || query.start !== mention.start) closeSuggestions();
  };

  const pickMention = (userId: string) => {
    const input = inputRef.current;
    if (!mention || !input) return;
    const result = applyMention(
      draft,
      mention,
      input.selectionStart ?? draft.length,
      handles.get(userId) ?? userId,
    );
    setDraft(result.text);
    setMention(undefined);
    // Đặt lại con trỏ sau khi React vẽ xong giá trị mới.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.caret, result.caret);
    });
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setError(undefined);
    setNotice(undefined);
    try {
      if (editing) {
        await api.editChatMessage(editing.id, {
          body,
          mentions: extractMentions(body, members, handles),
        });
        setEditing(undefined);
      } else {
        const result = await api.sendChatMessage({
          entityType,
          entityId,
          body,
          parentId: replyTo?.id,
          mentions: extractMentions(body, members, handles),
          attachmentDocumentId: attachmentId || undefined,
        });
        // Server loại id lạ nhưng vẫn gửi tin; nói rõ ai đã bị bỏ để người
        // gửi không tưởng họ sẽ nhận được thông báo.
        if (result.droppedMentions.length > 0) {
          setNotice(
            `Không nhắc được ${result.droppedMentions.map(directory.nameOf).join(', ')} vì họ không thuộc dự án này.`,
          );
        }
        setReplyTo(undefined);
        setAttachmentId('');
      }
      setDraft('');
      setMention(undefined);
      // Đã gửi: chữ "đang nhập" bên người khác phải tắt ngay, không chờ hết hạn.
      announceTyping(false);
      // Vừa gửi/sửa xong thì người gửi muốn thấy kết quả ở đáy luồng.
      stickToBottom.current = true;
      await reload(true);
      onChanged();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gửi được tin nhắn.');
    }
  };

  // Các hàm dưới đây truyền cho từng tin (`Bubble` được bọc `memo`) nên phải ổn định giữa
  // các lần vẽ; nếu không, mỗi phím gõ đều dựng lại toàn bộ danh sách tin.
  const remove = useCallback(
    async (message: ChatMessage) => {
      setError(undefined);
      try {
        await api.deleteChatMessage(message.id);
        await reload(true);
        onChangedRef.current();
      } catch (cause) {
        setError((cause as { message?: string })?.message ?? 'Không thu hồi được tin nhắn.');
      }
    },
    [reload],
  );
  const startReply = useCallback((message: ChatMessage) => setReplyTo(message), []);
  const startEdit = useCallback((message: ChatMessage) => {
    setEditing(message);
    setDraft(message.body);
  }, []);

  // Lượt nhắc hợp lệ hiện màu xanh, cả trong ô nhập lẫn trong tin đã gửi. Dùng đúng
  // bộ quét với `extractMentions`: chữ xanh nghĩa là người đó sẽ được báo.
  const renderText = useCallback(
    (text: string): ReactNode =>
      splitByMentions(text, scanMentions(text, members, handles)).map((part, index) =>
        part.mention ? (
          <span key={index} className={styles.mentionTag}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      ),
    [members, handles],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Đang gõ dở bằng bộ gõ tiếng Việt (Telex/VNI): Enter chốt chữ, không phải lệnh.
    if (event.nativeEvent.isComposing) return;

    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const key = event.key;
        setActiveIndex((index) => nextActiveIndex(index, key, suggestions.length));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = suggestions[activeIndex] ?? suggestions[0];
        if (chosen) pickMention(chosen.userId);
        return;
      }
      if (event.key === 'Escape') {
        // Esc khi đang mở danh sách chỉ đóng danh sách, không đóng cả Drawer.
        event.preventDefault();
        event.stopPropagation();
        closeSuggestions();
        return;
      }
    }

    // Enter gửi, Shift+Enter xuống dòng — thói quen của mọi ứng dụng chat.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  if (!open) return null;

  const documentName = new Map(documents.map((entry) => [entry.id, entry.name]));
  const { roots, repliesOf } = groupThread(shownMessages);
  const seenNames = seenByNewest(shownMessages, readers, currentUserId).map(directory.nameOf);
  const typingNames = activeTypers(typers, Date.now()).map(directory.nameOf);
  // Đổi mỗi phút để nút "Sửa" của các tin (đã `memo`) biến mất đúng lúc hết cửa sổ 15 phút.
  const minute = Math.floor(Date.now() / 60_000);

  return (
    <aside
      className={styles.drawer}
      role="complementary"
      aria-label={`Trao đổi về ${title}`}
    >
      <header className={styles.drawerHead}>
        <div>
          <h3>
            Trao đổi
            <span
              className={styles.liveState}
              data-state={live === undefined ? 'connecting' : live ? 'live' : 'offline'}
              role="status"
              title={
                live
                  ? 'Đang nhận tin mới theo thời gian thực.'
                  : live === undefined
                    ? 'Đang kết nối kênh thời gian thực.'
                    : 'Mất kết nối thời gian thực. Tin mới vẫn được cập nhật định kỳ khoảng 30 giây; sẽ tự nối lại.'
              }
            >
              <i aria-hidden />
              {live ? 'Trực tiếp' : live === undefined ? 'Đang kết nối' : 'Mất kết nối'}
            </span>
          </h3>
          <p>{title}</p>
        </div>
        <button type="button" aria-label="Đóng" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className={styles.drawerBody} ref={bodyRef} onScroll={onBodyScroll}>
        {hasMore ? (
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? 'Đang tải…' : 'Tải tin cũ hơn'}
          </button>
        ) : null}
        {loading && messages.length === 0 ? <p className={styles.muted}>Đang tải…</p> : null}
        {!loading && messages.length === 0 ? (
          <p className={styles.muted}>Chưa có trao đổi nào ở mục này.</p>
        ) : null}

        {roots.map((message) => (
          <div key={message.id}>
            <Bubble
              message={message}
              mine={message.createdBy === currentUserId}
              authorName={directory.nameOf(message.createdBy)}
              renderText={renderText}
              canWrite={canWrite}
              attachmentName={
                message.attachmentDocumentId
                  ? documentName.get(message.attachmentDocumentId)
                  : undefined
              }
              minute={minute}
              // Trả lời của trả lời bị chặn (tối đa hai cấp).
              onReply={message.parentId ? undefined : startReply}
              onEdit={startEdit}
              onDelete={remove}
            />
            {repliesOf(message.id).map((reply) => (
              <div key={reply.id} className={styles.chatReply}>
                <Bubble
                  message={reply}
                  mine={reply.createdBy === currentUserId}
                  authorName={directory.nameOf(reply.createdBy)}
                  renderText={renderText}
                  canWrite={canWrite}
                  attachmentName={
                    reply.attachmentDocumentId
                      ? documentName.get(reply.attachmentDocumentId)
                      : undefined
                  }
                  minute={minute}
                  onEdit={startEdit}
                  onDelete={remove}
                />
              </div>
            ))}
          </div>
        ))}
        {seenNames.length > 0 ? (
          <p className={styles.chatSeen} title={`Đã xem: ${seenNames.join(', ')}`}>
            {seenLabel(seenNames)}
          </p>
        ) : null}
      </div>

      {/* Luôn chiếm một dòng để chữ "đang nhập" hiện/tắt không làm luồng tin nhảy. */}
      <p className={styles.chatTyping} role="status" aria-live="polite">
        {typingNames.length > 0 ? (
          <>
            {typingLabel(typingNames)}
            {/* Ba chấm nhấp nháy lần lượt; tắt hẳn khi người dùng chọn giảm chuyển động. */}
            <Ellipsis className={styles.typingDots} size={18} aria-hidden />
          </>
        ) : null}
      </p>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {canWrite ? (
        <div className={styles.drawerFoot}>
          {replyTo ? (
            <p className={styles.chatContext}>
              <CornerDownRight size={13} /> Trả lời: {excerpt(replyTo.body)}
              <button type="button" onClick={() => setReplyTo(undefined)}>
                Bỏ
              </button>
            </p>
          ) : null}
          {editing ? (
            <p className={styles.chatContext}>
              <Pencil size={13} /> Đang sửa tin nhắn
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setDraft('');
                }}
              >
                Bỏ
              </button>
            </p>
          ) : null}

          {/*
            Đính kèm: chọn một tài liệu đã có, hoặc tải tệp mới lên ngay tại
            đây. Tải lên vẫn đi đúng đường của kho tài liệu — chọn thư mục, tạo
            phiên bản, kiểm loại tệp và dung lượng — rồi tệp vừa lên được chọn
            sẵn cho tin sắp gửi.
          */}
          {canWrite || documents.length > 0 ? (
            <div className={styles.chatAttachRow}>
              {documents.length > 0 ? (
                <Choice
                  label="Đính kèm tài liệu"
                  className={styles.chatAttachPicker}
                  value={attachmentId}
                  emptyOption="Không đính kèm tài liệu"
                  options={documents.map((document) => ({
                    value: document.id,
                    label: document.name,
                  }))}
                  onChange={setAttachmentId}
                />
              ) : (
                <span className={styles.muted}>Dự án chưa có tài liệu nào.</span>
              )}
              {/*
                Luôn có lối tải tệp lên khi được viết, kể cả khi dự án chưa có
                tài liệu hay kho chưa có thư mục chung: hộp thoại tải lên tự
                tạo thư mục riêng cho dự án.
              */}
              {canWrite ? (
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="Tải tệp mới lên"
                  title="Tải tệp mới lên và đính kèm"
                  onClick={() => setUploadOpen(true)}
                >
                  <Paperclip size={15} />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.chatComposer}>
            {/* Nổi ngay trên ô nhập (không chiếm chỗ trong luồng), nên luôn sát chỗ đang gõ. */}
            {suggestions.length > 0 ? (
              <ul className={styles.mentionList} role="listbox" aria-label="Gợi ý nhắc thành viên">
                {suggestions.map((candidate, index) => (
                  <li
                    key={candidate.userId}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? styles.mentionActive : undefined}
                    ref={(element) => {
                      // Đi bằng phím tới mục nằm ngoài vùng cuộn thì kéo nó vào tầm nhìn.
                      if (index === activeIndex) element?.scrollIntoView({ block: 'nearest' });
                    }}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      // Giữ focus ở ô nhập: nhấn nút không được làm mất vị trí con trỏ.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => pickMention(candidate.userId)}
                    >
                      {directory.nameOf(candidate.userId)}{' '}
                      <span className={styles.muted}>
                        @{handles.get(candidate.userId) ?? candidate.userId}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {/*
              Ô nhập không tô màu được từng đoạn chữ, nên chữ thật nằm trong lớp
              phản chiếu phía sau còn textarea trong suốt nằm đè lên để nhận gõ phím.
              Hai lớp dùng chung font, đệm và cách ngắt dòng để chữ khớp từng ký tự.
            */}
            <div className={styles.chatInputWrap}>
              <div className={styles.chatMirror} ref={mirrorRef} aria-hidden>
                {renderText(draft)}
                {/* Ký tự rộng 0 giữ chiều cao cho dòng trống cuối, như textarea. */}
                {'\u200b'}
              </div>
              <textarea
                ref={inputRef}
                rows={2}
                value={draft}
                maxLength={MAX_CHAT_BODY_LENGTH}
                placeholder="Nhập nội dung, gõ @ để nhắc thành viên. Enter để gửi."
                onChange={(event) =>
                  onDraftChange(event.target.value, event.target.selectionStart ?? 0)
                }
                onKeyDown={onKeyDown}
                onBlur={closeSuggestions}
                onClick={onCaretMove}
                onSelect={onCaretMove}
                onScroll={(event) => {
                  if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                }}
              />
            </div>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={!draft.trim()}
              onClick={() => void submit()}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.drawerFoot}>
          <span className={styles.muted}>Bạn chỉ có quyền xem, không gửi được tin nhắn.</span>
        </p>
      )}

      <UploadDialog
        open={uploadOpen}
        folders={folders}
        linkedTo={{ entityType, entityId }}
        autoPath={
          projectId
            ? { projectId, workItemId: entityType === 'work_item' ? entityId : undefined }
            : undefined
        }
        onClose={() => setUploadOpen(false)}
        onDone={(documentId) => {
          // Tệp vừa lên được chọn sẵn, người dùng chỉ việc gõ nội dung và gửi.
          if (documentId) setAttachmentId(documentId);
          onDocumentUploaded?.();
        }}
      />
    </aside>
  );
}

function BubbleImpl({
  message,
  mine,
  authorName,
  renderText,
  canWrite,
  attachmentName,
  onReply,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  authorName: string;
  renderText: (text: string) => ReactNode;
  canWrite: boolean;
  attachmentName?: string;
  /** Chỉ để so sánh `memo`: đổi mỗi phút để vẽ lại nút "Sửa" khi hết hạn. */
  minute: number;
  onReply?: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
}) {
  if (message.isDeleted) {
    return (
      <div className={styles.chatBubbleDeleted}>
        <span>Tin nhắn đã được thu hồi.</span>
      </div>
    );
  }

  // Cửa sổ sửa đã đóng thì ẩn hẳn nút, thay vì để người dùng bấm rồi nhận 409.
  const editable =
    mine &&
    (Date.now() - new Date(message.createdAt).getTime()) / 60_000 <= CHAT_EDIT_WINDOW_MINUTES;

  return (
    <div className={mine ? styles.chatBubbleMine : styles.chatBubble}>
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
      {canWrite ? (
        <p className={styles.chatActions}>
          {onReply ? (
            <button type="button" onClick={() => onReply(message)}>
              Trả lời
            </button>
          ) : null}
          {editable ? (
            <button type="button" onClick={() => onEdit(message)}>
              Sửa
            </button>
          ) : null}
          {/* Chỉ người gửi mới thu hồi được tin của chính mình, kể cả quản lý hay chủ dự án. */}
          {mine ? (
            <Popconfirm
              title="Thu hồi tin nhắn này?"
              description="Mọi người trong luồng sẽ chỉ thấy dòng “Tin nhắn đã được thu hồi”."
              okText="Thu hồi"
              okType="danger"
              onConfirm={() => onDelete(message)}
            >
              <button type="button" className={styles.chatActionDanger}>
                <Trash2 size={12} /> Thu hồi
              </button>
            </Popconfirm>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Mỗi tin là một khối riêng: `memo` để gõ phím hay đổi trạng thái khác không dựng lại cả danh sách. */
const Bubble = memo(BubbleImpl);

function excerpt(body: string): string {
  return body.length > 48 ? `${body.slice(0, 48)}…` : body;
}
