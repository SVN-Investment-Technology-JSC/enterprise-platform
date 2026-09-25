import { qualified } from './postgres-workspace-store.js';

describe('qualified', () => {
  it('gắn tiền tố cho MỌI cột của hằng viết nhiều dòng', () => {
    // Đúng dạng các hằng `*_COLUMNS`: xuống dòng rồi thụt lề sau dấu phẩy.
    const columns = `id, title,
       status, created_by,
       created_at`;
    expect(qualified(columns, 'w')).toBe(
      'w.id, w.title, w.status, w.created_by, w.created_at',
    );
  });

  it('không sinh cột rỗng khi có dấu phẩy thừa ở cuối', () => {
    expect(qualified('id, code,\n', 'p')).toBe('p.id, p.code');
  });
});
