import type { SharedFolder } from '@enterprise-platform/contracts-shared';
import { useState, type DragEvent as ReactDragEvent } from 'react';
import type { PickedEntry } from './folder-upload.model';

/** Đang kéo tệp, thư mục từ máy (không phải chữ hay phần tử trong trang). */
export function draggingFiles(event: { readonly dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Bộ xử lý kéo thả tệp cho một vùng nhận. `accept` quyết định vùng có nhận hay
 * không (quyền ghi); `onHover` bật, tắt viền khi đang kéo ngang qua.
 */
export function fileDropHandlers<T extends HTMLElement>(options: {
  readonly accept: () => boolean;
  readonly onHover: (over: boolean) => void;
  readonly onDrop: (dataTransfer: DataTransfer) => void;
}) {
  const take = (event: ReactDragEvent<T>) => {
    if (!draggingFiles(event) || !options.accept()) return false;
    event.preventDefault();
    // Vùng trong (dòng thư mục) nhận rồi thì vùng ngoài (cả bảng) không nhận nữa.
    event.stopPropagation();
    return true;
  };
  return {
    onDragEnter: (event: ReactDragEvent<T>) => {
      if (take(event)) options.onHover(true);
    },
    onDragOver: (event: ReactDragEvent<T>) => {
      if (!take(event)) return;
      event.dataTransfer.dropEffect = 'copy';
      options.onHover(true);
    },
    onDragLeave: (event: ReactDragEvent<T>) => {
      // Sang phần tử con vẫn là còn trong vùng.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      options.onHover(false);
    },
    onDrop: (event: ReactDragEvent<T>) => {
      if (!take(event)) return;
      options.onHover(false);
      options.onDrop(event.dataTransfer);
    },
  };
}

/** Nhận tệp kéo từ máy thả vào thư mục. `undefined` là gốc kho, hay chỗ trống của thư mục đang mở. */
export interface FolderDrop {
  readonly accepts: (folder: SharedFolder | undefined) => boolean;
  readonly onDrop: (folder: SharedFolder | undefined, dataTransfer: DataTransfer) => void;
}

/**
 * Vùng thả cho các dòng thư mục của một danh sách (cây, bảng): `on(key, folder)`
 * trả bộ xử lý của một dòng, `over` là khoá của dòng đang được kéo ngang qua.
 */
export function useFolderDrop(drop: FolderDrop | undefined) {
  const [over, setOver] = useState<string>();
  const on = <T extends HTMLElement>(key: string, folder: SharedFolder | undefined) =>
    drop
      ? fileDropHandlers<T>({
          accept: () => drop.accepts(folder),
          onHover: (hovering) => setOver((current) => (hovering ? key : current === key ? undefined : current)),
          onDrop: (dataTransfer) => drop.onDrop(folder, dataTransfer),
        })
      : undefined;
  return { over: drop ? over : undefined, on };
}

/**
 * Thả tệp trượt ra ngoài vùng nhận thì trình duyệt mở tệp đó, rời khỏi trang:
 * chặn ở cấp cửa sổ, con trỏ hiện "không thả được". Trả hàm gỡ.
 */
export function guardWindowFileDrop(target: Window = window): () => void {
  const guard = (event: DragEvent) => {
    if (event.defaultPrevented || !draggingFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragover', guard);
  target.addEventListener('drop', guard);
  return () => {
    target.removeEventListener('dragover', guard);
    target.removeEventListener('drop', guard);
  };
}

/**
 * Những gì vừa thả: tệp lẻ, và thư mục đọc đệ quy (kể cả thư mục rỗng), mỗi mục
 * giữ đường dẫn tính từ chỗ thả.
 *
 * Phải gọi ngay trong sự kiện `drop`: qua sự kiện là trình duyệt khoá danh sách
 * mục, nên phần lấy mục chạy trước lần `await` đầu tiên.
 */
export async function readDrop(dataTransfer: DataTransfer): Promise<PickedEntry[]> {
  const roots = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  const files = Array.from(dataTransfer.files ?? []);
  if (roots.length === 0 || roots.some((entry) => !entry)) {
    // Trình duyệt không cho đọc thư mục: chỉ còn các tệp lẻ.
    return files.map((file) => ({ file, path: file.name }));
  }
  const picked: PickedEntry[] = [];
  await Promise.all((roots as FileSystemEntry[]).map((entry) => walk(entry, picked)));
  return picked;
}

/** Thứ tự các mục không quan trọng: kế hoạch tải xếp lại theo đường dẫn. */
async function walk(entry: FileSystemEntry, out: PickedEntry[]): Promise<void> {
  const path = entry.fullPath.replace(/^\/+/, '');
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path });
    return;
  }
  if (!entry.isDirectory) return;
  out.push({ path });
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // `readEntries` trả từng lô (Chrome 100 mục một lô): đọc tới khi hết.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return;
    await Promise.all(batch.map((child) => walk(child, out)));
  }
}
