'use client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import {
  HRM_PERMISSIONS_INVALIDATED_EVENT,
  hrmFetch,
} from './hrm-api';
import { hubPagePermissions } from './hrm-hub-tabs';

const HrmPermissionsContext = createContext<{
  actions: readonly string[];
  loading: boolean;
  error: string;
  displayName: string;
}>({ actions: [], loading: true, error: '', displayName: '' });
export function HrmPermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    actions: [] as string[],
    loading: true,
    error: '',
    displayName: '',
  });
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await hrmFetch<{
          data: { actions: string[]; displayName: string };
        }>('/capabilities');
        if (active)
          // Không đổi state khi dữ liệu y nguyên để các màn đang mở không phải render lại mỗi lần làm mới.
          setState((prev) =>
            !prev.loading &&
            !prev.error &&
            prev.displayName === (result.data.displayName || '') &&
            prev.actions.length === result.data.actions.length &&
            prev.actions.every((a, i) => a === result.data.actions[i])
              ? prev
              : {
                  actions: result.data.actions,
                  displayName: result.data.displayName || '',
                  loading: false,
                  error: '',
                },
          );
      } catch (error) {
        if (active)
          setState({
            actions: [],
            displayName: '',
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'Không tải được quyền HRM',
          });
      }
    }
    let lastAt = Date.now();
    const run = () => {
      lastAt = Date.now();
      void refresh();
    };
    run();
    // Quyền ít đổi: làm mới định kỳ 2 phút; quay lại cửa sổ chỉ làm mới nếu đã quá 30 giây; sự kiện đổi quyền thì làm mới ngay.
    const timer = setInterval(run, 120000);
    const focused = () => {
      if (Date.now() - lastAt > 30000) run();
    };
    window.addEventListener('focus', focused);
    window.addEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, run);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focused);
      window.removeEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, run);
    };
  }, []);
  return (
    <HrmPermissionsContext.Provider value={state}>
      {children}
    </HrmPermissionsContext.Provider>
  );
}
export function useHrmPermissions() {
  const state = useContext(HrmPermissionsContext);
  // Hàm can/any ổn định theo danh sách quyền để các hook phụ thuộc vào chúng không chạy lại mỗi lần render.
  return useMemo(() => {
    const granted = new Set(state.actions);
    return {
      ...state,
      can: (permission: HrmAction) => granted.has(permission),
      any: (permissions: readonly HrmAction[]) => permissions.some((p) => granted.has(p)),
    };
  }, [state]);
}
/**
 * Quyền hiện từng trang: có BẤT KỲ quyền trong danh sách là thấy mục menu và vào được trang.
 * Dùng chung cho menu và chặn trang (hrm-shell). Không dùng hrm.read làm điều kiện hiện menu.
 * Mọi route mới của HRM phải có mục ở đây.
 */
export const hrmPagePermissions: Record<string, HrmAction[]> = {
  '/': ['hrm.self.read', 'hrm.dashboard.read'],
  '/approvals': [
    'hrm.leave.approve',
    'hrm.leave.approve.all',
    'hrm.ot.approve',
    'hrm.ot.approve.all',
    'hrm.trip.approve',
    'hrm.trip.approve.all',
    'hrm.shift.approve',
    'hrm.shift.approve.all',
    'hrm.attendance.approve',
    'hrm.attendance.approve.all',
    'hrm.profile.approve',
    'hrm.profile.approve.all',
    'hrm.custom.approve',
    'hrm.custom.approve.all',
    'hrm.advance.approve',
    'hrm.advance.approve.all',
    'hrm.request.read',
    'hrm.request.manage',
    'hrm.advance.read',
  ],
  // Cá nhân
  '/my-work': hubPagePermissions('/my-work'),
  '/requests': ['hrm.self.read'],
  '/profile': hubPagePermissions('/profile'),
  // Trang gộp tab: quyền trang = hợp quyền các tab (hrm-hub-tabs.ts); từng tab tự ẩn theo quyền riêng.
  '/employees': hubPagePermissions('/employees'),
  '/leave': hubPagePermissions('/leave'),
  '/timekeeping': hubPagePermissions('/timekeeping'),
  '/payroll': hubPagePermissions('/payroll'),
  // Hệ thống
  '/settings': hubPagePermissions('/settings'),
};
