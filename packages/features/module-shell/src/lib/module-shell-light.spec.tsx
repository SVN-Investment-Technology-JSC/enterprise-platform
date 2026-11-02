/**
 * @jest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ModuleShell } from './module-shell';
import type { ModuleNavItem } from './module-shell.types';

jest.mock('@enterprise-platform/feature-chat', () => ({
  ChatLauncher: () => null,
  UserAvatar: () => null,
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  NotificationBell: () => null,
  NotificationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SearchableSelect: () => null,
  SessionKeepAlive: () => null,
}));
jest.mock('./assistant-launcher', () => ({ AssistantLauncher: () => null }));
jest.mock('./module-switcher', () => ({ ModuleSwitcher: () => null }));
jest.mock('./use-shell-session', () => ({
  initialsOfName: () => 'TV',
  useShellSession: () => ({ principal: undefined, loggingOut: false, logoutError: undefined, logout: jest.fn() }),
}));

const NAV: readonly ModuleNavItem<'a' | 'b'>[] = [
  { id: 'a', label: 'Trang A' },
  { id: 'b', label: 'Trang B' },
];

function shell(props: Partial<Parameters<typeof ModuleShell<'a' | 'b'>>[0]> = {}) {
  return render(
    <ModuleShell<'a' | 'b'> moduleKey="test" title="Thử" appearance="light" nav={NAV} view="a" onViewChange={jest.fn()} {...props}>
      <p>nội dung</p>
    </ModuleShell>,
  );
}

const pinned = (container: HTMLElement) => container.querySelector('[data-shell-region="pinned-footer"]');

describe('ModuleShell light: vùng cố định cuối thanh bên (TC-FB-15)', () => {
  it('module không khai pinnedFooter thì không sinh vùng nào (module khác không đổi)', () => {
    const { container } = shell();
    expect(pinned(container)).toBeNull();
  });

  it('có pinnedFooter thì nằm trong thanh bên, ngoài vùng cuộn của menu, trước hàng nút chân', () => {
    const { container } = shell({ pinnedFooter: <button type="button">Kho hàng</button> });
    const region = pinned(container) as HTMLElement;
    expect(region).not.toBeNull();
    const sidebar = screen.getByRole('navigation', { name: 'Điều hướng Thử' });
    expect(sidebar.contains(region)).toBe(true);
    expect(within(region).getByRole('button', { name: 'Kho hàng' })).toBeTruthy();
    // Vùng cuộn chứa menu không chứa vùng cố định.
    const menuItem = screen.getByRole('button', { name: 'Trang A' });
    const scroll = menuItem.parentElement?.parentElement as HTMLElement;
    expect(scroll.contains(region)).toBe(false);
    // Đứng sau vùng cuộn, trước hàng chân.
    expect(scroll.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const home = within(sidebar).getByRole('link', { name: 'Trang chủ' });
    expect(region.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('thanh bên thu gọn vẫn hiện vùng cố định', () => {
    const { container } = shell({
      collapsible: true,
      collapsed: true,
      pinnedFooter: <button type="button" aria-label="Kho hàng">K</button>,
    });
    const region = pinned(container) as HTMLElement;
    expect(within(region).getByRole('button', { name: 'Kho hàng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mở rộng thanh bên' })).toBeTruthy();
  });

  it('navSwitcher nằm đầu vùng cuộn, trước danh sách menu', () => {
    shell({ navSwitcher: <div>bộ chuyển</div> });
    const switcher = screen.getByText('bộ chuyển');
    const item = screen.getByRole('button', { name: 'Trang A' });
    expect(switcher.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('mục menu vẫn chọn được như cũ', () => {
    const onViewChange = jest.fn();
    shell({ onViewChange });
    screen.getByRole('button', { name: 'Trang B' }).click();
    expect(onViewChange).toHaveBeenCalledWith('b');
  });
});
