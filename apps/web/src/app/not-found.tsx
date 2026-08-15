import Link from 'next/link';
import styles from './system-message.module.scss';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.code}>404</p>
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn này không tồn tại hoặc đã được di chuyển.</p>
      <Link className={styles.action} href="/">
        Về trang chủ
      </Link>
    </main>
  );
}
