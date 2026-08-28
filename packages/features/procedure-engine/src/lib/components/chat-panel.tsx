'use client';

import type {
  ProcedureActivity,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ACTION_TONE, activityTime, dayLabel } from './activity-format';
import styles from './workspace-board.module.scss';

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
  onSend: (body: string, mentions: string[], replyToId?: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [caret, setCaret] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const canComment = instance.authorization?.canComment ?? false;
  const names = useMemo(() => participants.map((person) => person.name), [participants]);

  /**
   * Chỉ bình luận. Các chuyển trạng thái đã có tab "Lịch sử thao tác" riêng —
   * trộn chung khiến một cuộc trao đổi ba câu bị đẩy trôi giữa hàng chục dòng
   * duyệt/trả về.
   *
   * Server trả mới-nhất-trước và AC-CHT-06 cũng yêu cầu vậy — không sắp lại.
   */
  const comments = useMemo(
    () => instance.activity.filter((entry) => entry.action === 'comment'),
    [instance.activity],
  );
  /** Trao đổi đang được trả lời. Giữ id chứ không giữ cả object: hồ sơ được nạp
   *  lại sau mỗi lần gửi, object cũ sẽ thành bản sao mồ côi. */
  const [replyToId, setReplyToId] = useState<string>();
  const commentById = useMemo(
    () => new Map(comments.map((entry) => [entry.id, entry])),
    [comments],
  );
  const replyTo = replyToId ? commentById.get(replyToId) : undefined;

  /**
   * Gom trao đổi thành CÂY theo `replyToId`.
   *
   * Danh sách phẳng không đọc được khi có nhiều nhánh: câu trả lời nằm cách câu
   * hỏi vài mục, phải đối chiếu bản trích mới biết ai đang nói với ai.
   *
   * Mục có `replyToId` trỏ vào thứ không tồn tại (bản gốc đã bị gỡ) được coi là
   * GỐC, không bị vứt đi — mất mạch hội thoại còn hơn mất hẳn nội dung.
   */
  const { roots, childrenOf } = useMemo(() => {
    const children = new Map<string, ProcedureActivity[]>();
    const top: ProcedureActivity[] = [];
    // Duyệt từ cũ tới mới để con của mỗi nhánh xếp theo thứ tự thời gian.
    for (const entry of [...comments].reverse()) {
      const parentId = entry.replyToId;
      if (parentId && comments.some((candidate) => candidate.id === parentId)) {
        const list = children.get(parentId) ?? [];
        list.push(entry);
        children.set(parentId, list);
      } else {
        top.push(entry);
      }
    }
    // Gốc hiện mới nhất trước, giống mọi bảng tin khác trong sản phẩm.
    return { roots: top.reverse(), childrenOf: children };
  }, [comments]);

  // Phân trang tính theo GỐC, không theo tổng số mục: cắt giữa một nhánh sẽ để
  // lại những câu trả lời mồ côi không hiểu nổi.
  const entries = roots.slice(0, visible);

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
    onSend(body, mentions, replyToId);
    setDraft('');
    setReplyToId(undefined);
  };

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>
Trao đổi
        </h3>
        <span className={styles.stepBadge}>{comments.length} mục</span>
      </header>

      <ol className={styles.feed}>
        {entries.map((entry: ProcedureActivity, index) => {
          const previous = entries[index - 1];
          const showDay =
            index === 0 || dayLabel(previous.createdAt) !== dayLabel(entry.createdAt);
          return (
            <li key={entry.id}>
              {showDay ? <div className={styles.feedDay}>{dayLabel(entry.createdAt)}</div> : null}
              <ThreadNode
                entry={entry}
                depth={0}
                childrenOf={childrenOf}
                orphan={Boolean(entry.replyToId)}
                names={names}
                canComment={canComment}
                onReply={(id) => {
                  setReplyToId(id);
                  textarea.current?.focus();
                }}
              />
            </li>
          );
        })}
        {comments.length === 0 ? (
          <li className={styles.panelHint}>Chưa có trao đổi nào.</li>
        ) : null}
      </ol>

      {visible < roots.length ? (
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
          {replyTo ? (
            <div className={styles.replyBar}>
              <span>
                Trả lời <strong>{replyTo.actorName}</strong>: {replyTo.comment?.slice(0, 80)}
                {(replyTo.comment?.length ?? 0) > 80 ? '…' : ''}
              </span>
              <button
                type="button"
                aria-label="Bỏ trả lời"
                onClick={() => setReplyToId(undefined)}
              >
                ×
              </button>
            </div>
          ) : null}
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

/** Độ sâu tối đa còn thụt lề. Sâu hơn thì giữ nguyên lề, không thì nhánh dài
 *  sẽ đẩy nội dung ra khỏi bề ngang của panel. */
const MAX_INDENT = 4;

/**
 * Một mục trao đổi cùng toàn bộ nhánh trả lời bên dưới nó.
 *
 * Đệ quy chứ không làm phẳng rồi thụt lề theo số: làm phẳng thì thứ tự phụ
 * thuộc vào cách sắp xếp, còn đệ quy thì cấu trúc cây chính là thứ tự.
 */
function ThreadNode(props: {
  entry: ProcedureActivity;
  depth: number;
  childrenOf: ReadonlyMap<string, ProcedureActivity[]>;
  /** Mục trả lời một trao đổi không còn hiển thị — hiện thành gốc nhưng có ghi chú. */
  orphan: boolean;
  names: readonly string[];
  canComment: boolean;
  onReply: (id: string) => void;
}) {
  const { entry, depth, childrenOf } = props;
  const replies = childrenOf.get(entry.id) ?? [];
  const tone = ACTION_TONE[entry.action] ?? ACTION_TONE.comment;

  return (
    <div className={depth > 0 ? styles.threadChild : undefined}>
      <div className={styles.feedRow}>
        <span className={`${styles.feedDot} ${styles[tone]}`} aria-hidden="true" />
        <div>
          <strong>
            {entry.actorName} — {entry.summary}
          </strong>
          {props.orphan ? (
            <p className={styles.replyQuote}>
              <em>Trả lời một trao đổi không còn hiển thị.</em>
            </p>
          ) : null}
          {entry.comment ? (
            <p className={styles.feedComment}>{renderMentions(entry.comment, props.names)}</p>
          ) : null}
          <div className={styles.feedFoot}>
            <small>{activityTime.format(new Date(entry.createdAt))}</small>
            {replies.length > 0 ? (
              <small className={styles.threadCount}>
                {replies.length} trả lời
              </small>
            ) : null}
            {props.canComment ? (
              <button
                type="button"
                className={styles.replyButton}
                onClick={() => props.onReply(entry.id)}
              >
                Trả lời
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {replies.map((child) => (
        <ThreadNode
          key={child.id}
          entry={child}
          depth={Math.min(depth + 1, MAX_INDENT)}
          childrenOf={childrenOf}
          orphan={false}
          names={props.names}
          canComment={props.canComment}
          onReply={props.onReply}
        />
      ))}
    </div>
  );
}
