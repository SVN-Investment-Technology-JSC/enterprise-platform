/**
 * ISS-OPS-012: đổi xlsx 0.18.5 (npm, có lỗ hổng) sang SheetJS 0.20.3. Tệp mẫu và kết quả đọc mốc trong
 * `__fixtures__/xlsx-read-baseline.json` ghi bằng 0.18.5 với đúng tuỳ chọn đọc của các màn nhập Excel; test này đọc lại
 * bằng bản đang cài và so với mốc.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_SPREADSHEET_FILE_BYTES,
  SpreadsheetFileTooLargeError,
} from '@enterprise-platform/shared-ui';
import * as XLSX from 'xlsx';
import {
  parseImportDate,
  readImportFile,
  readImportSheet,
  sheetFromRecords,
} from '@enterprise-platform/feature-inventory';

type Reading = { readonly ok?: unknown; readonly error?: true };
type Modes = Readonly<Record<string, Reading>>;
interface Baseline {
  readonly files: Readonly<Record<string, string>>;
  readonly expected: Readonly<Record<string, Readonly<Record<string, Modes>>>>;
}

const baseline = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'xlsx-read-baseline.json'),
    'utf8',
  ),
) as Baseline;

const bytesOf = (name: string) =>
  new Uint8Array(Buffer.from(baseline.files[name], 'base64'));

// Mốc ghi cho hai múi giờ; ô ngày đọc với `cellDates` ra Date theo giờ máy nên phải so đúng múi giờ.
const offset = new Date(2026, 0, 1).getTimezoneOffset();
const zone =
  offset === -420 ? 'Asia/Ho_Chi_Minh' : offset === 0 ? 'UTC' : undefined;
const describeInZone = zone ? describe : describe.skip;

const firstSheet = (book: XLSX.WorkBook) => book.Sheets[book.SheetNames[0]];

function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
      const raw = this[key];
      return raw instanceof Date ? { $date: raw.toISOString() } : v;
    }),
  );
}

function attempt(fn: () => unknown): Reading {
  try {
    return { ok: serialize(fn()) };
  } catch {
    return { error: true };
  }
}

/** Đúng các tuỳ chọn đọc trong mã (mỗi chế độ ghi nơi dùng). */
function readAllModes(name: string): Modes {
  const array = () => bytesOf(name);
  return {
    // trade-import.model.ts: readImportSheet
    tradeImport: attempt(() =>
      XLSX.utils.sheet_to_json(
        firstSheet(XLSX.read(array(), { type: 'array', cellDates: true })),
        { defval: '' },
      ),
    ),
    // trade-items.model.ts: readImportFile; maintenance-matrix.tsx
    arrayDefval: attempt(() =>
      XLSX.utils.sheet_to_json(
        firstSheet(XLSX.read(array(), { type: 'array' })),
        { defval: '' },
      ),
    ),
    // excel-import-dialog.tsx
    arrayHeaderRows: attempt(() =>
      XLSX.utils.sheet_to_json(
        firstSheet(XLSX.read(array(), { type: 'array' })),
        {
          header: 1,
          defval: '',
          blankrows: false,
        },
      ),
    ),
    // stocktake-hub.tsx (FileReader.readAsBinaryString)
    binaryDefault: attempt(() =>
      XLSX.utils.sheet_to_json(
        firstSheet(
          XLSX.read(Buffer.from(array()).toString('binary'), {
            type: 'binary',
          }),
        ),
      ),
    ),
    // file-preview.tsx (CSV giải mã UTF-8 như TextDecoder; jsdom không có TextDecoder)
    preview: attempt(() => {
      const book = name.endsWith('.csv')
        ? XLSX.read(Buffer.from(array()).toString('utf8'), { type: 'string' })
        : XLSX.read(array(), { type: 'array' });
      return book.SheetNames.map((sheet) => ({
        name: sheet,
        rows: XLSX.utils.sheet_to_json(book.Sheets[sheet], {
          header: 1,
          raw: false,
          defval: '',
          blankrows: false,
        }),
      }));
    }),
  };
}

