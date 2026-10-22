'use client';

import { SOCIAL_HRM_LINKS, type SocialPersonProfile } from '@enterprise-platform/contracts-social';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatBirthday, formatDate } from '../../discovery.model';
import styles from '../../discovery.module.scss';
import { errorMessage, type SocialApiError } from '../../social-api';
import { loadProfile } from '../../social-discovery-api';
import { SocialFeed } from '../feed/social-feed';
import { Avatar, userSubtitle } from '../ui';

type Tab = 'posts' | 'about';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'posts', label: 'Bài viết' },
  { id: 'about', label: 'Giới thiệu' },
];

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string; readonly notFound: boolean }
  | { readonly status: 'ready'; readonly profile: SocialPersonProfile };

/** Trang cá nhân: đầu trang gọn, hồ sơ nhanh bên cạnh, tab Bài viết / Giới thiệu. */
export function ProfileView({ userId }: { readonly userId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tab, setTab] = useState<Tab>('posts');

  const load = useCallback(() => {
    let active = true;
    setState({ status: 'loading' });
    loadProfile(userId)
      .then((profile) => active && setState({ status: 'ready', profile }))
      .catch((cause: unknown) => {
        if (!active) return;
        const notFound = (cause as SocialApiError | undefined)?.code === 'PERSON_NOT_FOUND';
        setState({
          status: 'error',
          notFound,
          message: notFound
            ? 'Không tìm thấy người này.'
            : errorMessage(cause, 'Không tải được trang cá nhân. Vui lòng thử lại.'),
        });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    setTab('posts');
    return load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className={`${styles.card} ${styles.skeletons}`} aria-busy="true" aria-label="Đang tải trang cá nhân">
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={`${styles.card} ${styles.state}`} role="alert">
        <p className={styles.stateTitle}>{state.message}</p>
        {state.notFound ? null : (
          <button type="button" className={styles.retry} onClick={load}>
            Thử lại
          </button>
        )}
      </div>
    );
  }

  const { profile } = state;
  const subtitle = userSubtitle({ ...profile.user, position: profile.position, unitName: profile.unitName });

  return (
    <div className={styles.profile}>
      <header className={`${styles.card} ${styles.profileHead}`}>
        <Avatar user={profile.user} size={64} />
        <div className={styles.profileIdentity}>
          <h1>{profile.user.name}</h1>
          {subtitle ? <p className={styles.profileRole}>{subtitle}</p> : null}
          <ul className={styles.profileFacts}>
            {profile.birthday ? <li>Sinh nhật {formatBirthday(profile.birthday)}</li> : null}
            <li>{profile.postCount} bài viết</li>
          </ul>
        </div>
      </header>

      <div className={styles.profileBody}>
        <div className={styles.profileMain}>
          <div className={styles.tabs} role="tablist" aria-label="Nội dung trang cá nhân">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`profile-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`profile-panel-${item.id}`}
                className={styles.tab}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`profile-panel-${tab}`} aria-labelledby={`profile-tab-${tab}`}>
            {tab === 'posts' ? (
              <SocialFeed scope={{ authorId: userId }} />
            ) : (
              <AboutPanel profile={profile} />
            )}
          </div>
        </div>

        <aside className={`${styles.card} ${styles.quick}`} aria-label="Hồ sơ nhanh">
          <h2>Hồ sơ nhanh</h2>
          {profile.canOpenInHrm ? (
            <a className={styles.quickLink} href={SOCIAL_HRM_LINKS.employees}>
              Hồ sơ trong Nhân sự
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : (
            <p className={styles.quickNote}>Bạn không có quyền xem hồ sơ nhân sự của người này.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function AboutPanel({ profile }: { readonly profile: SocialPersonProfile }) {
  const rows: readonly (readonly [string, string])[] = [
    ['Họ và tên', profile.user.name],
    ['Chức vụ', profile.position ?? ''],
    ['Phòng ban', profile.unitName ?? ''],
    ['Email', profile.email ?? ''],
    ['Ngày sinh', profile.birthday ? formatBirthday(profile.birthday) : ''],
    ['Ngày vào công ty', formatDate(profile.joinedAt)],
  ];
  const filled = rows.filter(([, value]) => value);
  return (
    <dl className={`${styles.card} ${styles.about}`}>
      {filled.map(([label, value]) => (
        <div key={label} className={styles.aboutRow}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
