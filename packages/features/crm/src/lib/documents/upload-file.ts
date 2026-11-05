/**
 * PUT file thẳng lên URL ký (không qua máy chủ CRM). Dùng XHR vì `fetch` chưa có sự kiện tiến trình tải lên.
 * Không gắn cookie hay `x-csrf-token`: URL ký đã mang chữ ký, thêm header lạ sẽ làm sai chữ ký.
 */
export function putFileToSignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 403) reject(new Error('Liên kết tải lên đã hết hạn hoặc không hợp lệ. Hãy thử lại.'));
      else reject(new Error(`Kho lưu trữ từ chối file (mã ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Mất kết nối khi tải lên. Hãy kiểm tra mạng và thử lại.'));
    xhr.onabort = () => reject(new Error('Đã huỷ tải lên.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
