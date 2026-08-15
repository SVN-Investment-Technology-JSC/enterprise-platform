import styles from './system-message.module.scss';

export default function Loading() {
  return (
    <main className={styles.page} aria-live="polite" aria-busy="true">
      <p className={styles.code}>Enterprise Platform</p>
      <h1>Đang tải dữ liệu…</h1>
    </main>
  );
}
