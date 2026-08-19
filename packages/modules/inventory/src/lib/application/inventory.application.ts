import { Inject, Injectable } from '@nestjs/common';
import type {
  Asset,
  CreateStockReservationRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  SerialTracking,
  UpdateAssetRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryStore } from './inventory-store.port.js';
import { INVENTORY_STORE } from './inventory-store.port.js';
import {
  AssetNotFoundError,
  InventoryError,
  InvalidReservationError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';

/** Resolved by the access guard from the caller's session or service token. */
export interface InventoryActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly canManage: boolean;
}

@Injectable()
export class InventoryApplication {
  constructor(@Inject(INVENTORY_STORE) private readonly store: InventoryStore) {}

  async getWarehouse(actor: InventoryActor, code: string): Promise<Warehouse> {
    const warehouse = await this.store.warehouse.findByCode(actor.tenantId, code);
    if (!warehouse) throw new WarehouseNotFoundError(code);
    return warehouse;
  }

  listWarehouses(actor: InventoryActor): Promise<Warehouse[]> {
    return this.store.warehouse.list(actor.tenantId);
  }

  async getMaterial(actor: InventoryActor, code: string): Promise<Material> {
    const material = await this.store.material.findByCode(actor.tenantId, code);
    if (!material) throw new MaterialNotFoundError(code);
    return material;
  }

  listMaterials(actor: InventoryActor): Promise<Material[]> {
    return this.store.material.list(actor.tenantId);
  }

  async getAsset(actor: InventoryActor, code: string): Promise<Asset> {
    const asset = await this.store.asset.findByCode(actor.tenantId, code);
    if (!asset) throw new AssetNotFoundError(code);
    return asset;
  }

  /** Sửa hồ sơ kỹ thuật của thiết bị: thông số và danh sách đầu việc mặc định. */
  async updateAsset(
    actor: InventoryActor,
    code: string,
    patch: UpdateAssetRequest,
  ): Promise<Asset> {
    for (const task of patch.taskTemplate ?? []) {
      if (!task.key?.trim() || !task.name?.trim()) {
        throw new InventoryError('VALIDATION', 'Mỗi đầu việc phải có mã và tên.');
      }
    }
    const keys = (patch.taskTemplate ?? []).map((task) => task.key.trim().toUpperCase());
    if (new Set(keys).size !== keys.length) {
      throw new InventoryError('VALIDATION', 'Mã đầu việc phải là duy nhất trong một thiết bị.');
    }

    const updated = await this.store.asset.update(actor.tenantId, code, patch);
    if (!updated) throw new AssetNotFoundError(code);
    return updated;
  }

  listAssets(actor: InventoryActor): Promise<Asset[]> {
    return this.store.asset.list(actor.tenantId);
  }

  /** Feeds Role E task decomposition in the Procedure module. */
  async resolveAssetTaskTemplate(
    actor: InventoryActor,
    assetCode: string,
  ): Promise<Record<string, unknown>[] | null> {
    await this.getAsset(actor, assetCode);
    return this.store.taskTemplate.resolveAssetTaskTemplate(actor.tenantId, assetCode);
  }

  getStockLevel(
    actor: InventoryActor,
    materialCode: string,
    warehouseCode: string,
  ): Promise<MaterialInventory | null> {
    return this.store.inventory.findByMaterialAndWarehouse(
      actor.tenantId,
      materialCode,
      warehouseCode,
    );
  }

  listStockByWarehouse(actor: InventoryActor, warehouseCode: string): Promise<MaterialInventory[]> {
    return this.store.inventory.listByWarehouse(actor.tenantId, warehouseCode);
  }

  listRecentTransactions(actor: InventoryActor, limit = 50): Promise<InventoryTransaction[]> {
    return this.store.transaction.listRecent(actor.tenantId, Math.min(Math.max(limit, 1), 200));
  }

  listReservations(actor: InventoryActor): Promise<Reservation[]> {
    return this.store.reservation.list(actor.tenantId);
  }

