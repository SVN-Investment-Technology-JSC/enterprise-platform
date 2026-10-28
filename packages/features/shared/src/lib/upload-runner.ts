import type { SharedDocumentSummary, SharedFolder } from '@enterprise-platform/contracts-shared';
import { documentNameCandidates, type PlannedFolder, type UploadJob, type UploadSkip } from './folder-upload.model';

/** Số tệp tải lên cùng lúc: đủ nhanh với thư mục nhiều tệp nhỏ, không dồn mạng khi tệp lớn. */
export const UPLOAD_CONCURRENCY = 3;

export interface UploadRunnerApi {
  createFolder(parentId: string, name: string): Promise<SharedFolder>;
  /** Thư mục người dùng thấy, đọc lại khi tạo thư mục báo trùng tên. */
  listFolders(): Promise<readonly SharedFolder[]>;
  /** Tài liệu đang dùng nằm thẳng trong thư mục. */
  listDocuments(folderId: string): Promise<readonly SharedDocumentSummary[]>;
  /**
   * Tạo tài liệu `name` trong `folderId` và tải tệp lên; trả id tài liệu. Hỏng
   * sau khi đã tạo tài liệu thì lỗi mang `documentId`.
   */
  uploadDocument(folderId: string, name: string, file: File): Promise<string>;
  /** Điền tệp vào tài liệu đã tạo mà tệp chưa lên xong (thêm phiên bản); trả id tài liệu. */
  resumeDocument(documentId: string, file: File): Promise<string>;
}

export interface UploadFailure {
  readonly job: UploadJob;
  readonly reason: string;
}

export interface UploadRunInput {
  readonly targetFolderId: string;
  /** Thư mục người dùng đang thấy, để nhập vào thư mục cùng tên thay vì tạo trùng. */
  readonly knownFolders: readonly SharedFolder[];
  readonly folders: readonly PlannedFolder[];
  readonly jobs: readonly UploadJob[];
  /** Thư mục đã có id từ lượt trước (thử lại), theo đường dẫn. */
  readonly folderIds?: ReadonlyMap<string, string>;
  /** Tên người dùng tự đặt cho một tệp: dùng đúng tên đó, trùng thì báo lỗi. */
  readonly exactName?: string;
  readonly shouldStop?: () => boolean;
  readonly onProgress?: (done: number, total: number, current?: string) => void;
}

export interface UploadRunResult {
  readonly uploaded: number;
  readonly skipped: readonly UploadSkip[];
  /** Tệp lỗi, và tệp chưa tải khi người dùng dừng giữa chừng. */
  readonly failures: readonly UploadFailure[];
  readonly folderIds: ReadonlyMap<string, string>;
  readonly lastDocumentId?: string;
}

/**
 * Tải một lượt: dựng các thư mục (cha trước con), rồi tải từng tệp vào đúng chỗ.
 *
 * Thư mục cùng tên đã có thì nhập vào. Tệp đã có trong thư mục (cùng tên tệp,
 * cùng dung lượng) thì bỏ qua, nên tải lại cả thư mục không sinh bản trùng; tài
 * liệu của tệp đó còn chưa lên xong (lượt trước hỏng giữa chừng) thì điền vào.
 * Tệp lỗi không dừng cả lượt; lỗi khi dựng thư mục thì dừng, vì tệp chưa có
 * chỗ để vào.
 */
