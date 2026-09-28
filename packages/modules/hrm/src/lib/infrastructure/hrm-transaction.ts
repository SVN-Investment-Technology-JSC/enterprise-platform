import type { Pool, PoolClient } from 'pg';
import { BadRequestException } from '@nestjs/common';

/** All writes in an HRM business operation share one connection and commit. */
export async function hrmTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (
      (error as { code?: string }).code === 'P0001' &&
      error instanceof Error &&
      error.message.includes('Procedure Engine')
    )
      throw new BadRequestException(error.message);
    throw error;
  } finally {
    client.release();
  }
}
