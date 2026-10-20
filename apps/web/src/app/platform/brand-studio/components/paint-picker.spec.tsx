import { DEFAULT_PALETTE, type Paint } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaintPicker } from './paint-picker';

function setup(props: Partial<React.ComponentProps<typeof PaintPicker>> = {}) {
  const onChange = jest.fn<void, [Paint]>();
  const onScrubStart = jest.fn();
  const onScrubEnd = jest.fn();
  render(
    <PaintPicker
      value="brand:sapphire"
      palette={DEFAULT_PALETTE}
      label="Màu nét"
      allowNone
      onChange={onChange}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
      {...props}
    />,
  );
  return { onChange, onScrubStart, onScrubEnd };
}

const trigger = (name = 'Màu nét: Xanh Sapphire') => screen.getByRole('button', { name });
const open = (name?: string) => fireEvent.click(trigger(name));

describe('PaintPicker', () => {
  it('hiện tên màu trên nút và chỉ mở hộp chọn khi bấm', () => {
    setup();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByRole('dialog', { name: 'Màu nét' })).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('chọn màu thương hiệu thì lưu theo khoá bảng màu và đóng hộp', () => {
    const { onChange } = setup();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Xanh ngọc' }));
    expect(onChange).toHaveBeenCalledWith('brand:emerald');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('đánh dấu màu đang dùng và không gọi onChange khi chọn lại đúng màu đó', () => {
    const { onChange } = setup();
    open();
    const current = screen.getByRole('button', { name: 'Xanh Sapphire' });
    expect(current.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Xanh ngọc' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(current);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chọn không có màu và theo màu chữ', () => {
    const { onChange } = setup();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Không có màu' }));
    expect(onChange).toHaveBeenLastCalledWith('none');

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Theo màu chữ xung quanh' }));
    expect(onChange).toHaveBeenLastCalledWith('currentColor');
  });

  it('ẩn nút Không khi không cho phép không màu', () => {
    setup({ allowNone: false });
    open();
    expect(screen.queryByRole('button', { name: 'Không có màu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Theo màu chữ xung quanh' })).toBeTruthy();
  });

  it('nhập mã hex rồi Enter thì lưu mã chuẩn hoá chữ thường', () => {
    const { onChange } = setup();
    open();
    const hex = screen.getByLabelText('Mã màu hex');
    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: '#FF8800' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('#ff8800');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nhận hex ngắn không có dấu #', () => {
    const { onChange } = setup();
    open();
    const hex = screen.getByLabelText('Mã màu hex');
    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: 'f80' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('#ff8800');
  });

  it('hex sai thì báo lỗi nhẹ và không đổi màu', () => {
    const { onChange } = setup();
    open();
    const hex = screen.getByLabelText('Mã màu hex');
    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: 'zzz' } });
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('đóng khi nhấn Esc hoặc bấm ra ngoài', () => {
    setup();
    open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bấm bên trong hộp không làm đóng hộp', () => {
    setup();
    open();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('kéo bảng màu hệ thống: báo bắt đầu một lần, đổi màu liên tục, kết thúc khi bảng đóng (sự kiện change)', () => {
    const { onChange, onScrubStart, onScrubEnd } = setup();
    open();
    const color = screen.getByLabelText('Chọn màu tuỳ ý');
    // Trình duyệt bắn `input` liên tục khi kéo và `change` một lần khi đóng bảng màu.
    fireEvent.input(color, { target: { value: '#00ff00' } });
    fireEvent.input(color, { target: { value: '#00aa00' } });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenNthCalledWith(1, '#00ff00');
    expect(onChange).toHaveBeenNthCalledWith(2, '#00aa00');
    fireEvent.change(color);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('kết thúc lượt kéo màu khi ô mất tiêu điểm hoặc hộp bị đóng giữa chừng', () => {
    const { onScrubEnd } = setup();
    open();
    const color = screen.getByLabelText('Chọn màu tuỳ ý');
    fireEvent.input(color, { target: { value: '#00ff00' } });
    fireEvent.blur(color);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);

    fireEvent.input(color, { target: { value: '#00aa00' } });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onScrubEnd).toHaveBeenCalledTimes(2);
  });

  it('nhiều màu khác nhau: hiện "Nhiều màu" và không đánh dấu màu nào', () => {
    setup({ mixed: true });
    expect(trigger('Màu nét: Nhiều màu')).toBeTruthy();
    open('Màu nét: Nhiều màu');
    expect(screen.getByRole('button', { name: 'Xanh Sapphire' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('không mở được khi bị vô hiệu', () => {
    setup({ disabled: true });
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });

  it('mô tả màu không còn trong bảng màu mà không vỡ', () => {
    setup({ value: 'brand:gone' });
    expect(screen.getByRole('button', { name: /Thiếu màu gone/ })).toBeTruthy();
  });
});
