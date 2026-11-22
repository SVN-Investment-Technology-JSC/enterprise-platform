'use client';

import type { PriceListSyncReason, PriceListSyncStatus } from '@enterprise-platform/contracts-crm';
import { toast } from '@enterprise-platform/shared-ui';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, loadCatalogSyncStatus, syncCatalog } from '../crm-api';
import styles from '../sales.module.scss';
import local from './pricing.module.scss';
import { syncResultMessage } from './pricing.model';

/** Sự kiện trên `window` báo bảng giá vừa đổi ngoài trang bảng giá (đồng bộ Kho); trang bảng giá nghe để tải lại. */
export const PRICE_LISTS_CHANGED_EVENT = 'crm:price-lists-changed';

export function notifyPriceListsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRICE_LISTS_CHANGED_EVENT));
}

/** Gọi `onChange` mỗi khi bảng giá đổi ở chỗ khác (đồng bộ Kho xong). */
export function usePriceListsChanged(onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const listener = () => latest.current();
    window.addEventListener(PRICE_LISTS_CHANGED_EVENT, listener);
    return () => window.removeEventListener(PRICE_LISTS_CHANGED_EVENT, listener);
  }, []);
}

export const SYNC_REASON_TEXT: Readonly<Record<PriceListSyncReason, string>> = {
  NO_DEFAULT: 'Chưa có bảng giá mặc định',
  CATALOG_CHANGED: 'Bảng giá mặc định cần được đồng bộ với Kho',
};

/**
 * Thông báo dưới header CRM cho quản trị CRM (`crm.manage`): chưa có bảng giá mặc định, hoặc danh mục Kho đã đổi kể từ
 * lần đồng bộ trước; nút "Đồng bộ" chạy một lần đồng bộ. Người khác không gọi API trạng thái. Đang tải hoặc API lỗi thì
 * không hiện gì (không nhấp nháy, không chặn trang); server vẫn kiểm quyền.
 */
export function PriceListSyncBanner({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<PriceListSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  // Chặn bấm hai lần thật nhanh (state chưa kịp cập nhật) để chỉ gửi một yêu cầu.
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    let alive = true;
    loadCatalogSyncStatus()
      .then((next) => alive && setStatus(next))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!canManage) {
      setStatus(null);
      return undefined;
    }
    return refresh();
  }, [canManage, refresh]);

  async function sync() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    setError(undefined);
    try {
      const result = await syncCatalog();
      toast.success(syncResultMessage(result));
      setStatus(null);
      notifyPriceListsChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Không đồng bộ được bảng giá mặc định với Kho.'));
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }

  if (!canManage || !status?.needsSync) return null;
  const reason = status.reason ?? 'CATALOG_CHANGED';
  return (
    <div className={local.syncBanner} role="status" aria-label="Đồng bộ bảng giá">
      <span className={local.syncBannerText}>{SYNC_REASON_TEXT[reason]}</span>
      <button type="button" className={styles.buttonPrimary} disabled={syncing} aria-busy={syncing || undefined} onClick={() => void sync()}>
        <RefreshCw size={14} aria-hidden="true" /> {syncing ? 'Đang đồng bộ…' : 'Đồng bộ'}
      </button>
      {error ? (
        <p role="alert" className={local.syncBannerError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
