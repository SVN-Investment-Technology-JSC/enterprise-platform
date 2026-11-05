import { contentTypeOf } from './library.model';

describe('contentTypeOf', () => {
  it('giữ kiểu trình duyệt báo, bỏ phần tham số', () => {
    expect(contentTypeOf({ name: 'video.mp4', type: 'video/mp4' })).toBe('video/mp4');
    expect(contentTypeOf({ name: 'ghi chú.txt', type: 'text/plain;charset=utf-8' })).toBe('text/plain');
  });

  it('trình duyệt không nhận ra thì đoán theo phần mở rộng, không đoán được thì là tệp nhị phân', () => {
    expect(contentTypeOf({ name: 'bản vẽ.DWG', type: '' })).toBe('image/vnd.dwg');
    expect(contentTypeOf({ name: 'khung.step', type: '' })).toBe('application/octet-stream');
    expect(contentTypeOf({ name: 'lạ', type: 'không phải kiểu' })).toBe('application/octet-stream');
  });
});
