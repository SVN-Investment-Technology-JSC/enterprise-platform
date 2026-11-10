import { DEFAULT_PALETTE, MAX_GRADIENT_STOPS, parseGradient, type Paint } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { PaintPicker } from './paint-picker';

/** Giữ giá trị trong state như trang thật, để các bước sửa liên tiếp tác động lên kết quả của bước trước. */
function Harness({ start, report, allowGradient }: { start: Paint; report: (paint: Paint) => void; allowGradient?: boolean }) {
  const [value, setValue] = useState<Paint>(start);
  return (
    <PaintPicker
      value={value}
      palette={DEFAULT_PALETTE}
      label="Màu nền"
      allowNone
      allowGradient={allowGradient}
      onChange={(paint) => {
        setValue(paint);
        report(paint);
      }}
    />
  );
}

const GRADIENT = 'linear:45:#ff0000@0,#0000ff@1';

function setup(start: Paint = 'brand:sapphire', allowGradient?: boolean) {
  const report = jest.fn<void, [Paint]>();
  render(<Harness start={start} report={report} allowGradient={allowGradient} />);
  return report;
}

const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /^Màu nền:/ }));
const last = (report: jest.Mock) => report.mock.calls[report.mock.calls.length - 1][0] as string;

describe('PaintPicker: màu chuyển sắc', () => {
  it('bấm Chuyển sắc đổi màu hiện tại thành gradient và mở bộ chỉnh, hộp không đóng', () => {
    const report = setup('brand:sapphire');
    openPicker();
    expect(screen.queryByTestId('gradient-editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Màu chuyển sắc' }));
    const gradient = parseGradient(last(report));
    if (!gradient) throw new Error('Không phải gradient');
    expect(gradient.stops[0].color).toBe('brand:sapphire');
    expect(screen.getByTestId('gradient-editor')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Màu nền' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Màu chuyển sắc' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Màu nền: Chuyển sắc' })).toBeTruthy();
  });

  it('ẩn nút Chuyển sắc khi không cho phép', () => {
    setup('brand:sapphire', false);
    openPicker();
    expect(screen.queryByRole('button', { name: 'Màu chuyển sắc' })).toBeNull();
  });

  it('kéo góc đổi góc gradient', () => {
    const report = setup(GRADIENT);
    openPicker();
    fireEvent.change(screen.getByLabelText('Góc chuyển sắc'), { target: { value: '180' } });
    expect(last(report)).toBe('linear:180:#ff0000@0,#0000ff@1');
  });

  it('chọn màu thương hiệu áp cho điểm màu đang chọn và không đóng hộp', () => {
    const report = setup(GRADIENT);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn điểm màu 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xanh ngọc' }));
    expect(last(report)).toBe('linear:45:#ff0000@0,brand:emerald@1');
    expect(screen.getByRole('dialog', { name: 'Màu nền' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn điểm màu 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tím' }));
    expect(last(report)).toBe('linear:45:brand:violet@0,brand:emerald@1');
  });

  it('nhập mã hex áp cho điểm màu đang chọn', () => {
    const report = setup(GRADIENT);
    openPicker();
    const hex = screen.getByLabelText('Mã màu hex');
    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: '#00FF88' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(last(report)).toBe('linear:45:#00ff88@0,#0000ff@1');
    expect(screen.getByRole('dialog', { name: 'Màu nền' })).toBeTruthy();
  });

  it('đổi vị trí điểm màu bằng ô số (phần trăm)', () => {
    const report = setup('linear:45:#ff0000@0,#00ff00@0.4,#0000ff@1');
    openPicker();
    fireEvent.change(screen.getByLabelText('Vị trí điểm màu 2 (%)'), { target: { value: '70' } });
    expect(last(report)).toBe('linear:45:#ff0000@0,#00ff00@0.7,#0000ff@1');
  });

  it('thêm điểm màu rồi chọn ngay điểm mới; xoá điểm màu; không xoá khi chỉ còn 2', () => {
    const report = setup(GRADIENT);
    openPicker();
    const removeFirst = screen.getByRole('button', { name: 'Xoá điểm màu 1' }) as HTMLButtonElement;
    expect(removeFirst.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Thêm điểm màu' }));
    expect(parseGradient(last(report))?.stops).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Chọn điểm màu 2' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Xoá điểm màu 2' }));
    expect(last(report)).toBe(GRADIENT);
    expect(screen.queryByRole('button', { name: 'Chọn điểm màu 3' })).toBeNull();
  });

  it('thêm tới số điểm màu tối đa thì nút Thêm bị khoá', () => {
    setup(GRADIENT);
    openPicker();
    for (let count = 2; count < MAX_GRADIENT_STOPS; count += 1) fireEvent.click(screen.getByRole('button', { name: 'Thêm điểm màu' }));
    expect((screen.getByRole('button', { name: 'Thêm điểm màu' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: `Chọn điểm màu ${MAX_GRADIENT_STOPS}` })).toBeTruthy();
  });

  it('dải hướng tâm: không có thanh góc, có ghi chú, vẫn sửa được điểm màu', () => {
    const radial = 'radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ff0000@0,#0000ff@1';
    const report = setup(radial);
    openPicker();
    expect(screen.queryByLabelText('Góc chuyển sắc')).toBeNull();
    expect(screen.getByTestId('radial-note')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Vị trí điểm màu 2 (%)'), { target: { value: '60' } });
    expect(last(report)).toBe('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ff0000@0,#0000ff@0.6');
  });

  it('sửa độ đặc của điểm màu', () => {
    const report = setup(GRADIENT);
    openPicker();
    expect((screen.getByLabelText('Độ đặc điểm màu 1 (%)') as HTMLInputElement).value).toBe('100');
    fireEvent.change(screen.getByLabelText('Độ đặc điểm màu 1 (%)'), { target: { value: '40' } });
    expect(last(report)).toBe('linear:45:#ff0000@0~0.4,#0000ff@1');
    expect((screen.getByLabelText('Độ đặc điểm màu 1 (%)') as HTMLInputElement).value).toBe('40');
  });

  it('chọn màu thường khi đang là gradient thì thay cả gradient bằng màu đó', () => {
    const report = setup(GRADIENT);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Theo màu chữ xung quanh' }));
    expect(last(report)).toBe('currentColor');
    openPicker();
    expect(screen.queryByTestId('gradient-editor')).toBeNull();
  });

  it('gradient hỏng không làm vỡ hộp chọn', () => {
    setup('linear:hỏng');
    openPicker();
    expect(screen.getByRole('dialog', { name: 'Màu nền' })).toBeTruthy();
    expect(screen.queryByTestId('gradient-editor')).toBeNull();
  });
});
