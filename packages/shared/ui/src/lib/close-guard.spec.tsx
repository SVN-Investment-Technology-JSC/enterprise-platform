import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CloseGuard } from './close-guard';

describe('CloseGuard', () => {
  it('chưa thay đổi thì đóng ngay', () => {
    const close = jest.fn();
    render(
      <CloseGuard dirty={false} onClose={close}>
        <button type="button">Huỷ</button>
      </CloseGuard>,
    );
    fireEvent.click(screen.getByText('Huỷ'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('đã thay đổi thì hỏi, chọn tiếp tục nhập thì không đóng', () => {
    const close = jest.fn();
    render(
      <CloseGuard dirty onClose={close}>
        <button type="button">Huỷ</button>
      </CloseGuard>,
    );
    fireEvent.click(screen.getByText('Huỷ'));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('Đóng và bỏ thay đổi?')).toBeTruthy();
    fireEvent.click(screen.getByText('Tiếp tục nhập'));
    expect(close).not.toHaveBeenCalled();
  });

  it('đã thay đổi thì chỉ đóng khi xác nhận', async () => {
    const close = jest.fn();
    render(
      <CloseGuard dirty onClose={close}>
        <button type="button">Huỷ</button>
      </CloseGuard>,
    );
    fireEvent.click(screen.getByText('Huỷ'));
    fireEvent.click(screen.getByText('Đóng và bỏ'));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('đang gửi thì khóa nút', () => {
    const close = jest.fn();
    render(
      <CloseGuard dirty busy onClose={close}>
        <button type="button">Huỷ</button>
      </CloseGuard>,
    );
    const button = screen.getByText('Huỷ') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(close).not.toHaveBeenCalled();
  });

  it('bật cảnh báo trình duyệt khi dirty và gỡ khi hết dirty', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const { rerender } = render(
      <CloseGuard dirty onClose={jest.fn()}>
        <button type="button">Huỷ</button>
      </CloseGuard>,
    );
    expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    rerender(
      <CloseGuard dirty={false} onClose={jest.fn()}>
        <button type="button">Huỷ</button>
      </CloseGuard>,
    );
    expect(remove.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });
});
