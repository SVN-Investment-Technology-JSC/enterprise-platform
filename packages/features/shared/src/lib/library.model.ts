import type { SharedFolder } from '@enterprise-platform/contracts-shared';

/** Một dòng của cây thư mục đã trải phẳng theo thứ tự hiển thị. */
export interface FolderTreeRow {
  readonly folder: SharedFolder;
  readonly level: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

/** Thư mục con trực tiếp, giữ thứ tự server đã sắp (theo tên, số tự nhiên). */
export function childrenOf(
  folders: readonly SharedFolder[],
  parentId: string | undefined,
): SharedFolder[] {
  return folders.filter((folder) => (folder.parentId ?? undefined) === parentId);
}

/** Chuỗi tổ tiên từ gốc tới thư mục (gồm cả nó). */
export function ancestry(folders: readonly SharedFolder[], folderId: string | undefined): SharedFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: SharedFolder[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  // Chặn vòng lặp nếu dữ liệu hỏng: không thư mục nào xuất hiện hai lần.
  while (current && !chain.includes(current)) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** Cây trải phẳng: chỉ đi vào nhánh đang mở. */
export function flattenTree(
  folders: readonly SharedFolder[],
  expanded: ReadonlySet<string>,
): FolderTreeRow[] {
  const parents = new Set(folders.map((folder) => folder.parentId).filter(Boolean));
  const rows: FolderTreeRow[] = [];
  const walk = (parentId: string | undefined, level: number) => {
    for (const folder of childrenOf(folders, parentId)) {
      const open = expanded.has(folder.id);
      rows.push({ folder, level, hasChildren: parents.has(folder.id), expanded: open });
      if (open) walk(folder.id, level + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

/** Thư mục và mọi thư mục con cháu — không được chọn làm chỗ chuyển tới của chính nó. */
export function branchIds(folders: readonly SharedFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Nhãn đường dẫn "3. HỢP ĐỒNG / HỒ SƠ 2026 / …" cho ô chọn thư mục. */
export function folderLabel(folders: readonly SharedFolder[], folderId: string): string {
  return ancestry(folders, folderId)
    .map((folder) => folder.name)
    .join(' / ');
}

/** `YYYY-MM-DD` hoặc ISO đầy đủ → `dd/mm/yyyy`. */
export function formatDate(value: string | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Ngày giờ ngắn kiểu "14/10/2026 09:42" theo giờ máy người xem. */
export function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Số ngày từ hôm nay tới ngày `YYYY-MM-DD`; âm là đã qua. */
export function daysUntil(value: string | undefined, today = new Date()): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86_400_000);
}

/** Mức cảnh báo hiệu lực: đã hết, sắp hết trong 60 ngày, hoặc bình thường. */
export function expiryTone(value: string | undefined, today = new Date()): 'expired' | 'soon' | 'normal' {
  const days = daysUntil(value, today);
  if (days === undefined) return 'normal';
  if (days < 0) return 'expired';
  return days <= 60 ? 'soon' : 'normal';
}

export type FileBadge = 'PDF' | 'DOC' | 'XLS' | 'PPT' | 'IMG' | 'ZIP' | 'DWG' | 'TXT' | 'TỆP';

/** Ô viết tắt loại tệp cạnh tên tài liệu. */
export function fileBadge(contentType: string | undefined, fileName = ''): FileBadge {
  const type = contentType ?? '';
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (type === 'application/pdf' || extension === 'pdf') return 'PDF';
  if (type.includes('word') || ['doc', 'docx', 'rtf'].includes(extension) || type === 'application/rtf') return 'DOC';
  if (type.includes('excel') || type.includes('spreadsheet') || ['xls', 'xlsx', 'csv'].includes(extension) || type === 'text/csv') return 'XLS';
  if (type.includes('powerpoint') || type.includes('presentation') || ['ppt', 'pptx'].includes(extension)) return 'PPT';
  if (type.startsWith('image/vnd.dwg') || type === 'application/acad' || extension === 'dwg') return 'DWG';
  if (type.startsWith('image/')) return 'IMG';
  if (type.includes('zip') || type.includes('rar') || ['zip', 'rar'].includes(extension)) return 'ZIP';
  if (type === 'text/plain' || extension === 'txt') return 'TXT';
  return 'TỆP';
}

/** Tên tài liệu gợi ý từ tên tệp: bỏ phần mở rộng. */
export function nameFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
}

/** Thẻ nhập dạng "220kV, thí nghiệm" → danh sách gọn, không trùng. */
export function parseTags(value: string): string[] {
  const tags: string[] = [];
  for (const raw of value.split(',')) {
    const tag = raw.trim();
    if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return tags;
}

/**
 * Kiểu tệp trình duyệt không nhận ra (thường gặp với .dwg, .rar trên Windows)
 * thì đoán theo phần mở rộng, để server không từ chối oan.
 */
export function contentTypeOf(file: Pick<File, 'name' | 'type'>): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const byExtension: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    rtf: 'application/rtf',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    dwg: 'image/vnd.dwg',
    csv: 'text/csv',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return byExtension[extension] ?? 'application/octet-stream';
}
