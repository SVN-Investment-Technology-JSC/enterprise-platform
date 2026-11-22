import {
  ObjectNotFoundError,
  ObjectRangeNotSatisfiableError,
  ObjectTooLargeError,
} from '@enterprise-platform/adapter-storage';
import { SHARED_FILE_PROXY_PATH, SHARED_PREVIEWABLE_CONTENT_TYPES } from '@enterprise-platform/contracts-shared';
import { Controller, Get, Logger, Param, Put, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NasService } from '../application/nas.service.js';
import { SharedError } from '../domain/shared.error.js';
import { describeStorageError, TenantStorageRouter } from '../infrastructure/tenant-storage-router.js';

/** Luồng tệp cùng các header cần chuyển cho trình duyệt, chung cho kho ngoài S3 và NAS. */
interface ForwardedFile {
  readonly body: Readable;
  readonly contentType: string;
  readonly contentLength?: number;
  readonly contentRange?: string;
  readonly etag?: string;
  readonly lastModified?: string;
}

/**
 * Chuyển tiếp tệp giữa trình duyệt và kho chỉ máy chủ ERP thấy được (NAS trong mạng
 * nội bộ, nối qua VPN hay Tailscale): kho ngoài S3 của tenant (chế độ `proxy`) và thư
 * mục chia sẻ của NAS (Kho NAS, phiếu có `p: 'nas'`).
 *
 * Máy chủ không lưu tệp: tải lên đọc thân yêu cầu thành từng phần 8 MiB rồi ghi
 * thẳng lên kho, tải xuống mở luồng từ kho đổ thẳng về trình duyệt (kèm `Range`, để
 * trình xem PDF đọc từng đoạn). Quyền nằm trong phiếu do service ký lúc người dùng
 * xin URL, giống URL ký sẵn của S3: phiếu sống 5 phút và chỉ dùng cho đúng một khoá.
 * Guard của app đã kiểm phiếu và mở DB của tenant; ở đây kiểm lại để không phụ thuộc
 * thứ tự cấu hình.
 */
@Controller(SHARED_FILE_PROXY_PATH)
export class SharedFilesController {
  private readonly logger = new Logger(SharedFilesController.name);

  constructor(
    private readonly storages: TenantStorageRouter,
    private readonly nas: NasService,
  ) {}

