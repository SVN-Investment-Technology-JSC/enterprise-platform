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
import { LibraryView, type LibraryAbilities, type LibraryRequest } from './components/library-view';
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
  const [abilities, setAbilities] = useState<LibraryAbilities>({ createFolder: false, upload: false });
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
  const tone = usage ? meterTone(usage) : 'normal';
  // Thùng rác là đoạn `trash` sau `library/`; người không có quyền xoá thì coi như không có.
  const inTrash =
    view === 'library' && sub === 'trash' && (capabilities.canDeleteDocuments || capabilities.isTenantAdmin);

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
  const openTrash = useCallback(() => navigate('library', 'trash'), [navigate]);

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
        view === 'library' && !provisioning && !inTrash && (abilities.createFolder || abilities.upload) ? (
          <div className={styles.headActions}>
            {abilities.createFolder ? (
              <button
                type="button"
                className={styles.buttonGhost}
                onClick={() => setRequest({ kind: 'folder', nonce: Date.now() })}
              >
                <FolderPlus size={15} /> Thư mục mới
              </button>
            ) : null}
            {abilities.upload ? (
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={usage?.enforcement === 'hard' && tone === 'over'}
                onClick={() => setRequest({ kind: 'upload', nonce: Date.now() })}
              >
                <Upload size={15} /> Tải lên
              </button>
            ) : null}
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
          folderId={view === 'library' && !inTrash ? sub : undefined}
          onOpenFolder={openFolder}
          onPathChange={setCrumbs}
          request={request}
          onStorageChanged={reloadUsage}
          trash={inTrash}
          onOpenTrash={openTrash}
          onAbilitiesChange={setAbilities}
        />
      )}
    </ModuleShell>
  );
}
