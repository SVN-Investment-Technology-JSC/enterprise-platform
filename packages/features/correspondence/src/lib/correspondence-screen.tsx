'use client';

import {
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import type {
  CorrespondenceDirectory,
  CorrespondenceOverview,
  CorrespondenceStatus,
  LetterStage,
} from '@enterprise-platform/contracts-correspondence';
import { Archive, Inbox, LayoutDashboard, Plus, Send, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { IntakeDialog } from './components/intake-dialog';
import { LetterDrawer } from './components/letter-drawer';
import { LetterListView } from './components/letter-list-view';
import { OverviewView } from './components/overview-view';
import { SettingsView } from './components/settings-view';
import { errorMessage, loadDirectory, loadOverview, loadStatus, loadTenantHomePath } from './correspondence-api';
import { CORRESPONDENCE_VIEWS, localToday, type CorrespondenceView } from './correspondence.model';
import styles from './correspondence.module.scss';

type ListView = Exclude<CorrespondenceView, 'letters' | 'settings'>;

/**
 * Văn thư: tiếp nhận công văn đến, trình lãnh đạo, giao phòng ban, duyệt, phát hành
 * và lưu trữ. Mở thẳng một công văn bằng `#letters/<id>` (liên kết trong thông báo):
 * ngăn chi tiết mở đè lên danh sách công văn đến.
 */
export function CorrespondenceScreen() {
  const { view, sub, navigate } = useHashView<CorrespondenceView>({
    views: CORRESPONDENCE_VIEWS,
    fallback: 'overview',
  });
  const [homePath, setHomePath] = useState('/');
  const [status, setStatus] = useState<CorrespondenceStatus>();
  const [directory, setDirectory] = useState<CorrespondenceDirectory>();
  const [overview, setOverview] = useState<CorrespondenceOverview>();
  const [error, setError] = useState<string>();
  const [stageFilter, setStageFilter] = useState<LetterStage>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [intakeOpen, setIntakeOpen] = useState(false);
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
      badge: overview?.open ? overview.open : undefined,
    },
    { id: 'outgoing', label: 'Công văn đi', group: 'Sổ công văn', icon: <Send size={16} /> },
    { id: 'archive', label: 'Kho lưu trữ', group: 'Sổ công văn', icon: <Archive size={16} /> },
    // Mở bằng nút bánh răng; khai ở đây để breadcrumb mang tên trang.
    { id: 'settings', label: 'Cấu hình sổ', hidden: true },
  ];

  return (
    <ModuleShell<CorrespondenceView>
      moduleKey="correspondence"
      appearance="light"
      title="Văn thư"
      nav={nav}
      view={shown}
      onViewChange={(next) => navigate(next)}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      settings={
        capabilities?.canManage
          ? { label: 'Cấu hình sổ', active: view === 'settings', onOpen: () => navigate('settings') }
          : undefined
      }
      actions={
        capabilities?.canRegister && !provisioning ? (
          <div className={styles.headActions}>
            <button type="button" className={styles.buttonPrimary} onClick={() => setIntakeOpen(true)}>
              <Plus size={15} /> Tiếp nhận công văn
            </button>
          </div>
        ) : undefined
      }
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
      {!status || provisioning ? null : shown === 'settings' && capabilities?.canManage ? (
        <SettingsView
          settings={status.settings}
          onSaved={(settings) => setStatus((current) => (current ? { ...current, settings } : current))}
        />
      ) : shown === 'overview' ? (
        overview ? (
          <OverviewView
            overview={overview}
            today={today}
            onNavigate={(next) => navigate(next)}
            onOpenStage={(stage) => {
              setStageFilter(stage);
              navigate('incoming');
            }}
            onOpenLetter={openLetter}
          />
        ) : null
      ) : (
        <LetterListView
          box={shown === 'mine' ? 'mine' : shown === 'outgoing' ? 'outgoing' : shown === 'archive' ? 'archive' : 'all'}
          stage={stageFilter}
          today={today}
          refreshKey={refreshKey}
          activeId={drawerId}
          onStageChange={setStageFilter}
          onOpen={openLetter}
        />
      )}

      {drawerId && status?.tablesReady ? (
        <LetterDrawer letterId={drawerId} directory={directory} onClose={closeLetter} onChanged={refresh} />
      ) : null}

      {status ? (
        <IntakeDialog
          open={intakeOpen}
          settings={status.settings}
          onClose={() => setIntakeOpen(false)}
          onCreated={(letterId) => {
            setIntakeOpen(false);
            refresh();
            openLetter(letterId);
          }}
        />
      ) : null}
    </ModuleShell>
  );
}
