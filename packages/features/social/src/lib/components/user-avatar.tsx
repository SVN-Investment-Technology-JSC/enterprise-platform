'use client';

import type { SocialUserRef } from '@enterprise-platform/contracts-social';
import { cn } from '../utils';
import { PersonHover } from './person-card';
import { Avatar } from './ui';

/**
 * Ảnh đại diện dùng chung của Mạng nội bộ: rê chuột hiện thẻ hồ sơ rút gọn, bấm để sang trang cá nhân (hỏi lại nếu đang
 * soạn dở). Mọi nơi hiện ảnh một người khác nên dùng component này để cách ứng xử giống nhau.
 *
 * - `link={false}`: ảnh nằm trong một liên kết hay nút khác (thẻ kết quả tìm kiếm, dòng sinh nhật...). Vẫn hiện thẻ hồ sơ khi
 *   rê chuột, nhưng không tự là liên kết (tránh lồng `<a>`); bấm thì để phần tử bao ngoài xử lý.
 * - `hover={false}`: chỉ vẽ ảnh, không thẻ hồ sơ (ảnh của chính mình trong ô soạn, tiêu đề trang cá nhân...).
 */
export function UserAvatar({
  user,
  size = 32,
  link = true,
  hover = true,
  className,
}: {
  readonly user: SocialUserRef;
  readonly size?: number;
  readonly link?: boolean;
  readonly hover?: boolean;
  readonly className?: string;
}) {
  const avatar = <Avatar user={user} size={size} />;
  if (!hover) return avatar;
  return (
    <PersonHover
      userId={user.id}
      name={user.name}
      label={user.name}
      asLink={link}
      className={cn('inline-flex shrink-0 rounded-full leading-none no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring/40', className)}
    >
      {avatar}
    </PersonHover>
  );
}