/**
 * 0.18.5 lệch 30 giây khi đổi số seri ngày sang giờ máy ở múi giờ Việt Nam (lỗi của bản cũ); 0.20.3 ra đúng.
 * Ô ngày (Date) được phép lệch tới 30 giây. Số seri ngày đọc từ chữ ngày trong CSV: 0.18.5 còn cộng thêm phần giờ
 * rác (30 giây, hoặc 7 giờ khi chữ dạng ISO), 0.20.3 ra số nguyên; phần ngày phải như nhau. Mọi giá trị khác giống hệt.
 */
const DATE_SKEW_MS = 30_000;
const MIN_DATE_SERIAL = 20_000;

function expectSameReading(
  actual: unknown,
  expected: unknown,
  path: string,
): void {
  if (isDate(actual) && isDate(expected)) {
    const diff = Math.abs(
      Date.parse(actual.$date) - Date.parse(expected.$date),
    );
    expect({ path, withinSkew: diff <= DATE_SKEW_MS }).toEqual({
      path,
      withinSkew: true,
    });
    return;
  }
  if (
    typeof actual === 'number' &&
    typeof expected === 'number' &&
    actual !== expected &&
    Number.isInteger(actual) &&
    actual > MIN_DATE_SERIAL
  ) {
    expect({ path, day: actual }).toEqual({ path, day: Math.round(expected) });
    return;
  }
  if (Array.isArray(expected)) {
    expect({
      path,
      isArray: Array.isArray(actual),
      length: (actual as unknown[]).length,
    }).toEqual({
      path,
      isArray: true,
      length: expected.length,
    });
    expected.forEach((item, index) =>
      expectSameReading(
        (actual as unknown[])[index],
        item,
        `${path}[${index}]`,
      ),
    );
    return;
  }
  if (expected && typeof expected === 'object') {
    expect({ path, keys: Object.keys(actual as object) }).toEqual({
      path,
      keys: Object.keys(expected),
    });
    for (const [key, value] of Object.entries(expected)) {
      expectSameReading(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
    }
    return;
  }
  expect({ path, value: actual }).toEqual({ path, value: expected });
}

function isDate(value: unknown): value is { $date: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { $date?: unknown }).$date === 'string'
  );
}

