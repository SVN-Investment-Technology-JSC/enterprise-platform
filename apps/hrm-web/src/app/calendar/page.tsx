import { redirect } from 'next/navigation';

/** Chức năng đã gộp thành tab của trang khác; giữ đường dẫn cũ để liên kết và dấu trang cũ vẫn dùng được. */
export default function Page() {
  redirect('/my-work?view=calendar');
}
