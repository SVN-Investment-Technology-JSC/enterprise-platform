'use client';

import { CRM_NO_CAPABILITIES, type CrmStatus } from '@enterprise-platform/contracts-crm';
import { ModuleShell, useHashView, type ModuleNavItem } from '@enterprise-platform/feature-module-shell';
import {
  CalendarClock,
  ChartColumn,
  FileSignature,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Target,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, loadCrmStatus, loadTenantHomePath } from './crm-api';
import {
  CRM_ACCESS_DENIED_MESSAGE,
  CRM_PAGES,
  CRM_VIEWS,
  crmCapabilityLabels,
  crmScopeLabel,
  isCrmAccessDenied,
  visibleCrmPages,
  type CrmPage,
  type CrmView,
} from './crm-nav.model';
import styles from './crm.module.scss';
import { ActivityPanel } from './activities/activity-panel';
import { CrmAntdProvider } from './components/crm-ui';
import { CrmDataProvider, peopleOptions, useCrm } from './crm-context';
import { CustomerDetail } from './customers/customer-detail';
import { CustomerList } from './customers/customer-list';
import { LeadsPage } from './leads/leads-page';
import { OpportunitiesPage } from './opportunities/opportunities-page';
import { QuoteEditor } from './quotes/quote-editor';
import { QuotesPage } from './quotes/quotes-page';
import { CrmSettingsPage } from './settings/crm-settings';
import { ContractDetail } from './contracts/contract-detail';
import { ContractsPage } from './contracts/contracts-page';
import { OrderDetail } from './orders/order-detail';
import { OrdersPage } from './orders/orders-page';
import { CustomerLedger } from './receivables/customer-ledger';
import { ReceivablesPage } from './receivables/receivables-page';
import { WarrantyDetail } from './warranty/warranty-detail';
import { WarrantyPage } from './warranty/warranty-page';
import { ReportsPage } from './reports/reports-page';
import salesStyles from './sales.module.scss';
import { SearchableSelect } from '@enterprise-platform/shared-ui';

const ICONS: Record<CrmView, ReactNode> = {
  overview: <LayoutDashboard size={16} />,
  customers: <Users size={16} />,
  leads: <UserPlus size={16} />,
  opportunities: <Target size={16} />,
  activities: <CalendarClock size={16} />,
  quotes: <FileText size={16} />,
  contracts: <FileSignature size={16} />,
  orders: <ShoppingCart size={16} />,
  receivables: <Wallet size={16} />,
  warranty: <ShieldCheck size={16} />,
  reports: <ChartColumn size={16} />,
  settings: <Settings size={16} />,
};

/**
 * Bán hàng. Menu ẩn hiện theo `capabilities` của `GET /api/crm/v1/status`
 * (quyền thật kiểm ở API). Đoạn hash thứ hai là id đang mở, ví dụ
 * `#customers/<id>`, `#opportunities/<id>`, `#activities/<id>` (liên kết từ
 * thông báo nhắc hạn), `#quotes/<id>` (thông báo duyệt báo giá), `#contracts/<id>` (hợp đồng sắp hết
 * hạn), `#orders/<id>` (giao trễ, mất phần giữ hàng). Người chưa có quyền
 * `crm.*` nào (status trả 403) chỉ thấy một thông báo, không có menu.
 */
