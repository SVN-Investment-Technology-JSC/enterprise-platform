import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('notification tenant migration', () => {
  it('creates the durable notification tables and sequence constraint', async () => {
    const sql = await readFile(
      resolve(__dirname, '../../../../../migrations/tenant/core/0008-notifications.sql'),
      'utf8',
    );

    for (const table of [
      'notifications',
      'user_state',
      'preferences',
      'notification_events',
      'inbox_messages',
      'schedule_emissions',
    ]) {
      expect(sql).toContain(`notification_schema.${table}`);
    }
    expect(sql).toMatch(/UNIQUE\s*\(user_id,\s*sequence\)/i);
  });
});
