/** Giới hạn kích thước tệp bảng tính (Excel, CSV) người dùng chọn để đọc ngay trên trình duyệt. */
export const MAX_SPREADSHEET_FILE_BYTES = 10 * 1024 * 1024;

export const SPREADSHEET_FILE_TOO_LARGE_MESSAGE = 'Tệp quá lớn (tối đa 10 MB).';

export const SPREADSHEET_FILE_UNREADABLE_MESSAGE =
  'Không đọc được tệp. Tệp có thể bị hỏng hoặc không phải tệp Excel (.xlsx, .xls, .csv).';

/** Báo tệp vượt giới hạn; ném trước khi đọc nội dung để không nạp tệp lớn vào bộ nhớ. */
export class SpreadsheetFileTooLargeError extends Error {
  constructor() {
    super(SPREADSHEET_FILE_TOO_LARGE_MESSAGE);
    this.name = 'SpreadsheetFileTooLargeError';
  }
}

/**
 * Kiểm kích thước tệp trước khi đọc. Trả thông báo lỗi tiếng Việt khi tệp vượt giới hạn,
 * `undefined` khi được phép đọc.
 */
export function spreadsheetFileSizeError(
  file: { readonly size: number },
  maxBytes: number = MAX_SPREADSHEET_FILE_BYTES,
): string | undefined {
  return file.size > maxBytes ? SPREADSHEET_FILE_TOO_LARGE_MESSAGE : undefined;
}

/** Như `spreadsheetFileSizeError` nhưng ném `SpreadsheetFileTooLargeError`, dùng trong hàm đọc tệp trả Promise. */
export function assertSpreadsheetFileSize(
  file: { readonly size: number },
  maxBytes: number = MAX_SPREADSHEET_FILE_BYTES,
): void {
  if (spreadsheetFileSizeError(file, maxBytes))
    throw new SpreadsheetFileTooLargeError();
}
