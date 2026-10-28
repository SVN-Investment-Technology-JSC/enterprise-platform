'use client';

import type { SocialUserRef } from '@enterprise-platform/contracts-social';
import { BarChart3, Image as ImageIcon, Megaphone, Pencil } from 'lucide-react';
import type { SocialComposerMode } from '../../social-context';
import shell from '../../social-shell.module.scss';
import { Avatar } from '../ui';

/**
 * Ô "Đăng bài viết mới" dùng chung cho bảng tin và trang nhóm: chỉ khác chữ gợi ý (`placeholder`) và việc có hiện lối
 * tắt "Thông báo" hay không (`canAnnounce`).
 */
export function ComposerBox({
  user,
  placeholder,
  canAnnounce,
  onCompose,
}: {
  readonly user: SocialUserRef;
  readonly placeholder: string;
  readonly canAnnounce: boolean;
  readonly onCompose: (mode?: SocialComposerMode) => void;
}) {
  return (
    <section className={shell.composer} aria-label="Soạn bài viết">
      <div className={shell.composerTop}>
        <Avatar user={user} size={36} />
        <button type="button" className={shell.composerTrigger} onClick={() => onCompose()}>
          <Pencil size={14} aria-hidden="true" /> {placeholder}
        </button>
      </div>
      <div className={shell.composerShortcuts}>
        <button type="button" onClick={() => onCompose('media')}>
          <ImageIcon size={15} aria-hidden="true" />
          Ảnh/Video/File
        </button>
        <button type="button" onClick={() => onCompose('poll')}>
          <BarChart3 size={15} aria-hidden="true" />
          Bình chọn
        </button>
        {canAnnounce ? (
          <button type="button" onClick={() => onCompose('announcement')}>
            <Megaphone size={15} aria-hidden="true" />
            Thông báo
          </button>
        ) : null}
      </div>
    </section>
  );
}
