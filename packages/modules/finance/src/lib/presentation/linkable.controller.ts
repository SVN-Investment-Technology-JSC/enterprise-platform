import {
  clampLinkableLimit,
  parseLinkableIds,
  type LinkableCandidateList,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import { Controller, Get, HttpException, Inject, Query, Req } from '@nestjs/common';
import { FinanceApplication } from '../application/finance.application.js';
import type { FinanceActor } from '../domain/finance.access.js';
import { FinanceError } from '../domain/finance.error.js';
import {
  financeLinkableKinds,
  isFinanceLinkableKind,
  voucherCandidate,
  voucherKindOfLinkable,
  voucherObject,
  type FinanceLinkableKind,
} from './linkable.mapper.js';

interface FinanceRequest {
  financeActor?: FinanceActor;
}

/** Cỡ trang màn danh sách phiếu nhận (10, 20, 50); xin cỡ nhỏ nhất đủ chứa `limit` rồi cắt lại. */
const pageSizeFor = (limit: number) => (limit <= 10 ? 10 : limit <= 20 ? 20 : 50);

/**
 * Tài chính công bố phiếu để module khác (Workspace) gắn làm "đối tượng liên quan". Chỉ đọc.
 *
 * Gọi lại đúng service sẵn có (cùng `listVouchers`, `voucher` mà màn Tài chính dùng), nên quyền và phạm vi dữ liệu y hệt màn
 * hình Tài chính: người không xem được phiếu ở đây thì cũng không tìm, không gắn được. Guard của Tài chính chặn trước như mọi
 * route người dùng khác. Không thêm truy vấn hay bảng nào. Hợp đồng route: `contracts-integration` (`linkable-objects.ts`).
 */
@Controller('v1/linkable')
export class LinkableController {
  constructor(@Inject(FinanceApplication) private readonly app: FinanceApplication) {}

  /** Chỉ các loại người dùng vào được danh sách (lập, duyệt loại đó hoặc đọc toàn bộ phiếu). */
  @Get('kinds')
  kinds(@Req() request: FinanceRequest): Promise<LinkableKindList> {
    return run(() => ({ kinds: financeLinkableKinds(actorOf(request)) }));
  }

  /** `q` rỗng: phiếu mới nhất trước (theo ngày chứng từ), như màn danh sách. */
  @Get('search')
  search(
    @Req() request: FinanceRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<LinkableCandidateList> {
    return run(async () => {
      const actor = actorOf(request);
      const type = requireKind(kind);
      const size = clampLinkableLimit(limit);
      const list = await this.app.listVouchers(actor, {
        kind: voucherKindOfLinkable(type),
        search: (q ?? '').trim().slice(0, 100) || undefined,
        page: 1,
        pageSize: pageSizeFor(size),
      });
      return { items: list.items.slice(0, size).map(voucherCandidate) };
    });
  }

  /** Hồ sơ đầy đủ theo lô; id không thấy, không có quyền hoặc khác loại thì bỏ qua, không làm hỏng cả lô. */
  @Get('resolve')
  resolve(
    @Req() request: FinanceRequest,
    @Query('kind') kind?: string,
    @Query('ids') ids?: string,
  ): Promise<LinkableObjectList> {
    return run(async () => {
      const actor = actorOf(request);
      const type = requireKind(kind);
      const settled = await Promise.all(parseLinkableIds(ids).map((id) => this.readOne(actor, type, id)));
      return { items: settled.filter((item): item is LinkableObject => item !== undefined) };
    });
  }

  private async readOne(actor: FinanceActor, kind: FinanceLinkableKind, id: string): Promise<LinkableObject | undefined> {
    try {
      const voucher = await this.app.voucher(actor, id);
      return voucher.kind === voucherKindOfLinkable(kind) ? voucherObject(voucher) : undefined;
    } catch (error) {
      // Không tìm thấy, không trong phạm vi, id sai định dạng: bỏ qua dòng này. Lỗi khác là bug, ném tiếp.
      if (error instanceof FinanceError || (error as { code?: string } | null)?.code === '22P02') return undefined;
      throw error;
    }
  }
}

function actorOf(request: FinanceRequest): FinanceActor {
  if (!request.financeActor) throw new HttpException({ code: 'UNAUTHORIZED', message: 'Thiếu danh tính người dùng.' }, 401);
  return request.financeActor;
}

function requireKind(kind: unknown): FinanceLinkableKind {
  if (!isFinanceLinkableKind(kind)) {
    throw new HttpException({ statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Tài chính.' }, 400);
  }
  return kind;
}

/** Đổi lỗi nghiệp vụ thành HTTP như controller Tài chính; lỗi lạ giữ nguyên để Nest ghi log 500. */
async function run<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FinanceError)
      throw new HttpException({ code: error.code, message: error.message, details: error.details }, error.status);
    throw error;
  }
}
