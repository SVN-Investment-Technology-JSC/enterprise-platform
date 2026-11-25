import { redirect } from 'next/navigation';

/** Đường dẫn số ít hay gõ nhầm; trang báo cáo nằm ở /reports. */
export default function Page() {
  redirect('/reports');
}
