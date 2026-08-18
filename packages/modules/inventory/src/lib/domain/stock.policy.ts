import { InventoryError } from './inventory.error.js';
export function availableStock(onHand:number,reserved:number,quarantine=0,damaged=0):number { return onHand-reserved-quarantine-damaged; }
export function assertCanIssue(available:number,requested:number):void {
  if (!Number.isFinite(requested)||requested<=0) throw new InventoryError('validation','Số lượng phải lớn hơn 0.');
  if (available<requested) throw new InventoryError('insufficient_stock',`Tồn khả dụng ${available} không đủ để xuất ${requested}.`);
}
