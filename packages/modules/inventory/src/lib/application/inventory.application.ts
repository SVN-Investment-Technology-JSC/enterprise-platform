import { Injectable, Inject } from '@nestjs/common';
import type {
  Warehouse,
  Material,
  Asset,
  StockReservation,
  CreateStockReservationRequest,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryStore } from './inventory-store.port';
import { INVENTORY_STORE } from './inventory-store.port';
import {
  AssetNotFoundError,
  InvalidReservationError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error';

@Injectable()
export class InventoryApplication {
  constructor(@Inject(INVENTORY_STORE) private readonly store: InventoryStore) {}

  async getWarehouse(code: string): Promise<Warehouse> {
    const warehouse = await this.store.warehouse.findByCode(code);
    if (!warehouse) {
      throw new WarehouseNotFoundError(code);
    }
    return warehouse;
  }

  async listWarehouses(): Promise<Warehouse[]> {
    return this.store.warehouse.list();
  }

  async getMaterial(code: string): Promise<Material> {
    const material = await this.store.material.findByCode(code);
    if (!material) {
      throw new MaterialNotFoundError(code);
    }
    return material;
  }

  async listMaterials(): Promise<Material[]> {
    return this.store.material.list();
  }

  async getAsset(code: string): Promise<Asset> {
    const asset = await this.store.asset.findByCode(code);
    if (!asset) {
      throw new AssetNotFoundError(code);
    }
    return asset;
  }

  async listAssets(): Promise<Asset[]> {
    return this.store.asset.list();
  }

  async resolveAssetTaskTemplate(assetCode: string): Promise<Record<string, unknown>[] | null> {
    const asset = await this.getAsset(assetCode);
    return asset.task_template;
  }

  async resolveMaterialTaskTemplate(
    materialCode: string,
    assetCode?: string
  ): Promise<Record<string, unknown>[] | null> {
    return this.store.taskTemplate.resolveMaterialTaskTemplate(materialCode, assetCode);
  }

  async createStockReservation(
    request: CreateStockReservationRequest
  ): Promise<StockReservation> {
    const warehouse = await this.getWarehouse(request.warehouse_code);

    if (!warehouse) {
      throw new WarehouseNotFoundError(request.warehouse_code);
    }

    const reservationRequest: Omit<StockReservation, 'id' | 'created_at' | 'code'> = {
      warehouse_id: warehouse.id,
      reference_type: request.reference_type,
      reference_id: request.reference_id,
      status: 'PENDING',
      expires_at: request.expires_at,
      notes: request.notes,
      items: request.items as unknown as StockReservation['items'],
    };

    return this.store.reservation.create(reservationRequest);
  }

  async getReservation(code: string): Promise<StockReservation> {
    const reservation = await this.store.reservation.findByCode(code);
    if (!reservation) {
      throw new InvalidReservationError(`Reservation ${code} not found`);
    }
    return reservation;
  }

  async findReservationsByReference(
    referenceType: string,
    referenceId: string
  ): Promise<StockReservation[]> {
    return this.store.reservation.findByReference(referenceType, referenceId);
  }

  async receiveStock(warehouseCode: string, materialCode: string, quantity: number, unitCost: number, receivedBy: string, supplierCode?: string, referenceId?: string, notes?: string) {
    await this.getWarehouse(warehouseCode);
    await this.getMaterial(materialCode);

    const receiptCode = `RCP-${Date.now()}`;
    return this.store.receipt.create({
      code: receiptCode,
      warehouseCode,
      materialCode,
      quantity,
      unitCost,
      supplierCode,
      referenceId,
      status: 'approved',
      notes,
      receivedBy,
    });
  }

  async issueStock(warehouseCode: string, materialCode: string, quantity: number, issuedBy: string, referenceType?: string, referenceId?: string, notes?: string) {
    await this.getWarehouse(warehouseCode);
    await this.getMaterial(materialCode);

    const issueCode = `ISS-${Date.now()}`;
    return this.store.issue.create({
      code: issueCode,
      warehouseCode,
      materialCode,
      quantity,
      referenceType,
      referenceId,
      status: 'approved',
      notes,
      issuedBy,
    });
  }

  async transferStock(fromWarehouseCode: string, toWarehouseCode: string, materialCode: string, quantity: number, transferredBy: string, notes?: string) {
    await this.getWarehouse(fromWarehouseCode);
    await this.getWarehouse(toWarehouseCode);
    await this.getMaterial(materialCode);

    const transferCode = `TRN-${Date.now()}`;
    return this.store.transfer.create({
      code: transferCode,
      fromWarehouseCode,
      toWarehouseCode,
      materialCode,
      quantity,
      status: 'approved',
      notes,
      transferredBy,
    });
  }
}
