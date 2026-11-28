/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { BulkActionsDialog } from './bulk-actions-dialog';

describe('BulkActionsDialog', () => {
  it('mặc định tắt cả hai; bật rồi Lưu gửi đúng cài đặt', () => {
    const onSave = jest.fn();
    render(<BulkActionsDialog definitionName="Mua sắm" value={undefined} onClose={jest.fn()} onSave={onSave} />);
    const approve = screen.getByLabelText('Cho phép duyệt hàng loạt') as HTMLInputElement;
    const reject = screen.getByLabelText('Cho phép không duyệt (huỷ) hàng loạt') as HTMLInputElement;
    expect(approve.checked).toBe(false);
    expect(reject.checked).toBe(false);
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(approve);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ approve: true, reject: false });
  });

  it('hiện đúng cài đặt đang có', () => {
    render(
      <BulkActionsDialog definitionName="Mua sắm" value={{ reject: true }} onClose={jest.fn()} onSave={jest.fn()} />,
    );
    expect((screen.getByLabelText('Cho phép duyệt hàng loạt') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Cho phép không duyệt (huỷ) hàng loạt') as HTMLInputElement).checked).toBe(true);
  });
});
