/** Chờ trước khi giải phóng URL: thu hồi ngay sau click có thể làm một số trình duyệt huỷ lượt tải. */
export const REVOKE_DELAY_MS = 1000;

/** Tải một tệp về máy. URL tạm luôn được giải phóng, kể cả khi click lỗi. */
export function downloadBlob(filename: string, data: string | Uint8Array | Blob, mime: string): void {
  const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : data.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Chép chữ vào clipboard; trả false nếu trình duyệt từ chối. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Rơi xuống cách dự phòng bên dưới (trang không an toàn hoặc chưa cấp quyền).
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
