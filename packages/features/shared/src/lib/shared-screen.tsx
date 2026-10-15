'use client';

import {
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import {
  formatBytes,
  type SharedCapabilities,
  type SharedStatus,
  type StorageUsage,
} from '@enterprise-platform/contracts-shared';
import { FolderOpen, FolderPlus, HardDrive, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { LibraryView, type LibraryRequest } from './components/library-view';
import { meterTone, StorageView } from './components/storage-view';
import {
  errorMessage,
  loadCurrentUserId,
  loadSharedStatus,
  loadStorageUsage,
  loadTenantHomePath,
} from './shared-api';
import styles from './shared.module.scss';

type Tab = 'library' | 'storage';

const VIEWS: readonly Tab[] = ['library', 'storage'];

const NO_RIGHTS: SharedCapabilities = {
  isTenantAdmin: false,
  canManage: false,
  canWriteDocuments: false,
  canDeleteDocuments: false,
};

/**
 * Hệ dùng chung. Phần đầu tiên là Tài liệu công ty — kho tài liệu cấp công ty,
 * tách khỏi tài liệu dự án của Workspace — và trang dung lượng tệp của cả tenant.
 */
export function SharedScreen() {
  const { view, sub, navigate } = useHashView<Tab>({ views: VIEWS, fallback: 'library' });
  const [homePath, setHomePath] = useState('/');
  const [me, setMe] = useState('');
  const [status, setStatus] = useState<SharedStatus>();
  const [usage, setUsage] = useState<StorageUsage>();
  const [error, setError] = useState<string>();
  const [crumbs, setCrumbs] = useState<readonly string[]>([]);
  const [request, setRequest] = useState<LibraryRequest>();
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    void loadTenantHomePath().then(setHomePath);
    void loadCurrentUserId().then(setMe);
    loadSharedStatus()
      .then((next) => {
        setStatus(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được trạng thái Hệ dùng chung.')));
  }, []);

  const reloadUsage = useCallback(() => {
    loadStorageUsage()
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (status?.tablesReady) reloadUsage();
  }, [status, reloadUsage]);

  const capabilities = status?.capabilities ?? NO_RIGHTS;
  const provisioning = Boolean(status && !status.tablesReady);
  const canWrite = capabilities.canWriteDocuments && !provisioning;
  const tone = usage ? meterTone(usage) : 'normal';

  const nav: readonly ModuleNavItem<Tab>[] = [
    { id: 'library', label: 'Tài liệu công ty', group: 'Tài liệu', icon: <FolderOpen size={16} /> },
    {
      id: 'storage',
      label: 'Dung lượng',
      group: 'Quản trị',
      icon: <HardDrive size={16} />,
      badge: usage ? `${Math.round(usage.usedPercent)}%` : undefined,
      hidden: !capabilities.canManage,
    },
  ];

  const openFolder = useCallback(
    (folderId: string | undefined) => navigate('library', folderId),
    [navigate],
  );

  return (
    <ModuleShell<Tab>
      moduleKey="shared"
      appearance="light"
      title="Hệ dùng chung"
      nav={nav}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      // Khung tự thêm nhãn trang (trừ trang đầu); ở kho chỉ cần đường dẫn thư mục.
      crumbs={view === 'library' ? crumbs : undefined}
      actions={
        view === 'library' && canWrite ? (
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.buttonGhost}
              onClick={() => setRequest({ kind: 'folder', nonce: Date.now() })}
            >
              <FolderPlus size={15} /> Thư mục mới
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={usage?.enforcement === 'hard' && tone === 'over'}
              onClick={() => setRequest({ kind: 'upload', nonce: Date.now() })}
            >
              <Upload size={15} /> Tải lên
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
          {provisioning ? (
            <p className={styles.notice}>Dữ liệu Hệ dùng chung của tenant đang được khởi tạo.</p>
          ) : null}
          {usage && tone !== 'normal' ? (
            <p className={tone === 'over' ? styles.alert : styles.warning}>
              Dung lượng tệp đã dùng {formatBytes(usage.usedBytes)} / {formatBytes(usage.quotaBytes)} (
              {usage.usedPercent.toLocaleString('vi-VN')}%)
              {tone === 'over' && usage.enforcement === 'hard' ? ' · đã chặn tải lên.' : '.'}
            </p>
          ) : null}
        </>
      }
    >
      {provisioning || !status ? null : view === 'storage' && capabilities.canManage ? (
        <StorageView usage={usage} />
      ) : (
        <LibraryView
          capabilities={capabilities}
          currentUserId={me}
          folderId={view === 'library' ? sub : undefined}
          onOpenFolder={openFolder}
          onPathChange={setCrumbs}
          request={request}
          onStorageChanged={reloadUsage}
        />
      )}
    </ModuleShell>
  );
}
