import {
  BRAND_ERROR_CODES,
  BRAND_SPEC_MAX_BYTES,
  LIMITS,
  type BrandErrorCode,
} from '@enterprise-platform/shared-brand-icon';

/** Lỗi nghiệp vụ của Brand Studio; controller đổi nó thành HTTP `{ statusCode, code, message }`. */
export class BrandError extends Error {
  constructor(
    readonly status: number,
    readonly code: BrandErrorCode,
    message: string,
    /** Trường bổ sung đưa vào thân lỗi, ví dụ `currentVersion` khi xung đột. */
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'BrandError';
  }
}

/** DB báo trùng khoá duy nhất: `id` (mã icon), `slug` hoặc `version`. */
export class BrandStoreConflictError extends Error {
  constructor(readonly kind: 'id' | 'slug' | 'version') {
    super(`Brand store unique violation on ${kind}`);
    this.name = 'BrandStoreConflictError';
  }
}

/** DB không lấy được khoá hàng trong thời hạn (người khác đang lưu cùng icon). */
export class BrandStoreBusyError extends Error {
  constructor() {
    super('Brand store lock not available');
    this.name = 'BrandStoreBusyError';
  }
}

const E = BRAND_ERROR_CODES;

export const brandErrors = {
  unauthorized: () =>
    new BrandError(401, E.unauthorized, 'Vui lòng đăng nhập để tiếp tục.'),
  forbidden: () =>
    new BrandError(
      403,
      E.forbidden,
      'Chỉ quản trị Platform được dùng chức năng này.',
    ),
  csrfInvalid: () =>
    new BrandError(
      403,
      E.csrfInvalid,
      'Phiên làm việc không hợp lệ. Hãy tải lại trang rồi thử lại.',
    ),
  requestInvalid: (message: string) =>
    new BrandError(400, E.requestInvalid, message),
  iconInvalid: (message: string) => new BrandError(400, E.iconInvalid, message),
  iconIdMismatch: () =>
    new BrandError(
      400,
      E.iconIdMismatch,
      'Mã icon trong nội dung không khớp với đường dẫn.',
    ),
  iconNotFound: () =>
    new BrandError(404, E.iconNotFound, 'Không tìm thấy icon.'),
  versionNotFound: () =>
    new BrandError(
      404,
      E.versionNotFound,
      'Không tìm thấy phiên bản này của icon.',
    ),
  iconExists: () =>
    new BrandError(409, E.iconExists, 'Mã icon này đã tồn tại.'),
  iconArchived: () =>
    new BrandError(
      409,
      E.iconArchived,
      'Icon đã được lưu trữ. Hãy khôi phục trước khi chỉnh sửa hoặc phát hành.',
    ),
  iconBusy: () =>
    new BrandError(
      409,
      E.iconBusy,
      'Icon đang được lưu ở nơi khác. Vui lòng thử lại sau giây lát.',
    ),
  iconLimitReached: () =>
    new BrandError(
      409,
      E.iconLimitReached,
      `Đã đạt tối đa ${LIMITS.maxIcons} icon. Hãy lưu trữ hoặc dọn bớt icon cũ.`,
    ),
  iconNotPublishable: (reasons: readonly string[]) =>
    new BrandError(
      422,
      E.iconNotPublishable,
      `Icon chưa đạt điều kiện phát hành: ${reasons.join(' ')}`,
      { reasons },
    ),
  versionConflict: (currentVersion: number) =>
    new BrandError(
      409,
      E.versionConflict,
      'Icon đã có phiên bản mới hơn do người khác lưu. Hãy tải lại icon trước khi lưu.',
      { currentVersion },
    ),
  standardsInvalid: (message: string) =>
    new BrandError(400, E.standardsInvalid, message),
  standardsConflict: (currentVersion: number) =>
    new BrandError(
      409,
      E.standardsConflict,
      'Bảng màu và quy chuẩn đã được người khác cập nhật. Hãy tải lại trước khi lưu.',
      { currentVersion },
    ),
  payloadTooLarge: () =>
    new BrandError(
      413,
      E.payloadTooLarge,
      `Icon quá lớn (tối đa ${Math.round(BRAND_SPEC_MAX_BYTES / 1024)} KB). Hãy bớt lớp hình hoặc điểm neo.`,
    ),
  storageUnavailable: () =>
    new BrandError(
      503,
      E.storageUnavailable,
      'Kho lưu trữ icon tạm thời không khả dụng. Vui lòng thử lại sau.',
    ),
  storageCorrupt: () =>
    new BrandError(
      502,
      E.storageCorrupt,
      'Dữ liệu icon trong kho bị thiếu hoặc hỏng. Hãy báo quản trị hệ thống.',
    ),
  databaseUnavailable: () =>
    new BrandError(
      503,
      E.databaseUnavailable,
      'Cơ sở dữ liệu tạm thời không khả dụng. Vui lòng thử lại sau.',
    ),
  internal: () =>
    new BrandError(
      500,
      E.internal,
      'Có lỗi hệ thống khi xử lý icon. Vui lòng thử lại.',
    ),
} as const;

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

/**
 * Lỗi mất kết nối tới Postgres (từ chối kết nối, hết thời gian chờ kết nối, DB đang khởi động lại, hết kết nối)
 * khác với lỗi truy vấn: người dùng chỉ cần thử lại sau.
 */
export function isDatabaseConnectionError(error: unknown): boolean {
  const { code, message } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
  };
  if (
    typeof code === 'string' &&
    (CONNECTION_ERROR_CODES.has(code) || code.startsWith('08'))
  )
    return true;
  return (
    typeof message === 'string' &&
    /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/i.test(
      message,
    )
  );
}
