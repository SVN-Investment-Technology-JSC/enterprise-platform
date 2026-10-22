import {
  DEFAULT_SIZE,
  LIMITS,
  createDocument,
  importSvg,
  normalizeLibrary,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';

/** Nội dung một tệp người dùng chọn để nhập vào thư viện. */
export interface ImportFileInput {
  readonly name: string;
  readonly text: string;
}

export interface ImportReport {
  /** Icon đọc được từ mọi tệp, chưa so với thư viện hiện có. */
  readonly docs: IconDocument[];
  /** Số mục trong tệp JSON sai định dạng nên bị bỏ qua. */
  readonly skipped: number;
  /** Mỗi tệp không đọc được kèm lý do ngắn. */
  readonly failures: ReadonlyArray<{ readonly file: string; readonly reason: string }>;
  /** Lưu ý khi đọc SVG (màu chuyển sắc, phần tử không hỗ trợ...). Đã gộp, không trùng. */
  readonly warnings: string[];
}

export interface ImportPlan {
  /** Icon thật sự thêm mới. */
  readonly fresh: IconDocument[];
  /** Icon giống hệt icon đã có (cùng mã, cùng nội dung) nên không thêm lần nữa. */
  readonly duplicates: number;
  /** Icon bị bỏ vì thư viện đã đầy (vượt giới hạn số icon). */
  readonly overflow: number;
}

export type NoticeTone = 'ok' | 'warn' | 'error';

export interface ImportNotice {
  readonly tone: NoticeTone;
  readonly text: string;
  /** Chi tiết ngắn (tối đa vài dòng) hiện dưới thông báo chính. */
  readonly details: string[];
}

const MAX_DETAILS = 4;

/** "cloud-upload_2.svg" thành "cloud upload 2". */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const spaced = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (spaced || 'Icon nhập').slice(0, 80);
}

type FileKind = 'svg' | 'json';

function kindOf(file: ImportFileInput): FileKind | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.json')) return 'json';
  const head = file.text.trimStart().slice(0, 1);
  if (head === '<') return 'svg';
  if (head === '[' || head === '{') return 'json';
  return null;
}

/** Một tệp SVG thành một icon nháp tuỳ biến, tên lấy theo tên tệp. */
export function documentFromSvg(markup: string, fileName: string): { doc: IconDocument; warnings: string[] } {
  const result = importSvg(markup, { size: DEFAULT_SIZE });
  const doc = createDocument({ name: nameFromFile(fileName), shapes: result.shapes, category: 'custom', status: 'draft' });
  return { doc, warnings: result.warnings };
}

/** Tệp JSON: một mảng icon, `{ icons: [...] }`, hoặc một icon đơn lẻ. */
function parseJsonDocs(text: string): { docs: IconDocument[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('không phải JSON hợp lệ');
  }
  const single =
    typeof data === 'object' && data !== null && !Array.isArray(data) && !('icons' in data) && ('shapes' in data || 'glyphPath' in data);
  try {
    return normalizeLibrary(single ? [data] : data);
  } catch {
    throw new Error('không phải thư viện icon');
  }
}

/**
 * Đọc nhiều tệp (SVG và/hoặc JSON sao lưu). Tệp lỗi không làm hỏng các tệp còn lại; lý do được ghi vào `failures`.
 * Cần môi trường có DOMParser (trình duyệt, jsdom) để đọc SVG.
 */
export function readImportFiles(files: readonly ImportFileInput[]): ImportReport {
  const docs: IconDocument[] = [];
  const failures: Array<{ file: string; reason: string }> = [];
  const warnings = new Set<string>();
  let skipped = 0;

  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      failures.push({ file: file.name, reason: 'chỉ nhận tệp .svg hoặc .json' });
      continue;
    }
    try {
      if (kind === 'svg') {
        const { doc, warnings: found } = documentFromSvg(file.text, file.name);
        docs.push(doc);
        for (const warning of found) warnings.add(warning);
      } else {
        const parsed = parseJsonDocs(file.text);
        docs.push(...parsed.docs);
        skipped += parsed.skipped;
        if (parsed.docs.length === 0) failures.push({ file: file.name, reason: 'không có icon hợp lệ' });
      }
    } catch (error) {
      failures.push({ file: file.name, reason: error instanceof Error ? error.message : 'không đọc được' });
    }
  }
  return { docs, skipped, failures, warnings: [...warnings] };
}

/** JSON có khoá sắp theo thứ tự chữ cái, để hai đối tượng cùng nội dung luôn ra cùng chuỗi dù khoá xếp khác nhau. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Dấu vân tay của nội dung icon; bỏ mã lớp hình vì icon mẫu sinh mã lớp mới mỗi lần dựng. */
function fingerprint(doc: IconDocument): string {
  return stableStringify([
    doc.name,
    doc.description,
    doc.category,
    doc.tags,
    doc.status,
    doc.size,
    doc.shapes.map((shape) => ({ ...shape, id: undefined })),
  ]);
}

/** Bỏ các icon đã có sẵn giống hệt (nhập lại bản sao lưu của chính thư viện này không sinh bản trùng). */
export function planImport(
  existing: readonly IconDocument[],
  incoming: readonly IconDocument[],
  limit: number = LIMITS.maxIcons,
): ImportPlan {
  const known = new Map(existing.map((doc) => [doc.id, fingerprint(doc)]));
  const candidates: IconDocument[] = [];
  let duplicates = 0;
  for (const doc of incoming) {
    if (known.get(doc.id) === fingerprint(doc)) duplicates += 1;
    else candidates.push(doc);
  }
  const room = Math.max(0, limit - existing.length);
  return { fresh: candidates.slice(0, room), duplicates, overflow: Math.max(0, candidates.length - room) };
}

/** Thông báo kết quả nhập, ngắn gọn; chi tiết lỗi từng tệp nằm ở `details`. */
export function describeImport(report: ImportReport, plan: ImportPlan): ImportNotice {
  const added = plan.fresh.length;
  const parts: string[] = [];
  if (added > 0) parts.push(`Đã nhập ${added} icon`);
  if (plan.duplicates > 0) parts.push(`${plan.duplicates} icon đã có sẵn`);
  if (plan.overflow > 0) parts.push(`${plan.overflow} icon vượt giới hạn ${LIMITS.maxIcons} icon của thư viện`);
  if (report.skipped > 0) parts.push(`bỏ qua ${report.skipped} mục lỗi`);
  if (report.failures.length > 0) parts.push(`${report.failures.length} tệp lỗi`);
  if (parts.length === 0) parts.push('Không có icon nào để nhập');

  const text = parts.join(', ').replace(/^./, (char) => char.toUpperCase()) + '.';
  const problems = report.skipped > 0 || plan.overflow > 0 || report.failures.length > 0 || report.warnings.length > 0;
  const tone: NoticeTone = added > 0 ? (problems ? 'warn' : 'ok') : report.failures.length > 0 || report.docs.length === 0 ? 'error' : 'ok';

  const details = [
    ...report.failures.map((failure) => `${failure.file}: ${failure.reason}`),
    ...report.warnings,
  ];
  return {
    tone,
    text,
    details: details.length > MAX_DETAILS ? [...details.slice(0, MAX_DETAILS), `và ${details.length - MAX_DETAILS} mục khác`] : details,
  };
}

/** Sao lưu toàn bộ thư viện: mảng JSON, nhập lại được bằng chính trang này. */
export function serializeLibrary(docs: readonly IconDocument[]): string {
  return JSON.stringify(docs, null, 2);
}

export function backupFileName(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `svndts-brand-icons-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}
