'use client';
import {
  createContext,
  useContext,
  useEffect,
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
          setState({
            actions: result.data.actions,
            displayName: result.data.displayName || '',
            loading: false,
            error: '',
          });
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
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const focused = () => void refresh();
    window.addEventListener('focus', focused);
    window.addEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, focused);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focused);
      window.removeEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, focused);
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
  return {
    ...state,
    can: (permission: HrmAction) => state.actions.includes(permission),
    any: (permissions: readonly HrmAction[]) =>
      permissions.some((p) => state.actions.includes(p)),
  };
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
  '/timekeeping': hubPagePermissions('/timekeeping'),
  '/payroll': hubPagePermissions('/payroll'),
  // Hệ thống
  '/settings': hubPagePermissions('/settings'),
};
