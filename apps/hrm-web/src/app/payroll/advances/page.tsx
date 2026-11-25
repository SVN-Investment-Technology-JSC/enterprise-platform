import { redirect } from 'next/navigation';

/** Tạm ứng do ứng dụng kế toán quản lý; đường dẫn cũ chuyển sang trang Bảng công. */
export default function Page() {
  redirect('/timekeeping?view=timesheets');
}
