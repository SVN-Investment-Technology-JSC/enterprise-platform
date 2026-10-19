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
jest.mock('./hrm-permissions', () => ({
  HrmPermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  hrmPagePermissions: {},
  useHrmPermissions: () => ({
    actions: [],
    loading: false,
    error: '',
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
});
