import { Inject, Injectable } from '@nestjs/common';
import type {
  Asset,
  CreateStockReservationRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryStore } from './inventory-store.port.js';
import { INVENTORY_STORE } from './inventory-store.port.js';
import {
  AssetNotFoundError,
  InvalidReservationError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';

@Injectable()
export class InventoryApplication {
  constructor(@Inject(INVENTORY_STORE) private readonly store: InventoryStore) {}

  async getWarehouse(code: string): Promise<Warehouse> {
    const warehouse = await this.store.warehouse.findByCode(code);
    if (!warehouse) throw new WarehouseNotFoundError(code);
    return warehouse;
  }

  listWarehouses(): Promise<Warehouse[]> {
    return this.store.warehouse.list();
  }

  async getMaterial(code: string): Promise<Material> {
    const material = await this.store.material.findByCode(code);
    if (!material) throw new MaterialNotFoundError(code);
    return material;
  }

  listMaterials(): Promise<Material[]> {
    return this.store.material.list();
  }

  async getAsset(code: string): Promise<Asset> {
    const asset = await this.store.asset.findByCode(code);
    if (!asset) throw new AssetNotFoundError(code);
    return asset;
  }

  listAssets(): Promise<Asset[]> {
    return this.store.asset.list();
  }

  /** Feeds Role E task decomposition in the Procedure module. */
  async resolveAssetTaskTemplate(assetCode: string): Promise<Record<string, unknown>[] | null> {
    await this.getAsset(assetCode);
    return this.store.taskTemplate.resolveAssetTaskTemplate(assetCode);
  }

  getStockLevel(materialCode: string, warehouseCode: string): Promise<MaterialInventory | null> {
    return this.store.inventory.findByMaterialAndWarehouse(materialCode, warehouseCode);
  }

  listStockByWarehouse(warehouseCode: string): Promise<MaterialInventory[]> {
    return this.store.inventory.listByWarehouse(warehouseCode);
  }

  /** Inbound movement — positive ledger quantity. */
  receiveStock(input: {
    warehouseCode: string;
    materialCode: string;
    quantity: number;
    unitCost?: number;
    referenceType?: string;
    referenceId?: string;
    note?: string;
    createdBy: string;
  }): Promise<InventoryTransaction> {
    this.requirePositive(input.quantity);
    return this.store.transaction.append({ ...input, type: 'IMPORT', quantity: input.quantity });
  }

  /** Outbound movement — stored as a negative ledger quantity. */
  issueStock(input: {
    warehouseCode: string;
    materialCode: string;
    quantity: number;
    referenceType?: string;
    referenceId?: string;
    note?: string;
    createdBy: string;
  }): Promise<InventoryTransaction> {
    this.requirePositive(input.quantity);
    return this.store.transaction.append({ ...input, type: 'EXPORT', quantity: -input.quantity });
  }

  /** Two ledger rows: TRANSFER_OUT at source, TRANSFER_IN at destination. */
  async transferStock(input: {
    fromWarehouseCode: string;
    toWarehouseCode: string;
    materialCode: string;
    quantity: number;
    note?: string;
    createdBy: string;
  }): Promise<{ out: InventoryTransaction; in: InventoryTransaction }> {
    this.requirePositive(input.quantity);
    if (input.fromWarehouseCode === input.toWarehouseCode) {
      throw new InvalidReservationError('Kho nguồn và kho đích phải khác nhau.');
    }

    const out = await this.store.transaction.append({
      warehouseCode: input.fromWarehouseCode,
      materialCode: input.materialCode,
      type: 'TRANSFER_OUT',
      quantity: -input.quantity,
      note: input.note,
      createdBy: input.createdBy,
    });
    const inbound = await this.store.transaction.append({
      warehouseCode: input.toWarehouseCode,
      materialCode: input.materialCode,
      type: 'TRANSFER_IN',
      quantity: input.quantity,
      referenceType: 'inventory_transaction',
      referenceId: out.id,
      note: input.note,
      createdBy: input.createdBy,
    });

    return { out, in: inbound };
  }

  createStockReservation(
    request: CreateStockReservationRequest,
    createdBy: string,
  ): Promise<Reservation> {
    if (!request.items?.length) {
      throw new InvalidReservationError('Yêu cầu giữ vật tư phải có ít nhất một dòng.');
    }
    for (const item of request.items) {
      this.requirePositive(item.quantityReserved);
    }

    return this.store.reservation.create({
      referenceType: request.referenceType,
      referenceId: request.referenceId,
      expiresAt: request.expiresAt,
      createdBy,
      items: request.items.map((item) => ({
        warehouseCode: request.warehouseCode,
        materialCode: item.materialCode,
        quantityReserved: item.quantityReserved,
      })),
    });
  }

  async getReservation(code: string): Promise<Reservation> {
    const reservation = await this.store.reservation.findByCode(code);
    if (!reservation) {
      throw new InvalidReservationError(`Không tìm thấy phiếu giữ vật tư ${code}.`);
    }
    return reservation;
  }

  findReservationsByReference(referenceType: string, referenceId: string): Promise<Reservation[]> {
    return this.store.reservation.findByReference(referenceType, referenceId);
  }

  private requirePositive(quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InvalidReservationError('Số lượng phải là số dương.');
    }
  }
}
