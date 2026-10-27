import { Controller, Get, HttpException, Query, Req } from '@nestjs/common';
import type { MaterialKind } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from '../application/inventory.application.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/** Loại mặt hàng trả về khi bên gọi không chỉ định; Quy trình chọn vật tư không cần dịch vụ. */
const DEFAULT_CATALOG_KINDS: readonly MaterialKind[] = ['STOCK'];

/** Tách tham số dạng danh sách cách nhau bằng dấu phẩy; bỏ phần tử rỗng. */
function list(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/**
 * Danh mục mặt hàng cho phân hệ khác (T1-24). Route `internal/` đi qua xác thực
 * dịch vụ của guard inventory-api.
 *
 * `GET v1/internal/materials?search=&ids=&codes=&warehouseCode=&kind=&limit=&cursor=`
 * trả `{ materials, nextCursor }`. Quy trình gọi không tham số và chỉ đọc
 * `code`, `name`, `unit`, `available` như trước.
 */
@Controller('v1')
export class InternalCatalogController {
  constructor(private readonly app: InventoryApplication) {}

  @Get('internal/materials')
  listMaterials(
    @Req() request: InventoryRequest,
    @Query('search') search?: string,
    @Query('ids') ids?: string,
    @Query('codes') codes?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.execute(() =>
      this.app.listMaterialCatalog(this.actor(request), {
        search,
        ids: list(ids),
        codes: list(codes),
        warehouseCode,
        // Không truyền `kind` thì giữ hành vi cũ: chỉ mặt hàng có tồn. Bán hàng
        // muốn lấy cả dịch vụ thì truyền rõ `kind=STOCK,SERVICE`.
        kinds: (list(kind) ?? DEFAULT_CATALOG_KINDS) as MaterialKind[],
        limit: limit ? Number(limit) : undefined,
        cursor,
      }),
    );
  }

  private actor(request: InventoryRequest): InventoryActor {
    if (!request.inventoryActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted inventory context.' },
        401,
      );
    }
    return request.inventoryActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof InventoryError)) throw error;
      throw new HttpException(
        { ...error.details, statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
