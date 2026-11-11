/** Lỗi xuất file (PDF, Word) có câu tiếng Việt cho người dùng; menu Xuất hiện `message` bằng toast. */
export class QuoteExportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QuoteExportError';
  }
}
