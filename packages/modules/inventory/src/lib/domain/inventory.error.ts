export type InventoryErrorCode = 'validation'|'forbidden'|'not_found'|'conflict'|'insufficient_stock';
export class InventoryError extends Error { constructor(readonly code:InventoryErrorCode,message:string){ super(message); this.name='InventoryError'; } }
