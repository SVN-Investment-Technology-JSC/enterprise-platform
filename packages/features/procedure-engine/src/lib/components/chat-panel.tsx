'use client';

import type {
  ProcedureActivity,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './workspace-board.module.scss';

const time = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Màu theo loại hành động, để quét mắt nhanh trên dòng thời gian dài.
 *
 * Dùng chấm màu chứ không dùng emoji: emoji hiển thị khác nhau tuỳ hệ điều hành,
 * không đổi màu theo giao diện sáng/tối, và không mang thêm nghĩa nào so với
 * dòng chữ ngay bên cạnh.
 */
const ACTION_TONE: Record<string, string> = {
  start: 'toneStart',
  approve: 'toneOk',
  complete: 'toneOk',
  return: 'toneWarn',
  reject: 'toneBad',
  cancel: 'toneBad',
  comment: 'toneNeutral',
  publish: 'toneNeutral',
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  return sameDay ? 'Hôm nay' : day.format(date);
}

/**
 * Tô đậm tên người được nhắc trong nội dung.
 *
 * Quét theo tên hiển thị đầy đủ, không dùng `\w+`: tên tiếng Việt có dấu cách
 * nên regex từ đơn sẽ cắt nhầm ở chữ đầu tiên. Duyệt tên dài trước để "Nguyễn
 * Văn A" không bị khớp nhầm thành "Nguyễn Văn".
 */
function renderMentions(text: string, names: readonly string[]): ReactNode {
  if (names.length === 0) return text;
  const ordered = [...names].sort((left, right) => right.length - left.length);
  const out: ReactNode[] = [];
  let rest = text;
  let guard = 0;

  while (rest.length > 0 && guard < 200) {
    guard += 1;
    let hit: { index: number; name: string } | undefined;
    for (const name of ordered) {
      const index = rest.indexOf(`@${name}`);
      if (index >= 0 && (hit === undefined || index < hit.index)) hit = { index, name };
    }
    if (!hit) break;
    if (hit.index > 0) out.push(rest.slice(0, hit.index));
    out.push(
      <mark key={`${out.length}-${hit.name}`} className={styles.mention}>
        @{hit.name}
      </mark>,
    );
    rest = rest.slice(hit.index + hit.name.length + 1);
  }
  if (rest) out.push(rest);
  return out.length > 0 ? out : text;
}

const PAGE = 20;

export function ChatPanel({
  instance,
  busy,
  participants,
  onSend,
}: {
  instance: ProcedureInstance;
  busy?: string;
  /** Tên người có mặt trong hồ sơ, dùng cho gợi ý @ và tô đậm. */
  participants: readonly { id: string; name: string }[];
  onSend: (body: string, mentions: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [caret, setCaret] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const canComment = instance.authorization?.canComment ?? false;
  const names = useMemo(() => participants.map((person) => person.name), [participants]);

  // Server trả mới-nhất-trước và AC-CHT-06 cũng yêu cầu vậy — không sắp lại.
  const entries = instance.activity.slice(0, visible);

  /**
   * Đoạn `@…` đang gõ ngay trước con trỏ.
   *
   * Tên tiếng Việt có dấu cách nên không thể dừng ở khoảng trắng đầu tiên: lấy
   * cả phần sau `@` tới con trỏ rồi để phép khớp tiền tố lo phần còn lại.
   */
  const mentionQuery = useMemo(() => {
    const before = draft.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return undefined;
    // Chỉ tính khi @ đứng đầu dòng hoặc sau khoảng trắng — tránh bắt nhầm email.
    if (at > 0 && !/\s/.test(before[at - 1])) return undefined;
    const query = before.slice(at + 1);
    if (query.includes('\n')) return undefined;
    return { at, query };
  }, [draft, caret]);

  const suggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const needle = mentionQuery.query.trim().toLowerCase();
    return participants
      .filter((person) => !needle || person.name.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [mentionQuery, participants]);

  const insertMention = (name: string) => {
    if (!mentionQuery) return;
    const next = `${draft.slice(0, mentionQuery.at)}@${name} ${draft.slice(caret)}`;
    setDraft(next);
    const position = mentionQuery.at + name.length + 2;
    setCaret(position);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  };

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    const mentions = participants
      .filter((person) => body.includes(`@${person.name}`))
      .map((person) => person.id);
    onSend(body, mentions);
    setDraft('');
  };

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>
Trao đổi
        </h3>
        <span className={styles.stepBadge}>{instance.activity.length} mục</span>
      </header>

      <ol className={styles.feed}>
        {entries.map((entry: ProcedureActivity, index) => {
          const tone = ACTION_TONE[entry.action] ?? ACTION_TONE.comment;
          const previous = entries[index - 1];
          const showDay =
            index === 0 || dayLabel(previous.createdAt) !== dayLabel(entry.createdAt);
          return (
            <li key={entry.id}>
              {showDay ? <div className={styles.feedDay}>{dayLabel(entry.createdAt)}</div> : null}
              <div className={styles.feedRow}>
                <span className={`${styles.feedDot} ${styles[tone]}`} aria-hidden="true" />
                <div>
                  <strong>
                    {entry.actorName} — {entry.summary}
                  </strong>
                  {entry.comment ? (
                    <p className={styles.feedComment}>{renderMentions(entry.comment, names)}</p>
                  ) : null}
                  <small>{time.format(new Date(entry.createdAt))}</small>
                </div>
              </div>
            </li>
          );
        })}
        {instance.activity.length === 0 ? (
          <li className={styles.panelHint}>Chưa có trao đổi nào.</li>
        ) : null}
      </ol>

      {visible < instance.activity.length ? (
        <button
          type="button"
          className={styles.ghost}
          onClick={() => setVisible((count) => count + PAGE)}
        >
          Xem thêm
        </button>
      ) : null}

      {canComment ? (
        <div className={styles.composer}>
          <div className={styles.composerBox}>
            <textarea
              ref={textarea}
              rows={3}
              placeholder="Nhập trao đổi… (Ctrl+Enter để gửi, gõ @ để nhắc tên)"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && suggestions.length > 0) {
                  event.preventDefault();
                  setCaret(-1);
                  return;
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            {suggestions.length > 0 ? (
              <ul className={styles.mentionList}>
                {suggestions.map((person) => (
                  <li key={person.id}>
                    <button type="button" onMouseDown={(event) => {
                      // mousedown chứ không phải click: click xảy ra sau blur,
                      // lúc đó danh sách đã đóng và không chèn được nữa.
                      event.preventDefault();
                      insertMention(person.name);
                    }}>
                      {person.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className={styles.composerFoot}>
            <span className={styles.panelHint}>
              {participants.length > 0 ? `Có thể nhắc: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}
            </span>
            <button
              type="button"
              className={styles.primary}
              disabled={busy === 'comment' || !draft.trim()}
              onClick={send}
            >
              Gửi
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.panelHint}>
          {instance.status === 'running'
            ? 'Bạn không có mặt trong hồ sơ này nên chỉ đọc được.'
            : 'Hồ sơ đã kết thúc — chỉ đọc lại được lịch sử trao đổi.'}
        </p>
      )}
    </article>
  );
}