export async function runUpload(api: UploadRunnerApi, input: UploadRunInput): Promise<UploadRunResult> {
  const folderIds = new Map(input.folderIds ?? []);
  const known = [...input.knownFolders];
  const created = new Set<string>();

  for (const planned of input.folders) {
    if (folderIds.has(planned.path)) continue;
    const parentId = planned.parentPath ? folderIds.get(planned.parentPath) : input.targetFolderId;
    if (!parentId) throw new Error(`Không dựng được thư mục “${planned.path}”.`);
    const sameIn = (list: readonly SharedFolder[]) =>
      list.find((folder) => folder.parentId === parentId && folder.name.toLowerCase() === planned.name.toLowerCase());
    const same = sameIn(known);
    if (same) {
      folderIds.set(planned.path, same.id);
      continue;
    }
    try {
      const folder = await api.createFolder(parentId, planned.name);
      known.push(folder);
      created.add(folder.id);
      folderIds.set(planned.path, folder.id);
    } catch (cause) {
      // Thư mục đã có mà danh sách đang cầm chưa thấy (lượt trước hỏng giữa chừng,
      // người khác vừa tạo): đọc lại rồi nhập vào. Không thấy (không được chia sẻ) thì báo lỗi.
      if ((cause as { code?: string } | null)?.code !== 'NAME_TAKEN') throw cause;
      const fresh = sameIn(await api.listFolders());
      if (!fresh) throw cause;
      known.push(fresh);
      folderIds.set(planned.path, fresh.id);
    }
  }

  const existing = new Map<string, Promise<readonly SharedDocumentSummary[]>>();
  const existingIn = (folderId: string) => {
    // Thư mục vừa tạo trong lượt này còn trống.
    if (created.has(folderId)) return Promise.resolve([]);
    let list = existing.get(folderId);
    if (!list) {
      list = api.listDocuments(folderId);
      existing.set(folderId, list);
    }
    return list;
  };
  const taken = new Map<string, Set<string>>();

  const skipped: UploadSkip[] = [];
  const failures: UploadFailure[] = [];
  let uploaded = 0;
  let lastDocumentId: string | undefined;
  let next = 0;
  let done = 0;
  const total = input.jobs.length;

  const uploadOne = async (job: UploadJob) => {
    const folderId = job.folderPath ? folderIds.get(job.folderPath) : input.targetFolderId;
    if (!folderId) throw new Error('Thư mục chưa dựng được.');
    if (job.pendingDocumentId) {
      lastDocumentId = await api.resumeDocument(job.pendingDocumentId, job.file);
      uploaded += 1;
      return;
    }
    if (input.exactName) {
      lastDocumentId = await api.uploadDocument(folderId, input.exactName, job.file);
      uploaded += 1;
      return;
    }
    const documents = await existingIn(folderId);
    const fileName = job.file.name.trim().toLowerCase();
    const sameFile = documents.filter(
      (document) => document.currentVersion?.fileName.trim().toLowerCase() === fileName,
    );
    if (sameFile.some((document) => document.currentVersion?.sizeBytes === job.file.size)) {
      skipped.push({ path: job.path, reason: 'Đã có trong thư mục' });
      return;
    }
    // Lần trước tạo tài liệu rồi hỏng giữa chừng (tệp chưa lên xong): điền vào đó, không tạo thêm.
    const pending = sameFile.find((document) => document.currentVersion?.sizeBytes == null);
    if (pending) {
      lastDocumentId = await api.resumeDocument(pending.id, job.file);
      uploaded += 1;
      return;
    }
    let used = taken.get(folderId);
    if (!used) {
      used = new Set(documents.map((document) => document.name.toLowerCase()));
      taken.set(folderId, used);
    }
    for (const name of documentNameCandidates(job.file.name)) {
      const key = name.toLowerCase();
      if (used.has(key)) continue;
      // Giữ chỗ tên trước khi chờ mạng: tệp khác đang tải song song không lấy trùng.
      used.add(key);
      try {
        lastDocumentId = await api.uploadDocument(folderId, name, job.file);
        uploaded += 1;
        return;
      } catch (cause) {
        // Tên bị tài liệu mình không thấy (độ mật cao hơn) giữ: thử tên kế tiếp.
        if ((cause as { code?: string } | null)?.code !== 'NAME_TAKEN') throw cause;
      }
    }
    throw new Error('Trùng tên với tài liệu đã có.');
  };

  const worker = async () => {
    while (next < total && !input.shouldStop?.()) {
      const job = input.jobs[next];
      next += 1;
      input.onProgress?.(done, total, job.path);
      try {
        await uploadOne(job);
      } catch (cause) {
        const pendingDocumentId = (cause as { documentId?: string } | null)?.documentId ?? job.pendingDocumentId;
        failures.push({ job: pendingDocumentId ? { ...job, pendingDocumentId } : job, reason: messageOf(cause) });
      }
      done += 1;
      input.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker));

  // Dừng giữa chừng: tệp chưa tải đưa vào danh sách để "Tải lại".
  for (const job of input.jobs.slice(next)) failures.push({ job, reason: 'Chưa tải' });
  return { uploaded, skipped, failures, folderIds, lastDocumentId };
}

function messageOf(cause: unknown): string {
  const message = (cause as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'Không tải lên được.';
}
