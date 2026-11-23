import { isSystemFile, type PickedEntry } from './folder-upload.model';

/** Một tệp sẽ tải lên NAS; `folder` tính từ thư mục đích, rỗng là thẳng vào đó. */
export interface NasUploadJob {
  readonly file: File;
  readonly folder: string;
  readonly name: string;
}

export interface NasUploadPlan {
  readonly jobs: readonly NasUploadJob[];
  /** Thư mục rỗng phải tạo riêng (thư mục có tệp thì NAS tự tạo khi tải tệp vào); cha đứng trước con. */
  readonly emptyFolders: readonly string[];
  /** Tệp hệ thống (.DS_Store, Thumbs.db, ~$…) bỏ qua. */
  readonly skipped: number;
  readonly totalBytes: number;
}

const joinPath = (...parts: readonly string[]) => parts.filter(Boolean).join('/');

/**
 * Kế hoạch tải lên Kho NAS từ những gì vừa chọn hoặc kéo thả: tệp lẻ vào thẳng thư mục
 * đích, thư mục giữ nguyên cây. `target` là thư mục đích (tính trong thư mục chia sẻ).
 */
export function planNasUpload(entries: readonly PickedEntry[], target: string): NasUploadPlan {
  const jobs: NasUploadJob[] = [];
  const folders = new Set<string>();
  let skipped = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    if (!entry.file) {
      if (parts.length > 0) folders.add(parts.join('/'));
      continue;
    }
    const name = parts.pop() ?? entry.file.name;
    if (isSystemFile(name)) {
      skipped += 1;
      continue;
    }
    jobs.push({ file: entry.file, folder: joinPath(target, parts.join('/')), name });
    totalBytes += entry.file.size;
  }
  // Thư mục đã có tệp ở trong (hay ở thư mục con) thì NAS tự tạo khi tải tệp vào.
  const covered = (folder: string) =>
    jobs.some((job) => {
      const relative = target ? job.folder.slice(target.length + 1) : job.folder;
      return job.folder === joinPath(target, folder) || relative.startsWith(`${folder}/`);
    });
  const emptyFolders = [...folders]
    .filter((folder) => !covered(folder))
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
    .map((folder) => joinPath(target, folder));
  return { jobs, emptyFolders, skipped, totalBytes };
}
