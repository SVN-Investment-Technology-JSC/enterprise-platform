/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { useCloseGuard } from './use-close-guard';

function Harness({ dirty, busy, onClose }: { dirty: boolean; busy?: boolean; onClose: () => void }) {
  const guard = useCloseGuard({ dirty, busy, onClose });
  return (
    <Dialog {...guard.dialogProps}>
      <DialogContent>
        <DialogTitle>Form thử</DialogTitle>
        <button type="button" onClick={guard.requestClose}>
          Huỷ
        </button>
      </DialogContent>
      {guard.confirm}
    </Dialog>
  );
}

describe('useCloseGuard', () => {
  it('chưa đổi gì: nút X và Esc đóng ngay', () => {
    const onClose = jest.fn();
    render(<Harness dirty={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('đã đổi: hỏi xác nhận; Tiếp tục nhập giữ form, Đóng và bỏ mới đóng', async () => {
    const onClose = jest.fn();
    render(<Harness dirty onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Đóng và bỏ thay đổi?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    expect(screen.queryByText('Đóng và bỏ thay đổi?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Đóng và bỏ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: không đóng được và không hỏi', () => {
    const onClose = jest.fn();
    render(<Harness dirty busy onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Đóng và bỏ thay đổi?')).toBeNull();
  });

  it('bấm nền không đóng', () => {
    const onClose = jest.fn();
    render(<Harness dirty={false} onClose={onClose} />);
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    fireEvent.click(overlay);
    fireEvent.mouseDown(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });
});
