/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import {
  NAV_COLLAPSED_STORAGE_KEY,
  filterHrmNavigation,
  hrmNavigationSections,
} from '../hrm-navigation';
import { hrmPagePermissions } from '../hrm-permissions';
import { HrmSidebarNav } from './hrm-sidebar-nav';

const sections = filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, () => true);

beforeEach(() => {
  localStorage.clear();
});

describe('HrmSidebarNav', () => {
  it('lists every visible group with its items as links', () => {
    render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed={false} />);
    expect(screen.getByRole('navigation', { name: 'Điều hướng HRM' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /HỆ THỐNG/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Đơn từ của tôi' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Cấu hình' }).getAttribute('href')).toBe('/settings');
  });

  it('collapses and expands a group and remembers it in localStorage', () => {
    const { unmount } = render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed={false} />);
    const header = screen.getByRole('button', { name: /HỆ THỐNG/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Cấu hình' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) ?? '{}')).toEqual({ 'HỆ THỐNG': true });
    unmount();

    render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed={false} />);
    expect(screen.getByRole('button', { name: /HỆ THỐNG/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Cấu hình' })).toBeNull();
  });

  it('keeps the group of the current page open even when it was saved as collapsed', () => {
    localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, JSON.stringify({ 'CÁ NHÂN': true, 'HỆ THỐNG': true }));
    render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed={false} />);
    expect(screen.getByRole('button', { name: /CÁ NHÂN/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Đơn từ của tôi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /HỆ THỐNG/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a collapsed group when navigating to a page inside it', () => {
    localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, JSON.stringify({ 'QUẢN LÝ': true }));
    const { rerender } = render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed={false} />);
    expect(screen.queryByRole('link', { name: 'Chấm công và ca' })).toBeNull();
    rerender(<HrmSidebarNav sections={sections} activeNavId="timekeeping" railCollapsed={false} />);
    expect(screen.getByRole('link', { name: 'Chấm công và ca' })).toBeTruthy();
  });

  it('still works when localStorage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed={false} />);
    const header = screen.getByRole('button', { name: /HỆ THỐNG/ });
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('shows a flat icon rail without group headers when the sidebar is narrow', () => {
    render(<HrmSidebarNav sections={sections} activeNavId="requests" railCollapsed />);
    expect(screen.queryByRole('button', { name: /HỆ THỐNG/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Cấu hình' })).toBeTruthy();
  });

  it('renders nothing for a group the user cannot use', () => {
    const personalOnly = filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, (p) => p.includes('hrm.self.read'));
    render(<HrmSidebarNav sections={personalOnly} activeNavId={null} railCollapsed={false} />);
    expect(screen.queryByRole('button', { name: /HỆ THỐNG/ })).toBeNull();
    expect(screen.getByRole('button', { name: /TỔNG QUAN/ })).toBeTruthy();
  });
});
