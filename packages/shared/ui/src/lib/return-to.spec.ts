import { readReturnTo } from './return-to';

describe('readReturnTo — chỉ nhận đường dẫn nội bộ', () => {
  it('nhận đường dẫn bắt đầu bằng /', () => {
    expect(readReturnTo('?returnTo=%2Fdashboard')).toBe('/dashboard');
    expect(readReturnTo('?project=p1&returnTo=/dashboard')).toBe('/dashboard');
  });

  it('bỏ qua link ra ngoài hoặc giá trị lạ', () => {
    expect(readReturnTo('?returnTo=https://evil.example')).toBeUndefined();
    expect(readReturnTo('?returnTo=//evil.example')).toBeUndefined();
    expect(readReturnTo('?returnTo=/%5Cevil.example')).toBeUndefined();
    expect(readReturnTo('?returnTo=dashboard')).toBeUndefined();
    expect(readReturnTo('')).toBeUndefined();
  });
});
