import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Popconfirm } from './popconfirm';

describe('Popconfirm typed confirmation', () => {
  it('requires a matching value and passes the actual input to the destructive action', async () => {
    const confirm = jest.fn().mockResolvedValue(undefined);
    render(
      <Popconfirm
        title="Xóa tenant?"
        confirmInput={{ requiredText: 'tenant-a', label: 'Mã tenant' }}
        onConfirm={confirm}
        okText="Xác nhận xóa"
      >
        <button>Xóa</button>
      </Popconfirm>,
    );
    fireEvent.click(screen.getByText('Xóa'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Xác nhận xóa'));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'tenant-a' } });
    fireEvent.click(screen.getByText('Xác nhận xóa'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('tenant-a'));
  });

  it('collects a required reason and passes it to onConfirm', async () => {
    const confirm = jest.fn().mockResolvedValue(undefined);
    render(
      <Popconfirm
        title="Từ chối đơn?"
        reasonRequired
        reasonLabel="Lý do từ chối"
        onConfirm={confirm}
        okText="Từ chối"
      >
        <button>Mở</button>
      </Popconfirm>,
    );
    fireEvent.click(screen.getByText('Mở'));
    const ok = screen.getByRole('button', { name: 'Từ chối' });
    expect((ok as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  Thiếu chứng từ  ' },
    });
    expect((ok as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Thiếu chứng từ'));
  });
});

describe('Popconfirm trong hộp thoại', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  it('đặt ô xác nhận ngay cạnh nút, kể cả khi hộp thoại không có position (khối chứa là lớp phủ ngoài)', () => {
    // Lớp phủ toàn màn hình (khối chứa thật), ngăn chi tiết role="dialog" không định vị nằm lệch phải.
    render(
      <div data-testid="overlay">
        <aside role="dialog" data-testid="drawer">
          <Popconfirm title="Duyệt công văn này?" placement="top-end" okType="primary">
            <button>Duyệt</button>
          </Popconfirm>
        </aside>
      </div>,
    );
    const overlay = screen.getByTestId('overlay');
    const drawer = screen.getByTestId('drawer');
    const button = screen.getByText('Duyệt');
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => overlay });
    const restore = [
      jest.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1900, 900)),
      jest.spyOn(drawer, 'getBoundingClientRect').mockReturnValue(rect(1120, 0, 780, 900)),
      jest.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(1750, 560, 90, 36)),
    ];
    Object.defineProperty(overlay, 'offsetWidth', { configurable: true, value: 1900 });
    Object.defineProperty(overlay, 'offsetHeight', { configurable: true, value: 900 });
    Object.defineProperty(drawer, 'offsetWidth', { configurable: true, value: 780 });
    Object.defineProperty(drawer, 'offsetHeight', { configurable: true, value: 900 });
    Object.defineProperty(drawer, 'clientWidth', { configurable: true, value: 780 });
    Object.defineProperty(drawer, 'clientHeight', { configurable: true, value: 900 });
    Object.defineProperty(overlay, 'clientWidth', { configurable: true, value: 1900 });
    Object.defineProperty(overlay, 'clientHeight', { configurable: true, value: 900 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1900 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    try {
      fireEvent.click(button);
      const popup = screen.getByText('Duyệt công văn này?').closest('div[style]') as HTMLElement;
      jest.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 280, 120));
      // Cuộn hay đổi cỡ cửa sổ thì tính lại vị trí với kích thước thật của ô.
      fireEvent(window, new Event('resize'));
      // Mép phải ô thẳng mép phải nút, ô nằm trên nút: theo toạ độ của lớp phủ, không theo ngăn.
      expect(popup.style.left).toBe(`${1840 - 280}px`);
      expect(popup.style.top).toBe(`${560 - 120 - 8}px`);
    } finally {
      restore.forEach((spy) => spy.mockRestore());
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
    }
  });
});
