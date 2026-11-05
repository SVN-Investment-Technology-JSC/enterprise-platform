/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { CRM_SECTIONS, CRM_INVENTORY_DENIED_HINT, CRM_INVENTORY_HREF } from './crm-nav.model';
import { CrmInventoryButton, CrmSectionSwitcher } from './crm-sidebar';

jest.mock('./crm.module.scss', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

describe('CrmInventoryButton', () => {
  it('ẩn: không vẽ gì (TC-FB-10)', () => {
    const { container } = render(<CrmInventoryButton state="hidden" collapsed={false} />);
    expect(container.innerHTML).toBe("");
  });

  it('bấm được: liên kết tới /modules/inventory (TC-FB-11)', () => {
    render(<CrmInventoryButton state="enabled" collapsed={false} />);
    const link = screen.getByRole('link', { name: 'Kho hàng' });
    expect(link.getAttribute('href')).toBe(CRM_INVENTORY_HREF);
    expect(CRM_INVENTORY_HREF).toBe('/modules/inventory');
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('mờ: aria-disabled, có chú giải, bấm không chuyển trang (TC-FB-12)', () => {
    render(<CrmInventoryButton state="disabled" collapsed={false} />);
    expect(screen.queryByRole('link', { name: 'Kho hàng' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Kho hàng' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('Bạn chưa được cấp quyền vào Kho');
    expect(button.getAttribute('aria-describedby')).toBe('crm-inventory-denied');
    expect(document.getElementById('crm-inventory-denied')?.textContent).toBe(CRM_INVENTORY_DENIED_HINT);
    expect(button.className).toContain('inventoryButtonDisabled');
    // Bấm: sự kiện bị chặn mặc định, không có href để chuyển.
    expect(fireEvent.click(button)).toBe(false);
    expect(button.getAttribute('href')).toBeNull();
  });

  it('thanh bên thu gọn: vẫn có nhãn đọc được, trạng thái mờ giữ aria-disabled (TC-FB-15)', () => {
    const { unmount } = render(<CrmInventoryButton state="enabled" collapsed />);
    expect(screen.getByRole('link', { name: 'Kho hàng' })).toBeTruthy();
    expect(screen.queryByText('Kho hàng')).toBeNull();
    unmount();
    render(<CrmInventoryButton state="disabled" collapsed />);
    expect(screen.getByRole('button', { name: 'Kho hàng' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('CrmSectionSwitcher', () => {
  it('đánh dấu phần đang chọn và gọi onSelect (TC-NAV-02)', () => {
    const onSelect = jest.fn();
    render(<CrmSectionSwitcher sections={CRM_SECTIONS} active="care" collapsed={false} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Quản lý khách hàng' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Bán hàng' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Bán hàng' }));
    expect(onSelect).toHaveBeenCalledWith('sales');
  });

  it('phần ẩn thì không có nút; không còn phần nào thì không vẽ gì (TC-NAV-04)', () => {
    const { container, rerender } = render(
      <CrmSectionSwitcher sections={[CRM_SECTIONS[0]]} active="care" collapsed={false} onSelect={jest.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Bán hàng' })).toBeNull();
    rerender(<CrmSectionSwitcher sections={[]} active={undefined} collapsed={false} onSelect={jest.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
