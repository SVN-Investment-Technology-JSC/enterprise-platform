import styles from './page.module.scss';

const capabilities = [
  {
    title: 'Platform Core',
    description: 'Identity, tenancy, authorization và entitlement.',
  },
  {
    title: 'Business Modules',
    description:
      'CRM là vertical slice đầu tiên; các module khác được thêm dần.',
  },
  {
    title: 'Dedicated Database',
    description: 'Mỗi tenant sử dụng một PostgreSQL database độc lập.',
  },
] as const;

export default function Page() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Enterprise Platform</p>
        <h1>Nền tảng SaaS đa tenant theo kiến trúc modular monolith.</h1>
        <p className={styles.summary}>
          Workspace đã sẵn sàng để triển khai luồng xác thực, tenant context,
          phân quyền và business module mà không làm lẫn ranh giới dữ liệu.
        </p>
      </section>

      <section className={styles.grid} aria-label="Năng lực nền tảng">
        {capabilities.map((capability) => (
          <article className={styles.card} key={capability.title}>
            <h2>{capability.title}</h2>
            <p>{capability.description}</p>
          </article>
        ))}
      </section>

      <p className={styles.status}>Foundation workspace · Nx · pnpm</p>
    </main>
  );
}
