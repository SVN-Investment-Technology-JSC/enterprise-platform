import { createIco, isPng } from './ico';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG giả chỉ có chữ ký và phần thân đánh dấu, đủ để kiểm cấu trúc ICO. */
function fakePng(marker: number, extra = 4): Uint8Array {
  return new Uint8Array([...SIGNATURE, ...new Array<number>(extra).fill(marker)]);
}

describe('createIco', () => {
  it('ghi ICONDIR đúng: dành riêng 0, loại 1, số ảnh', () => {
    const ico = createIco([
      { size: 16, png: fakePng(1) },
      { size: 32, png: fakePng(2) },
      { size: 48, png: fakePng(3) },
    ]);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(3);
  });

  it('ghi từng ICONDIRENTRY và đặt PNG đúng vị trí', () => {
    const pngs = [fakePng(1, 4), fakePng(2, 9), fakePng(3, 20)];
    const ico = createIco([
      { size: 16, png: pngs[0] },
      { size: 32, png: pngs[1] },
      { size: 48, png: pngs[2] },
    ]);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    let expectedOffset = 6 + 16 * 3;
    [16, 32, 48].forEach((size, index) => {
      const entry = 6 + 16 * index;
      expect(view.getUint8(entry)).toBe(size);
      expect(view.getUint8(entry + 1)).toBe(size);
      expect(view.getUint8(entry + 2)).toBe(0);
      expect(view.getUint8(entry + 3)).toBe(0);
      expect(view.getUint16(entry + 4, true)).toBe(1);
      expect(view.getUint16(entry + 6, true)).toBe(32);
      expect(view.getUint32(entry + 8, true)).toBe(pngs[index].length);
      const offset = view.getUint32(entry + 12, true);
      expect(offset).toBe(expectedOffset);
      expect([...ico.subarray(offset, offset + pngs[index].length)]).toEqual([...pngs[index]]);
      expectedOffset += pngs[index].length;
    });
    expect(ico.length).toBe(expectedOffset);
  });

  it('xếp ảnh từ nhỏ đến lớn dù đầu vào lộn xộn', () => {
    const ico = createIco([
      { size: 48, png: fakePng(3) },
      { size: 16, png: fakePng(1) },
      { size: 32, png: fakePng(2) },
    ]);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect([0, 1, 2].map((index) => view.getUint8(6 + 16 * index))).toEqual([16, 32, 48]);
  });

  it('kích thước 256 ghi là 0', () => {
    const ico = createIco([{ size: 256, png: fakePng(1) }]);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
  });

  it('từ chối đầu vào sai', () => {
    expect(() => createIco([])).toThrow();
    expect(() => createIco([{ size: 0, png: fakePng(1) }])).toThrow();
    expect(() => createIco([{ size: 257, png: fakePng(1) }])).toThrow();
    expect(() => createIco([{ size: 16.5, png: fakePng(1) }])).toThrow();
    expect(() => createIco([{ size: 16, png: new Uint8Array([1, 2, 3]) }])).toThrow(/PNG/);
  });
});

describe('isPng', () => {
  it('nhận chữ ký PNG', () => {
    expect(isPng(fakePng(0))).toBe(true);
    expect(isPng(new Uint8Array(SIGNATURE))).toBe(true);
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
    expect(isPng(new TextEncoder().encode('<svg />'))).toBe(false);
  });
});
