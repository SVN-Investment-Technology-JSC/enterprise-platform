'use client';

import styles from '../social.module.scss';
import { PersonHover } from './person-card';

/**
 * Tên được nhắc trong bình luận: chữ xanh, rê chuột hiện thẻ hồ sơ, bấm để sang trang cá nhân (hỏi lại nếu đang soạn dở).
 */
export function MentionLink({ userId, name }: { readonly userId: string; readonly name: string }) {
  return (
    <PersonHover userId={userId} name={name} className={styles.mention}>
      @{name}
    </PersonHover>
  );
}
