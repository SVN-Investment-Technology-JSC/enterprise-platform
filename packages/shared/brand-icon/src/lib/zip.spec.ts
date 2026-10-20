import { createZip, crc32, normalizeZipPath } from './zip.js';

interface ReadEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  time: number;
  date: number;
  data: Uint8Array;
}

/** Bộ đọc zip tối thiểu cho test: đi từ bản ghi kết thúc sang thư mục trung tâm, rồi đối chiếu tiêu đề cục bộ. */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });

  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Không thấy bản ghi kết thúc zip');
  expect(view.getUint16(end + 4, true)).toBe(0);
  expect(view.getUint16(end + 20, true)).toBe(0);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  expect(centralStart + centralSize).toBe(end);

  const entries: ReadEntry[] = [];
  let pos = centralStart;
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const time = view.getUint16(pos + 12, true);
    const date = view.getUint16(pos + 14, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 6, true)).toBe(flags);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    expect(view.getUint32(localOffset + 18, true)).toBe(compressedSize);
    expect(view.getUint32(localOffset + 22, true)).toBe(size);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    expect(decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))).toBe(name);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, flags, method, crc, compressedSize, size, time, date, data: bytes.subarray(dataStart, dataStart + size) });
  }
  expect(pos).toBe(end);
  return entries;
}

/** Bản CRC-32 theo từng bit, độc lập với bản dùng bảng trong code chính. */
function referenceCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encode = (text: string) => new TextEncoder().encode(text);

describe('crc32', () => {
  it('khớp giá trị chuẩn của chuỗi 123456789', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
  });

  it('chuỗi rỗng cho 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('khớp bản tính theo từng bit trên dữ liệu bất kỳ', () => {
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 31 + 7) % 256;
    expect(crc32(data)).toBe(referenceCrc32(data));
  });
});

describe('createZip', () => {
  it('gói rỗng chỉ có bản ghi kết thúc', () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('ghi đúng chữ ký, CRC, kích thước và nội dung từng tệp', () => {
    const binary = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const zip = createZip([
      { path: 'svg/home.svg', data: '<svg />\n' },
      { path: 'favicon/favicon-16x16.png', data: binary },
      { path: 'empty.txt', data: '' },
    ]);
    const entries = readZip(zip);

    expect(entries.map((entry) => entry.name)).toEqual(['svg/home.svg', 'favicon/favicon-16x16.png', 'empty.txt']);
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(entry.size);
      expect(entry.crc).toBe(referenceCrc32(entry.data));
    }
    expect(new TextDecoder().decode(entries[0].data)).toBe('<svg />\n');
    expect([...entries[1].data]).toEqual([...binary]);
    expect(entries[2].size).toBe(0);
    expect(entries[2].crc).toBe(0);
  });

  it('giữ nguyên dữ liệu lớn', () => {
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 2654435761) >>> 24;
    const [entry] = readZip(createZip([{ path: 'big.bin', data: big }]));
    expect(entry.size).toBe(big.length);
    expect(entry.crc).toBe(referenceCrc32(big));
    expect(entry.data.every((byte, index) => byte === big[index])).toBe(true);
  });

  it('tên tệp tiếng Việt có dấu được ghi UTF-8 với cờ bit 11', () => {
    const name = 'svg/đơn-hàng/Hóa đơn — thử.svg';
    const [entry] = readZip(createZip([{ path: name, data: 'nội dung có dấu: ắ ề ỗ' }]));
    expect(entry.name).toBe(name);
    expect(entry.flags & 0x0800).toBe(0x0800);
    expect(new TextDecoder().decode(entry.data)).toBe('nội dung có dấu: ắ ề ỗ');
  });

  it('cùng đầu vào cho cùng từng byte, thời gian DOS cố định', () => {
    const files = [
      { path: 'a.txt', data: 'một' },
      { path: 'b/c.txt', data: 'hai' },
    ];
    const first = createZip(files);
    const second = createZip(files);
    expect([...first]).toEqual([...second]);
    const [entry] = readZip(first);
    expect(entry.date).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
    expect(entry.time).toBe(0);
  });

  it('chuẩn hoá đường dẫn: đổi \\ thành /, bỏ / đầu và đoạn rỗng', () => {
    const entries = readZip(createZip([{ path: '\\svg\\\\a.svg', data: 'x' }, { path: '/./b//c.svg', data: 'y' }]));
    expect(entries.map((entry) => entry.name)).toEqual(['svg/a.svg', 'b/c.svg']);
  });

  it('từ chối đường dẫn rỗng, có .. hoặc bị trùng', () => {
    expect(() => createZip([{ path: '', data: 'x' }])).toThrow();
    expect(() => createZip([{ path: '../thoat.txt', data: 'x' }])).toThrow();
    expect(() => createZip([{ path: 'a/../../thoat.txt', data: 'x' }])).toThrow();
    expect(() => createZip([{ path: 'a.txt', data: 'x' }, { path: '/a.txt', data: 'y' }])).toThrow(/Trùng/);
  });
});

describe('normalizeZipPath', () => {
  it('trả đường dẫn sạch', () => {
    expect(normalizeZipPath('a\\b/c.txt')).toBe('a/b/c.txt');
  });
});
