'use client';

import {
  CHAT_EDIT_WINDOW_MINUTES,
  MAX_CHAT_BODY_LENGTH,
  type ChatEntityType,
  type ChatMessage,
  type DocumentFolder,
  type DocumentSummary,
  type ProjectMember,
} from '@enterprise-platform/contracts-workspace';
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
  /**
   * 'drawer' trượt đè lên nội dung; 'pane' là khung cố định trong bố cục.
   * Trang Dự án dùng 'pane' để chat nằm cạnh nội dung, không che mất nó.
   */
  readonly variant?: 'drawer' | 'pane';
}

/**
 * Drawer chat theo node.
 *
 * Không có WebSocket trong repo, nên luồng tin **không realtime**: nội dung
 * nạp khi mở Drawer và khi chính người dùng gửi tin. Chấm đỏ trên cây do
 * `projects-view` hỏi lại theo nhịp.
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
  variant = 'drawer',
}: ChatDrawerProps) {
  const directory = useDirectory();
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

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const thread = await api.loadChatThread(entityType, entityId);
      setMessages(thread.messages);
      setError(undefined);
    } catch (cause) {
      setMessages([]);
      setError((cause as { message?: string })?.message ?? 'Không tải được luồng tin.');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (!open) return;
    setDraft('');
    setReplyTo(undefined);
    setEditing(undefined);
    setNotice(undefined);
    void reload();
  }, [open, reload]);

  // Luồng đọc từ trên xuống, nên tin mới nhất nằm cuối; cuộn xuống đáy sau
  // mỗi lần nạp để không phải tự kéo.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages]);

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
      await reload();
      onChanged();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gửi được tin nhắn.');
    }
  };

  const remove = async (message: ChatMessage) => {
    setError(undefined);
    try {
      await api.deleteChatMessage(message.id);
      await reload();
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
  const roots = messages.filter((message) => !message.parentId);
  const repliesOf = (parentId: string) =>
    messages.filter((message) => message.parentId === parentId);

  return (
    <aside
      className={variant === 'pane' ? styles.chatPane : styles.drawer}
      role="complementary"
      aria-label={`Trao đổi về ${title}`}
    >
      <header className={styles.drawerHead}>
        <div>
          <h3>Trao đổi</h3>
          <p>{title}</p>
        </div>
        <button type="button" aria-label="Đóng" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className={styles.drawerBody}>
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
              onReply={() => setReplyTo(message)}
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

          {suggestions.length > 0 ? (
            <ul className={styles.mentionList}>
              {suggestions.map((candidate) => (
                <li key={candidate.userId}>
                  <button type="button" onClick={() => pickMention(candidate.userId)}>
                    {directory.nameOf(candidate.userId)}{' '}
                    <span className={styles.muted}>@{handles.get(candidate.userId) ?? candidate.userId}</span>
                  </button>
                </li>
              ))}
            </ul>
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
              {canWrite && folders.length > 0 ? (
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
            <button type="button" className={styles.chatActionDanger} onClick={onDelete}>
              <Trash2 size={12} /> Thu hồi
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function excerpt(body: string): string {
  return body.length > 48 ? `${body.slice(0, 48)}…` : body;
}
