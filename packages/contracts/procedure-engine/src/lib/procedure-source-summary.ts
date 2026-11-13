/**
 * Thông tin nguồn của hồ sơ Quy trình (CRM phase 3, plan mục 17.1, D3-31): phân hệ mở hồ sơ gửi kèm tóm tắt chứng từ gốc
 * (nhãn - giá trị) và đường dẫn về chứng từ, để người duyệt biết đang duyệt gì. Chỉ là thông tin hiển thị: chữ thuần, không
 * HTML, không ảnh hưởng luồng hồ sơ. Hàm kiểm dùng chung cho phía gửi và phía Quy trình.
 */

export interface ProcedureSourceSummaryItem {
  readonly label: string;
  readonly value: string;
}

export interface ProcedureSourceSummary {
  /** Tiêu đề khối, ví dụ "Báo giá BG2600401 v2". */
  readonly title?: string;
  readonly items: readonly ProcedureSourceSummaryItem[];
  /** Đường dẫn nội bộ về chứng từ gốc, bắt đầu bằng `/` (ví dụ `/modules/crm#quotes/<id>`); mở cùng tab. */
  readonly url?: string;
  /** Nhãn nút mở chứng từ, ví dụ "Mở báo giá trong Bán hàng". */
  readonly urlLabel?: string;
}

export const PROCEDURE_SOURCE_SUMMARY_LIMITS = {
  items: 30,
  label: 100,
  value: 1000,
  title: 200,
  url: 500,
  urlLabel: 100,
} as const;

export interface ProcedureSourceSummaryError {
  /** Đường dẫn trường, ví dụ `items[3].label`, `url`. */
  readonly path: string;
  readonly message: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim().normalize('NFC') : '');

/** Đường dẫn nội bộ an toàn: bắt đầu bằng một `/`, không có scheme, không có ký tự điều khiển, không có `\`. */
export function isInternalPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return false;
  }
  // Bắt đầu bằng một `/` thì trình duyệt luôn hiểu là đường dẫn cùng trang web (kể cả `/javascript:x`); chặn thêm dạng
  // `/http://...` cho dễ đọc, tránh nhầm là link ngoài.
  return !/^\/[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Kiểm và chuẩn hoá thông tin nguồn: cắt khoảng trắng, bỏ dòng rỗng cả nhãn lẫn giá trị; quá giới hạn hoặc link không phải
 * đường dẫn nội bộ thì báo lỗi tiếng Việt. Đầu vào rỗng (`null`, `undefined`) là không có thông tin nguồn.
 */
export function validateProcedureSourceSummary(input: unknown):
  | { readonly ok: true; readonly summary: ProcedureSourceSummary | null }
  | { readonly ok: false; readonly errors: readonly ProcedureSourceSummaryError[] } {
  if (input === null || input === undefined) return { ok: true, summary: null };
  const errors: ProcedureSourceSummaryError[] = [];
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ path: '', message: 'Thông tin nguồn không đúng định dạng.' }] };
  }
  const source = input as Record<string, unknown>;
  const L = PROCEDURE_SOURCE_SUMMARY_LIMITS;

  const title = text(source['title']);
  if (title.length > L.title) errors.push({ path: 'title', message: `Tiêu đề thông tin nguồn tối đa ${L.title} ký tự.` });

  const rawItems = source['items'];
  if (rawItems !== undefined && !Array.isArray(rawItems)) errors.push({ path: 'items', message: 'Danh sách thông tin nguồn không đúng định dạng.' });
  const list = Array.isArray(rawItems) ? rawItems : [];
  const items: ProcedureSourceSummaryItem[] = [];
  list.forEach((raw, index) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const label = text(item['label']);
    const value = text(item['value']);
    if (!label && !value) return;
    if (!label) errors.push({ path: `items[${index}].label`, message: `Dòng ${index + 1}: thiếu nhãn.` });
    if (label.length > L.label) errors.push({ path: `items[${index}].label`, message: `Dòng ${index + 1}: nhãn tối đa ${L.label} ký tự.` });
    if (value.length > L.value) errors.push({ path: `items[${index}].value`, message: `Dòng ${index + 1}: giá trị tối đa ${L.value} ký tự.` });
    items.push({ label, value });
  });
  if (items.length > L.items) errors.push({ path: 'items', message: `Thông tin nguồn tối đa ${L.items} dòng.` });

  const url = text(source['url']);
  if (url && (url.length > L.url || !isInternalPath(url))) {
    errors.push({ path: 'url', message: 'Đường dẫn chứng từ phải là đường dẫn nội bộ bắt đầu bằng "/", tối đa 500 ký tự.' });
  }
  const urlLabel = text(source['urlLabel']);
  if (urlLabel.length > L.urlLabel) errors.push({ path: 'urlLabel', message: `Nhãn nút mở chứng từ tối đa ${L.urlLabel} ký tự.` });

  if (errors.length) return { ok: false, errors };
  if (!title && !items.length && !url) return { ok: true, summary: null };
  return {
    ok: true,
    summary: {
      ...(title ? { title } : {}),
      items,
      ...(url ? { url } : {}),
      ...(url && urlLabel ? { urlLabel } : {}),
    },
  };
}
