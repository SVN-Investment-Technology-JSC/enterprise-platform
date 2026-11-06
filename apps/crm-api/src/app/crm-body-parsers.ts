import type { IncomingMessage, ServerResponse } from 'http';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Giới hạn thân JSON của mọi route: giữ đúng mặc định của Nest (body-parser) như trước phase 3. */
export const CRM_DEFAULT_JSON_LIMIT = '100kb';
/** Riêng lưu bố cục in của mẫu báo giá: bố cục tối đa 1 MB (có ảnh), chừa phần thân bọc ngoài. */
export const CRM_LAYOUT_JSON_LIMIT = '2mb';

const LAYOUT_ROUTE = /^\/api\/crm\/v1\/quote-templates\/[^/?#]+\/layout\/?$/;

/** `PUT /api/crm/v1/quote-templates/:id/layout`. */
export function isQuoteLayoutUpload(request: IncomingMessage): boolean {
  const path = (request.url ?? '').split('?')[0];
  return request.method === 'PUT' && LAYOUT_ROUTE.test(path);
}

/** Cùng loại nội dung mà parser JSON mặc định nhận (`application/json`, có hoặc không có `charset`). */
function isJsonRequest(request: IncomingMessage): boolean {
  return /^application\/json\s*(;|$)/i.test(String(request.headers['content-type'] ?? '').trim());
}

interface BodyParserError {
  readonly type?: string;
  readonly status?: number;
}

/**
 * Parser thân request của CRM API, thay cho parser mặc định của Nest (tạo app với `bodyParser: false`).
 *
 * Route lưu bố cục được parser riêng giới hạn 2 MB đọc trước; các route khác giữ 100 KB như cũ (parser sau bỏ qua
 * request đã đọc xong thân). Thân lưu bố cục vượt 2 MB trả 413 kèm câu tiếng Việt thay cho trang lỗi chung.
 */
export function configureCrmBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', {
    limit: CRM_LAYOUT_JSON_LIMIT,
    type: (request: IncomingMessage) => isQuoteLayoutUpload(request) && isJsonRequest(request),
  });
  app.useBodyParser('json', { limit: CRM_DEFAULT_JSON_LIMIT });
  app.useBodyParser('urlencoded', { extended: true });
  app.use((error: BodyParserError, request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
    if (error?.type !== 'entity.too.large' || !isQuoteLayoutUpload(request)) return next(error);
    response.statusCode = 413;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        statusCode: 413,
        code: 'LAYOUT_TOO_LARGE',
        message: 'Bố cục quá lớn (tối đa 2 MB). Hãy giảm kích thước ảnh hoặc bớt khối rồi lưu lại.',
      }),
    );
  });
}
