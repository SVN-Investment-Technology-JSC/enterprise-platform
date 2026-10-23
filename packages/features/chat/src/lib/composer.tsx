'use client';

import {
  CHAT_MAX_ATTACHMENT_BYTES,
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MAX_BODY_LENGTH,
  isChatAllowedType,
  type ChatAttachmentView,
  type ChatMessageView,
  type ChatPerson,
} from '@enterprise-platform/contracts-chat';
import { File as FileIcon, ImagePlus, Paperclip, SendHorizontal, Smile, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { chatApi } from './chat-api';
import {
  applyMention,
  filesOf,
  findMentionQuery,
  formatBytes,
  keptMentions,
  namePastedFile,
  suggestPeople,
  type MentionQuery,
  type NameOf,
} from './chat-model';
import styles from './chat.module.scss';
import { EmojiPicker } from './emoji-picker';
import { UserAvatar } from './user-avatar';

export interface ComposerSubmit {
  readonly body: string;
  readonly mentions: string[];
  readonly attachments: ChatAttachmentView[];
  readonly replyTo: ChatMessageView | null;
}

interface PendingFile {
  readonly key: string;
  readonly file: File;
  readonly preview: string | null;
  readonly state: 'uploading' | 'done' | 'error';
  readonly attachment?: ChatAttachmentView;
  readonly error?: string;
}

export interface ComposerHandle {
  focus(): void;
  addFiles(files: readonly File[]): void;
}

export interface ComposerProps {
  readonly conversationId: string;
  readonly me: string;
  /** Người nhắc được (thành viên cuộc; cuộc chung: mọi người). */
  readonly people: readonly ChatPerson[];
  readonly nameOf: NameOf;
  readonly replyTo: ChatMessageView | null;
  readonly editing: ChatMessageView | null;
  readonly onCancelContext: () => void;
  readonly onSubmit: (value: ComposerSubmit) => Promise<void> | void;
  readonly onSaveEdit: (message: ChatMessageView, body: string, mentions: string[]) => Promise<void> | void;
  readonly onTyping: (typing: boolean) => void;
}

let keySeed = 0;

function problemOf(file: File): string | null {
  if (!isChatAllowedType(file.type || '')) return `${file.name || 'Tệp'}: loại tệp này không gửi được qua chat.`;
  if (file.size > CHAT_MAX_ATTACHMENT_BYTES) return `${file.name}: vượt quá ${Math.round(CHAT_MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`;
  return null;
}

/**
 * Ô soạn tin: Enter gửi, Shift+Enter xuống dòng; "@" gợi ý người để nhắc tên; dán ảnh (Ctrl+V) hay kéo thả tệp vào
 * là đính kèm ngay; bảng biểu tượng cảm xúc chèn tại con trỏ. Tệp được tải lên ngay khi chọn, nút gửi chờ tải xong.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  const { conversationId, me, people, nameOf, replyTo, editing } = props;
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const [emoji, setEmoji] = useState(false);
  const [files, setFiles] = useState<readonly PendingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [sending, setSending] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);

  // Đổi cuộc trò chuyện: bắt đầu lại ô soạn trống.
  useEffect(() => {
    setText('');
    setPicked(new Map());
    setFiles([]);
    setError(null);
    setMention(null);
  }, [conversationId]);

  // Vào chế độ sửa: đưa nội dung tin cũ vào ô soạn.
  useEffect(() => {
    if (!editing) return;
    setText(editing.body);
    setPicked(new Map(editing.mentions.map((id) => [id, nameOf(id)])));
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(editing.body.length, editing.body.length);
    });
  }, [editing, nameOf]);

  useEffect(() => {
    if (replyTo) textarea.current?.focus();
  }, [replyTo]);

  // Ô soạn tự cao theo nội dung (tối đa khoảng 6 dòng).
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [text]);

  // Ảnh xem trước tạo bằng URL tạm của trình duyệt: gỡ ô soạn thì trả lại bộ nhớ (bỏ từng tệp đã dọn riêng).
  const previews = useRef<readonly PendingFile[]>([]);
  previews.current = files;
  useEffect(() => {
    const list = previews;
    return () => {
      for (const file of list.current) if (file.preview) URL.revokeObjectURL(file.preview);
    };
  }, []);

  const suggestions = useMemo(
    () => (mention ? suggestPeople(people, mention.query, { excludeId: me, limit: 8 }) : []),
    [mention, people, me],
  );

  const upload = useCallback(
    (incoming: readonly File[]) => {
      if (editing) return;
      const problems: string[] = [];
      const room = CHAT_MAX_ATTACHMENTS_PER_MESSAGE - files.length;
      const accepted: PendingFile[] = [];
      incoming.forEach((raw, index) => {
        const file = namePastedFile(raw, index);
        const problem = problemOf(file);
        if (problem) problems.push(problem);
        else if (accepted.length < room)
          accepted.push({
            key: `f${(keySeed += 1)}`,
            file,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
            state: 'uploading',
          });
        else problems.push(`Mỗi tin gửi kèm tối đa ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} tệp.`);
      });
      setError(problems.length > 0 ? [...new Set(problems)].join(' ') : null);
      if (accepted.length === 0) return;
      setFiles((current) => [...current, ...accepted]);
      for (const item of accepted) {
        chatApi
          .upload(conversationId, item.file)
          .then((attachment) =>
            setFiles((current) => current.map((entry) => (entry.key === item.key ? { ...entry, state: 'done', attachment } : entry))),
          )
          .catch((cause: unknown) =>
            setFiles((current) =>
              current.map((entry) =>
                entry.key === item.key ? { ...entry, state: 'error', error: cause instanceof Error ? cause.message : 'Tải lên lỗi' } : entry,
              ),
            ),
          );
      }
    },
    [conversationId, editing, files.length],
  );

  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus(), addFiles: upload }), [upload]);

  const announceTyping = (value: string) => {
    const now = Date.now();
    if (value.trim()) {
      if (now - typingSent.current > 3_000) {
        typingSent.current = now;
        props.onTyping(true);
      }
    } else if (typingSent.current) {
      typingSent.current = 0;
      props.onTyping(false);
    }
  };

  const change = (value: string, caret: number) => {
    setText(value);
    setMention(findMentionQuery(value, caret));
    setActive(0);
    announceTyping(value);
  };

  const pickMention = (person: ChatPerson) => {
    const element = textarea.current;
    if (!mention || !element) return;
    const next = applyMention(text, mention, element.selectionStart ?? text.length, person.fullName);
    setText(next.text);
    setPicked((current) => new Map(current).set(person.id, person.fullName));
    setMention(null);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  };

  const insertText = (value: string) => {
    const element = textarea.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const uploading = files.some((file) => file.state === 'uploading');
  const ready = files.filter((file) => file.state === 'done' && file.attachment);
  const canSend = !sending && !uploading && (text.trim().length > 0 || (!editing && ready.length > 0));

  const submit = async () => {
    if (!canSend) return;
    const body = text.trim();
    const mentions = keptMentions(body, picked);
    setSending(true);
    try {
      if (editing) {
        await props.onSaveEdit(editing, body, mentions);
      } else {
        await props.onSubmit({ body, mentions, attachments: ready.map((file) => file.attachment as ChatAttachmentView), replyTo });
        for (const file of files) if (file.preview) URL.revokeObjectURL(file.preview);
        setFiles((current) => current.filter((file) => file.state === 'error'));
      }
      setText('');
      setPicked(new Map());
      setError(null);
      typingSent.current = 0;
      props.onTyping(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không gửi được tin nhắn.');
    } finally {
      setSending(false);
      textarea.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickMention(suggestions[active] ?? suggestions[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (event.key === 'Escape' && (editing || replyTo)) {
      event.preventDefault();
      event.stopPropagation();
      props.onCancelContext();
      setText(editing ? '' : text);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = filesOf(event.clipboardData?.files);
    if (pasted.length === 0) return;
    event.preventDefault();
    upload(pasted);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropping(false);
    upload(filesOf(event.dataTransfer?.files));
  };

  return (
    <div
      className={styles.composer}
      onDragOver={(event) => {
        if (editing || !event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      {editing || replyTo ? (
        <div className={styles.contextBar}>
          <span>
            {editing ? (
              <>
                <strong>Đang sửa tin</strong> · Esc để huỷ
              </>
            ) : (
              <>
                Trả lời <strong>{nameOf(replyTo?.senderId ?? '')}</strong>: {replyTo?.body || 'Tệp đính kèm'}
              </>
            )}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Huỷ"
            onClick={() => {
              if (editing) setText('');
              props.onCancelContext();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className={styles.pending} aria-label="Tệp đính kèm">
          {files.map((item) => (
            <div key={item.key} className={styles.pendingItem}>
              {item.preview ? <img src={item.preview} alt="" /> : <FileIcon aria-hidden="true" />}
              <span style={{ minWidth: 0 }}>
                <span className={styles.pendingName}>{item.file.name}</span>
                <br />
                <span className={item.state === 'error' ? `${styles.pendingState} ${styles.pendingError}` : styles.pendingState}>
                  {item.state === 'uploading' ? 'Đang tải lên…' : item.state === 'error' ? (item.error ?? 'Tải lên lỗi') : formatBytes(item.file.size)}
                </span>
              </span>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.pendingRemove}`}
                aria-label={`Bỏ ${item.file.name}`}
                onClick={() => {
                  if (item.preview) URL.revokeObjectURL(item.preview);
                  setFiles((current) => current.filter((entry) => entry.key !== item.key));
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className={`${styles.popover} ${styles.mentionList}`} role="listbox" aria-label="Gợi ý nhắc tên">
          {suggestions.map((person, index) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? `${styles.mentionOption} ${styles.mentionOptionActive}` : styles.mentionOption}
              onMouseDown={(event) => {
                event.preventDefault();
                pickMention(person);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <UserAvatar userId={person.id} name={person.fullName} size={26} />
              <span>
                {person.fullName}
                <br />
                <small>{person.email}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {emoji ? <EmojiPicker onPick={insertText} onClose={() => setEmoji(false)} /> : null}

      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Gửi ảnh"
          title="Gửi ảnh"
          disabled={Boolean(editing)}
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Đính kèm tệp"
          title="Đính kèm tệp"
          disabled={Boolean(editing)}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip aria-hidden="true" />
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          aria-label="Chọn ảnh"
          onChange={(event) => {
            upload(filesOf(event.target.files));
            event.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Chọn tệp đính kèm"
          onChange={(event) => {
            upload(filesOf(event.target.files));
            event.target.value = '';
          }}
        />
        <div className={dropping ? `${styles.inputBox} ${styles.dropping}` : styles.inputBox}>
          <textarea
            ref={textarea}
            rows={1}
            value={text}
            maxLength={CHAT_MAX_BODY_LENGTH}
            placeholder="Nhập tin nhắn hoặc dán ảnh..."
            aria-label="Nội dung tin nhắn"
            onChange={(event) => change(event.target.value, event.target.selectionStart ?? event.target.value.length)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              setTimeout(() => setMention(null), 150);
              if (typingSent.current) {
                typingSent.current = 0;
                props.onTyping(false);
              }
            }}
          />
          <button
            type="button"
            className={emoji ? `${styles.iconButton} ${styles.iconButtonActive}` : styles.iconButton}
            aria-label="Biểu tượng cảm xúc"
            title="Biểu tượng cảm xúc"
            onClick={() => setEmoji((value) => !value)}
          >
            <Smile aria-hidden="true" />
          </button>
        </div>
        <button type="button" className={styles.sendButton} aria-label={editing ? 'Lưu tin đã sửa' : 'Gửi'} disabled={!canSend} onClick={() => void submit()}>
          <SendHorizontal aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className={styles.composerError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
