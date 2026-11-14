'use client';

import type { CorrespondenceDirectory, LetterDetail } from '@enterprise-platform/contracts-correspondence';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { AtSign, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commentLetter, errorMessage } from '../correspondence-api';
import {
  applyMention,
  findMentionQuery,
  keptMentions,
  splitMentions,
  suggestPeople,
  type MentionQuery,
} from '../correspondence.model';
import styles from '../correspondence.module.scss';

/**
 * Trao đổi trên công văn theo từng bước. Gõ "@" để nhắc tên người trong công ty: người được
 * nhắc nhận thông báo và xem được công văn.
 */
export function CommentsSection({
  letter,
  directory,
  currentUserId,
  onDone,
  onDirtyChange,
}: {
  readonly letter: LetterDetail;
  readonly directory?: CorrespondenceDirectory;
  readonly currentUserId?: string;
  readonly onDone: (next: LetterDetail, message: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const people = directory?.people ?? [];
  const suggestions = useMemo(
    () => (mention ? suggestPeople(people, mention.query, currentUserId) : []),
    [mention, people, currentUserId],
  );

  useEffect(() => onDirtyChange(body.trim() !== ''), [body, onDirtyChange]);
  useEffect(() => setHighlight(0), [mention?.query]);

  const track = (text: string, caret: number) => {
    setBody(text);
    setMention(findMentionQuery(text, caret));
  };

  const choose = (person: { userId: string; name: string }) => {
    const element = input.current;
    if (!element || !mention) return;
    const next = applyMention(body, mention, element.selectionStart ?? body.length, person.name);
    setBody(next.text);
    setPicked((current) => new Map(current).set(person.userId, person.name));
    setMention(null);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const mentionedUserIds = keptMentions(body, picked);
      const next = await commentLetter(letter.id, { body, mentionedUserIds });
      setBody('');
      setPicked(new Map());
      onDone(next, mentionedUserIds.length > 0 ? `Đã gửi trao đổi, báo ${mentionedUserIds.length} người được nhắc.` : 'Đã gửi trao đổi.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được trao đổi.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Trao đổi</h2>
        <span className={styles.muted}>
          {letter.comments.length > 0 ? `${letter.comments.length} ý kiến` : 'Gõ @ để nhắc tên'}
        </span>
      </div>
      {letter.comments.length > 0 ? (
        <ol className={styles.comments}>
          {letter.comments.map((comment) => (
            <li key={comment.id}>
              <div className={styles.commentHead}>
                <b>{comment.authorName ?? 'Người dùng'}</b>
                <small>{formatDateTime(comment.at)}</small>
              </div>
              <p>
                {splitMentions(comment.body, comment.mentions).map((part, index) =>
                  part.mention ? (
                    <span key={index} className={styles.mention}>
                      {part.text}
                    </span>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.sectionNote}>
          Chưa có trao đổi nào. Trao đổi ở đây gắn với bước đang xử lý.
        </p>
      )}
      {letter.actions.comment ? (
        <div className={styles.composer}>
          <div className={styles.composerBox}>
            <textarea
              ref={input}
              value={body}
              rows={2}
              maxLength={4000}
              placeholder="Viết ý kiến trao đổi, gõ @ để nhắc tên người liên quan"
              aria-label="Nội dung trao đổi"
              onChange={(event) => track(event.target.value, event.target.selectionStart ?? event.target.value.length)}
              onClick={(event) => setMention(findMentionQuery(body, event.currentTarget.selectionStart ?? body.length))}
              onKeyDown={(event) => {
                if (suggestions.length > 0 && mention) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setHighlight((value) => (value + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    choose(suggestions[highlight] ?? suggestions[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setMention(null);
                    return;
                  }
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {mention && suggestions.length > 0 ? (
              <ul className={styles.mentionList} role="listbox" aria-label="Nhắc tên">
                {suggestions.map((person, index) => (
                  <li key={person.userId} role="option" aria-selected={index === highlight}>
                    <button
                      type="button"
                      className={index === highlight ? styles.mentionActive : undefined}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(person);
                      }}
                    >
                      <AtSign size={12} /> {person.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className={styles.composerActions}>
            <span className={styles.hint}>Ctrl + Enter để gửi</span>
            <button type="button" className={styles.buttonPrimary} disabled={busy || !body.trim()} onClick={() => void send()}>
              <Send size={14} /> {busy ? 'Đang gửi…' : 'Gửi'}
            </button>
          </div>
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
