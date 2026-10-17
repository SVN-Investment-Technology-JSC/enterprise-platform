/**
 * Tin nhắn `postMessage` giữa khung ERP (ModuleShell) và khung chat Trợ lý nhúng trong iframe.
 *
 * Luồng một thao tác: Trợ lý gửi `action` kèm bản nháp → khung ERP tìm phân hệ đã đăng ký thao tác đó và mở popup
 * của phân hệ với dữ liệu điền sẵn → người dùng lưu hoặc đóng → khung ERP trả `result` để Trợ lý báo lại.
 * Bên nhận luôn kiểm `event.origin` trước khi đọc, và chỉ tin tin nhắn qua `isAssistantFrameMessage`.
 */
export const ASSISTANT_MESSAGE = {
  /** Khung ERP báo trang đang mở (đường dẫn kèm query và hash). */
  page: 'savina-assistant:page',
  /** Khung chat đã sẵn sàng nhận tin. */
  ready: 'savina-assistant:ready',
  /** Khung chat xin đóng ngăn Trợ lý. */
  close: 'savina-assistant:close',
  /** Trợ lý xin mở popup của một thao tác. */
  action: 'savina-assistant:action',
  /** Khung ERP trả kết quả của thao tác. */
  result: 'savina-assistant:result',
  /** Khung ERP báo quyền trong công ty vừa đổi: khung chat lấy lại danh sách phím tắt. */
  refresh: 'savina-assistant:refresh',
} as const;

export type AssistantMessageType =
  (typeof ASSISTANT_MESSAGE)[keyof typeof ASSISTANT_MESSAGE];

export interface AssistantActionRequest {
  /** `key` của thao tác đã khai báo bằng `defineAssistantActions`. */
  readonly key: string;
  /** Do Trợ lý sinh, để ghép kết quả trả về với yêu cầu. */
  readonly requestId: string;
  /**
   * Giá trị điền sẵn theo tên trường của request; popup vẫn kiểm lại như khi người dùng tự nhập. Gửi lại cùng
   * `requestId` khi form đang mở thì chỉ cập nhật các ô có trong bản nháp.
   */
  readonly draft: Readonly<Record<string, unknown>>;
  /** Trang có form, để khung ERP chuyển tới khi màn hình hiện tại không có thao tác này. */
  readonly page?: string;
  /** Mã biến thể (loại đơn tuỳ chỉnh, quy trình) khi thao tác khai `variants`. */
  readonly variant?: string;
}

/**
 * - `saved`: người dùng đã lưu.
 * - `cancelled`: người dùng đóng popup.
 * - `unavailable`: trang hiện tại không có thao tác này, hoặc người dùng không có quyền.
 * - `failed`: lưu lỗi; `message` là câu đọc được cho người dùng.
 */
export type AssistantActionOutcome = 'saved' | 'cancelled' | 'unavailable' | 'failed';

export interface AssistantActionResult {
  readonly requestId: string;
  readonly key: string;
  readonly outcome: AssistantActionOutcome;
  /** Mã bản ghi vừa tạo hoặc sửa, khi `saved`. */
  readonly id?: string;
  /** Tên ngắn của bản ghi để Trợ lý nhắc lại, ví dụ tiêu đề cuộc họp. */
  readonly label?: string;
  /** Đường dẫn mở bản ghi trong ERP. */
  readonly href?: string;
  readonly message?: string;
}

export type AssistantFrameMessage =
  | { readonly type: typeof ASSISTANT_MESSAGE.page; readonly page: string }
  | { readonly type: typeof ASSISTANT_MESSAGE.ready }
  | { readonly type: typeof ASSISTANT_MESSAGE.close }
  | { readonly type: typeof ASSISTANT_MESSAGE.refresh }
  | ({ readonly type: typeof ASSISTANT_MESSAGE.action } & AssistantActionRequest)
  | ({ readonly type: typeof ASSISTANT_MESSAGE.result } & AssistantActionResult);

const OUTCOMES: readonly string[] = ['saved', 'cancelled', 'unavailable', 'failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Kiểm hình dạng tin nhắn nhận qua `postMessage`; không thay cho việc kiểm `event.origin`. */
export function isAssistantFrameMessage(value: unknown): value is AssistantFrameMessage {
  if (!isRecord(value)) return false;
  switch (value['type']) {
    case ASSISTANT_MESSAGE.page:
      return typeof value['page'] === 'string';
    case ASSISTANT_MESSAGE.ready:
    case ASSISTANT_MESSAGE.close:
    case ASSISTANT_MESSAGE.refresh:
      return true;
    case ASSISTANT_MESSAGE.action:
      return (
        typeof value['key'] === 'string' &&
        typeof value['requestId'] === 'string' &&
        isRecord(value['draft']) &&
        optionalString(value['variant']) &&
        (value['page'] === undefined ||
          (typeof value['page'] === 'string' && value['page'].startsWith('/') && !value['page'].startsWith('//')))
      );
    case ASSISTANT_MESSAGE.result:
      return (
        typeof value['key'] === 'string' &&
        typeof value['requestId'] === 'string' &&
        OUTCOMES.includes(value['outcome'] as string) &&
        optionalString(value['id']) &&
        optionalString(value['label']) &&
        optionalString(value['href']) &&
        optionalString(value['message'])
      );
    default:
      return false;
  }
}
