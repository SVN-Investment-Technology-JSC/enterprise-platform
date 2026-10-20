import { DEFAULT_PALETTE, ICON_SIZES } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen } from '@testing-library/react';
import { PreviewPanel } from './preview-panel';
import { rectShape, testDoc } from './panel-test-utils';

const doc = testDoc([rectShape('a', 6, 6, 12, 12, { stroke: 'brand:sapphire' })], {
  name: 'Kho vận',
  description: 'Quản lý kho',
});

const renderPreview = (value = doc) => render(<PreviewPanel doc={value} palette={DEFAULT_PALETTE} />);
const sized = (container: HTMLElement, size: number) => Array.from(container.querySelectorAll<SVGElement>(`svg[style*="width: ${size}px"]`));

describe('PreviewPanel', () => {
  it('vẽ icon ở đủ các cỡ chuẩn đúng bằng điểm ảnh, kèm số cỡ', () => {
    const { container } = renderPreview();
    for (const size of ICON_SIZES) {
      expect(screen.getByText(String(size))).toBeTruthy();
      expect(sized(container, size).length).toBeGreaterThan(0);
    }
    const favicon = sized(container, 16)[0];
    expect(favicon.getAttribute('style')).toContain('height: 16px');
    expect(favicon.getAttribute('style')).not.toContain('transform');
    expect(favicon.getAttribute('style')).not.toContain('image-rendering');
  });

  it('có các mô phỏng tab trình duyệt, thanh bên, thẻ phân hệ và nút', () => {
    const { container } = renderPreview();
    for (const caption of ['Tab trình duyệt', 'Thanh bên', 'Thẻ phân hệ', 'Nút']) expect(screen.getByText(caption)).toBeTruthy();
    // tab 16px, hai mục thanh bên 20px, thẻ 24px, hai nút 16px (cùng hàng cỡ 16/20/24)
    expect(sized(container, 20)).toHaveLength(3);
    expect(screen.getByText('Quản lý kho')).toBeTruthy();
    expect(screen.getAllByText('Kho vận').length).toBeGreaterThanOrEqual(4);
  });

  it('dùng tên và mô tả dự phòng khi icon chưa đặt', () => {
    renderPreview(testDoc([], { name: '  ', description: '' }));
    expect(screen.getAllByText('Icon').length).toBeGreaterThan(0);
    expect(screen.getByText('Mô tả phân hệ')).toBeTruthy();
  });

  it('chuyển giữa màu thương hiệu và theo màu chữ', () => {
    const { container } = renderPreview();
    expect(sized(container, 32)[0].getAttribute('stroke')).toBe('#2563eb');
    expect(screen.getByRole('button', { name: 'Màu thương hiệu' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Theo màu chữ (currentColor)' }));
    expect(sized(container, 32)[0].getAttribute('stroke')).toBe('currentColor');
    expect(screen.getByRole('button', { name: 'Theo màu chữ (currentColor)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('chuyển nền sáng và nền tối', () => {
    renderPreview();
    expect(screen.getByRole('button', { name: 'Nền sáng' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Nền tối' }));
    expect(screen.getByRole('button', { name: 'Nền tối' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Nền sáng' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('nền tối đổi màu chữ của icon theo màu chữ, nền sáng trở lại màu tối', () => {
    const { container } = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Theo màu chữ (currentColor)' }));
    expect(sized(container, 32)[0].getAttribute('style')).toContain('rgb(51, 65, 85)');
    fireEvent.click(screen.getByRole('button', { name: 'Nền tối' }));
    expect(sized(container, 32)[0].getAttribute('style')).toContain('rgb(226, 232, 240)');
  });

  it('icon rỗng vẫn hiển thị khung xem trước mà không lỗi', () => {
    const { container } = renderPreview(testDoc([]));
    expect(sized(container, 48).length).toBeGreaterThan(0);
  });
});
