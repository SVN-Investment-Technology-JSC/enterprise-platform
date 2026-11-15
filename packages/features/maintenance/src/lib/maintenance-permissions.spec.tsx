/** @jest-environment jsdom */
import { ApiRequestError } from '@enterprise-platform/shared-ui';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MaintenanceSchedulesTable } from './components/maintenance-schedules';
import { MaintenanceScreen } from './maintenance-screen';

jest.mock('@enterprise-platform/feature-module-shell', () => ({
  ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModuleSettingsView: () => null,
  useAssistantSaved: () => undefined,
  useHashView: () => ({ view: 'dashboard', sub: undefined, navigate: jest.fn() }),
}));

jest.mock('./maintenance-api', () => {
  const never = () => new Promise(() => undefined);
  return {
    loadMaintenanceWorkspace: jest.fn(),
    loadMaintenanceMatrix: jest.fn(),
    loadTenantHomePath: jest.fn(() => Promise.resolve('/')),
    loadOrganizationUnitNames: jest.fn(() => Promise.resolve(new Map())),
    loadTenantMembers: jest.fn(() => Promise.resolve([])),
    loadMyDashboardCards: jest.fn(() => Promise.resolve({ cardIds: null })),
    loadMaintenanceSettings: jest.fn(never),
    loadMaintenanceHistory: jest.fn(never),
    loadMaintenanceOccurrence: jest.fn(never),
    loadPerformersByInstanceCode: jest.fn(() => Promise.resolve(new Map())),
    completeMaintenanceOccurrence: jest.fn(),
    createMaintenanceIncident: jest.fn(),
    createMaintenanceSchedule: jest.fn(),
    removeAssetFromMatrix: jest.fn(),
    runMaintenanceNow: jest.fn(),
    saveMaintenanceMatrix: jest.fn(),
    saveMaintenanceSetting: jest.fn(),
    retryMaintenanceDispatch: jest.fn(),
    saveMyDashboardCards: jest.fn(),
    skipNextOccurrence: jest.fn(),
    updateMaintenanceSchedule: jest.fn(),
    uploadOccurrenceAttachment: jest.fn(),
  };
});

const api = jest.requireMock<Record<string, jest.Mock>>('./maintenance-api');

function schedulesTable(canManage: boolean) {
  return render(
    <MaintenanceSchedulesTable
      schedules={[]}
      canManage={canManage}
      busy={false}
      frequencyLabel={(freq) => freq}
      onToggle={jest.fn()}
      onSkipOnce={jest.fn()}
      onCreateSchedule={jest.fn()}
    />,
  );
}

describe('Bảo trì: ẩn thao tác ghi theo quyền (ISS-UI-022)', () => {
  it('người có quyền cấu hình thấy nút tạo lịch bảo trì', () => {
    schedulesTable(true);
    expect(screen.getByRole('button', { name: /Tạo lịch bảo trì/ })).toBeTruthy();
  });

  it('người chỉ có quyền đọc không thấy nút tạo lịch bảo trì', () => {
    schedulesTable(false);
    expect(screen.queryByRole('button', { name: /Tạo lịch bảo trì/ })).toBeNull();
  });

  it('không có quyền phân hệ thì hiện thông báo tiếng Việt thay cho lỗi kỹ thuật', async () => {
    api.loadMaintenanceWorkspace.mockRejectedValue(new ApiRequestError(403, 'Không được phép truy cập Maintenance.', 'ACCESS_DENIED'));
    api.loadMaintenanceMatrix.mockRejectedValue(new ApiRequestError(403, 'Không được phép truy cập Maintenance.', 'ACCESS_DENIED'));
    render(<MaintenanceScreen />);
    await waitFor(() => expect(screen.getByText(/Bạn chưa được cấp quyền dùng phân hệ Bảo trì\./)).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Đang tải dữ liệu bảo trì…')).toBeNull();
  });
});