  @Get(':token')
  async download(@Param('token') token: string, @Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    const ticket = this.storages.verifyTicket(token, 'get');
    if (!ticket) return this.fail(response, 403, 'FILE_TICKET_INVALID', 'Liên kết tệp không hợp lệ hoặc đã hết hạn.');
    const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;

    let object: ForwardedFile;
    try {
      if (ticket.p === 'nas') {
        const abort = new AbortController();
        response.on('close', () => abort.abort());
        const file = await this.nas.openDownload(ticket.t, ticket.k, range, abort.signal);
        object = { ...file, contentType: file.contentType ?? 'application/octet-stream' };
      } else {
        const storage = await this.storages.streamsAt(ticket.t, 'external');
        const opened = await storage.openStream(ticket.k, { range });
        object = { ...opened, lastModified: opened.lastModified?.toUTCString() };
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return this.fail(response, 404, 'FILE_NOT_FOUND', 'Không thấy tệp trong kho lưu trữ.');
      if (error instanceof ObjectRangeNotSatisfiableError) {
        response.statusCode = 416;
        response.end();
        return;
      }
      return this.storageFailure(response, error);
    }

    const contentType = ticket.c ?? object.contentType;
    // Chỉ PDF và ảnh được mở tại chỗ; mọi thứ khác tải về, để tệp HTML/SVG không thành trang trên tên miền ERP.
    const inline = ticket.d === 'inline' && SHARED_PREVIEWABLE_CONTENT_TYPES.includes(contentType);
    const disposition = inline ? 'inline' : 'attachment';
    const fileName = ticket.n ? `; filename*=UTF-8''${encodeURIComponent(ticket.n)}` : '';
    response.statusCode = object.contentRange ? 206 : 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `${disposition}${fileName}`);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!inline || contentType.startsWith('image/')) {
      response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; sandbox");
    }
    if (object.contentLength !== undefined) response.setHeader('Content-Length', String(object.contentLength));
    if (object.contentRange) response.setHeader('Content-Range', object.contentRange);
    if (object.etag) response.setHeader('ETag', object.etag);
    if (object.lastModified) response.setHeader('Last-Modified', object.lastModified);
    if (request.method === 'HEAD') {
      object.body.destroy();
      response.end();
      return;
    }
    try {
      await pipeline(object.body, response);
    } catch (error) {
      // Người dùng đóng tab giữa chừng là chuyện thường; chỉ ghi khi kho đứt luồng.
      object.body.destroy();
      if (!response.destroyed) this.logger.warn(`Chuyển tiếp tệp hỏng giữa chừng: ${describeStorageError(error)}`);
    }
  }

  @Put(':token')
  async upload(@Param('token') token: string, @Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    const ticket = this.storages.verifyTicket(token, 'put');
    if (!ticket) return this.fail(response, 403, 'FILE_TICKET_INVALID', 'Liên kết tải lên không hợp lệ hoặc đã hết hạn.');
    const declared = Number(request.headers['content-length']);
    if (ticket.p === 'nas') return this.uploadToNas(ticket, declared, request, response);
    if (ticket.m !== undefined && Number.isFinite(declared) && declared > ticket.m) {
      response.setHeader('Connection', 'close');
      return this.fail(response, 413, 'FILE_TOO_LARGE', 'Tệp lớn hơn mức cho phép.');
    }
    try {
      const storage = await this.storages.streamsAt(ticket.t, 'external');
      const { sizeBytes } = await storage.uploadStream(ticket.k, request, ticket.c ?? 'application/octet-stream', {
        maxBytes: ticket.m,
      });
      sendJson(response, 200, { sizeBytes });
    } catch (error) {
      if (error instanceof ObjectTooLargeError) {
        response.setHeader('Connection', 'close');
        return this.fail(response, 413, 'FILE_TOO_LARGE', 'Tệp lớn hơn mức cho phép.');
      }
      if (request.destroyed && !request.complete) {
        this.logger.warn(`Trình duyệt ngắt giữa lúc tải lên ${ticket.k}.`);
        return;
      }
      return this.storageFailure(response, error);
    }
  }

  /** NAS nhận multipart có độ dài cố định: trình duyệt phải gửi đúng số byte đã khai lúc xin phiếu. */
  private async uploadToNas(
    ticket: { t: string; k: string; n?: string; m?: number },
    declared: number,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!ticket.n || ticket.m === undefined || declared !== ticket.m) {
      response.setHeader('Connection', 'close');
      return this.fail(response, 400, 'FILE_SIZE_MISMATCH', 'Dung lượng tệp gửi lên khác với lúc xin tải lên; thử lại.');
    }
    const abort = new AbortController();
    request.on('aborted', () => abort.abort());
    try {
      await this.nas.acceptUpload(ticket.t, ticket.k, ticket.n, request, ticket.m, abort.signal);
      sendJson(response, 200, { sizeBytes: ticket.m });
    } catch (error) {
      if (request.destroyed && !request.complete) {
        this.logger.warn(`Trình duyệt ngắt giữa lúc tải lên NAS ${ticket.k}/${ticket.n}.`);
        return;
      }
      return this.storageFailure(response, error);
    }
  }

  private storageFailure(response: ServerResponse, error: unknown): void {
    if (error instanceof SharedError) return this.fail(response, error.statusCode, error.code, error.message);
    const message = describeStorageError(error);
    this.logger.error(`Kho lưu trữ ngoài lỗi: ${message}`);
    return this.fail(response, 502, 'EXTERNAL_STORAGE_FAILED', `Kho lưu trữ của công ty đang lỗi: ${message}`);
  }

  private fail(response: ServerResponse, statusCode: number, code: string, message: string): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, statusCode, { statusCode, code, message });
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
