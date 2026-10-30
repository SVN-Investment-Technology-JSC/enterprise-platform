import type { SharedDocumentSummary, SharedFolder } from '@enterprise-platform/contracts-shared';
import { planFolderUpload, type UploadJob } from './folder-upload.model';
import { runUpload, type UploadRunnerApi } from './upload-runner';

const folder = (id: string, name: string, parentId?: string): SharedFolder => ({
  id,
  parentId,
  name,
  depth: parentId ? 1 : 0,
  isActive: true,
  documentCount: 0,
  totalDocumentCount: 0,
  totalBytes: 0,
  createdBy: 'u-1',
  createdAt: '2026-10-28T00:00:00Z',
  updatedAt: '2026-10-28T00:00:00Z',
});

const picked = (path: string, size = 10) => {
  const file = new File(['x'], path.split('/').pop() ?? path);
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

const job = (path: string, size = 10): UploadJob => ({ file: picked(path, size), path, folderPath: '' });

/** API giả: ghi lại lời gọi; `taken` là tên đã có (kể cả tài liệu người gọi không thấy). */
function fakeApi(
  options: {
    readonly documents?: Record<string, Partial<SharedDocumentSummary>[]>;
    readonly taken?: Record<string, string[]>;
    readonly failOn?: string[];
    /** Thư mục đã có trên server mà danh sách người gọi đang cầm chưa có. */
    readonly serverFolders?: SharedFolder[];
  } = {},
) {
  const created: { parentId: string; name: string }[] = [];
  const uploads: { folderId: string; name: string; file: string }[] = [];
  const resumed: { documentId: string; file: string }[] = [];
  const api: UploadRunnerApi = {
    createFolder: async (parentId, name) => {
      if (options.serverFolders?.some((item) => item.parentId === parentId && item.name.toLowerCase() === name.toLowerCase())) {
        throw { code: 'NAME_TAKEN', message: `Đã có mục tên "${name}" ở cùng chỗ.` };
      }
      created.push({ parentId, name });
      return folder(`new-${created.length}`, name, parentId);
    },
    listFolders: async () => [TARGET, ...(options.serverFolders ?? [])],
    listDocuments: async (folderId) => (options.documents?.[folderId] ?? []) as SharedDocumentSummary[],
    uploadDocument: async (folderId, name, file) => {
      if (options.taken?.[folderId]?.includes(name.toLowerCase())) {
        throw { code: 'NAME_TAKEN', message: `Đã có mục tên "${name}" ở cùng chỗ.` };
      }
      // Như shared-api: tài liệu đã tạo rồi mới hỏng ở chặng PUT, lỗi mang id tài liệu đó.
      if (options.failOn?.includes(file.name)) {
        throw { code: 'UPLOAD_FAILED', message: 'Tải tệp lên thất bại (500).', documentId: `pending-${file.name}` };
      }
      uploads.push({ folderId, name, file: file.name });
      return `doc-${uploads.length}`;
    },
    resumeDocument: async (documentId, file) => {
      resumed.push({ documentId, file: file.name });
      return documentId;
    },
  };
  return { api, created, uploads, resumed };
}

const TARGET = folder('target', 'Tài liệu công ty');

describe('runUpload – tải cả thư mục', () => {
  it('dựng thư mục còn thiếu, nhập vào thư mục cùng tên đã có, tải tệp vào đúng chỗ', async () => {
    const existing = folder('existing', 'hồ sơ', 'target');
    const plan = planFolderUpload([picked('Hồ sơ/a.pdf'), picked('Hồ sơ/2026/b.pdf')], 0);
    const { api, created, uploads } = fakeApi();

    const result = await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET, existing],
      folders: plan.folders,
      jobs: plan.jobs,
    });

    expect(created).toEqual([{ parentId: 'existing', name: '2026' }]);
    expect(uploads).toEqual([
      { folderId: 'new-1', name: 'b', file: 'b.pdf' },
      { folderId: 'existing', name: 'a', file: 'a.pdf' },
    ]);
    expect(result).toMatchObject({ uploaded: 2, skipped: [], failures: [] });
    expect(result.folderIds.get('Hồ sơ')).toBe('existing');
  });

  it('tệp cùng tên khác đuôi: tệp sau giữ nguyên tên tệp', async () => {
    const plan = planFolderUpload([picked('Hồ sơ/Biên bản.pdf'), picked('Hồ sơ/Biên bản.docx')], 0);
    const { api, uploads } = fakeApi();
    await runUpload(api, { targetFolderId: 'target', knownFolders: [TARGET], folders: plan.folders, jobs: plan.jobs });
    expect(uploads.map((upload) => upload.name)).toEqual(['Biên bản', 'Biên bản.pdf']);
  });

  it('tải lại: tệp đã có (cùng tên tệp, cùng dung lượng) thì bỏ qua, tệp khác thì đổi tên để không đè', async () => {
    const { api, uploads } = fakeApi({
      documents: {
        target: [
          { name: 'a', currentVersion: { fileName: 'a.pdf', sizeBytes: 10 } as SharedDocumentSummary['currentVersion'] },
          { name: 'b', currentVersion: { fileName: 'b.pdf', sizeBytes: 99 } as SharedDocumentSummary['currentVersion'] },
        ],
      },
    });
    const result = await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: [],
      jobs: [job('a.pdf'), job('b.pdf')],
    });
    expect(result.skipped).toEqual([{ path: 'a.pdf', reason: 'Đã có trong thư mục' }]);
    expect(uploads).toEqual([{ folderId: 'target', name: 'b.pdf', file: 'b.pdf' }]);
  });

  it('tên bị tài liệu người dùng không thấy giữ chỗ: thử tên kế tiếp', async () => {
    const { api, uploads } = fakeApi({ taken: { target: ['biên bản'] } });
    await runUpload(api, { targetFolderId: 'target', knownFolders: [TARGET], folders: [], jobs: [job('Biên bản.pdf')] });
    expect(uploads.map((upload) => upload.name)).toEqual(['Biên bản.pdf']);
  });

  it('tệp lỗi không dừng cả lượt, được liệt kê để tải lại', async () => {
    const { api, uploads } = fakeApi({ failOn: ['b.pdf'] });
    const result = await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: [],
      jobs: [job('a.pdf'), job('b.pdf'), job('c.pdf')],
    });
    expect(uploads.map((upload) => upload.file)).toEqual(['a.pdf', 'c.pdf']);
    expect(result.failures.map((failure) => [failure.job.path, failure.reason])).toEqual([
      ['b.pdf', 'Tải tệp lên thất bại (500).'],
    ]);
  });

  it('tải lại tệp hỏng giữa chừng: điền vào đúng tài liệu đã tạo, không tạo tài liệu mới', async () => {
    const first = fakeApi({ failOn: ['b.pdf'] });
    const failed = await runUpload(first.api, { targetFolderId: 'target', knownFolders: [TARGET], folders: [], jobs: [job('b.pdf')] });
    expect(failed.failures[0].job.pendingDocumentId).toBe('pending-b.pdf');

    const again = fakeApi();
    const result = await runUpload(again.api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: [],
      jobs: failed.failures.map((failure) => failure.job),
    });
    expect(again.uploads).toEqual([]);
    expect(again.resumed).toEqual([{ documentId: 'pending-b.pdf', file: 'b.pdf' }]);
    expect(result).toMatchObject({ uploaded: 1, failures: [], lastDocumentId: 'pending-b.pdf' });
  });

  it('tải lại cả thư mục ở lần khác: tài liệu cùng tên tệp còn chưa lên xong thì điền vào đó', async () => {
    const { api, uploads, resumed } = fakeApi({
      documents: {
        target: [{ id: 'hang', name: 'a', currentVersion: { fileName: 'a.pdf' } as SharedDocumentSummary['currentVersion'] }],
      },
    });
    await runUpload(api, { targetFolderId: 'target', knownFolders: [TARGET], folders: [], jobs: [job('a.pdf')] });
    expect(uploads).toEqual([]);
    expect(resumed).toEqual([{ documentId: 'hang', file: 'a.pdf' }]);
  });

  it('dừng giữa chừng: tệp đang tải xong nốt, tệp chưa tải vào danh sách để tải lại', async () => {
    const { api, uploads } = fakeApi();
    const progress: number[] = [];
    const result = await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: [],
      jobs: ['1', '2', '3', '4', '5'].map((name) => job(`${name}.pdf`)),
      shouldStop: () => uploads.length > 0,
      onProgress: (done) => progress.push(done),
    });
    // Ba tệp đã bắt đầu cùng lúc trước khi bấm dừng.
    expect(result.uploaded).toBe(3);
    expect(result.failures.map((failure) => [failure.job.path, failure.reason])).toEqual([
      ['4.pdf', 'Chưa tải'],
      ['5.pdf', 'Chưa tải'],
    ]);
    expect(Math.max(...progress)).toBe(3);
  });

  it('tên tự đặt cho một tệp: dùng đúng tên đó, trùng thì báo lỗi chứ không tự đổi', async () => {
    const { api, uploads } = fakeApi({ taken: { target: ['hđ 01'] } });
    const result = await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: [],
      jobs: [job('scan.pdf')],
      exactName: 'HĐ 01',
    });
    expect(uploads).toEqual([]);
    expect(result.failures[0].reason).toBe('Đã có mục tên "HĐ 01" ở cùng chỗ.');
  });

  it('lỗi khi dựng thư mục thì dừng trước khi tải tệp nào', async () => {
    const { api, uploads } = fakeApi();
    api.createFolder = async () => {
      throw { code: 'FORBIDDEN', message: 'Bạn không có quyền tạo thư mục trong “Tài liệu công ty”.' };
    };
    const plan = planFolderUpload([picked('Hồ sơ/a.pdf')], 0);
    await expect(
      runUpload(api, { targetFolderId: 'target', knownFolders: [TARGET], folders: plan.folders, jobs: plan.jobs }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(uploads).toEqual([]);
  });

  it('thư mục đã có mà danh sách đang cầm chưa thấy (lượt trước hỏng giữa chừng): đọc lại rồi nhập vào', async () => {
    const plan = planFolderUpload([picked('Hồ sơ/a.pdf')], 0);
    const { api, created, uploads } = fakeApi({ serverFolders: [folder('made-earlier', 'Hồ sơ', 'target')] });
    const result = await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: plan.folders,
      jobs: plan.jobs,
    });
    expect(created).toEqual([]);
    expect(uploads).toEqual([{ folderId: 'made-earlier', name: 'a', file: 'a.pdf' }]);
    expect(result.folderIds.get('Hồ sơ')).toBe('made-earlier');
  });

  it('tải lại dùng thư mục đã dựng ở lượt trước, không tạo lại', async () => {
    const plan = planFolderUpload([picked('Hồ sơ/a.pdf')], 0);
    const { api, created, uploads } = fakeApi();
    await runUpload(api, {
      targetFolderId: 'target',
      knownFolders: [TARGET],
      folders: plan.folders,
      jobs: plan.jobs,
      folderIds: new Map([['Hồ sơ', 'made-before']]),
    });
    expect(created).toEqual([]);
    expect(uploads[0].folderId).toBe('made-before');
  });
});
