import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BLOCKED_REASON_MAX_LENGTH } from '@enterprise-platform/contracts-workspace';
import { BlockedReasonDialog, BlockedReasonNotice } from '@enterprise-platform/feature-workspace';

afterEach(cleanup);

const item = { code: 'CV-7', title: 'Lắp đặt tủ điện' };

const renderDialog = (props: Partial<Parameters<typeof BlockedReasonDialog>[0]> = {}) => {
  const onConfirm = jest.fn(async (_reason: string) => undefined);
  const onClose = jest.fn();
  render(<BlockedReasonDialog open item={item} onClose={onClose} onConfirm={onConfirm} {...props} />);
  return { onConfirm, onClose };
};

const box = () => screen.getByRole('textbox', { name: 'Lý do vướng mắc' }) as HTMLTextAreaElement;
const confirm = () => screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement;

describe('BlockedReasonDialog', () => {
  it('nêu mã và tên công việc, ô lý do được focus sẵn và nút Xác nhận khoá khi còn trống', async () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Báo vướng mắc' })).toBeTruthy();
    expect(screen.getByText('CV-7 · Lắp đặt tủ điện')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(confirm().disabled).toBe(true);
    expect(box().maxLength).toBe(BLOCKED_REASON_MAX_LENGTH);
  });

  it('toàn khoảng trắng vẫn bị khoá', () => {
    renderDialog();
    fireEvent.change(box(), { target: { value: '   \n  ' } });
    expect(confirm().disabled).toBe(true);
  });

  it('gửi lý do đã cắt khoảng trắng hai đầu', async () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(box(), { target: { value: '  Chờ nhà cung cấp giao vật tư \n' } });
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Chờ nhà cung cấp giao vật tư'));
  });

  it('Ctrl+Enter gửi, nhưng không gửi khi đang gõ dở bằng bộ gõ tiếng Việt', async () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(box(), { target: { value: 'Thiếu bản vẽ' } });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Thiếu bản vẽ'));
  });

  it('lỗi từ server hiện ngay trong hộp và hộp vẫn mở để gửi lại', async () => {
    const onConfirm = jest.fn(async (_reason: string) => {
      throw new Error('Công việc đã bị huỷ.');
    });
    const { onClose } = renderDialog({ onConfirm });
    fireEvent.change(box(), { target: { value: 'Kẹt giấy phép' } });
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe('Công việc đã bị huỷ.');
    expect(onClose).not.toHaveBeenCalled();
    expect(box().value).toBe('Kẹt giấy phép');
    await waitFor(() => expect(confirm().disabled).toBe(false));
  });

  it('chế độ sửa: tiêu đề riêng và điền sẵn lý do hiện tại', () => {
    renderDialog({ item: { ...item, blockedReason: 'Chờ vật tư' } });
    expect(screen.getByRole('heading', { name: 'Sửa lý do vướng mắc' })).toBeTruthy();
    expect(box().value).toBe('Chờ vật tư');
    expect(confirm().disabled).toBe(false);
  });

  it('hiện bộ đếm ký tự khi gần hết giới hạn', () => {
    renderDialog();
    expect(screen.queryByText(/ký tự$/)).toBeNull();
    fireEvent.change(box(), { target: { value: 'a'.repeat(BLOCKED_REASON_MAX_LENGTH - 10) } });
    expect(screen.getByText(`${BLOCKED_REASON_MAX_LENGTH - 10}/${BLOCKED_REASON_MAX_LENGTH} ký tự`)).toBeTruthy();
  });
});

describe('BlockedReasonNotice', () => {
  it('hiện lý do và nút Sửa lý do khi người xem có quyền', () => {
    const onEdit = jest.fn();
    render(<BlockedReasonNotice reason={'Dòng 1\nDòng 2'} onEdit={onEdit} />);
    expect(screen.getByText('Vướng mắc')).toBeTruthy();
    expect(screen.getByText(/Dòng 1/).textContent).toBe('Dòng 1\nDòng 2');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa lý do' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('dữ liệu cũ chưa có lý do: báo "Chưa ghi lý do" kèm nút Ghi lý do; không quyền thì không có nút', () => {
    const { rerender } = render(<BlockedReasonNotice onEdit={() => undefined} />);
    expect(screen.getByText('Chưa ghi lý do')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ghi lý do' })).toBeTruthy();
    rerender(<BlockedReasonNotice />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
