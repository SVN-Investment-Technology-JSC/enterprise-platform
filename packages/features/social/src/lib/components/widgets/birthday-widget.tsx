'use client';

import type { SocialBirthdaysUpcoming } from '@enterprise-platform/contracts-social';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadBirthdaysUpcoming } from '../../social-discovery-api';
import { SocialLink } from '../../social-navigation';
import { ageLabel, entryDayMonth, splitForWidget } from '../birthday/birthday.model';
import styles from '../birthday/birthday.module.scss';
import { Avatar } from '../ui';

const NEXT_AVATARS = 4;

/**
 * Khối sinh nhật cho cột phải: người sinh nhật hôm nay và hàng avatar những người sắp tới; mũi tên mở
 * trang `/birthday`. Không có dữ liệu hoặc gặp lỗi thì ẩn hẳn, để không làm vỡ trang.
 */
export function BirthdayWidget() {
  const [data, setData] = useState<SocialBirthdaysUpcoming | null>(null);

  useEffect(() => {
    let active = true;
    loadBirthdaysUpcoming({ months: 2 })
      .then((result) => active && setData(result))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, []);

  if (!data) return null;
  const { today, next } = splitForWidget(data, 50);
  if (today.length === 0 && next.length === 0) return null;
  const shown = next.slice(0, NEXT_AVATARS);
  const rest = next.length - shown.length;

  return (
    <section className={styles.widget} aria-label="Sinh nhật">
      <header className={styles.widgetHead}>
        <h2>Sinh nhật</h2>
        {today.length > 0 ? (
          <span className={styles.todayTag} aria-label={`${today.length} sinh nhật hôm nay`}>
            {today.length}
          </span>
        ) : null}
      </header>
      {today.length > 0 ? (
        <ul className={styles.todayList}>
          {today.map((entry) => {
            const age = ageLabel(entry);
            return (
              <li key={entry.user.id}>
                <SocialLink to={{ name: 'profile', userId: entry.user.id }} className={styles.todayItem}>
                  <Avatar user={entry.user} size={28} />
                  <span className={styles.text}>
                    <span className={styles.name}>{entry.user.name}</span>
                    <span className={styles.meta}>{['Hôm nay', age].filter(Boolean).join(' · ')}</span>
                  </span>
                </SocialLink>
              </li>
            );
          })}
        </ul>
      ) : null}
      {next.length > 0 ? (
        <SocialLink
          to={{ name: 'birthday' }}
          className={styles.moreRow}
          aria-label={`Sinh nhật sắp tới, ${next.length} người. Mở trang đầy đủ`}
          title={shown.map((entry) => `${entry.user.name} ${entryDayMonth(entry)}`).join(', ')}
        >
          <span>Sinh nhật sắp tới</span>
          <span className={styles.stack}>
            {shown.map((entry) => (
              <Avatar key={entry.user.id} user={entry.user} size={26} />
            ))}
            {rest > 0 ? <span className={styles.stackMore}>+{rest}</span> : null}
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </SocialLink>
      ) : null}
    </section>
  );
}
