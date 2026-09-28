'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import { hrmFetch } from './hrm-api';

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
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focused);
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
export const hrmPagePermissions: Record<string, HrmAction[]> = {
  '/dependents': ['hrm.dependent.read'],
  '/': ['hrm.self.read', 'hrm.dashboard.read'],
  '/profile': ['hrm.self.read'],
  '/attendance': ['hrm.self.read'],
  '/requests': ['hrm.self.read'],
  '/payslips': ['hrm.self.payslip'],
  '/employees': ['hrm.employee.read'],
  '/shifts': ['hrm.shift.read', 'hrm.shift.manage'],
  '/approvals': ['hrm.request.read', 'hrm.advance.read'],
  '/timesheets': ['hrm.timesheet.read'],
  '/payroll/settings': ['hrm.payroll.configure'],
  '/payroll/advances': ['hrm.advance.read'],
  '/payroll': ['hrm.payroll.read'],
  '/policies': ['hrm.time.configure', 'hrm.device.manage'],
  '/leave-settings': ['hrm.leave.read'],
  '/operations': [
    'hrm.automation.manage',
    'hrm.integration.manage',
    'hrm.audit.read',
  ],
  '/calendar': ['hrm.self.read'],
  '/permissions': ['hrm.read'],
};
