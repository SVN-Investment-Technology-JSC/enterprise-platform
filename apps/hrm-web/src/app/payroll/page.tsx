import { redirect } from 'next/navigation';

/** Lương và chi trả do ứng dụng kế toán quản lý; đường dẫn cũ chuyển sang trang Bảng công. */
export default function Page() {
  redirect('/timekeeping?view=timesheets');
}
