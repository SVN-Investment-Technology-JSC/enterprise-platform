'use client';

import { initialsOf, userAvatarUrl } from '@enterprise-platform/contracts-chat';
import { useEffect, useState, type CSSProperties } from 'react';
import { usePerson } from './people-directory';
import styles from './user-avatar.module.scss';

export interface UserAvatarProps {
  readonly userId?: string | null;
  /** Tên để lấy chữ viết tắt khi chưa có ảnh (mặc định lấy từ danh bạ). */
  readonly name?: string | null;
  /** Ghi đè phiên bản ảnh (ví dụ ngay sau khi đổi ảnh); mặc định lấy từ danh bạ. */
  readonly avatarVersion?: number | null;
  readonly size?: number;
  /** Chấm trạng thái ở góc: trực tuyến (xanh) hoặc ngoại tuyến (xám); bỏ trống thì không vẽ. */
  readonly presence?: 'online' | 'offline';
  readonly className?: string;
  readonly title?: string;
}

/**
 * Ảnh đại diện dùng chung toàn hệ thống: ảnh người dùng tải lên ở "Tài khoản của tôi", chưa có ảnh (hoặc ảnh lỗi)
 * thì hiện chữ viết tắt trên nền màu nhấn của hệ thống.
 */
export function UserAvatar({ userId, name, avatarVersion, size = 32, presence, className, title }: UserAvatarProps) {
  const person = usePerson(userId);
  const version = avatarVersion !== undefined ? avatarVersion : (person?.avatarVersion ?? null);
  const label = name ?? person?.fullName ?? '';
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [userId, version]);
  const showImage = Boolean(userId && version !== null && !failed);
  const style = { '--ep-avatar-size': `${size}px` } as CSSProperties;
  return (
    <span className={[styles.avatar, className].filter(Boolean).join(' ')} style={style} title={title ?? (label || undefined)}>
      {showImage ? (
        <img
          className={styles.image}
          src={userAvatarUrl(userId as string, version as number)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initialsOf(label)}
        </span>
      )}
      {presence ? (
        <span
          className={presence === 'online' ? `${styles.dot} ${styles.dotOnline}` : styles.dot}
          role="img"
          aria-label={presence === 'online' ? 'Đang trực tuyến' : 'Ngoại tuyến'}
        />
      ) : null}
    </span>
  );
}
