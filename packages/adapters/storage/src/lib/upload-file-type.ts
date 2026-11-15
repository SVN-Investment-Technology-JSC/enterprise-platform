/**
 * Kiểm loại tệp trước khi ký URL tải lên.
 *
 * Trình duyệt tự `PUT` thẳng lên kho, nên `contentType` lưu trên object là thứ
 * client khai. Khai `text/plain` thì lọt được tệp `.exe`, `.html` vào kho; khai
 * `text/html` cho tệp `.pdf` thì kho trả `text/html` và trình duyệt dựng tệp
 * thành trang trên tên miền kho. Vì vậy:
 *
 * - đuôi tệp phải nằm trong danh sách cho phép, và không bao giờ là đuôi chạy
 *   được hay đánh dấu (`.exe`, `.html`, `.svg`...);
 * - `contentType` khai phải là một trong các loại của đúng đuôi đó;
 * - loại dùng để ký URL và để trả về khi tải xuống do server quyết theo đuôi.
 */

export const UPLOAD_FILE_TYPE_NOT_ALLOWED_MESSAGE = 'Loại tệp không được phép.';
export const UPLOAD_FILE_SIZE_INVALID_MESSAGE = 'Dung lượng tệp không hợp lệ.';

/** Loại nội dung "không rõ": trình duyệt không nhận ra kiểu tệp. */
const UNKNOWN_CONTENT_TYPES: ReadonlySet<string> = new Set(['', 'application/octet-stream']);

/**
 * Đuôi tệp được phép và các `contentType` tương ứng; loại đầu tiên là loại
 * chuẩn server dùng khi client không khai rõ.
 */
export const DEFAULT_UPLOAD_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  // Tài liệu văn phòng.
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  odt: ['application/vnd.oasis.opendocument.text'],
  ods: ['application/vnd.oasis.opendocument.spreadsheet'],
  odp: ['application/vnd.oasis.opendocument.presentation'],
  rtf: ['application/rtf', 'text/rtf'],
  // Văn bản thuần. Windows hay gán `.csv` là `application/vnd.ms-excel`.
  txt: ['text/plain'],
  csv: ['text/csv', 'application/vnd.ms-excel'],
  // Ảnh raster (không có SVG: SVG chạy được script).
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  bmp: ['image/bmp'],
  // Tệp nén.
  zip: ['application/zip', 'application/x-zip-compressed'],
  '7z': ['application/x-7z-compressed'],
  rar: ['application/vnd.rar', 'application/x-rar-compressed'],
  // Video.
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
};

/**
 * Đuôi luôn bị chặn, kể cả khi danh sách riêng của một phân hệ lỡ cho phép:
 * chương trình chạy được, script, và định dạng trình duyệt dựng thành trang.
 */
export const BLOCKED_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  // Chương trình, trình cài đặt, thư viện.
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'dll', 'cpl', 'sys', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'jar',
  // Script.
  'bat', 'cmd', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta',
  'py', 'pl', 'rb', 'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'lnk', 'reg', 'inf',
  // Đánh dấu trình duyệt dựng thành trang hoặc chạy script. `.xml` không nằm
  // đây (hoá đơn điện tử là XML); danh sách cho phép mặc định cũng không có nó.
  'html', 'htm', 'xhtml', 'xht', 'shtml', 'mht', 'mhtml', 'svg', 'svgz', 'swf',
]);

export type UploadFileRejection = 'type' | 'size';

/** Tệp không qua được kiểm tra; mỗi phân hệ đổi lỗi này sang lỗi 400 của mình. */
export class UploadFileRejectedError extends Error {
  readonly code = 'FILE_TYPE_NOT_ALLOWED';

  constructor(readonly reason: UploadFileRejection) {
    super(reason === 'size' ? UPLOAD_FILE_SIZE_INVALID_MESSAGE : UPLOAD_FILE_TYPE_NOT_ALLOWED_MESSAGE);
    this.name = 'UploadFileRejectedError';
  }
}

export interface UploadFileInput {
  readonly fileName: unknown;
  readonly contentType: unknown;
  readonly sizeBytes?: unknown;
}

