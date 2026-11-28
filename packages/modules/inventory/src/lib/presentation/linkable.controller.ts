import {
  clampLinkableLimit,
  parseLinkableIds,
  type LinkableCandidateList,
  type LinkableKindList,
  type LinkableObject,
  type LinkableObjectList,
} from '@enterprise-platform/contracts-integration';
import type { StockDocument } from '@enterprise-platform/contracts-inventory';
import { Controller, Get, HttpException, Query, Req } from '@nestjs/common';
import { InventoryApplication, type InventoryActor } from '../application/inventory.application.js';
import { StockDocumentService } from '../application/stock-document.service.js';
import { StocktakeService } from '../application/stocktake.service.js';
import { InventoryError, toInventoryError } from '../domain/inventory.error.js';
import {
  DOCUMENT_TYPES_BY_KIND,
  INVENTORY_LINKABLE_KINDS,
  INVENTORY_LINKABLE_KIND_LIST,
  assetCandidate,
  assetObject,
  assetSearchParts,
  documentCandidate,
  documentKindOf,
  documentObject,
  documentSearchParts,
  isDocumentKind,
  isInventoryLinkableKind,
  materialCandidate,
  materialObject,
  materialSearchParts,
  matchesSearch,
  newestFirst,
  stocktakeCandidate,
  stocktakeObject,
  type AssetCustody,
  type InventoryDocumentKind,
  type InventoryLinkableKind,
} from './linkable.mapper.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Số chứng từ mới nhất quét khi tìm theo chữ. Danh sách chứng từ kho chưa có tham số tìm theo chữ, nên lọc trên trang
 * mới nhất (đúng mức trần trang của store); mã chứng từ gõ đủ thì đọc thẳng nên vẫn ra dù cũ hơn.
 */
const DOCUMENT_SEARCH_WINDOW = 200;

/**
 * Kho công bố hồ sơ để module khác (Workspace) gắn làm "đối tượng liên quan". Chỉ đọc.
 *
 * Gọi lại đúng các service sẵn có, cùng `list`, `get` mà các route GET của màn Kho dùng (`v1/stock-documents`,
 * `v1/stocktakes`, `v1/materials`, `v1/assets`, `v1/custody/assets`). Guard của inventory-api cho mọi route GET đi bằng
 * quyền `inventory.read` (không có quyền đọc riêng theo loại hồ sơ), nên mọi loại đều hiện với người vào được Kho; người
 * không có quyền đọc Kho bị guard chặn trước khi tới đây. Không thêm truy vấn hay bảng nào.
 * Hợp đồng route: `contracts-integration` (`linkable-objects.ts`).
 */
@Controller('v1/linkable')
export class LinkableController {
  constructor(
    private readonly app: InventoryApplication,
    private readonly documents: StockDocumentService,
    private readonly stocktakes: StocktakeService,
  ) {}

  @Get('kinds')
  kinds(@Req() request: InventoryRequest): LinkableKindList {
    this.actor(request);
    return { kinds: INVENTORY_LINKABLE_KIND_LIST };
  }

