import { SHARED_DOCUMENT_MAX_BYTES, SHARED_MAX_FOLDER_DEPTH } from '@enterprise-platform/contracts-shared';
import {
  documentNameCandidates,
  hasFolders,
  isSystemFile,
  pickedFiles,
  planFolderUpload,
  type PickedEntry,
} from './folder-upload.model';

/** Tệp như `<input webkitdirectory>` trả về: tên tệp + đường dẫn từ thư mục được chọn. */
const file = (path: string, size = 10) => {
  const item = new File(['x'], path.split('/').pop() ?? path);
  Object.defineProperty(item, 'size', { value: size });
  Object.defineProperty(item, 'webkitRelativePath', { value: path });
  return item;
};

const picked = (path: string, size = 10): PickedEntry => ({ file: file(path, size), path });

/** Thư mục kéo thả vào: không có tệp, kể cả thư mục rỗng. */
const dir = (path: string): PickedEntry => ({ path });

describe('planFolderUpload', () => {
  it('dựng cây thư mục theo đường dẫn, cha trước con, mỗi tệp vào đúng thư mục', () => {
    const plan = planFolderUpload(
      [picked('Hồ sơ/Biên bản.docx', 5), picked('Hồ sơ/2026/Phụ lục/PL1.xlsx', 7), picked('Hồ sơ/2026/HĐ01.pdf', 3)],
      1,
    );
    expect(plan.folders).toEqual([
      { path: 'Hồ sơ', name: 'Hồ sơ', parentPath: '' },
      { path: 'Hồ sơ/2026', name: '2026', parentPath: 'Hồ sơ' },
      { path: 'Hồ sơ/2026/Phụ lục', name: 'Phụ lục', parentPath: 'Hồ sơ/2026' },
    ]);
    expect(plan.jobs.map((job) => [job.path, job.folderPath])).toEqual([
      ['Hồ sơ/2026/HĐ01.pdf', 'Hồ sơ/2026'],
      ['Hồ sơ/2026/Phụ lục/PL1.xlsx', 'Hồ sơ/2026/Phụ lục'],
      ['Hồ sơ/Biên bản.docx', 'Hồ sơ'],
    ]);
    expect(plan.totalBytes).toBe(15);
    expect(plan.problem).toBeUndefined();
  });

  it('nhận mọi định dạng; bỏ qua tệp hệ thống lặng lẽ, tệp quá cỡ thì báo lại', () => {
    const plan = planFolderUpload(
      [
        picked('Hồ sơ/.DS_Store'),
        picked('Hồ sơ/Thumbs.db'),
        picked('Hồ sơ/desktop.ini'),
        picked('Hồ sơ/~$Biên bản.docx'),
        picked('Hồ sơ/quay.mp4', SHARED_DOCUMENT_MAX_BYTES + 1),
        picked('Hồ sơ/bản vẽ.dwg'),
        picked('Hồ sơ/cấu hình.json'),
      ],
      0,
    );
    expect(plan.jobs.map((job) => job.path)).toEqual(['Hồ sơ/bản vẽ.dwg', 'Hồ sơ/cấu hình.json']);
    expect(plan.skipped).toEqual([{ path: 'Hồ sơ/quay.mp4', reason: expect.stringMatching(/^Vượt quá/) }]);
  });

  it('chặn cả lượt khi cây mới vượt giới hạn cấp của kho', () => {
    const deepest = SHARED_MAX_FOLDER_DEPTH - 2;
    expect(planFolderUpload([picked('A/x.pdf')], deepest).problem).toBeUndefined();
    expect(planFolderUpload([picked('A/B/x.pdf')], deepest).problem).toContain('“A/B”');
  });

  it('chặn khi tên thư mục dài quá giới hạn; cắt khoảng trắng và bỏ đoạn rỗng như server', () => {
    expect(planFolderUpload([picked(`${'a'.repeat(181)}/x.pdf`)], 0).problem).toMatch(/dài quá 180/);
    const plan = planFolderUpload([picked(' Hồ sơ //2026/x.pdf')], 0);
    expect(plan.folders.map((folder) => folder.path)).toEqual(['Hồ sơ', 'Hồ sơ/2026']);
  });
});

