import { redirect } from 'next/navigation';

/** Trang Kỳ công đã ẩn: khóa đơn từ, khóa chấm công và xuất bảng công làm ngay ở trang Bảng công. */
export default function Page() {
  redirect('/timekeeping?view=timesheets');
}
