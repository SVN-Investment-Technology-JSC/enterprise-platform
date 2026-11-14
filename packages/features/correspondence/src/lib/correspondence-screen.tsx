'use client';

import { ModuleShell, useHashView, type ModuleNavItem } from '@enterprise-platform/feature-module-shell';
import type {
  CorrespondenceConfig,
  CorrespondenceDirectory,
  CorrespondenceOverview,
  CorrespondenceStatus,
  LetterStage,
} from '@enterprise-platform/contracts-correspondence';
import { Archive, BarChart3, FilePen, Inbox, LayoutDashboard, Plus, Send, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ArchiveView } from './components/archive-view';
import { ConfigView } from './components/config-view';
import { IntakeDialog } from './components/intake-dialog';
import { LetterDrawer } from './components/letter-drawer';
import { LetterListView } from './components/letter-list-view';
import { OutgoingDialog } from './components/outgoing-dialog';
import { OverviewView } from './components/overview-view';
import { ReportView } from './components/report-view';
import { errorMessage, loadConfig, loadDirectory, loadOverview, loadStatus, loadTenantHomePath } from './correspondence-api';
import { CORRESPONDENCE_VIEWS, localToday, type CorrespondenceView } from './correspondence.model';
import styles from './correspondence.module.scss';

type ListView = Exclude<CorrespondenceView, 'letters' | 'settings'>;

/**
 * Văn thư: công văn đến (tiếp nhận, giao phòng ban, duyệt theo quy trình, hoàn tất) và công
 * văn đi (soạn thảo, văn thư kiểm tra, duyệt, ban hành), kho lưu trữ và báo cáo. Mở thẳng một
 * công văn bằng `#letters/<id>` (liên kết trong thông báo): ngăn chi tiết mở đè lên danh sách.
 */