/** Tệp giả có `arrayBuffer` (jsdom chưa có `File.arrayBuffer`). */
function fakeFile(name: string, bytes: Uint8Array, size = bytes.byteLength) {
  const arrayBuffer = jest.fn(async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return { file: { name, size, arrayBuffer } as unknown as File, arrayBuffer };
}

describe('SheetJS 0.20.3 (ISS-OPS-012)', () => {
  it('đang dùng bản 0.20.3', () => {
    expect(XLSX.version).toBe('0.20.3');
  });
});

describeInZone(
  `Đọc tệp mốc giống xlsx 0.18.5 (múi giờ ${zone ?? 'khác'})`,
  () => {
    const expected = zone ? baseline.expected[zone] : {};

    it.each(['sample.xlsx', 'corrupt.xlsx', 'broken-zip.xlsx'])(
      '%s: mọi chế độ đọc giống mốc (ngày, số, ô trống, công thức, tiếng Việt)',
      (name) => {
        expectSameReading(readAllModes(name), expected[name], name);
      },
    );

    it('sample.csv: giống mốc, trừ ô ngày ở bản xem trước giữ nguyên chữ trong tệp', () => {
      const actual = readAllModes('sample.csv');
      const {
        preview: actualPreview,
        tradeImport: actualTrade,
        ...actualRest
      } = actual;
      const {
        preview: expectedPreview,
        tradeImport: expectedTrade,
        ...expectedRest
      } = expected['sample.csv'];
      expectSameReading(actualRest, expectedRest, 'sample.csv');
      // Chữ ngày dạng ISO trong CSV: 0.18.5 hiểu là 0 giờ UTC, 0.20.3 là 0 giờ giờ máy. Ngày nhập vào hệ thống
      // (parseImportDate) vẫn như nhau; các cột khác giống hệt.
      const dateColumn = (rows: unknown) =>
        (rows as Record<string, unknown>[]).map((row) => {
          const value = Object.values(row)[2];
          return parseImportDate(isDate(value) ? new Date(value.$date) : value);
        });
      const otherColumns = (rows: unknown) =>
        (rows as Record<string, unknown>[]).map((row) =>
          Object.entries(row).filter((_, index) => index !== 2),
        );
      expect(dateColumn(actualTrade.ok)).toEqual(dateColumn(expectedTrade.ok));
      expect(otherColumns(actualTrade.ok)).toEqual(
        otherColumns(expectedTrade.ok),
      );
      // 0.18.5 hiện "2/7/26", "12/31/25" (định dạng Mỹ); 0.20.3 giữ đúng chữ người dùng gõ trong CSV.
      const rows = (sheets: unknown) =>
        (sheets as { rows: string[][] }[])[0].rows;
      expect(rows(expectedPreview.ok).map((row) => row[2])).toEqual([
        'Ngày nhập',
        '2/7/26',
        '12/31/25',
        '29/02/2024',
      ]);
      expect(rows(actualPreview.ok).map((row) => row[2])).toEqual([
        'Ngày nhập',
        '02/07/2026',
        '2025-12-31',
        '29/02/2024',
      ]);
      const withoutDate = (sheets: unknown) =>
        rows(sheets).map((row) => row.filter((_, index) => index !== 2));
      expect(withoutDate(actualPreview.ok)).toEqual(
        withoutDate(expectedPreview.ok),
      );
    });

    it('readImportSheet (nhập hàng hoá, dịch vụ) đọc tệp mốc giống 0.18.5', async () => {
      const { file } = fakeFile('sample.xlsx', bytesOf('sample.xlsx'));
      const sheet = await readImportSheet(file);
      const old = sheetFromRecords(
        expected['sample.xlsx'].tradeImport.ok as Record<string, unknown>[],
      );
      expect(sheet.headers).toEqual(old.headers);
      expectSameReading(serialize(sheet.rows), old.rows, 'readImportSheet');
    });
  },
);

describe('Ô ngày đọc bằng cellDates ra đúng giờ máy', () => {
  it('ngày không giờ là 0 giờ, ngày có giờ đúng phút', () => {
    const book = XLSX.read(bytesOf('sample.xlsx'), {
      type: 'array',
      cellDates: true,
    });
    const [first] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      firstSheet(book),
      { defval: '' },
    );
    const day = first['Ngày nhập'] as Date;
    const moment = first['Thời điểm'] as Date;
    expect([
      day.getFullYear(),
      day.getMonth() + 1,
      day.getDate(),
      day.getHours(),
      day.getMinutes(),
      day.getSeconds(),
    ]).toEqual([2026, 7, 2, 0, 0, 0]);
    expect([moment.getDate(), moment.getHours(), moment.getMinutes()]).toEqual([
      2, 14, 35,
    ]);
  });

  it('parseImportDate lấy đúng ngày trong ô, không lùi một ngày', async () => {
    const { file } = fakeFile('sample.xlsx', bytesOf('sample.xlsx'));
    const sheet = await readImportSheet(file);
    expect(
      sheet.rows.map((row) => parseImportDate(row.cells['Ngày nhập'])),
    ).toEqual([
      '2026-07-02T00:00:00+07:00',
      '2025-12-31T00:00:00+07:00',
      '2024-02-29T00:00:00+07:00',
      undefined,
    ]);
  });
});

describe('Chặn tệp quá lớn trước khi đọc', () => {
  it('readImportSheet báo lỗi tiếng Việt, không đọc nội dung tệp', async () => {
    const { file, arrayBuffer } = fakeFile(
      'lon.xlsx',
      bytesOf('sample.xlsx'),
      MAX_SPREADSHEET_FILE_BYTES + 1,
    );
    await expect(readImportSheet(file)).rejects.toThrow(
      SpreadsheetFileTooLargeError,
    );
    await expect(readImportSheet(file)).rejects.toThrow(
      'Tệp quá lớn (tối đa 10 MB).',
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('readImportFile báo lỗi tiếng Việt, không đọc nội dung tệp', async () => {
    const { file, arrayBuffer } = fakeFile(
      'lon.xlsx',
      bytesOf('sample.xlsx'),
      MAX_SPREADSHEET_FILE_BYTES + 1,
    );
    await expect(readImportFile(file)).rejects.toThrow(
      'Tệp quá lớn (tối đa 10 MB).',
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('tệp đúng giới hạn vẫn đọc', async () => {
    const { file } = fakeFile(
      'sample.xlsx',
      bytesOf('sample.xlsx'),
      MAX_SPREADSHEET_FILE_BYTES,
    );
    expect((await readImportSheet(file)).rows).toHaveLength(4);
  });
});
