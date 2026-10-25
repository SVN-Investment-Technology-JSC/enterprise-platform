'use client';

import type { SocialBirthdaysUpcoming } from '@enterprise-platform/contracts-social';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadBirthdaysUpcoming } from '../../social-discovery-api';
import { SocialLink } from '../../social-navigation';
import { ageLabel, entryDayMonth, splitForWidget } from '../birthday/birthday.model';
import styles from '../birthday/birthday.module.scss';
import { Avatar } from '../ui';

const NEXT_AVATARS = 3;

/** Bánh sinh nhật nhỏ ở đầu thẻ. */
function CakeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="9" y="2.6" width="2" height="3" rx="0.6" fill="#f22b2b" />
      <path d="M10 0.4c.7.9 1 1.4 1 1.9a1 1 0 0 1-2 0c0-.5.3-1 1-1.9Z" fill="#f0c419" />
      <rect x="5" y="5.6" width="10" height="4.6" rx="1.4" fill="#f9eab0" />
      <rect x="3.4" y="9.4" width="13.2" height="4.4" rx="1.4" fill="#f3d55b" />
      <rect x="2" y="13" width="16" height="4.6" rx="1.4" fill="#f3d55b" />
      <rect x="1" y="17" width="18" height="2" rx="1" fill="#e0a817" />
    </svg>
  );
}

/** Cờ treo và hoa giấy ở góc phải tiêu đề (trang trí, không mang thông tin). */
function PartyDecor() {
  return (
    <svg className={styles.decor} width="170" height="48" viewBox="0 0 170 48" aria-hidden="true" focusable="false">
      <g fill="none" stroke="#c9ccd2" strokeWidth="1">
        <path d="M96 0 Q 130 14 168 6" />
      </g>
      <path d="M112 8l8 3-3 11z" fill="#e5383b" />
      <path d="M124 11l8 1-4 11z" fill="#f5a623" />
      <path d="M136 12l8-1-1 12z" fill="#2fa8cc" />
      <path d="M148 11l8-3 1 12z" fill="#3fb950" />
      <path d="M159 8l8-4 1 12z" fill="#8a5cf6" />
      <g>
        <rect x="14" y="10" width="3" height="5" fill="#2f6fe4" transform="rotate(25 15 12)" />
        <rect x="30" y="22" width="3" height="3" fill="#e5383b" />
        <rect x="48" y="12" width="3" height="5" fill="#f5a623" transform="rotate(-30 49 14)" />
        <rect x="64" y="26" width="3" height="3" fill="#2fa8cc" />
        <rect x="78" y="10" width="3" height="5" fill="#3fb950" transform="rotate(40 79 12)" />
        <rect x="92" y="24" width="3" height="3" fill="#e5383b" />
        <circle cx="40" cy="30" r="1.5" fill="#2f6fe4" />
        <circle cx="104" cy="34" r="1.5" fill="#f5a623" />
        <circle cx="22" cy="4" r="1.5" fill="#3fb950" />
        <circle cx="70" cy="6" r="1.5" fill="#e5383b" />
      </g>
    </svg>
  );
}

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
        <CakeIcon />
        <h2>Sinh nhật</h2>
        {today.length > 0 ? (
          <span className={styles.todayTag} aria-label={`${today.length} sinh nhật hôm nay`}>
            {today.length}
          </span>
        ) : null}
        <PartyDecor />
      </header>
      {today.length === 0 ? <p className={styles.todayEmpty}>Hôm nay không có sinh nhật ai.</p> : null}
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
