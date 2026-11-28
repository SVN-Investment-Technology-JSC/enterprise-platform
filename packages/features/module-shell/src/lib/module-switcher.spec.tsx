/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { foldText } from './module-launcher';
import { sortForLauncher } from './module-launcher-order';
import { ModuleSwitcher } from './module-switcher';

const mockAuthFetch = jest.fn();
jest.mock('@enterprise-platform/shared-ui', () => ({
  AppIcon: ({ fallback: Fallback, className }: { fallback: ComponentType<{ className?: string }>; className?: string }) => (
    <Fallback className={className} />
  ),
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
  useBrandSlot: () => ({ item: undefined, hasCustom: false, loaded: true }),
}));

const CATALOG = [
  { key: 'crm', name: 'Kinh doanh', description: 'Khách hàng', launchUrl: '/modules/crm', icon: 'BH', entitlementStatus: 'not-entitled' },
  { key: 'finance', name: 'Tài chính', description: 'Phiếu thu, phiếu chi', launchUrl: '/modules/finance', icon: 'FIN', entitlementStatus: 'active' },
  { key: 'hrm', name: 'Nhân sự & Công', description: 'Quản lý nhân sự', launchUrl: '/modules/hrm', icon: 'HRM', entitlementStatus: 'active' },
  { key: 'workspace', name: 'Dự án & Công việc', description: 'Dự án, công việc', launchUrl: '/modules/workspace', icon: 'WS', entitlementStatus: 'active' },
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockAuthFetch.mockReset();
  mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ modules: CATALOG }) });
});

async function openSwitcher() {
  render(<ModuleSwitcher moduleKey="workspace" homeHref="/apps" />);
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển phân hệ' }));
  const panel = await screen.findByRole('dialog', { name: 'Chuyển phân hệ' });
  await within(panel).findByRole('link', { name: /Tài chính/ });
  return panel;
}

describe('ModuleSwitcher', () => {
  it('một lưới: Trang chủ đầu tiên, phân hệ theo thứ tự dùng hằng ngày, phân hệ chưa kích hoạt mờ ở cuối', async () => {
    const panel = await openSwitcher();
    const links = within(panel).getAllByRole('link').filter((link) => link.hasAttribute('data-tile'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/modules/workspace',
      '/modules/hrm',
      '/modules/finance',
    ]);
    expect(within(links[1]).getByText('Dự án & Công việc')).toBeTruthy();
    expect(links[0].getAttribute('href')).toBe('/dashboard');
    expect(links[1].getAttribute('aria-current')).toBe('page');
    // Kinh doanh chưa kích hoạt: vẫn hiện nhưng không phải link.
    const inactive = within(panel).getByText('Kinh doanh').parentElement;
    expect(inactive?.tagName).toBe('SPAN');
    expect(inactive?.getAttribute('aria-disabled')).toBe('true');
    // Không còn giao diện cũ.
    expect(within(panel).queryByRole('button', { name: 'Giao diện cũ' })).toBeNull();
  });

  it('tìm không dấu theo tên, chỉ ra phân hệ đang dùng', async () => {
    const panel = await openSwitcher();
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'tai chinh' } });
    const options = within(within(panel).getByRole('listbox', { name: 'Kết quả tìm' })).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('href'))).toEqual(['/modules/finance']);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'kinh doanh' } });
    expect(within(panel).queryAllByRole('option')).toHaveLength(0);
  });

  it('phím G mở menu phân hệ', async () => {
    render(<ModuleSwitcher moduleKey="finance" homeHref="/apps" />);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'g' });
    });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Chuyển phân hệ' })).toBeTruthy());
  });
});

describe('foldText / sortForLauncher', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(foldText('Đơn từ cần xử lý')).toBe('don tu can xu ly');
  });
  it('phân hệ đang dùng trước, chưa kích hoạt sau; phân hệ mới giữ thứ tự danh mục', () => {
    const keys = sortForLauncher([
      { key: 'shared' },
      { key: 'new-b' },
      { key: 'crm', entitlementStatus: 'not-entitled' },
      { key: 'social' },
      { key: 'new-a' },
      { key: 'workspace', entitlementStatus: 'active' },
    ]).map((module) => module.key);
    expect(keys).toEqual(['social', 'workspace', 'shared', 'new-b', 'new-a', 'crm']);
  });
});
