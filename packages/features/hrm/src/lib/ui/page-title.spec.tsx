/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { PageTitle } from './page-title';

describe('PageTitle', () => {
  it('hiện tên trang, mô tả và nội dung góc phải (badge) như nút thao tác', () => {
    render(
      <PageTitle
        title="Lương và chi trả"
        description="Mô tả trang"
        badge={<button type="button">Tạo kỳ lương</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Lương và chi trả' })).toBeTruthy();
    expect(screen.getByText('Mô tả trang')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo kỳ lương' })).toBeTruthy();
  });

  it('không có tab trang gộp thì không dựng đường kẻ tab khi withTabs tắt', () => {
    const { container } = render(<PageTitle title="Bảng công" />);
    expect(container.querySelector('.border-b')).toBeNull();
  });

  it('withTabs dựng vùng tab dưới tiêu đề (trống nếu không nằm trong trang gộp)', () => {
    const { container } = render(<PageTitle withTabs title="Bảng công" />);
    expect(container.querySelector('.border-b')).not.toBeNull();
  });
});
