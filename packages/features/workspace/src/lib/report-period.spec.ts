import { localDay, percent, presetRange } from './report-period';

describe('presetRange — kỳ báo cáo chọn nhanh', () => {
  // Thứ Tư 21/10/2026.
  const today = new Date(2026, 9, 21);

  it('tuần bắt đầu thứ Hai, kết thúc Chủ nhật', () => {
    expect(presetRange('week', today)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  it('tháng, quý và năm chứa hôm nay', () => {
    expect(presetRange('month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('quarter', today)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('Chủ nhật vẫn thuộc tuần bắt đầu từ thứ Hai trước đó', () => {
    expect(presetRange('week', new Date(2026, 9, 25))).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  it('tháng Hai năm thường', () => {
    expect(presetRange('month', new Date(2026, 1, 10))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('percent', () => {
  it('làm tròn, mẫu 0 thì không có tỉ lệ', () => {
    expect(percent(5, 7)).toBe(71);
    expect(percent(0, 0)).toBeUndefined();
  });
});

describe('localDay', () => {
  it('lấy ngày theo giờ máy, không cắt chuỗi UTC', () => {
    const start = new Date(2026, 0, 1, 0, 0, 0);
    expect(localDay(start.toISOString())).toBe('2026-01-01');
  });
});
