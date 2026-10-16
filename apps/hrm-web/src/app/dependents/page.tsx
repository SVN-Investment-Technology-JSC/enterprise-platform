import { redirect } from 'next/navigation';

/**
 * Trang người phụ thuộc toàn công ty đã bỏ: người phụ thuộc giờ là tab "Người phụ thuộc" trong chi tiết từng nhân viên
 * (Nhân sự > Nhân viên, bấm vào một nhân viên). Giữ đường dẫn cũ để liên kết và dấu trang cũ vẫn dùng được.
 */
export default function Page() {
  redirect('/employees?view=employees');
}
