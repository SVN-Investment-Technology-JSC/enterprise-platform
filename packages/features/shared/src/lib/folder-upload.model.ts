import { formatBytes, SHARED_DOCUMENT_MAX_BYTES, SHARED_MAX_FOLDER_DEPTH } from '@enterprise-platform/contracts-shared';
import { nameFromFile } from './library.model';

/** Tệp hệ điều hành tự sinh trong thư mục, không phải tài liệu: bỏ qua khi tải cả thư mục. */
const SYSTEM_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export function isSystemFile(name: string): boolean {
  const lower = name.toLowerCase();
  // `~$…` là tệp khoá Office tạo ra khi tài liệu đang mở.
  return SYSTEM_FILE_NAMES.has(lower) || lower.startsWith('~$');
}

/** Một tệp sẽ tải lên. `folderPath` rỗng là thẳng vào thư mục đích. */
export interface UploadJob {
  readonly file: File;
  /** Đường dẫn hiển thị, kể cả tên tệp: "Hồ sơ/2026/HĐ01.pdf". */
  readonly path: string;
  readonly folderPath: string;
  /** Lượt trước đã tạo tài liệu nhưng tệp chưa lên xong: tải lại thì điền vào tài liệu này. */
  readonly pendingDocumentId?: string;
}

/** Thư mục cần có trước khi tải tệp: tạo mới, hoặc nhập vào thư mục cùng tên đã có. */
export interface PlannedFolder {
  readonly path: string;
  readonly name: string;
  /** Rỗng là thư mục đích. */
  readonly parentPath: string;
}

export interface UploadSkip {
  readonly path: string;
  readonly reason: string;
}

export interface FolderUploadPlan {
  /** Cha đứng trước con. */
  readonly folders: readonly PlannedFolder[];
  readonly jobs: readonly UploadJob[];
  readonly skipped: readonly UploadSkip[];
  readonly totalBytes: number;
  /** Lỗi chặn cả lượt: cây sâu quá giới hạn, tên thư mục quá dài. */
  readonly problem?: string;
}

/**
 * Kế hoạch tải cả thư mục từ danh sách tệp của `<input webkitdirectory>`: mỗi
 * tệp mang `webkitRelativePath` dạng "Hồ sơ/2026/HĐ01.pdf", đoạn đầu là thư mục
 * được chọn.
 *
 * `targetDepth` là độ sâu của thư mục đích; cây mới phải nằm trong giới hạn cấp
 * như khi tạo thư mục bằng tay. Tệp hệ thống bỏ qua lặng lẽ; tệp quá cỡ hay tên
 * quá dài bỏ qua và báo lại, không chặn cả lượt. Thứ tự theo đường dẫn, để tải
 * lại cùng thư mục thì tệp cùng tên khác đuôi nhận đúng tên như lần trước.
 */
export function planFolderUpload(files: readonly File[], targetDepth: number): FolderUploadPlan {
  const folders = new Map<string, PlannedFolder>();
  const jobs: UploadJob[] = [];
  const skipped: UploadSkip[] = [];
  let totalBytes = 0;
  let problem: string | undefined;

  const entries = files
    .map((file) => ({ file, segments: splitPath(file.webkitRelativePath || file.name) }))
    .filter((entry) => entry.segments.length > 0)
    .map((entry) => ({ ...entry, path: entry.segments.join('/') }))
    .sort((a, b) => a.path.localeCompare(b.path, 'vi', { numeric: true }));

  for (const { file, segments, path } of entries) {
    const name = segments[segments.length - 1];
    if (isSystemFile(name)) continue;
    if (file.size > SHARED_DOCUMENT_MAX_BYTES) {
      skipped.push({ path, reason: `Vượt quá ${formatBytes(SHARED_DOCUMENT_MAX_BYTES)}` });
      continue;
    }
    if (name.length > 255) {
      skipped.push({ path, reason: 'Tên tệp dài quá 255 ký tự' });
      continue;
    }
    const dirs = segments.slice(0, -1);
    dirs.forEach((dir, index) => {
      const folderPath = dirs.slice(0, index + 1).join('/');
      if (folders.has(folderPath)) return;
      if (dir.length > 180) problem ??= `Tên thư mục “${dir.slice(0, 60)}…” dài quá 180 ký tự.`;
      if (targetDepth + index + 1 > SHARED_MAX_FOLDER_DEPTH - 1) {
        problem ??= `Cây thư mục tối đa ${SHARED_MAX_FOLDER_DEPTH} cấp, “${folderPath}” vượt quá.`;
      }
      folders.set(folderPath, { path: folderPath, name: dir, parentPath: dirs.slice(0, index).join('/') });
    });
    jobs.push({ file, path, folderPath: dirs.join('/') });
    totalBytes += file.size;
  }
  return { folders: [...folders.values()], jobs, skipped, totalBytes, problem };
}

/** "Hồ sơ//2026 /a.pdf" → ["Hồ sơ", "2026", "a.pdf"]; tên được cắt khoảng trắng như phía server. */
function splitPath(path: string): string[] {
  return path
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Tên tài liệu theo thứ tự thử cho một tệp: tên bỏ đuôi; trùng thì nguyên tên
 * tệp (tệp cùng tên khác đuôi, "Biên bản.pdf" và "Biên bản.docx"); vẫn trùng
 * thì đánh số.
 */
export function documentNameCandidates(fileName: string): string[] {
  const full = fileName.trim();
  const base = nameFromFile(full) || full;
  const names = base === full ? [full] : [base, full];
  for (let index = 2; index <= 9; index += 1) names.push(`${base} (${index})`);
  return names;
}
