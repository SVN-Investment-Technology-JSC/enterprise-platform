import type {
  CreateStocktakeRequest,
  StocktakeLine,
  StocktakeSession,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import type { InventoryActor } from './inventory.application.js';
import type { LatestMaterialStocktake, StocktakeStore } from './stocktake-store.port.js';

function requireTransactionWrite(actor: InventoryActor): void {
  if (!(actor.canWriteTransactions ?? actor.canManage)) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền thao tác kiểm kê kho.', 403);
  }
}

function requireStocktakeApprove(actor: InventoryActor): void {
  if (!(actor.canApproveStocktake ?? actor.canManage)) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền duyệt và ghi sổ kiểm kê kho.', 403);
  }
}

/**
 * Nghiệp vụ Kiểm kê kho (`Stocktake`).
 * Dữ liệu phiên, snapshot tồn đầu, chi tiết đếm và bút toán cân kho đều chạy trên server.
 */
export class StocktakeService {
  constructor(private readonly store: StocktakeStore) {}

  listSessions(actor: InventoryActor): Promise<StocktakeSession[]> {
    return this.store.listSessions(actor.tenantId);
  }

  listLines(actor: InventoryActor, sessionId: string): Promise<StocktakeLine[]> {
    if (!sessionId?.trim()) {
      throw new InventoryError('INVALID_INPUT', 'Thiếu mã phiên kiểm kê.');
    }
    return this.store.listLines(actor.tenantId, sessionId.trim());
  }

  latestByMaterial(
    actor: InventoryActor,
    materialCode: string,
  ): Promise<LatestMaterialStocktake | null> {
    if (!materialCode?.trim()) {
      throw new InventoryError('INVALID_INPUT', 'Thiếu mã vật tư.');
    }
    return this.store.latestByMaterial(actor.tenantId, materialCode.trim());
  }

  createSession(
    actor: InventoryActor,
    input: CreateStocktakeRequest,
  ): Promise<StocktakeSession> {
    requireTransactionWrite(actor);
    if (!input?.title?.trim()) {
      throw new InventoryError('INVALID_INPUT', 'Tên đợt kiểm kê không được để trống.');
    }
    if (!input?.warehouseCode?.trim()) {
      throw new InventoryError('INVALID_INPUT', 'Vui lòng chọn kho kiểm kê.');
    }
    return this.store.createSession(actor.tenantId, input);
  }

  startCounting(
    actor: InventoryActor,
    sessionId: string,
  ): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
    requireTransactionWrite(actor);
    return this.store.startCounting(actor.tenantId, sessionId);
  }

  saveLines(
    actor: InventoryActor,
    sessionId: string,
    updates: readonly UpdateStocktakeLineInput[],
  ): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
    requireTransactionWrite(actor);
    return this.store.saveLines(
      actor.tenantId,
      sessionId,
      updates ?? [],
      actor.displayName || actor.userId,
    );
  }

  submitForApproval(actor: InventoryActor, sessionId: string): Promise<StocktakeSession> {
    requireTransactionWrite(actor);
    return this.store.submitForApproval(actor.tenantId, sessionId);
  }

  approveAndPost(
    actor: InventoryActor,
    sessionId: string,
  ): Promise<{ session: StocktakeSession; transactionsCreated: number }> {
    requireStocktakeApprove(actor);
    return this.store.approveAndPost(actor.tenantId, sessionId, actor.userId);
  }

  rejectSession(
    actor: InventoryActor,
    sessionId: string,
    reason?: string,
  ): Promise<StocktakeSession> {
    requireStocktakeApprove(actor);
    return this.store.rejectSession(actor.tenantId, sessionId, reason);
  }

  cancelSession(
    actor: InventoryActor,
    sessionId: string,
    reason?: string,
  ): Promise<StocktakeSession> {
    requireTransactionWrite(actor);
    return this.store.cancelSession(actor.tenantId, sessionId, reason);
  }
}
