'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FinanceCapabilities, FinanceVoucherKind } from '@enterprise-platform/contracts-finance';
import { FINANCE_PERMISSIONS_INVALIDATED_EVENT, financeFetch } from './finance-api';

export interface FinancePermissionState {
  loading: boolean;
  error: string | null;
  capabilities: FinanceCapabilities | null;
}

const FinancePermissionsContext = createContext<FinancePermissionState>({ loading: true, error: null, capabilities: null });

export function FinancePermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FinancePermissionState>({ loading: true, error: null, capabilities: null });

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const capabilities = await financeFetch<FinanceCapabilities>('/capabilities');
        if (active) setState({ loading: false, error: null, capabilities });
      } catch (error) {
        if (active) setState({ loading: false, error: error instanceof Error ? error.message : 'Không tải được quyền Tài chính', capabilities: null });
      }
    }
    let lastAt = Date.now();
    const run = () => {
      lastAt = Date.now();
      void refresh();
    };
    run();
    // Quyền ít đổi: làm mới 2 phút một lần; quay lại cửa sổ chỉ làm mới nếu đã quá 30 giây; bị từ chối (403) thì làm mới ngay.
    const timer = setInterval(run, 120_000);
    const focused = () => {
      if (Date.now() - lastAt > 30_000) run();
    };
    window.addEventListener('focus', focused);
    window.addEventListener(FINANCE_PERMISSIONS_INVALIDATED_EVENT, run);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focused);
      window.removeEventListener(FINANCE_PERMISSIONS_INVALIDATED_EVENT, run);
    };
  }, []);

  return <FinancePermissionsContext.Provider value={state}>{children}</FinancePermissionsContext.Provider>;
}

const KIND_KEY = { RECEIPT: 'receipt', PAYMENT: 'payment', TRANSFER: 'transfer' } as const;

/** Có xem được số dư công ty không: cùng điều kiện với server (`canSeeBalances`). */
export function canSeeBalances(c: FinanceCapabilities | null): boolean {
  if (!c) return false;
  return (
    c.canReadAll ||
    c.canManageAccounts ||
    c.canReadReports ||
    c.receipt.approve ||
    c.payment.approve ||
    c.transfer.approve
  );
}

/** Mở được màn danh sách phiếu của loại này: lập, duyệt hoặc đọc toàn bộ. */
export function canOpenKind(c: FinanceCapabilities | null, kind: FinanceVoucherKind): boolean {
  if (!c) return false;
  const k = c[KIND_KEY[kind]];
  return k.create || k.approve || c.canReadAll;
}

/** Quyền hiện từng trang, dùng chung cho menu và chặn trang. */
export function canOpenPage(c: FinanceCapabilities | null, path: string): boolean {
  if (!c) return false;
  switch (path) {
    case '/':
      return true;
    case '/receipts':
      return canOpenKind(c, 'RECEIPT');
    case '/payments':
      return canOpenKind(c, 'PAYMENT');
    case '/transfers':
      return canOpenKind(c, 'TRANSFER');
    case '/accounts':
      return canSeeBalances(c);
    case '/reports':
      return c.canReadReports;
    case '/settings':
      return c.canManageSettings;
    default:
      return true;
  }
}

export function useFinancePermissions() {
  const state = useContext(FinancePermissionsContext);
  return useMemo(
    () => ({
      ...state,
      canOpenPage: (path: string) => canOpenPage(state.capabilities, path),
    }),
    [state],
  );
}
