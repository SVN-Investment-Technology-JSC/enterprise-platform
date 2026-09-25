/**
 * Định dạng tiền VND.
 *
 * Hai kiểu: đầy đủ cho bảng chi tiết (`25.500.000.000 ₫`), rút gọn cho thẻ
 * KPI (`25,5 tỷ`). Thẻ KPI hẹp, và một con số 11 chữ số thì không ai đọc nhanh
 * được — nhưng bảng chi tiết thì phải đủ tới đồng, vì người đối chiếu cần số
 * chính xác.
 */

const BILLION = 1_000_000_000;
const MILLION = 1_000_000;
const THOUSAND = 1_000;

/** `25500000000` → `25.500.000.000 ₫`. Rỗng thì trả gạch ngang. */
export function formatVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * `25500000000` → `25,5 tỷ`; `850000000` → `850 triệu`.
 *
 * Giữ tối đa một chữ số thập phân và bỏ `,0` thừa: `25 tỷ`, không phải
 * `25,0 tỷ`. Số âm giữ dấu, vì lợi nhuận âm là thông tin, không phải lỗi.
 */
export function formatVndCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';

  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const scaled = (amount: number, unit: string) =>
    `${sign}${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(amount)} ${unit}`;

  if (abs >= BILLION) return scaled(abs / BILLION, 'tỷ');
  if (abs >= MILLION) return scaled(abs / MILLION, 'triệu');
  if (abs >= THOUSAND) return scaled(abs / THOUSAND, 'nghìn');
  return `${sign}${abs.toLocaleString('vi-VN')} đ`;
}

/** Phần trăm một chữ số: `21.2` → `21,2%`. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)}%`;
}

/**
 * Đọc số người dùng gõ vào ô tiền.
 *
 * Người Việt gõ `25.500.000.000` (dấu chấm ngăn nghìn) hoặc `25500000000`;
 * cả hai phải ra cùng một số. Dấu phẩy là phần thập phân. Ô trống trả
 * `null` — nghĩa là "xoá giá trị", khác với 0.
 *
 * Trả `undefined` khi chuỗi không đọc được, để form báo lỗi thay vì âm thầm
 * lưu một con số sai.
 */
export function parseVndInput(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/\s|₫|đ/gi, '');
  if (!trimmed) return null;
  const normalised = trimmed.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return undefined;
  return Number(normalised);
}

/** Số → chuỗi để điền sẵn vào ô nhập, theo đúng cách người dùng sẽ gõ. */
export function toVndInput(value: number | null | undefined): string {
  if (value == null) return '';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Chèn dấu chấm ngăn nghìn **ngay trong lúc gõ**.
 *
 * `10000000` thành `10.000.000` để người nhập nhìn ra ngay đang gõ mười triệu
 * hay một trăm triệu — đếm số 0 bằng mắt là cách chắc chắn nhập sai.
 *
 * Giữ nguyên phần thập phân người dùng đang gõ dở (`1.234,5`) và giữ cả dấu
 * phẩy cuối chuỗi, nếu không con trỏ sẽ bị chuỗi mới nhảy lung tung khi họ vừa
 * gõ dấu phân cách thập phân.
 */
export function formatVndWhileTyping(text: string): string {
  const cleaned = text.replace(/[^\d,-]/g, '');
  if (!cleaned) return '';
  const negative = cleaned.startsWith('-');
  const [rawWhole = '', ...rest] = cleaned.replace(/-/g, '').split(',');
  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  const grouped = whole ? new Intl.NumberFormat('vi-VN').format(Number(whole)) : '';
  const decimals = rest.length > 0 ? `,${rest.join('').slice(0, 2)}` : '';
  return `${negative ? '-' : ''}${grouped}${decimals}`;
}
