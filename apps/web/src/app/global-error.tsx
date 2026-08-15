'use client';

import { useEffect } from 'react';
import styles from './system-message.module.scss';

export default function GlobalError({
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
    <html lang="vi">
      <body className={styles.page}>
        <p className={styles.code}>Enterprise Platform</p>
        <h1>Ứng dụng đang tạm thời gián đoạn.</h1>
        <button className={styles.action} type="button" onClick={reset}>
          Tải lại
        </button>
      </body>
    </html>
  );
}
