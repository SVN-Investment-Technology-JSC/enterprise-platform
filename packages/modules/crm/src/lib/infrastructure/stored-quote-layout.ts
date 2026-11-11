import { validateQuoteLayout, type QuoteLayout } from '@enterprise-platform/contracts-crm';
import { Logger } from '@nestjs/common';

const logger = new Logger('CrmQuoteLayout');

/**
 * Đọc bố cục đã lưu trong DB (bố cục của mẫu hoặc bản chụp trên phiên bản báo giá). Rỗng: `null`. Sai cấu trúc
 * (ghi tay, hoặc bản cũ không còn hợp lệ với code hiện tại): `null` và ghi cảnh báo, không làm hỏng màn hình đang đọc.
 */
export function parseStoredQuoteLayout(value: unknown, source: string): QuoteLayout | null {
  if (value === null || value === undefined) return null;
  const result = validateQuoteLayout(value);
  if (result.ok) return result.layout;
  logger.warn(
    `Bỏ qua bố cục không hợp lệ ở ${source}: ${result.errors
      .slice(0, 3)
      .map((error) => `${error.code}${error.path ? ` (${error.path})` : ''}`)
      .join(', ')}`,
  );
  return null;
}
