/**
 * Chi tiết đơn công tác gửi kèm `hrm.project_request.submitted` để Workspace hiện đầy đủ đơn trong dự án mà không
 * phải đọc bảng của HRM.
 *
 * HRM dịch sẵn thành danh sách "nhãn – giá trị" (như `requestTypeLabel`): Workspace chỉ lưu và hiển thị, không cần
 * biết đơn công tác có những trường nào, nên thêm trường mới ở đây không đụng tới Workspace.
 */

export interface RequestProjectDetail {
  readonly label: string;
  readonly value: string;
}

const TRIP_TYPE_LABELS: Readonly<Record<string, string>> = {
  DOMESTIC: 'Công tác trong nước (Nội địa)',
  OVERSEAS: 'Công tác nước ngoài (Quốc tế)',
  INTERSITE: 'Công tác nội bộ liên chi nhánh',
};

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `dd/MM/yyyy HH:mm` theo giờ Việt Nam. */
function formatDateTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

/** `YYYY-MM-DD` → `dd/MM/yyyy`. */
function formatDay(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function money(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toLocaleString('vi-VN')} đ` : '';
}

function yesNo(value: unknown): string | undefined {
  if (value === true) return 'Có';
  if (value === false) return 'Không';
  return undefined;
}

/**
 * Dựng chi tiết từ dòng `business_trip_requests` vừa ghi (đã gồm cột phương tiện) và `attributes` do form gửi.
 * Trường nào trống thì bỏ, để popup không hiện dòng "—".
 */
export function businessTripDetails(
  row: Record<string, unknown>,
  attributes: Record<string, unknown> = {},
): RequestProjectDetail[] {
  const details: RequestProjectDetail[] = [];
  const add = (label: string, value: unknown) => {
    const shown = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
    if (shown) details.push({ label, value: shown });
  };

  add('Hình thức công tác', TRIP_TYPE_LABELS[text(row.business_trip_type)] ?? text(row.business_trip_type));
  add('Địa điểm công tác', row.destination);
  add('Địa chỉ cụ thể', attributes.destinationAddress);
  add('Phòng ban công tác / cử đi', attributes.workDepartment);

  const from = formatDateTime(row.from_at) || formatDay(row.from_date);
  const to = formatDateTime(row.to_at) || formatDay(row.to_date);
  add('Từ', from);
  add('Đến', to);
  const days = Number(row.days_count);
  if (Number.isFinite(days) && days > 0) add('Số ngày công tác', `${days.toLocaleString('vi-VN')} ngày`);

  add('Lý do', row.reason_name);
  // Cột `reason` của đơn công tác là phần mô tả tự do người nộp nhập ("Nội dung công việc công tác").
  add('Nội dung công việc', row.reason);
  add('Cho phép làm thêm giờ', yesNo(row.allow_ot));

  const mode = text(row.transport_mode);
  if (mode === 'COMPANY_VEHICLE') add('Phương tiện di chuyển', 'Xe công ty');
  else if (mode === 'EXTERNAL') add('Phương tiện di chuyển', text(row.transport_detail) || 'Phương tiện ngoài');
  add('Yêu cầu chấm vân tay', yesNo(attributes.requiredFinger));

  const surcharges = Array.isArray(attributes.surcharges) ? attributes.surcharges : [];
  const lines = surcharges
    .map((entry) => {
      const item = (entry ?? {}) as { name?: unknown; amount?: unknown };
      const name = text(item.name);
      const amount = Number(item.amount) > 0 ? money(item.amount) : '';
      return [name, amount].filter(Boolean).join(': ');
    })
    .filter(Boolean);
  if (lines.length > 0) add('Phụ phí dự trù', lines.join('; '));
  if (Number(attributes.totalSurcharges) > 0) add('Tổng phụ phí dự trù', money(attributes.totalSurcharges));

  if (row.created_on_behalf === true) {
    const by = text(row.on_behalf_by_name);
    const why = text(row.on_behalf_reason);
    add('Đặt hộ', [by, why].filter(Boolean).join(' — ') || 'Có');
  }
  return details;
}
