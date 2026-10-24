import { render, screen } from '@testing-library/react';
import { OnBehalfName } from './on-behalf-name';

describe('OnBehalfName', () => {
  it('đơn tự gửi: chỉ có tên, không có dấu sao', () => {
    render(<p>{<OnBehalfName name="Đoàn Nguyễn Sơn Hải" onBehalf={false} />}</p>);
    expect(screen.getByText('Đoàn Nguyễn Sơn Hải')).toBeTruthy();
    expect(screen.queryByTestId('on-behalf-mark')).toBeNull();
  });

  it('đơn tạo hộ: dấu sao đỏ sau tên, rê chuột thấy người tạo và lý do', () => {
    render(<p>{<OnBehalfName name="Đoàn Nguyễn Sơn Hải" onBehalf byName="Trưởng phòng" reason="Báo ốm qua điện thoại" />}</p>);
    expect(screen.getByText('Đoàn Nguyễn Sơn Hải')).toBeTruthy();
    const mark = screen.getByTestId('on-behalf-mark');
    expect(mark.textContent).toBe('*');
    expect(mark.className).toContain('text-red-600');
    expect(mark.getAttribute('title')).toBe('Đơn tạo hộ bởi Trưởng phòng. Lý do: Báo ốm qua điện thoại');
  });
});
