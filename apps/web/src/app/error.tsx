'use client';

import { useEffect } from 'react';
import styles from './system-message.module.scss';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <p className={styles.code}>Có lỗi xảy ra</p>
      <h1>Không thể hoàn tất yêu cầu.</h1>
      <p>Vui lòng thử lại. Nếu lỗi lặp lại, hãy liên hệ quản trị viên.</p>
      <button className={styles.action} type="button" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
