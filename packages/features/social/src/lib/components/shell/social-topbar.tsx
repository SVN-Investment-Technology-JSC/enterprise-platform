'use client';

import type { SocialMe } from '@enterprise-platform/contracts-social';
import { ModuleSwitcher } from '@enterprise-platform/feature-module-shell';
import { NotificationBell, useBrandSlot } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import { SOCIAL_BASE_PATH } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { Avatar } from '../ui';
import { SearchBox } from './social-nav';

/**
 * Thanh trên của Mạng nội bộ (thay cho breadcrumb của khung): chuyển phân hệ, tên, ô tìm kiếm ở giữa,
 * chuông thông báo và người dùng. Dính ở đầu vùng cuộn, tràn hết bề ngang nội dung.
 */
export function SocialTopBar({
  me,
  homeHref,
  searchActive,
  searchQuery,
}: {
  readonly me: SocialMe;
  readonly homeHref: string;
  readonly searchActive: boolean;
  readonly searchQuery: string;
}) {
  const { item: brandLogoItem, hasCustom: hasCustomBrandLogo } = useBrandSlot('brand.logo');
  const [failedLogoKey, setFailedLogoKey] = useState<string | null>(null);
  const logoKey = brandLogoItem ? `${brandLogoItem.iconId}@${brandLogoItem.version}` : null;
  const customLogoSrc =
    hasCustomBrandLogo && brandLogoItem && logoKey && failedLogoKey !== logoKey
      ? `/api/platform/v1/brand/slots/brand.logo/svg?icon=${encodeURIComponent(brandLogoItem.iconId)}&v=${brandLogoItem.version}`
      : null;

  return (
    <header className={styles.topbar}>
      <div className={styles.topbarInner}>
        <div className={styles.topbarBrand}>
          <ModuleSwitcher moduleKey="social" homeHref={homeHref} />
          <SocialLink className={styles.topbarTitle} to={{ name: 'feed' }}>
            <img
              src={customLogoSrc ?? `${SOCIAL_BASE_PATH}/brand-logo.jpg`}
              alt=""
              width={30}
              height={30}
              onError={() => {
                if (customLogoSrc && logoKey) {
                  setFailedLogoKey(logoKey);
                }
              }}
            />
            <span>
              <strong>Mạng nội bộ</strong>
            </span>
          </SocialLink>
        </div>
        <SearchBox active={searchActive} query={searchQuery} />
        <div className={styles.topbarActions}>
          <NotificationBell />
          <SocialLink className={styles.topbarUser} to={{ name: 'profile', userId: me.user.id }}>
            <Avatar user={me.user} size={30} />
            <span className={styles.topbarUserName}>{me.user.name}</span>
          </SocialLink>
        </div>
      </div>
    </header>
  );
}
