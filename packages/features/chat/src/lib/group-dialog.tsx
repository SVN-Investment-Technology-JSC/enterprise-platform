'use client';

import { CHAT_MAX_TITLE_LENGTH, type ChatConversationView, type ChatPerson } from '@enterprise-platform/contracts-chat';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { Check, Search, UserMinus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { chatApi } from './chat-api';
import { matchesPerson } from './chat-model';
import styles from './chat.module.scss';
import { UserAvatar } from './user-avatar';

function PeoplePicker({
  people,
  selected,
  onToggle,
  exclude,
}: {
  people: readonly ChatPerson[];
  selected: ReadonlySet<string>;
  onToggle: (person: ChatPerson) => void;
  exclude: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  const visible = people.filter((person) => !exclude.has(person.id.toLowerCase()) && matchesPerson(person, query));
  return (
    <>
      <div className={styles.search}>
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm người theo tên hoặc email..." aria-label="Tìm người" />
      </div>
      <div className={styles.pickList} role="listbox" aria-multiselectable="true" aria-label="Chọn người">
        {visible.length === 0 ? <p className={styles.emptyList}>Không có người phù hợp.</p> : null}
        {visible.map((person) => {
          const on = selected.has(person.id.toLowerCase());
          return (
            <button key={person.id} type="button" role="option" aria-selected={on} className={styles.pickRow} onClick={() => onToggle(person)}>
              <span className={on ? `${styles.check} ${styles.checkOn}` : styles.check} aria-hidden="true">
                {on ? <Check /> : null}
              </span>
              <UserAvatar userId={person.id} name={person.fullName} size={28} />
              <span>
                {person.fullName}
                <br />
                <small>{person.email}</small>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

/** Tạo nhóm: đặt tên và chọn ít nhất một người. */
export function CreateGroupDialog({
  me,
  people,
  onClose,
  onCreated,
}: {
  me: string;
  people: readonly ChatPerson[];
  onClose: () => void;
  onCreated: (conversation: ChatConversationView) => void;
}) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<ReadonlyMap<string, ChatPerson>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  const exclude = useMemo(() => new Set([me.toLowerCase()]), [me]);
  const toggle = (person: ChatPerson) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(person.id.toLowerCase())) next.delete(person.id.toLowerCase());
      else next.set(person.id.toLowerCase(), person);
      return next;
    });
  const canSubmit = title.trim().length > 0 && selected.size > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await chatApi.group(title.trim(), [...selected.values()].map((person) => person.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được nhóm.');
      setBusy(false);
    }
  };
  return (
    <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="chat-create-group">
        <div className={styles.dialogHead}>
          <div style={{ flex: 1 }}>
            <h3 id="chat-create-group">Tạo nhóm chat</h3>
            <p>Đặt tên nhóm và chọn người tham gia.</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className={styles.dialogBody}>
          <div className={styles.field}>
            <label htmlFor="chat-group-title">Tên nhóm</label>
            <input
              id="chat-group-title"
              value={title}
              maxLength={CHAT_MAX_TITLE_LENGTH}
              autoFocus
              placeholder="Ví dụ: Phòng kế toán"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void submit()}
            />
          </div>
          {selected.size > 0 ? (
            <div className={styles.chips} aria-label="Người đã chọn">
              {[...selected.values()].map((person) => (
                <span key={person.id} className={styles.chip}>
                  {person.fullName}
                  <button type="button" aria-label={`Bỏ ${person.fullName}`} onClick={() => toggle(person)}>
                    <X aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <PeoplePicker people={people} selected={new Set(selected.keys())} onToggle={toggle} exclude={exclude} />
          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className={styles.dialogFoot}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className={styles.primary} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? 'Đang tạo…' : `Tạo nhóm${selected.size > 0 ? ` (${selected.size + 1} người)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Thông tin nhóm: đổi tên, xem và thêm thành viên, mời ra (trưởng nhóm), rời nhóm. */
export function GroupInfoDialog({
  conversation,
  me,
  people,
  nameOf,
  onClose,
  onChanged,
  onLeft,
}: {
  conversation: ChatConversationView;
  me: string;
  people: readonly ChatPerson[];
  nameOf: (userId: string) => string;
  onClose: () => void;
  onChanged: (conversation: ChatConversationView) => void;
  onLeft: () => void;
}) {
  const [title, setTitle] = useState(conversation.title ?? '');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  const owner = conversation.myRole === 'owner';
  const members = useMemo(() => new Set(conversation.memberIds.map((id) => id.toLowerCase())), [conversation.memberIds]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thực hiện được.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="chat-group-info">
        <div className={styles.dialogHead}>
          <div style={{ flex: 1 }}>
            <h3 id="chat-group-info">Thông tin nhóm</h3>
            <p>{conversation.memberCount} thành viên</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className={styles.dialogBody}>
          <div className={styles.field}>
            <label htmlFor="chat-group-rename">Tên nhóm</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="chat-group-rename" style={{ flex: 1 }} value={title} maxLength={CHAT_MAX_TITLE_LENGTH} onChange={(event) => setTitle(event.target.value)} />
              <button
                type="button"
                className={styles.ghost}
                disabled={busy || !title.trim() || title.trim() === conversation.title}
                onClick={() => void run(async () => onChanged(await chatApi.update(conversation.id, { title: title.trim() })))}
              >
                Đổi tên
              </button>
            </div>
          </div>

          {adding ? (
            <>
              <PeoplePicker
                people={people}
                selected={selected}
                exclude={members}
                onToggle={(person) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    const key = person.id.toLowerCase();
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className={styles.ghost} onClick={() => setAdding(false)}>
                  Quay lại
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || selected.size === 0}
                  onClick={() =>
                    void run(async () => {
                      onChanged(await chatApi.addMembers(conversation.id, [...selected]));
                      setSelected(new Set());
                      setAdding(false);
                    })
                  }
                >
                  Thêm {selected.size > 0 ? `${selected.size} người` : ''}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 13 }}>Thành viên</strong>
                <button type="button" className={styles.linkButton} onClick={() => setAdding(true)}>
                  Thêm người
                </button>
              </div>
              <div>
                {conversation.memberIds.map((userId) => {
                  const isMe = userId.toLowerCase() === me.toLowerCase();
                  return (
                    <div key={userId} className={styles.memberRow}>
                      <UserAvatar userId={userId} size={30} />
                      <span>
                        {nameOf(userId)}
                        {isMe ? ' (bạn)' : ''}
                      </span>
                      {owner && !isMe ? (
                        <Popconfirm
                          title="Mời ra khỏi nhóm?"
                          description={`${nameOf(userId)} sẽ không còn xem và gửi tin trong nhóm này.`}
                          okText="Mời ra"
                          okType="danger"
                          placement="left"
                          onConfirm={() => run(async () => onChanged(await chatApi.removeMember(conversation.id, userId)))}
                        >
                          <button type="button" className={`${styles.iconButton} ${styles.danger}`} aria-label={`Mời ${nameOf(userId)} ra khỏi nhóm`}>
                            <UserMinus aria-hidden="true" />
                          </button>
                        </Popconfirm>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className={styles.dialogFoot}>
          <Popconfirm
            title="Rời nhóm?"
            description="Bạn sẽ không còn nhận tin của nhóm này. Người trong nhóm có thể thêm bạn lại."
            okText="Rời nhóm"
            okType="danger"
            placement="top"
            onConfirm={() =>
              run(async () => {
                await chatApi.leave(conversation.id);
                onLeft();
              })
            }
          >
            <button type="button" className={`${styles.ghost} ${styles.danger}`} disabled={busy}>
              Rời nhóm
            </button>
          </Popconfirm>
          <button type="button" className={styles.primary} onClick={onClose}>
            Xong
          </button>
        </div>
      </div>
    </div>
  );
}