export function CrmScreen() {
  const { view, sub, navigate } = useHashView<CrmView>({ views: CRM_VIEWS, fallback: 'overview' });
  const [homePath, setHomePath] = useState('/');
  const [status, setStatus] = useState<CrmStatus>();
  const [error, setError] = useState<string>();
  const [denied, setDenied] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    void loadTenantHomePath().then(setHomePath);
    loadCrmStatus()
      .then((next) => {
        setStatus(next);
        setError(undefined);
        setDenied(false);
      })
      .catch((cause) => {
        if (isCrmAccessDenied(cause)) setDenied(true);
        else setError(errorMessage(cause, 'Không tải được trạng thái phân hệ Bán hàng.'));
      });
  }, []);

  const capabilities = status?.capabilities ?? CRM_NO_CAPABILITIES;
  const pages = visibleCrmPages(capabilities);
  const provisioning = Boolean(status && !status.tablesReady);
  // Trang bị ẩn (mở bằng link cũ khi không có quyền) thì hiện Tổng quan.
  const current: CrmPage = pages.find((page) => page.id === view) ?? CRM_PAGES[0];

  // Menu chỉ hiện khi đã biết quyền, để người không có quyền không thấy menu thoáng qua.
  const nav: readonly ModuleNavItem<CrmView>[] = CRM_PAGES.map((page) => ({
    id: page.id,
    label: page.label,
    group: page.group,
    icon: ICONS[page.id],
    hidden: !status || !pages.includes(page),
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
      {denied ? (
        <AccessDenied />
      ) : !status ? null : current.id === 'overview' ? (
        <Overview status={status} onOpen={navigate} />
      ) : status.tablesReady ? (
        <CrmAntdProvider>
          <CrmDataProvider capabilities={capabilities} currentUserId={status.userId}>
            <SalesView page={current} sub={sub} navigate={navigate} />
          </CrmDataProvider>
        </CrmAntdProvider>
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
          Quản lý trọn chu trình bán hàng: khách hàng, lead và cơ hội; báo giá, hợp đồng và đơn bán; công nợ, bảo hành
          và báo cáo. Chọn một mục dưới đây để mở.
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
                <span className={styles.badge}>{page.group}</span>
              </span>
              <span className={styles.muted}>{page.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nội dung từng trang; trang không khớp hiện khung chờ. */
function SalesView({
  page,
  sub,
  navigate,
}: {
  page: CrmPage;
  sub: string | undefined;
  navigate: (view: CrmView, sub?: string) => void;
}) {
  const openCustomer = (id: string) => navigate('customers', id);
  const openOpportunity = (id: string) => navigate('opportunities', id);
  const openQuote = (id: string) => navigate('quotes', id);
  const openContract = (id: string) => navigate('contracts', id);
  const openOrder = (id: string) => navigate('orders', id);
  switch (page.id) {
    case 'customers':
      return sub ? (
        <CustomerDetail
          key={sub}
          customerId={sub}
          onBack={() => navigate('customers')}
          onOpenOpportunity={openOpportunity}
          onOpenQuote={openQuote}
          onOpenContract={openContract}
          onOpenOrder={openOrder}
          onOpenWarranty={(id) => navigate('warranty', id)}
        />
      ) : (
        <CustomerList onOpen={openCustomer} />
      );
    case 'leads':
      return <LeadsPage onOpenCustomer={openCustomer} onOpenOpportunity={openOpportunity} />;
    case 'opportunities':
      return (
        <OpportunitiesPage
          focusId={sub}
          onFocus={(id) => navigate('opportunities', id)}
          onOpenCustomer={openCustomer}
          onOpenQuote={openQuote}
        />
      );
    case 'quotes':
      return sub ? (
        <QuoteEditor
          key={sub}
          quoteId={sub}
          onBack={() => navigate('quotes')}
          onOpenCustomer={openCustomer}
          onOpenOpportunity={openOpportunity}
          onOpenOrder={openOrder}
        />
      ) : (
        <QuotesPage onOpen={openQuote} />
      );
    case 'contracts':
      return sub ? (
        <ContractDetail
          key={sub}
          contractId={sub}
          onBack={() => navigate('contracts')}
          onOpenCustomer={openCustomer}
          onOpenOrder={openOrder}
          onOpenQuote={openQuote}
        />
      ) : (
        <ContractsPage onOpen={openContract} />
      );
    case 'orders':
      return sub ? (
        <OrderDetail
          key={sub}
          orderId={sub}
          onBack={() => navigate('orders')}
          onOpenCustomer={openCustomer}
          onOpenContract={openContract}
          onOpenQuote={openQuote}
          onOpenReceivables={(customerId) => navigate('receivables', customerId)}
        />
      ) : (
        <OrdersPage onOpen={openOrder} />
      );
    case 'receivables':
      return sub ? (
        <CustomerLedger
          key={sub}
          customerId={sub}
          onBack={() => navigate('receivables')}
          onOpenCustomer={openCustomer}
          onOpenOrder={openOrder}
        />
      ) : (
        <ReceivablesPage onOpenCustomer={(customerId) => navigate('receivables', customerId)} />
      );
    case 'warranty':
      return sub ? (
        <WarrantyDetail
          key={sub}
          caseId={sub}
          onBack={() => navigate('warranty')}
          onOpenCustomer={openCustomer}
          onOpenOrder={openOrder}
        />
      ) : (
        <WarrantyPage onOpen={(id) => navigate('warranty', id)} />
      );
    case 'reports':
      return (
        <ReportsPage
          onOpenCustomer={(customerId) => navigate('receivables', customerId)}
          onOpenOrder={openOrder}
          onOpenAlert={(alert) =>
            alert.kind === 'QUOTE_PENDING' ? openQuote(alert.id) : alert.kind === 'CONTRACT_EXPIRING' ? openContract(alert.id) : openOrder(alert.id)
          }
        />
      );
    case 'activities':
      return <ActivitiesPage focusId={sub} />;
    case 'settings':
      return <CrmSettingsPage tab={sub} onTab={(tab) => navigate('settings', tab === 'general' ? undefined : tab)} />;
    default:
      return <Placeholder page={page} />;
  }
}

/** Hoạt động trong phạm vi dữ liệu, mặc định đang mở; lọc theo người được giao. */
function ActivitiesPage({ focusId }: { focusId?: string }) {
  const { people } = useCrm();
  const [assigneeUserId, setAssigneeUserId] = useState('');
  return (
    <div className={salesStyles.page}>
      <div className={salesStyles.toolbar}>
        <SearchableSelect
          className={salesStyles.filter}
          options={peopleOptions(people)}
          value={assigneeUserId}
          placeholder="Mọi người được giao"
          clearable
          onChange={setAssigneeUserId}
        />
      </div>
      <ActivityPanel
        key={assigneeUserId}
        scope={assigneeUserId ? { assigneeUserId } : {}}
        focusId={focusId}
        showTarget
        defaultStatus="OPEN"
      />
    </div>
  );
}

/** Khung chờ khi dữ liệu Bán hàng của tenant chưa khởi tạo xong. */
function Placeholder({ page }: { page: CrmPage }) {
  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-label={page.label}>
        <span className={styles.cardHead}>
          {ICONS[page.id]}
          <h2 className={styles.title}>{page.label}</h2>
        </span>
        <p className={styles.muted}>{page.summary}</p>
        <p className={styles.muted}>Trang sẽ mở khi dữ liệu Bán hàng của tenant khởi tạo xong.</p>
      </section>
    </div>
  );
}

/** Người chưa có quyền `crm.*` nào: một thông báo rõ, không menu, không lỗi đỏ. */
function AccessDenied() {
  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-label="Chưa được cấp quyền">
        <h2 className={styles.title}>Chưa được cấp quyền</h2>
        <p className={styles.muted}>{CRM_ACCESS_DENIED_MESSAGE}</p>
      </section>
    </div>
  );
}
