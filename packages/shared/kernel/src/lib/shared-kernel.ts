export interface DomainEvent<TPayload = unknown> {
  readonly type: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export type Result<TValue, TError = Error> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

export const Result = {
  ok<TValue>(value: TValue): Result<TValue, never> {
    return { ok: true, value };
  },
  err<TError>(error: TError): Result<never, TError> {
    return { ok: false, error };
  },
};
