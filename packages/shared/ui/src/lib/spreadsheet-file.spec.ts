import {
  assertSpreadsheetFileSize,
  MAX_SPREADSHEET_FILE_BYTES,
  SPREADSHEET_FILE_TOO_LARGE_MESSAGE,
  SpreadsheetFileTooLargeError,
  spreadsheetFileSizeError,
} from './spreadsheet-file';

describe('spreadsheet file size limit', () => {
  it('giới hạn là 10 MB', () => {
    expect(MAX_SPREADSHEET_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('cho đọc tệp đúng bằng giới hạn và tệp rỗng', () => {
    expect(spreadsheetFileSizeError({ size: 0 })).toBeUndefined();
    expect(
      spreadsheetFileSizeError({ size: MAX_SPREADSHEET_FILE_BYTES }),
    ).toBeUndefined();
    expect(() =>
      assertSpreadsheetFileSize({ size: MAX_SPREADSHEET_FILE_BYTES }),
    ).not.toThrow();
  });

  it('báo lỗi tiếng Việt khi vượt giới hạn', () => {
    expect(
      spreadsheetFileSizeError({ size: MAX_SPREADSHEET_FILE_BYTES + 1 }),
    ).toBe('Tệp quá lớn (tối đa 10 MB).');
    expect(() =>
      assertSpreadsheetFileSize({ size: MAX_SPREADSHEET_FILE_BYTES + 1 }),
    ).toThrow(SpreadsheetFileTooLargeError);
    expect(() =>
      assertSpreadsheetFileSize({ size: MAX_SPREADSHEET_FILE_BYTES + 1 }),
    ).toThrow(SPREADSHEET_FILE_TOO_LARGE_MESSAGE);
  });

  it('nhận giới hạn riêng', () => {
    expect(spreadsheetFileSizeError({ size: 2048 }, 1024)).toBe(
      SPREADSHEET_FILE_TOO_LARGE_MESSAGE,
    );
    expect(spreadsheetFileSizeError({ size: 1024 }, 1024)).toBeUndefined();
  });
});
