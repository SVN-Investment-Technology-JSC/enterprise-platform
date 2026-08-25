export class InventoryError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, InventoryError.prototype);
  }
}

export class WarehouseNotFoundError extends InventoryError {
  constructor(warehouseCode: string) {
    super('WAREHOUSE_NOT_FOUND', `Không tìm thấy kho ${warehouseCode}.`, 404);
  }
}

export class MaterialNotFoundError extends InventoryError {
  constructor(materialCode: string) {
    super('MATERIAL_NOT_FOUND', `Không tìm thấy vật tư ${materialCode}.`, 404);
  }
}

export class AssetNotFoundError extends InventoryError {
  constructor(assetCode: string) {
    super('ASSET_NOT_FOUND', `Không tìm thấy thiết bị ${assetCode}.`, 404);
  }
}

export class InsufficientStockError extends InventoryError {
  constructor(materialCode: string, requested: number, available: number) {
    super(
      'INSUFFICIENT_STOCK',
      `Insufficient stock for ${materialCode}: requested ${requested}, available ${available}`,
      400
    );
  }
}

export class InvalidReservationError extends InventoryError {
  constructor(message: string) {
    super('INVALID_RESERVATION', message, 400);
  }
}

export class UnknownSettingsKeyError extends InventoryError {
  constructor(key: string) {
    super('UNKNOWN_SETTINGS_KEY', `Khoá cấu hình ${key} không hợp lệ.`, 400);
  }
}

export class SettingsVersionConflictError extends InventoryError {
  constructor(key: string) {
    super(
      'SETTINGS_VERSION_CONFLICT',
      `Cấu hình ${key} đã được người khác sửa; tải lại rồi lưu lại.`,
      409,
    );
  }
}
