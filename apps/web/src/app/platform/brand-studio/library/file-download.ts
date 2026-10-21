/** Tải một tệp văn bản về máy bằng Blob; không đính dữ liệu vào URL. */
export function downloadTextFile(fileName: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Trình duyệt cần một nhịp để bắt đầu tải trước khi thu hồi URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Đọc tệp người dùng chọn thành văn bản. */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Không đọc được tệp.'));
    reader.readAsText(file);
  });
}
