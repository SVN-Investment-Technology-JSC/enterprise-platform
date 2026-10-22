/**
 * Ghi file ZIP thuần TypeScript, không phụ thuộc thư viện.
 * Phương pháp STORE (không nén): icon là văn bản nhỏ, nên đơn giản và dễ kiểm chứng hơn là nén.
 * Tên file ghi UTF-8 (cờ bit 11) nên giữ được dấu tiếng Việt; thời gian DOS cố định để cùng đầu vào cho cùng kết quả.
 */

export interface ZipFile {
  /** Đường dẫn trong gói, dùng dấu `/`, ví dụ `svg/home.svg`. */
  readonly path: string;
  readonly data: string | Uint8Array;
}

/** 2020-01-01 00:00:00 theo định dạng DOS (năm tính từ 1980). */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3) như ZIP và PNG dùng. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Chuẩn hoá đường dẫn: dùng `/`, bỏ `/` đầu và đoạn rỗng; từ chối `..` để giải nén không thoát khỏi thư mục đích. */
export function normalizeZipPath(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  if (parts.length === 0) throw new Error('Tên tệp trong gói zip không được để trống.');
  if (parts.includes('..')) throw new Error(`Đường dẫn không hợp lệ trong gói zip: ${path}`);
  return parts.join('/');
}

/** Dựng gói zip từ danh sách tệp. Trùng đường dẫn sau khi chuẩn hoá thì báo lỗi thay vì ghi gói hỏng. */
export function createZip(files: readonly ZipFile[]): Uint8Array {
  if (files.length > MAX_ENTRIES) throw new Error(`Gói zip tối đa ${MAX_ENTRIES} tệp.`);
  const encoder = new TextEncoder();

  interface Entry {
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }
  const entries: Entry[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (const file of files) {
    const path = normalizeZipPath(file.path);
    if (seen.has(path)) throw new Error(`Trùng tên tệp trong gói zip: ${path}`);
    seen.add(path);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    if (data.length > MAX_SIZE) throw new Error(`Tệp quá lớn để đưa vào gói zip: ${path}`);
    const name = encoder.encode(path);
    entries.push({ name, data, crc: crc32(data), offset });
    offset += LOCAL_HEADER_SIZE + name.length + data.length;
  }
  const centralSize = entries.reduce((sum, entry) => sum + CENTRAL_HEADER_SIZE + entry.name.length, 0);
  const total = offset + centralSize + END_RECORD_SIZE;
  if (total > MAX_SIZE) throw new Error('Gói zip quá lớn (tối đa 4 GB).');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;

  for (const entry of entries) {
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, VERSION_NEEDED, true);
    view.setUint16(pos + 6, FLAG_UTF8, true);
    view.setUint16(pos + 8, 0, true); // STORE
    view.setUint16(pos + 10, DOS_TIME, true);
    view.setUint16(pos + 12, DOS_DATE, true);
    view.setUint32(pos + 14, entry.crc, true);
    view.setUint32(pos + 18, entry.data.length, true);
    view.setUint32(pos + 22, entry.data.length, true);
    view.setUint16(pos + 26, entry.name.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += LOCAL_HEADER_SIZE;
    out.set(entry.name, pos);
    pos += entry.name.length;
    out.set(entry.data, pos);
    pos += entry.data.length;
  }

  const centralStart = pos;
  for (const entry of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, VERSION_NEEDED, true); // phiên bản tạo
    view.setUint16(pos + 6, VERSION_NEEDED, true); // phiên bản cần để giải nén
    view.setUint16(pos + 8, FLAG_UTF8, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, DOS_TIME, true);
    view.setUint16(pos + 14, DOS_DATE, true);
    view.setUint32(pos + 16, entry.crc, true);
    view.setUint32(pos + 20, entry.data.length, true);
    view.setUint32(pos + 24, entry.data.length, true);
    view.setUint16(pos + 28, entry.name.length, true);
    view.setUint16(pos + 30, 0, true); // extra
    view.setUint16(pos + 32, 0, true); // comment
    view.setUint16(pos + 34, 0, true); // disk
    view.setUint16(pos + 36, 0, true); // thuộc tính nội bộ
    view.setUint32(pos + 38, 0, true); // thuộc tính ngoài
    view.setUint32(pos + 42, entry.offset, true);
    pos += CENTRAL_HEADER_SIZE;
    out.set(entry.name, pos);
    pos += entry.name.length;
  }

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  view.setUint16(pos + 20, 0, true);
  return out;
}