describe('planFolderUpload – kéo thả', () => {
  it('giữ cả thư mục rỗng, cha trước con', () => {
    const plan = planFolderUpload([dir('Hồ sơ/Trống/Con'), dir('Hồ sơ'), picked('Hồ sơ/a.pdf'), dir('Hồ sơ/Trống')], 0);
    expect(plan.folders).toEqual([
      { path: 'Hồ sơ', name: 'Hồ sơ', parentPath: '' },
      { path: 'Hồ sơ/Trống', name: 'Trống', parentPath: 'Hồ sơ' },
      { path: 'Hồ sơ/Trống/Con', name: 'Con', parentPath: 'Hồ sơ/Trống' },
    ]);
    expect(plan.jobs.map((job) => [job.path, job.folderPath])).toEqual([['Hồ sơ/a.pdf', 'Hồ sơ']]);
  });

  it('thả nhiều thư mục và tệp lẻ một lúc: mỗi thư mục là một gốc, tệp lẻ vào thẳng thư mục đích', () => {
    const plan = planFolderUpload([picked('Biên bản.pdf'), picked('A/x.pdf'), dir('B')], 0);
    expect(plan.folders.map((folder) => [folder.path, folder.parentPath])).toEqual([
      ['A', ''],
      ['B', ''],
    ]);
    expect(plan.jobs.map((job) => [job.path, job.folderPath])).toEqual([
      ['A/x.pdf', 'A'],
      ['Biên bản.pdf', ''],
    ]);
  });

  it('thư mục rỗng cũng tính cấp như thư mục có tệp', () => {
    const deepest = SHARED_MAX_FOLDER_DEPTH - 2;
    expect(planFolderUpload([dir('A')], deepest).problem).toBeUndefined();
    expect(planFolderUpload([dir('A/B')], deepest).problem).toContain('“A/B”');
  });
});

describe('hasFolders, pickedFiles', () => {
  it('có thư mục khi có mục không phải tệp hay tệp nằm trong thư mục con', () => {
    expect(hasFolders([picked('a.pdf'), picked('b.docx')])).toBe(false);
    expect(hasFolders([picked('a.pdf'), dir('Trống')])).toBe(true);
    expect(hasFolders([picked('Hồ sơ/a.pdf')])).toBe(true);
  });

  it('tệp chọn bằng hộp chọn thư mục mang đường dẫn tương đối, tệp lẻ mang tên tệp', () => {
    const loose = new File(['x'], 'lẻ.pdf');
    expect(pickedFiles([file('Hồ sơ/2026/a.pdf'), loose]).map((entry) => entry.path)).toEqual([
      'Hồ sơ/2026/a.pdf',
      'lẻ.pdf',
    ]);
  });
});

describe('documentNameCandidates', () => {
  it('tên bỏ đuôi trước, rồi nguyên tên tệp, rồi đánh số', () => {
    expect(documentNameCandidates('Biên bản.pdf').slice(0, 4)).toEqual([
      'Biên bản',
      'Biên bản.pdf',
      'Biên bản (2)',
      'Biên bản (3)',
    ]);
    expect(documentNameCandidates('README').slice(0, 2)).toEqual(['README', 'README (2)']);
  });
});

describe('isSystemFile', () => {
  it('nhận ra tệp hệ điều hành và tệp khoá Office, không phân biệt hoa thường', () => {
    expect(['.DS_Store', 'THUMBS.DB', 'desktop.ini', '~$HĐ.docx'].every(isSystemFile)).toBe(true);
    expect(isSystemFile('Biên bản.docx')).toBe(false);
  });
});
