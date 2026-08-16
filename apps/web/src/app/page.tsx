import Link from 'next/link';
import styles from './page.module.scss';

export default function PortalChooserPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span>Enterprise Platform</span>
        <h1>Chọn đúng cổng<br />cho đúng vai trò.</h1>
        <p>
          Platform Admin quản trị toàn bộ nền tảng. Tenant Admin và người dùng
          doanh nghiệp truy cập portal cùng các module đã được cấp entitlement.
        </p>
        <div className={styles.flow} aria-label="Luồng truy cập">
          <b>Identity</b><i>→</i><b>Authorization</b><i>→</i><b>Entitlement</b>
        </div>
      </section>

      <section className={styles.portals} aria-labelledby="portal-heading">
        <div className={styles.heading}>
          <small>Hai vùng truy cập độc lập</small>
          <h2 id="portal-heading">Bạn muốn đăng nhập ở đâu?</h2>
          <p>Mỗi cổng chỉ chấp nhận đúng loại tài khoản được chỉ định.</p>
        </div>

        <Link className={`${styles.portalCard} ${styles.platformCard}`} href="/platform/login">
          <span className={styles.icon}>PC</span>
          <div>
            <small>Platform Core</small>
            <h3>Superadmin</h3>
            <p>Quản lý tenant, module registry, entitlement và database reference.</p>
          </div>
          <strong>Vào cổng quản trị →</strong>
        </Link>

        <Link className={`${styles.portalCard} ${styles.tenantCard}`} href="/tenant/login">
          <span className={styles.icon}>TP</span>
          <div>
            <small>Tenant Portal</small>
            <h3>Người dùng tenant</h3>
            <p>Truy cập workspace và các module doanh nghiệp đã đăng ký.</p>
          </div>
          <strong>Vào cổng tenant →</strong>
        </Link>
      </section>
    </main>
  );
}
