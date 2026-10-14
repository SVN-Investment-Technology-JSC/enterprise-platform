'use client';

import {
  CHAT_EDIT_WINDOW_MINUTES,
  CHAT_UNREAD_POLL_MS,
  MAX_CHAT_BODY_LENGTH,
  type ChatEntityType,
  type ChatMessage,
  type DocumentFolder,
  type DocumentSummary,
  type ProjectMember,
} from '@enterprise-platform/contracts-workspace';
import {
  Popconfirm,
  useRealtimeEvent,
  useRealtimeStatus,
  type WorkspaceChatSignal,
} from '@enterprise-platform/shared-ui';
import { CornerDownRight, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  applyMention,
  extractMentions,
  findMentionQuery,
  mentionHandles,
  suggestMembers,
  type MentionQuery,
} from '../mention.model';
import { groupThread, mergeMessages } from '../chat.model';
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
  /** Quản lý dự án thu hồi được tin của người khác. */
  readonly canModerate: boolean;
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
  canModerate,
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

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
        if (silent) {
          setMessages((current) => mergeMessages(current, thread.messages));
          // Nếu đã tải trang cũ, `hasMore` của trang mới nhất không nói gì về
          // phần cũ hơn; chỉ đặt lại khi chưa tải thêm gì.
          setHasMore((current) => (current ? current : Boolean(thread.hasMore)));
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
    // Mở node khác: bỏ hẳn tin của node trước, kẻo gộp nhầm hai luồng.
    setMessages([]);
    setHasMore(false);
    stickToBottom.current = true;
    prependAnchor.current = undefined;
    void reload();
  }, [open, reload]);

  // Luồng đọc từ trên xuống, nên tin mới nhất nằm cuối. Sau khi chèn tin cũ lên
  // đầu thì giữ nguyên chỗ đang đọc; còn lại chỉ kéo xuống đáy khi đang sát đáy.
  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    const anchor = prependAnchor.current;
    if (anchor && body) {
      body.scrollTop = body.scrollHeight - anchor.height + anchor.top;
      prependAnchor.current = undefined;
      return;
    }
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    const body = bodyRef.current;
    if (!oldest || !hasMore || loadingOlder || !body) return;
    setLoadingOlder(true);
    const seq = loadSeq.current;
    try {
      const thread = await api.loadChatThread(entityType, entityId, oldest.id);
      if (seq !== loadSeq.current) return;
      prependAnchor.current = { height: body.scrollHeight, top: body.scrollTop };
      setMessages((current) => mergeMessages(current, thread.messages));
      setHasMore(Boolean(thread.hasMore));
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tải được tin cũ hơn.');
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, hasMore, loadingOlder, entityType, entityId]);

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
      if (signal?.entityType === entityType && signal.entityId === entityId) {
        refreshFromRealtime();
      }
    },
    (connected) => {
      // Nối lại sau khi rớt mạng: có thể đã lỡ tin.
      if (connected && open) refreshFromRealtime();
    },
  );

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

  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    setMention(findMentionQuery(value, caret));
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
      // Vừa gửi/sửa xong thì người gửi muốn thấy kết quả ở đáy luồng.
      stickToBottom.current = true;
      await reload(true);
      onChanged();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gửi được tin nhắn.');
    }
  };

  const remove = async (message: ChatMessage) => {
    setError(undefined);
    try {
      await api.deleteChatMessage(message.id);
      await reload(true);
      onChanged();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không thu hồi được tin nhắn.');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter gửi, Shift+Enter xuống dòng — thói quen của mọi ứng dụng chat.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  if (!open) return null;

  const documentName = new Map(documents.map((entry) => [entry.id, entry.name]));
  const { roots, repliesOf } = groupThread(messages);

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
              canWrite={canWrite}
              canModerate={canModerate}
              attachmentName={
                message.attachmentDocumentId
                  ? documentName.get(message.attachmentDocumentId)
                  : undefined
              }
              // Trả lời của trả lời bị chặn (tối đa hai cấp).
              onReply={message.parentId ? undefined : () => setReplyTo(message)}
              onEdit={() => {
                setEditing(message);
                setDraft(message.body);
              }}
              onDelete={() => void remove(message)}
            />
            {repliesOf(message.id).map((reply) => (
              <div key={reply.id} className={styles.chatReply}>
                <Bubble
                  message={reply}
                  mine={reply.createdBy === currentUserId}
                  authorName={directory.nameOf(reply.createdBy)}
                  canWrite={canWrite}
                  canModerate={canModerate}
                  attachmentName={
                    reply.attachmentDocumentId
                      ? documentName.get(reply.attachmentDocumentId)
                      : undefined
                  }
                  onEdit={() => {
                    setEditing(reply);
                    setDraft(reply.body);
                  }}
                  onDelete={() => void remove(reply)}
                />
              </div>
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

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
                {suggestions.map((candidate) => (
                  <li key={candidate.userId}>
                    <button
                      type="button"
                      // Giữ focus ở ô nhập: nhấn nút không được làm mất vị trí con trỏ.
                      onMouseDown={(event) => event.preventDefault()}
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
            />
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

function Bubble({
  message,
  mine,
  authorName,
  canWrite,
  canModerate,
  attachmentName,
  onReply,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  authorName: string;
  canWrite: boolean;
  canModerate: boolean;
  attachmentName?: string;
  onReply?: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
      <p className={styles.chatBody}>{message.body}</p>
      {message.attachmentDocumentId ? (
        <p className={styles.chatAttachment}>
          <Paperclip size={12} /> {attachmentName ?? 'Tài liệu đính kèm'}
        </p>
      ) : null}
      {canWrite ? (
        <p className={styles.chatActions}>
          {onReply ? (
            <button type="button" onClick={onReply}>
              Trả lời
            </button>
          ) : null}
          {editable ? (
            <button type="button" onClick={onEdit}>
              Sửa
            </button>
          ) : null}
          {mine || canModerate ? (
            <Popconfirm
              title="Thu hồi tin nhắn này?"
              description="Mọi người trong luồng sẽ chỉ thấy dòng “Tin nhắn đã được thu hồi”."
              okText="Thu hồi"
              okType="danger"
              onConfirm={onDelete}
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

function excerpt(body: string): string {
  return body.length > 48 ? `${body.slice(0, 48)}…` : body;
}
