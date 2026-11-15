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

  // SEC-UI008-01: trình duyệt bỏ ký tự điều khiển và coi `\` như `/`, nên các giá trị này dẫn ra trang ngoài.
  it.each(['/%09/trang-ngoai', '/\n/x', '/%5C%5Cx', '//evil.com', 'https://evil.com', '/\t/evil.com', '/\\evil.com'])(
    'từ chối %j, dù chỉ mã hoá một lớp hay hai lớp',
    (value) => {
      expect(readReturnTo(`?returnTo=${value}`)).toBeUndefined();
      expect(readReturnTo(`?returnTo=${encodeURIComponent(value)}`)).toBeUndefined();
    }
  );

  it('từ chối ký tự điều khiển ở đầu hoặc cuối giá trị', () => {
    expect(readReturnTo(`?returnTo=${encodeURIComponent('\t//evil.com')}`)).toBeUndefined();
    expect(readReturnTo(`?returnTo=${encodeURIComponent('/dashboard\u007f')}`)).toBeUndefined();
  });

  // SEC-UI008-02
  it('giữ nguyên đường dẫn cùng trang web kèm query', () => {
    expect(readReturnTo(`?returnTo=${encodeURIComponent('/modules/procedure?tab=1')}`)).toBe('/modules/procedure?tab=1');
    expect(readReturnTo('?returnTo=%2Fmodules%2Fworkspace%2F')).toBe('/modules/workspace/');
  });
});
