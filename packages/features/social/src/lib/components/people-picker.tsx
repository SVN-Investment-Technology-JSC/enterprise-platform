'use client';

import type { SocialUserRef } from '@enterprise-platform/contracts-social';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { searchPeople } from '../social-api';
import styles from '../social.module.scss';
import { Avatar, userSubtitle } from './ui';

/** Tìm người theo tên, gợi ý từ server (có trễ nhẹ khi gõ). Dùng cho danh sách người dùng chung. */
export function usePeopleSearch(query: string, enabled = true) {
  const [people, setPeople] = useState<readonly SocialUserRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPeople(query.trim())
        .then((next) => {
          if (!cancelled) setPeople(next);
        })
        .catch(() => {
          if (!cancelled) setPeople([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled]);

  return { people, loading };
}

/** Danh sách gợi ý người, dùng chung cho ô chọn người và ô bình luận. */
export function PeopleList({
  people,
  loading,
  onPick,
}: {
  readonly people: readonly SocialUserRef[];
  readonly loading: boolean;
  readonly onPick: (user: SocialUserRef) => void;
}) {
  if (people.length === 0) {
    return <p className={styles.suggestEmpty}>{loading ? 'Đang tìm…' : 'Không có người phù hợp.'}</p>;
  }
  return (
    <ul className={styles.suggestList} role="listbox" aria-label="Gợi ý người">
      {people.map((user) => (
        <li key={user.id} role="option" aria-selected="false">
          <button
            type="button"
            className={styles.suggestItem}
            // Giữ con trỏ trong ô đang gõ.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(user)}
          >
            <Avatar user={user} size={28} />
            <span className={styles.suggestText}>
              <span className={styles.suggestName}>{user.name}</span>
              {userSubtitle(user) ? <span className={styles.suggestMeta}>{userSubtitle(user)}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Ô chọn người để nhắc tên trong bài: gõ để tìm, bấm để thêm thành thẻ. */
export function PeoplePicker({
  selected,
  onChange,
}: {
  readonly selected: readonly SocialUserRef[];
  readonly onChange: (next: readonly SocialUserRef[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { people, loading } = usePeopleSearch(query, open);
  const taken = new Set(selected.map((user) => user.id));
  const candidates = people.filter((user) => !taken.has(user.id));

  return (
    <div className={styles.peoplePicker}>
      {selected.length > 0 ? (
        <ul className={styles.chips}>
          {selected.map((user) => (
            <li key={user.id} className={styles.chip}>
              <span>{user.name}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Bỏ ${user.name}`}
                onClick={() => onChange(selected.filter((item) => item.id !== user.id))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.searchBox}>
        <Search size={14} />
        <input
          value={query}
          placeholder="Tìm người để nhắc tên (@)…"
          aria-label="Tìm người để nhắc tên"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {open && query.trim() ? (
        <div className={styles.suggestPanel}>
          <PeopleList
            people={candidates}
            loading={loading}
            onPick={(user) => {
              onChange([...selected, user]);
              setQuery('');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
