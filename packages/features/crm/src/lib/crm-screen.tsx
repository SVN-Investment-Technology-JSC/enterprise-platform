'use client';

import { CRM_NO_CAPABILITIES, type CrmStatus } from '@enterprise-platform/contracts-crm';
import { ModuleShell, useHashView, type ModuleNavItem } from '@enterprise-platform/feature-module-shell';
import {
  ChartColumn,
  FileSignature,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Target,
  Users,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, loadCrmStatus, loadTenantHomePath } from './crm-api';
import {
  CRM_PAGES,
  CRM_VIEWS,
  crmCapabilityLabels,
  crmScopeLabel,
  visibleCrmPages,
  type CrmPage,
  type CrmView,
} from './crm-nav.model';
import styles from './crm.module.scss';

const ICONS: Record<CrmView, ReactNode> = {
  overview: <LayoutDashboard size={16} />,
  customers: <Users size={16} />,
  opportunities: <Target size={16} />,
  quotes: <FileText size={16} />,
  contracts: <FileSignature size={16} />,
  orders: <ShoppingCart size={16} />,
  receivables: <Wallet size={16} />,
  warranty: <ShieldCheck size={16} />,
  reports: <ChartColumn size={16} />,
  settings: <Settings size={16} />,
};

/**
 * Bán hàng. GĐ0 mới có khung: menu tiếng Việt và trang giữ chỗ cho từng phần;
 * menu ẩn hiện theo `capabilities` của `GET /api/crm/v1/status` (quyền thật
 * kiểm ở API).
 */
export function CrmScreen() {
  const { view, navigate } = useHashView<CrmView>({ views: CRM_VIEWS, fallback: 'overview' });
  const [homePath, setHomePath] = useState('/');
  const [status, setStatus] = useState<CrmStatus>();
  const [error, setError] = useState<string>();
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    void loadTenantHomePath().then(setHomePath);
    loadCrmStatus()
      .then((next) => {
        setStatus(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được trạng thái phân hệ Bán hàng.')));
  }, []);

  const capabilities = status?.capabilities ?? CRM_NO_CAPABILITIES;
  const pages = visibleCrmPages(capabilities);
  const provisioning = Boolean(status && !status.tablesReady);
  // Trang bị ẩn (mở bằng link cũ khi không có quyền) thì hiện Tổng quan.
  const current: CrmPage = pages.find((page) => page.id === view) ?? CRM_PAGES[0];

  const nav: readonly ModuleNavItem<CrmView>[] = CRM_PAGES.map((page) => ({
    id: page.id,
    label: page.label,
    group: page.group,
    icon: ICONS[page.id],
    hidden: !pages.includes(page),
  }));

  return (
    <ModuleShell<CrmView>
      moduleKey="crm"
      appearance="light"
      title="Bán hàng"
      nav={nav}
      view={current.id}
      onViewChange={navigate}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      banner={
        <>
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          {provisioning ? (
            <p className={styles.notice}>Dữ liệu Bán hàng của tenant đang được khởi tạo.</p>
          ) : null}
        </>
      }
    >
      {!status ? null : current.id === 'overview' ? (
        <Overview status={status} onOpen={navigate} />
      ) : (
        <Placeholder page={current} />
      )}
    </ModuleShell>
  );
}

function Overview({ status, onOpen }: { status: CrmStatus; onOpen: (view: CrmView) => void }) {
  const capabilities = status.capabilities;
  const pages = visibleCrmPages(capabilities).filter((page) => page.id !== 'overview');
  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-label="Quyền của bạn">
        <h2 className={styles.title}>Phân hệ Bán hàng</h2>
        <p className={styles.muted}>
          Phân hệ đang được xây dựng theo từng giai đoạn. Các trang dưới đây sẽ lần lượt mở khi sẵn sàng.
        </p>
        <dl className={styles.facts}>
          <dt>Phạm vi dữ liệu</dt>
          <dd>{crmScopeLabel(capabilities)}</dd>
          <dt>Quyền của bạn</dt>
          <dd>
            <ul className={styles.tags}>
              {crmCapabilityLabels(capabilities).map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </section>
      <ul className={styles.grid}>
        {pages.map((page) => (
          <li key={page.id}>
            <button type="button" className={styles.card} onClick={() => onOpen(page.id)}>
              <span className={styles.cardHead}>
                {ICONS[page.id]}
                <strong>{page.label}</strong>
                <span className={styles.badge}>{page.phase}</span>
              </span>
              <span className={styles.muted}>{page.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Placeholder({ page }: { page: CrmPage }) {
  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-label={page.label}>
        <span className={styles.cardHead}>
          {ICONS[page.id]}
          <h2 className={styles.title}>{page.label}</h2>
          <span className={styles.badge}>{page.phase}</span>
        </span>
        <p className={styles.muted}>{page.summary}</p>
        <p className={styles.muted}>Trang này đang được xây dựng.</p>
      </section>
    </div>
  );
}
