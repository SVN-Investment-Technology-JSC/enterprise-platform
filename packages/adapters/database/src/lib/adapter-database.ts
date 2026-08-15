export interface ConnectionFactory<TConfig, TConnection> {
  create(config: TConfig): Promise<TConnection>;
  close(connection: TConnection): Promise<void>;
}

export interface PoolRegistry<TKey, TConnection> {
  get(key: TKey): TConnection | undefined;
  set(key: TKey, connection: TConnection): void;
  delete(key: TKey): void;
}

export interface TransactionRunner<TConnection> {
  run<TValue>(
    connection: TConnection,
    operation: (connection: TConnection) => Promise<TValue>,
  ): Promise<TValue>;
}

export function createConnectionKey(...parts: readonly string[]): string {
  if (parts.length === 0 || parts.some((part) => part.trim().length === 0)) {
    throw new Error('A connection key requires non-empty parts.');
  }

  return parts.join(':');
}