export interface UploadFileTypeOptions {
  /**
   * Danh sách riêng của phân hệ (đuôi → một hay nhiều loại). Thiếu thì dùng
   * `DEFAULT_UPLOAD_FILE_TYPES`. Đuôi trong `BLOCKED_UPLOAD_EXTENSIONS` vẫn bị
   * chặn dù có trong danh sách này.
   */
  readonly allowed?: Readonly<Record<string, string | readonly string[]>>;
  /** Chỉ nhận các loại này (lọc thêm trên danh sách đuôi). */
  readonly allowedContentTypes?: readonly string[];
  /**
   * Nhận `contentType` rỗng hoặc `application/octet-stream` (trình duyệt không
   * nhận ra kiểu) và thay bằng loại chuẩn của đuôi. Mặc định từ chối.
   */
  readonly acceptUnknownContentType?: boolean;
  /** Mặc định `true`: `sizeBytes` bắt buộc và phải là số nguyên dương. */
  readonly requireSize?: boolean;
}

export interface CheckedUploadFile {
  readonly fileName: string;
  /** Đuôi chữ thường, không có dấu chấm. */
  readonly extension: string;
  /** Loại server dùng để ký URL tải lên, lưu và trả khi tải xuống. */
  readonly contentType: string;
  /** `undefined` chỉ khi `requireSize: false` và client không gửi. */
  readonly sizeBytes?: number;
}

/** Đuôi tệp chữ thường, rỗng khi tên không có đuôi. */
export function uploadFileExtension(fileName: string): string {
  const base = fileName.trim().replace(/[. ]+$/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0 && !base.startsWith('.')) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Loại nội dung chữ thường, bỏ tham số (`; charset=...`). */
export function normalizeContentType(contentType: unknown): string {
  return typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
}

/** Đuôi chạy được hoặc đánh dấu (`.exe`, `.html`, `.svg`...). */
export function isBlockedUploadExtension(fileName: string): boolean {
  return BLOCKED_UPLOAD_EXTENSIONS.has(uploadFileExtension(fileName));
}

/** Số byte hợp lệ: số nguyên dương an toàn (chuỗi số cũng nhận). */
export function parseUploadSize(value: unknown): number {
  const size = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isSafeInteger(size) || size <= 0) throw new UploadFileRejectedError('size');
  return size;
}

/**
 * Đối chiếu đuôi tệp với `contentType` theo danh sách cho phép.
 *
 * Ném `UploadFileRejectedError` khi đuôi bị chặn hay không có trong danh sách,
 * loại khai không thuộc đuôi đó, hoặc `sizeBytes` không phải số nguyên dương.
 */
export function checkUploadFile(input: UploadFileInput, options: UploadFileTypeOptions = {}): CheckedUploadFile {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  if (!fileName) throw new UploadFileRejectedError('type');
  const extension = uploadFileExtension(fileName);
  if (!extension || BLOCKED_UPLOAD_EXTENSIONS.has(extension)) throw new UploadFileRejectedError('type');

  const table = options.allowed ?? DEFAULT_UPLOAD_FILE_TYPES;
  const entry = Object.prototype.hasOwnProperty.call(table, extension) ? table[extension] : undefined;
  const accepted = (typeof entry === 'string' ? [entry] : [...(entry ?? [])])
    .map((type) => normalizeContentType(type))
    .filter((type) => type && !UNKNOWN_CONTENT_TYPES.has(type))
    .filter((type) => !options.allowedContentTypes || options.allowedContentTypes.includes(type));
  if (accepted.length === 0) throw new UploadFileRejectedError('type');

  const declared = normalizeContentType(input.contentType);
  let contentType: string;
  if (accepted.includes(declared)) {
    contentType = declared;
  } else if (options.acceptUnknownContentType && UNKNOWN_CONTENT_TYPES.has(declared)) {
    contentType = accepted[0];
  } else {
    throw new UploadFileRejectedError('type');
  }

  const requireSize = options.requireSize ?? true;
  const sizeBytes =
    requireSize || (input.sizeBytes !== undefined && input.sizeBytes !== null)
      ? parseUploadSize(input.sizeBytes)
      : undefined;
  return { fileName, extension, contentType, sizeBytes };
}

/**
 * Loại server trả khi tải xuống: loại chuẩn của đuôi tệp nếu đuôi được phép,
 * ngược lại `application/octet-stream` (trình duyệt chỉ tải về, không mở).
 */
export function downloadContentTypeFor(
  fileName: string,
  allowed: Readonly<Record<string, string | readonly string[]>> = DEFAULT_UPLOAD_FILE_TYPES,
): string {
  const extension = uploadFileExtension(fileName);
  if (!extension || BLOCKED_UPLOAD_EXTENSIONS.has(extension)) return 'application/octet-stream';
  const entry = Object.prototype.hasOwnProperty.call(allowed, extension) ? allowed[extension] : undefined;
  const first = typeof entry === 'string' ? entry : entry?.[0];
  return first ? normalizeContentType(first) : 'application/octet-stream';
}
