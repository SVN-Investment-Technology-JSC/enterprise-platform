/** Cạnh PNG lớn nhất cho phép; canvas của trình duyệt có giới hạn, và favicon không cần hơn thế. */
export const MAX_RASTER_SIZE = 2048;

const SVG_MIME = 'image/svg+xml;charset=utf-8';
const ROOT_TAG = /<svg\b[^>]*>/;
const SIZE_ATTR = /\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/g;

/**
 * Đặt width/height tường minh cho thẻ `<svg>` gốc. SVG chỉ có viewBox thì mỗi trình duyệt tự chọn kích thước gốc khác nhau
 * (có nơi 300x150), nên vẽ ra canvas dễ lệch; có kích thước tường minh thì ảnh luôn đúng `size x size`.
 */
export function withExplicitSize(svg: string, size: number): string {
  const match = ROOT_TAG.exec(svg);
  if (!match) return svg;
  const tag = match[0];
  const cleaned = tag.replace(SIZE_ATTR, '');
  const closing = cleaned.endsWith('/>') ? '/>' : '>';
  const opened = cleaned.slice(0, cleaned.length - closing.length).trimEnd();
  const sized = `${opened} width="${size}" height="${size}"${closing}`;
  return `${svg.slice(0, match.index)}${sized}${svg.slice(match.index + tag.length)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không đọc được SVG để vẽ thành ảnh.'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Trình duyệt không tạo được ảnh PNG.'))), 'image/png');
  });
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('Không đọc được dữ liệu ảnh.'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Vẽ SVG thành PNG vuông `size x size`, nền trong suốt. Kích thước canvas đặt thẳng theo điểm ảnh,
 * không nhân devicePixelRatio, nên màn hình độ phân giải cao vẫn ra đúng cạnh yêu cầu.
 */
export async function svgToPng(svg: string, size: number): Promise<Uint8Array> {
  if (!Number.isInteger(size) || size < 1 || size > MAX_RASTER_SIZE) {
    throw new Error(`Cạnh ảnh phải từ 1 đến ${MAX_RASTER_SIZE} điểm ảnh.`);
  }
  const url = URL.createObjectURL(new Blob([withExplicitSize(svg, size)], { type: SVG_MIME }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Trình duyệt không hỗ trợ vẽ ảnh (canvas).');
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return await blobToBytes(await canvasToBlob(canvas));
  } finally {
    URL.revokeObjectURL(url);
  }
}
