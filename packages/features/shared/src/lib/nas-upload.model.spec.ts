import { planNasUpload } from './nas-upload.model';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('planNasUpload', () => {
  it('tệp lẻ vào thẳng thư mục đích, thư mục giữ nguyên cây; bỏ tệp hệ thống', () => {
    const plan = planNasUpload(
      [
        { path: 'a.pdf', file: file('a.pdf', 5) },
        { path: 'Hồ sơ' },
        { path: 'Hồ sơ/2026' },
        { path: 'Hồ sơ/2026/HĐ 01.pdf', file: file('HĐ 01.pdf', 7) },
        { path: 'Hồ sơ/.DS_Store', file: file('.DS_Store') },
        { path: 'Hồ sơ/~$HĐ 01.docx', file: file('~$HĐ 01.docx') },
      ],
      'HỢP ĐỒNG',
    );
    expect(plan.jobs.map((job) => [job.folder, job.name])).toEqual([
      ['HỢP ĐỒNG', 'a.pdf'],
      ['HỢP ĐỒNG/Hồ sơ/2026', 'HĐ 01.pdf'],
    ]);
    expect(plan.emptyFolders).toEqual([]);
    expect(plan).toMatchObject({ skipped: 2, totalBytes: 12 });
  });

  it('thư mục rỗng tạo riêng, cha trước con; ở gốc thư mục chia sẻ thì không có tiền tố', () => {
    const plan = planNasUpload([{ path: 'Mới' }, { path: 'Mới/Trống' }, { path: 'Có tệp' }, { path: 'Có tệp/x.txt', file: file('x.txt') }], '');
    expect(plan.emptyFolders).toEqual(['Mới', 'Mới/Trống']);
    expect(plan.jobs.map((job) => job.folder)).toEqual(['Có tệp']);
  });
});
