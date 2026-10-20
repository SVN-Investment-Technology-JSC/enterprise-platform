/**
 * Dựng file .ico dạng PNG-in-ICO (Vista trở lên và mọi trình duyệt đều đọc được): mỗi ảnh là một PNG nguyên bản,
 * không cần chuyển sang BMP.
 */

export interface IcoImage {
  /** Cạnh ảnh vuông, 1 đến 256. */
  readonly size: number;
  /** Dữ liệu tệp PNG hoàn chỉnh. */
  readonly png: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;

export function isPng(data: Uint8Array): boolean {
  return data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

/** Ghép các PNG (thường 16, 32, 48) thành một favicon.ico; ảnh được xếp từ nhỏ đến lớn. */
export function createIco(images: readonly IcoImage[]): Uint8Array {
  if (images.length === 0) throw new Error('Cần ít nhất một ảnh để tạo file .ico.');
  if (images.length > 0xffff) throw new Error('Quá nhiều ảnh trong file .ico.');
  for (const image of images) {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) {
      throw new Error(`Kích thước ảnh .ico phải từ 1 đến 256 (nhận ${image.size}).`);
    }
    if (!isPng(image.png)) throw new Error(`Ảnh ${image.size}px không phải PNG hợp lệ.`);
  }

  const sorted = [...images].sort((a, b) => a.size - b.size);
  const dataStart = HEADER_SIZE + ENTRY_SIZE * sorted.length;
  const total = sorted.reduce((sum, image) => sum + image.png.length, dataStart);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // dành riêng
  view.setUint16(2, 1, true); // loại 1 = icon
  view.setUint16(4, sorted.length, true);

  let offset = dataStart;
  sorted.forEach((image, index) => {
    const entry = HEADER_SIZE + ENTRY_SIZE * index;
    const dimension = image.size === 256 ? 0 : image.size; // 0 nghĩa là 256
    view.setUint8(entry, dimension);
    view.setUint8(entry + 1, dimension);
    view.setUint8(entry + 2, 0); // không dùng bảng màu
    view.setUint8(entry + 3, 0);
    view.setUint16(entry + 4, 1, true); // planes
    view.setUint16(entry + 6, 32, true); // bit mỗi điểm ảnh
    view.setUint32(entry + 8, image.png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.length;
  });
  return out;
}