  @Get('search')
  search(
    @Req() request: InventoryRequest,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<LinkableCandidateList> {
    return this.execute(async () => {
      const actor = this.actor(request);
      const type = requireKind(kind);
      const text = (q ?? '').trim().slice(0, 100);
      const size = clampLinkableLimit(limit);
      if (isDocumentKind(type)) {
        return { items: (await this.searchDocuments(actor, type, text, size)).map(documentCandidate) };
      }
      switch (type) {
        case INVENTORY_LINKABLE_KINDS.stocktake: {
          const page = await this.stocktakes.list(actor, { search: text || undefined, limit: size });
          return { items: page.items.map(stocktakeCandidate) };
        }
        case INVENTORY_LINKABLE_KINDS.material: {
          const rows = await this.app.listMaterials(actor);
          return { items: pick(rows, text, size, materialSearchParts).map(materialCandidate) };
        }
        case INVENTORY_LINKABLE_KINDS.asset: {
          const rows = await this.app.listAssets(actor);
          return { items: pick(rows, text, size, assetSearchParts).map(assetCandidate) };
        }
      }
      return { items: [] };
    });
  }

  /** Hồ sơ đầy đủ theo lô; id không thấy hoặc không có quyền thì bỏ qua, không làm hỏng cả lô. */
  @Get('resolve')
  resolve(
    @Req() request: InventoryRequest,
    @Query('kind') kind?: string,
    @Query('ids') ids?: string,
  ): Promise<LinkableObjectList> {
    return this.execute(async () => {
      const actor = this.actor(request);
      const type = requireKind(kind);
      const wanted = parseLinkableIds(ids);
      if (!wanted.length) return { items: [] };
      // Phần cấp phát của tài sản nằm ở danh sách tab Tài sản; đọc một lần cho cả lô.
      const custody =
        type === INVENTORY_LINKABLE_KINDS.asset
          ? new Map<string, AssetCustody>(
              (await this.app.listCustodyAssets(actor)).map((row) => [row.code.toUpperCase(), row]),
            )
          : undefined;
      const settled = await Promise.all(wanted.map((id) => this.readOne(actor, type, id, custody)));
      return { items: settled.filter((item): item is LinkableObject => item !== undefined) };
    });
  }

  private async readOne(
    actor: InventoryActor,
    kind: InventoryLinkableKind,
    id: string,
    custody?: ReadonlyMap<string, AssetCustody>,
  ): Promise<LinkableObject | undefined> {
    try {
      if (isDocumentKind(kind)) {
        const document = await this.documents.get(actor, id);
        // Id của chứng từ thuộc nhóm khác (gắn nhầm loại) thì coi như không thấy.
        return documentKindOf(document.docType) === kind ? documentObject(document) : undefined;
      }
      switch (kind) {
        case INVENTORY_LINKABLE_KINDS.stocktake:
          return stocktakeObject(await this.stocktakes.get(actor, id));
        case INVENTORY_LINKABLE_KINDS.material:
          return materialObject(await this.app.getMaterial(actor, id));
        case INVENTORY_LINKABLE_KINDS.asset: {
          const asset = await this.app.getAsset(actor, id);
          return assetObject(asset, custody?.get(asset.code.toUpperCase()));
        }
      }
      return undefined;
    } catch (error) {
      // Không tìm thấy, id sai định dạng: bỏ qua dòng này. Lỗi khác là bug, ném tiếp.
      if (error instanceof InventoryError || (error as { code?: string } | null)?.code === '22P02') return undefined;
      throw error;
    }
  }

  /**
   * Chứng từ của một nhóm loại, mới nhất trước. Có chữ tìm thì lọc trên trang mới nhất theo mã, kho, ghi chú, vật tư
   * trên dòng; gõ đúng mã chứng từ thì đọc thẳng bằng `get` để không bỏ sót chứng từ cũ.
   */
  private async searchDocuments(
    actor: InventoryActor,
    kind: InventoryDocumentKind,
    q: string,
    limit: number,
  ): Promise<StockDocument[]> {
    const docTypes = DOCUMENT_TYPES_BY_KIND[kind];
    if (!q) return [...(await this.documents.list(actor, { docTypes, limit })).items];
    const page = await this.documents.list(actor, { docTypes, limit: DOCUMENT_SEARCH_WINDOW });
    const matches = page.items.filter((row) => matchesSearch(q, documentSearchParts(row)));
    if (!matches.some((row) => row.code.toUpperCase() === q.toUpperCase())) {
      const exact = await this.exactDocument(actor, q);
      if (exact && documentKindOf(exact.docType) === kind) matches.unshift(exact);
    }
    return matches.slice(0, limit);
  }

  private async exactDocument(actor: InventoryActor, code: string): Promise<StockDocument | undefined> {
    try {
      return await this.documents.get(actor, code);
    } catch (error) {
      if (error instanceof InventoryError || (error as { code?: string } | null)?.code === '22P02') return undefined;
      throw error;
    }
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
      const known = toInventoryError(error);
      if (!known) throw error;
      throw new HttpException(
        { ...known.details, statusCode: known.statusCode, code: known.code, message: known.message },
        known.statusCode,
      );
    }
  }
}

/** Danh mục đọc cả bảng (như màn Kho): lọc theo chữ, không có chữ thì mới tạo nhất trước. */
function pick<T extends { readonly createdAt?: string }>(
  rows: readonly T[],
  q: string,
  limit: number,
  parts: (row: T) => readonly (string | undefined)[],
): T[] {
  const matched = q ? rows.filter((row) => matchesSearch(q, parts(row))) : newestFirst(rows);
  return matched.slice(0, limit);
}

function requireKind(kind: unknown): InventoryLinkableKind {
  if (!isInventoryLinkableKind(kind)) {
    throw new HttpException({ statusCode: 400, code: 'VALIDATION', message: 'Loại đối tượng không thuộc Kho.' }, 400);
  }
  return kind;
}
