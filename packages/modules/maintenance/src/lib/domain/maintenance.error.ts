export type MaintenanceErrorCode = 'validation' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';

export class MaintenanceError extends Error {
  constructor(readonly code: MaintenanceErrorCode, message: string) {
    super(message);
    this.name = 'MaintenanceError';
  }
}
