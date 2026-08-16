export type ProcedureEngineErrorCode =
  | 'validation'
  | 'forbidden'
  | 'not_found'
  | 'conflict';

export class ProcedureEngineError extends Error {
  constructor(
    readonly code: ProcedureEngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProcedureEngineError';
  }
}
