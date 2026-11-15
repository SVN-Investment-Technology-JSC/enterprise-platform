/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HrmShell } from './hrm-shell';

let mockPath = '/requests';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@enterprise-platform/feature-module-shell', () => ({
  ModuleShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="module-shell">{children}</div>
  ),
}));
let mockDenied = false;
jest.mock('./hrm-permissions', () => ({
  HrmPermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  hrmPagePermissions: {},
  useHrmPermissions: () => ({
    actions: [],
    loading: false,
    error: mockDenied ? 'Không được phép truy cập HRM.' : '',
    denied: mockDenied,
    displayName: '',
    can: () => true,
    any: () => true,
  }),
}));

describe('HrmShell', () => {
  it('trang form nhúng của card Trợ lý chỉ có nội dung, không có khung điều hướng HRM', () => {
    mockPath = '/assistant/form';
    render(
      <HrmShell>
        <p>Form tạo đơn</p>
      </HrmShell>,
    );
    expect(screen.getByText('Form tạo đơn')).toBeTruthy();
    expect(screen.queryByTestId('module-shell')).toBeNull();
  });

  it('các trang khác vẫn nằm trong khung HRM', () => {
    mockPath = '/modules/hrm/requests';
    render(
      <HrmShell>
        <p>Đơn từ</p>
      </HrmShell>,
    );
    expect(screen.getByTestId('module-shell').textContent).toContain('Đơn từ');
  });

  // SEC-UI022-03: không có quyền phân hệ (tải quyền trả 403) thì báo tiếng Việt, không hiện lỗi kỹ thuật.
  it('không có quyền phân hệ thì hiện thông báo chưa được cấp quyền, không hiện nội dung trang', () => {
    mockPath = '/modules/hrm/requests';
    mockDenied = true;
    render(
      <HrmShell>
        <p>Đơn từ</p>
      </HrmShell>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Bạn chưa được cấp quyền dùng phân hệ Nhân sự.');
    expect(alert.textContent).not.toContain('Không thể tải thông tin quyền hạn');
    expect(screen.queryByText('Đơn từ')).toBeNull();
    mockDenied = false;
  });
});