export function CorrespondenceScreen() {
  const { view, sub, navigate } = useHashView<CorrespondenceView>({
    views: CORRESPONDENCE_VIEWS,
    fallback: 'overview',
  });
  const [homePath, setHomePath] = useState('/');
  const [status, setStatus] = useState<CorrespondenceStatus>();
  const [directory, setDirectory] = useState<CorrespondenceDirectory>();
  const [config, setConfig] = useState<CorrespondenceConfig>();
  const [overview, setOverview] = useState<CorrespondenceOverview>();
  const [error, setError] = useState<string>();
  const [stageFilter, setStageFilter] = useState<LetterStage>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [outgoingOpen, setOutgoingOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Màn đang xem phía sau ngăn chi tiết, để đóng ngăn thì quay về đúng chỗ.
  const [base, setBase] = useState<ListView>('incoming');
  const today = localToday();

  useEffect(() => {
    void loadTenantHomePath().then(setHomePath);
    loadStatus()
      .then((next) => {
        setStatus(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được trạng thái Văn thư.')));
    loadDirectory()
      .then(setDirectory)
      .catch(() => undefined);
  }, []);

  const reloadConfig = useCallback(() => {
    loadConfig()
      .then(setConfig)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được cấu hình Văn thư.')));
  }, []);

  useEffect(() => {
    if (status?.tablesReady) reloadConfig();
  }, [status, reloadConfig]);

  useEffect(() => {
    if (!status?.tablesReady) return;
    loadOverview()
      .then(setOverview)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được tổng quan.')));
  }, [status, refreshKey]);

  useEffect(() => {
    if (view !== 'letters' && view !== 'settings') setBase(view);
  }, [view]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const openLetter = useCallback((letterId: string) => navigate('letters', letterId), [navigate]);
  const closeLetter = useCallback(() => navigate(base), [navigate, base]);

  const capabilities = status?.capabilities;
  const provisioning = Boolean(status && !status.tablesReady);
  const shown: ListView | 'settings' = view === 'letters' ? base : view;
  const drawerId = view === 'letters' ? sub : undefined;
  const canConfigure = Boolean(capabilities?.canConfigure || capabilities?.isTenantAdmin);

  const nav: readonly ModuleNavItem<CorrespondenceView>[] = [
    { id: 'overview', label: 'Tổng quan', group: 'Văn thư', icon: <LayoutDashboard size={16} /> },
    {
      id: 'mine',
      label: 'Cần tôi xử lý',
      group: 'Văn thư',
      icon: <UserCheck size={16} />,
      badge: overview?.awaitingMe ? overview.awaitingMe : undefined,
    },
    {
      id: 'incoming',
      label: 'Công văn đến',
      group: 'Sổ công văn',
      icon: <Inbox size={16} />,
      badge: overview?.incomingOpen ? overview.incomingOpen : undefined,
    },
    {
      id: 'outgoing',
      label: 'Công văn đi',
      group: 'Sổ công văn',
      icon: <Send size={16} />,
      badge: overview?.outgoingOpen ? overview.outgoingOpen : undefined,
    },
    { id: 'archive', label: 'Kho lưu trữ', group: 'Sổ công văn', icon: <Archive size={16} /> },
    ...(capabilities?.canReadReports
      ? [{ id: 'reports' as const, label: 'Báo cáo', group: 'Sổ công văn', icon: <BarChart3 size={16} /> }]
      : []),
    // Mở bằng nút bánh răng; khai ở đây để breadcrumb mang tên trang.
    { id: 'settings', label: 'Cấu hình', hidden: true },
  ];

  const headActions =
    !provisioning && config && (capabilities?.canRegister || capabilities?.canCreateOutgoing) ? (
      <div className={styles.headActions}>
        {capabilities?.canCreateOutgoing ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setOutgoingOpen(true)}>
            <FilePen size={15} /> Soạn công văn đi
          </button>
        ) : null}
        {capabilities?.canRegister ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setIntakeOpen(true)}>
            <Plus size={15} /> Tiếp nhận công văn đến
          </button>
        ) : null}
      </div>
    ) : undefined;

  return (
    <ModuleShell<CorrespondenceView>
      moduleKey="correspondence"
      appearance="light"
      title="Văn thư"
      nav={nav}
      view={shown}
      onViewChange={(next) => {
        setStageFilter(undefined);
        navigate(next);
      }}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      settings={canConfigure ? { label: 'Cấu hình', active: view === 'settings', onOpen: () => navigate('settings') } : undefined}
      actions={headActions}
      banner={
        <>
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          {provisioning ? <p className={styles.notice}>Dữ liệu Văn thư của tenant đang được khởi tạo.</p> : null}
        </>
      }
    >
      {!status || provisioning || !config ? null : shown === 'settings' && canConfigure ? (
        <ConfigView config={config} directory={directory} onChanged={reloadConfig} />
      ) : shown === 'overview' ? (
        overview ? (
          <OverviewView
            overview={overview}
            today={today}
            onNavigate={(next) => {
              setStageFilter(undefined);
              navigate(next);
            }}
            onOpenStage={(direction, stage) => {
              setStageFilter(stage);
              navigate(direction);
            }}
            onOpenLetter={openLetter}
          />
        ) : null
      ) : shown === 'archive' ? (
        <ArchiveView refreshKey={refreshKey} onOpenLetter={openLetter} />
      ) : shown === 'reports' && capabilities?.canReadReports ? (
        <ReportView refreshKey={refreshKey} />
      ) : (
        <LetterListView
          box={shown === 'mine' ? 'mine' : shown === 'outgoing' ? 'outgoing' : 'incoming'}
          stage={stageFilter}
          today={today}
          refreshKey={refreshKey}
          activeId={drawerId}
          onStageChange={setStageFilter}
          onOpen={openLetter}
        />
      )}

      {drawerId && status?.tablesReady && config ? (
        <LetterDrawer
          letterId={drawerId}
          config={config}
          directory={directory}
          currentUserId={status.userId}
          onClose={closeLetter}
          onChanged={refresh}
          onOpenLetter={openLetter}
        />
      ) : null}

      {config ? (
        <>
          <IntakeDialog
            open={intakeOpen}
            config={config}
            onClose={() => setIntakeOpen(false)}
            onCreated={(letterId) => {
              setIntakeOpen(false);
              refresh();
              openLetter(letterId);
            }}
          />
          <OutgoingDialog
            open={outgoingOpen}
            config={config}
            directory={directory}
            onClose={() => setOutgoingOpen(false)}
            onCreated={(letterId) => {
              setOutgoingOpen(false);
              refresh();
              openLetter(letterId);
            }}
          />
        </>
      ) : null}
    </ModuleShell>
  );
}
