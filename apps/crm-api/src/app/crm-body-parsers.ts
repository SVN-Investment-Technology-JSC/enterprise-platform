import type { IncomingMessage, ServerResponse } from 'http';
import { SALES_ORGANIZATION_INVALID_CODE } from '@enterprise-platform/contracts-crm';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Giới hạn thân JSON của mọi route: giữ đúng mặc định của Nest (body-parser) như trước phase 3. */
export const CRM_DEFAULT_JSON_LIMIT = '100kb';
/**
 * Riêng lưu bố cục in của mẫu báo giá (bố cục tối đa 1 MB, có ảnh) và tạo, sửa tổ chức báo giá (logo tối đa 300 KB),
 * chừa phần thân bọc ngoài.
 */
export const CRM_LAYOUT_JSON_LIMIT = '2mb';

const LAYOUT_ROUTE = /^\/api\/crm\/v1\/quote-templates\/[^/?#]+\/layout\/?$/;
const SALES_ORGANIZATIONS_ROUTE = /^\/api\/crm\/v1\/sales-organizations\/?$/;
const SALES_ORGANIZATION_ROUTE = /^\/api\/crm\/v1\/sales-organizations\/[^/?#]+\/?$/;

const pathOf = (request: IncomingMessage): string => (request.url ?? '').split('?')[0];

/** `PUT /api/crm/v1/quote-templates/:id/layout`. */
export function isQuoteLayoutUpload(request: IncomingMessage): boolean {
  return request.method === 'PUT' && LAYOUT_ROUTE.test(pathOf(request));
}

/** `POST /api/crm/v1/sales-organizations`, `PATCH /api/crm/v1/sales-organizations/:id` (thân có logo). */
export function isSalesOrganizationUpload(request: IncomingMessage): boolean {
  const path = pathOf(request);
  return (
    (request.method === 'POST' && SALES_ORGANIZATIONS_ROUTE.test(path)) ||
    (request.method === 'PATCH' && SALES_ORGANIZATION_ROUTE.test(path))
  );
}

/** Route được nhận thân JSON tới 2 MB. */
export function isLargeJsonUpload(request: IncomingMessage): boolean {
  return isQuoteLayoutUpload(request) || isSalesOrganizationUpload(request);
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
 * Route lưu bố cục và tạo, sửa tổ chức báo giá được parser riêng giới hạn 2 MB đọc trước; các route khác giữ 100 KB như
 * cũ (parser sau bỏ qua request đã đọc xong thân). Thân các route này vượt 2 MB trả 413 kèm câu tiếng Việt thay cho
 * trang lỗi chung.
 */
export function configureCrmBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', {
    limit: CRM_LAYOUT_JSON_LIMIT,
    type: (request: IncomingMessage) => isLargeJsonUpload(request) && isJsonRequest(request),
  });
  app.useBodyParser('json', { limit: CRM_DEFAULT_JSON_LIMIT });
  app.useBodyParser('urlencoded', { extended: true });
  app.use((error: BodyParserError, request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
    if (error?.type !== 'entity.too.large' || !isLargeJsonUpload(request)) return next(error);
    response.statusCode = 413;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify(
        isQuoteLayoutUpload(request)
          ? {
              statusCode: 413,
              code: 'LAYOUT_TOO_LARGE',
              message: 'Bố cục quá lớn (tối đa 2 MB). Hãy giảm kích thước ảnh hoặc bớt khối rồi lưu lại.',
            }
          : {
              statusCode: 413,
              code: SALES_ORGANIZATION_INVALID_CODE,
              message: 'Dữ liệu tổ chức quá lớn (tối đa 2 MB). Hãy dùng logo nhỏ hơn 300 KB rồi lưu lại.',
            },
      ),
    );
  });
}
