/**
 * Công cụ xuất dữ liệu kho còn nằm trong localStorage của trình duyệt.
 *
 * Kiểm kê đã chuyển sang máy chủ nên giao diện không còn đọc khoá cũ; lô hàng
 * vẫn lưu cục bộ. Người dùng tải dữ liệu cũ về trước khi nó bị bỏ lại phía sau.
 * Đọc đúng các khoá mà `inventory-api.ts` từng/đang dùng.
 */
export const LOCAL_STOCKTAKES_KEY = 'ep:inventory:stocktakes';
export const LOCAL_STOCKTAKE_LINES_PREFIX = 'ep:inventory:stocktake_lines:';
export const LOCAL_LOTS_PREFIX = 'ep:inventory:lot_tracking:';
const NOTICE_DISMISSED_KEY = 'ep:inventory:local-export-notice-dismissed';

export interface LocalInventoryData {
  readonly exportedAt: string;
  readonly stocktakeSessions: unknown[];
  /** Khoá: id đợt kiểm kê cục bộ. */
  readonly stocktakeLines: Record<string, unknown[]>;
  /** Khoá: mã vật tư. */
  readonly lots: Record<string, unknown[]>;
}

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Trả về `null` khi không có gì (hoặc không truy cập được localStorage). */
export function readLocalInventoryData(): LocalInventoryData | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    const stocktakeSessions = parseArray(storage.getItem(LOCAL_STOCKTAKES_KEY));
    const stocktakeLines: Record<string, unknown[]> = {};
    const lots: Record<string, unknown[]> = {};
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      if (key.startsWith(LOCAL_STOCKTAKE_LINES_PREFIX)) {
        const rows = parseArray(storage.getItem(key));
        if (rows.length > 0) stocktakeLines[key.slice(LOCAL_STOCKTAKE_LINES_PREFIX.length)] = rows;
      } else if (key.startsWith(LOCAL_LOTS_PREFIX)) {
        const rows = parseArray(storage.getItem(key));
        if (rows.length > 0) lots[key.slice(LOCAL_LOTS_PREFIX.length)] = rows;
      }
    }
    if (
      stocktakeSessions.length === 0 &&
      Object.keys(stocktakeLines).length === 0 &&
      Object.keys(lots).length === 0
    ) {
      return null;
    }
    return { exportedAt: new Date().toISOString(), stocktakeSessions, stocktakeLines, lots };
  } catch {
    return null;
  }
}

export function isLocalExportNoticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissLocalExportNotice(): void {
  try {
    window.localStorage.setItem(NOTICE_DISMISSED_KEY, '1');
  } catch {
    /* không lưu được thì cảnh báo sẽ hiện lại lần sau */
  }
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportLocalInventoryJson(data: LocalInventoryData): void {
  download(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `kho-du-lieu-cuc-bo-${stamp()}.json`,
  );
}

function flatten(row: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((row ?? {}) as Record<string, unknown>)) {
    out[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  }
  return out;
}

export async function exportLocalInventoryExcel(data: LocalInventoryData): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const append = (name: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return;
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  };
  append('Dot_kiem_ke', data.stocktakeSessions.map(flatten));
  append(
    'Dong_kiem_ke',
    Object.entries(data.stocktakeLines).flatMap(([sessionId, rows]) =>
      rows.map((row) => ({ sessionId, ...flatten(row) })),
    ),
  );
  append(
    'Lo_hang',
    Object.entries(data.lots).flatMap(([materialCode, rows]) =>
      rows.map((row) => ({ materialCode, ...flatten(row) })),
    ),
  );
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  download(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `kho-du-lieu-cuc-bo-${stamp()}.xlsx`,
  );
}
