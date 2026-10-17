import type { ReactNode } from 'react';
import { SessionKeepAlive } from '@enterprise-platform/shared-ui';

/** Mọi trang dưới /platform đều đã đăng nhập (proxy chặn khi thiếu phiên): giữ phiên sống ngầm. */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionKeepAlive />
      {children}
    </>
  );
}
