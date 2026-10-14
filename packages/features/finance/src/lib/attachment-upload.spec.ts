import { ATTACHMENT_ACCEPT, attachmentProblem, formatBytes } from './attachment-upload';

describe('kiểm tệp đính kèm ở trình duyệt', () => {
  it('nhận PDF, ảnh, Word, Excel trong giới hạn 10 MB', () => {
    for (const name of ['hoa-don.pdf', 'anh.PNG', 'a.jpeg', 'b.webp', 'c.docx', 'd.xlsx', 'e.doc', 'f.xls']) expect(attachmentProblem({ name, size: 1000 })).toBeNull();
    expect(attachmentProblem({ name: 'x.pdf', size: 10 * 1024 * 1024 })).toBeNull();
  });

  it('từ chối đuôi lạ, tệp rỗng và tệp quá lớn kèm tên tệp trong thông báo', () => {
    expect(attachmentProblem({ name: 'virus.exe', size: 10 })).toContain('virus.exe');
    expect(attachmentProblem({ name: 'khong-duoi', size: 10 })).toContain('chỉ nhận');
    expect(attachmentProblem({ name: 'a.pdf', size: 0 })).toContain('rỗng');
    expect(attachmentProblem({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 })).toContain('10 MB');
  });

  it('bộ lọc của hộp chọn tệp gồm đúng các đuôi được nhận', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.pdf', '.png', '.docx', '.xlsx']));
    expect(ATTACHMENT_ACCEPT).not.toContain('.exe');
  });

  it('dung lượng đọc được', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});