  listSerials(actor: InventoryActor): Promise<SerialTracking[]> {
    return this.store.serial.list(actor.tenantId);
  }

  /** Inbound movement — positive ledger quantity. */
  receiveStock(
    actor: InventoryActor,
    input: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      unitCost?: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
    },
  ): Promise<InventoryTransaction> {
    this.requireManager(actor);
    this.requirePositive(input.quantity);
    return this.store.transaction.append(actor.tenantId, {
      ...input,
      type: 'IMPORT',
      quantity: input.quantity,
      createdBy: actor.userId,
    });
  }

  /** Outbound movement — stored as a negative ledger quantity. */
  issueStock(
    actor: InventoryActor,
    input: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
    },
  ): Promise<InventoryTransaction> {
    this.requireManager(actor);
    this.requirePositive(input.quantity);
    return this.store.transaction.append(actor.tenantId, {
      ...input,
      type: 'EXPORT',
      quantity: -input.quantity,
      createdBy: actor.userId,
    });
  }

  /** Two ledger rows: TRANSFER_OUT at source, TRANSFER_IN at destination. */
  async transferStock(
    actor: InventoryActor,
    input: {
      fromWarehouseCode: string;
      toWarehouseCode: string;
      materialCode: string;
      quantity: number;
      note?: string;
    },
  ): Promise<{ out: InventoryTransaction; in: InventoryTransaction }> {
    this.requireManager(actor);
    this.requirePositive(input.quantity);
    if (input.fromWarehouseCode === input.toWarehouseCode) {
      throw new InvalidReservationError('Kho nguồn và kho đích phải khác nhau.');
    }

    const out = await this.store.transaction.append(actor.tenantId, {
      warehouseCode: input.fromWarehouseCode,
      materialCode: input.materialCode,
      type: 'TRANSFER_OUT',
      quantity: -input.quantity,
      note: input.note,
      createdBy: actor.userId,
    });
    const inbound = await this.store.transaction.append(actor.tenantId, {
      warehouseCode: input.toWarehouseCode,
      materialCode: input.materialCode,
      type: 'TRANSFER_IN',
      quantity: input.quantity,
      referenceType: 'inventory_transaction',
      referenceId: out.id,
      note: input.note,
      createdBy: actor.userId,
    });

    return { out, in: inbound };
  }

  createStockReservation(
    actor: InventoryActor,
    request: CreateStockReservationRequest,
  ): Promise<Reservation> {
    this.requireManager(actor);
    if (!request.items?.length) {
      throw new InvalidReservationError('Yêu cầu giữ vật tư phải có ít nhất một dòng.');
    }
    for (const item of request.items) {
      this.requirePositive(item.quantityReserved);
    }

    return this.store.reservation.create(actor.tenantId, {
      referenceType: request.referenceType,
      referenceId: request.referenceId,
      expiresAt: request.expiresAt,
      createdBy: actor.userId,
      items: request.items.map((item) => ({
        warehouseCode: request.warehouseCode,
        materialCode: item.materialCode,
        quantityReserved: item.quantityReserved,
      })),
    });
  }

  async getReservation(actor: InventoryActor, code: string): Promise<Reservation> {
    const reservation = await this.store.reservation.findByCode(actor.tenantId, code);
    if (!reservation) {
      throw new InvalidReservationError(`Không tìm thấy phiếu giữ vật tư ${code}.`);
    }
    return reservation;
  }

  findReservationsByReference(
    actor: InventoryActor,
    referenceType: string,
    referenceId: string,
  ): Promise<Reservation[]> {
    return this.store.reservation.findByReference(actor.tenantId, referenceType, referenceId);
  }

  private requireManager(actor: InventoryActor): void {
    if (!actor.canManage) {
      throw new InvalidReservationError('Bạn không có quyền thao tác kho.');
    }
  }

  private requirePositive(quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InvalidReservationError('Số lượng phải là số dương.');
    }
  }
}
