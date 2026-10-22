'use client';

import dynamic from 'next/dynamic';

/**
 * Khu vực "Duyệt đơn và chấm công nhanh" của HRM. Chỉ nạp ở trình duyệt (cần vị trí GPS và gọi API HRM bằng phiên đăng
 * nhập hiện tại) và để phần HRM nằm ngoài bó mã của trang cho tenant không dùng HRM.
 */
const HrmQuickWork = dynamic(() => import('@enterprise-platform/feature-hrm').then((m) => m.HrmQuickWork), {
  ssr: false,
});

export function HrmQuickWorkSection() {
  return <HrmQuickWork />;
}
