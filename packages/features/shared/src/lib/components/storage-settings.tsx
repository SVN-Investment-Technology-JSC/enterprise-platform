'use client';

import type { StorageUsage } from '@enterprise-platform/contracts-shared';
import { useEffect, useState } from 'react';
import styles from '../shared.module.scss';
import { ExternalStoragePanel } from './external-storage-panel';
import { NasAccountsPanel, NasConnectionPanel } from './nas-connection-panel';
import { StorageView } from './storage-view';

type StorageTab = 'usage' | 'external' | 'nas' | 'accounts';

const TABS: readonly { readonly id: StorageTab; readonly label: string }[] = [
  { id: 'usage', label: 'Dung lượng' },
  { id: 'external', label: 'Kho lưu trữ ngoài' },
  { id: 'nas', label: 'Kết nối NAS' },
  { id: 'accounts', label: 'Tài khoản NAS' },
];

const REMEMBER_KEY = 'shared.storage.tab';

/** Trang quản trị dung lượng, chia tab: mỗi lúc chỉ một phần, nhìn gọn. Nhớ tab đang mở trên máy này. */
export function StorageSettings({ usage, onChanged }: { readonly usage?: StorageUsage; readonly onChanged: () => void }) {
  const [tab, setTab] = useState<StorageTab>('usage');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY) as StorageTab | null;
      if (saved && TABS.some((item) => item.id === saved)) setTab(saved);
    } catch {
      /* trình duyệt chặn lưu trữ: mở tab đầu */
    }
  }, []);

  const open = (next: StorageTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(REMEMBER_KEY, next);
    } catch {
      /* không lưu được thì thôi */
    }
  };

  return (
    <div className={styles.storageSettings}>
      <div className={styles.storageTabs} role="tablist" aria-label="Dung lượng">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={styles.storageTab}
            data-active={tab === item.id}
            onClick={() => open(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'usage' ? (
          <StorageView usage={usage} />
        ) : tab === 'external' ? (
          <ExternalStoragePanel onChanged={onChanged} />
        ) : tab === 'nas' ? (
          <NasConnectionPanel />
        ) : (
          <NasAccountsPanel />
        )}
      </div>
    </div>
  );
}
