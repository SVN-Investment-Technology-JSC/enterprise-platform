'use client';

import { SOCIAL_BIRTHDAY_PAGE_QUERY_MAX, type SocialBirthdaysUpcoming } from '@enterprise-platform/contracts-social';
import { Cake } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import { loadBirthdaysUpcoming } from '../../social-discovery-api';
import { SocialLink } from '../../social-navigation';
import { Avatar } from '../ui';
import { ageLabel, entryDayMonth, entrySubtitle, monthGroupLabel } from './birthday.model';
import styles from './birthday.module.scss';

const DEBOUNCE_MS = 300;
/** Trang đầy đủ xem rộng hơn mặc định để không thiếu người (tối đa của hợp đồng là 12). */
const PAGE_MONTHS = 6;

/** Trang `/birthday`: sinh nhật sắp tới nhóm theo tháng, tìm theo tên hoặc đơn vị. */
export function BirthdayView() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SocialBirthdaysUpcoming>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim().slice(0, SOCIAL_BIRTHDAY_PAGE_QUERY_MAX)), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    loadBirthdaysUpcoming({ months: PAGE_MONTHS, q: query || undefined })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, 'Không tải được danh sách sinh nhật.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <section className={styles.page} aria-label="Sinh nhật sắp tới">
      <div className={styles.head}>
        <h1>Sinh nhật sắp tới</h1>
        <input
          type="search"
          className={styles.search}
          placeholder="Tìm theo tên hoặc đơn vị"
          aria-label="Tìm sinh nhật theo tên hoặc đơn vị"
          maxLength={SOCIAL_BIRTHDAY_PAGE_QUERY_MAX}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className={`${styles.state} ${styles.error}`}>
          {error}
        </p>
      ) : loading && !data ? (
        <div className={styles.grid} aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={styles.skeleton} />
          ))}
        </div>
      ) : data && data.groups.length > 0 ? (
        data.groups.map((group) => (
          <div key={`${group.year}-${group.month}`} className={styles.month}>
            <h2 className={styles.monthLabel}>{monthGroupLabel(group, data.today)}</h2>
            <ul className={styles.grid}>
              {group.items.map((entry) => {
                const age = ageLabel(entry);
                const unit = entrySubtitle(entry);
                return (
                  <li key={`${entry.user.id}-${entry.date}`}>
                    <SocialLink
                      to={{ name: 'profile', userId: entry.user.id }}
                      className={styles.card}
                      data-today={entry.isToday}
                    >
                      <Avatar user={entry.user} size={32} />
                      <span className={styles.text}>
                        <span className={styles.name}>{entry.user.name}</span>
                        {unit ? <span className={styles.unit}>{unit}</span> : null}
                        <span className={styles.meta}>
                          <span className={styles.metaItem}>
                            <Cake size={12} aria-hidden="true" />
                            {entryDayMonth(entry)}
                          </span>
                          {age ? <span>{age}</span> : null}
                          {entry.isToday ? <span className={styles.todayTag}>Hôm nay</span> : null}
                        </span>
                      </span>
                    </SocialLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      ) : (
        <p className={styles.state}>
          {query ? 'Không có sinh nhật nào khớp với từ khoá.' : 'Chưa có sinh nhật nào sắp tới.'}
        </p>
      )}
    </section>
  );
}
