export interface InventoryNotificationEvent {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function lowStockNotificationEvent(input: {
  readonly alertId: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly available: number;
  readonly minimum: number;
}): InventoryNotificationEvent {
  return {
    type: 'inventory.stock.low',
    aggregateType: 'inventory-material',
    aggregateId: input.materialId,
    payload: {
      sourceId: input.alertId,
      sourceType: 'inventory_material',
      materialId: input.materialId,
      materialCode: input.materialCode,
      materialName: input.materialName,
      available: input.available,
      minimum: input.minimum,
      summary: `${input.materialName} (${input.materialCode}) còn ${input.available}, dưới mức tối thiểu ${input.minimum}.`,
      deepLink: `/inventory/materials/${input.materialId}`,
    },
  };
}
