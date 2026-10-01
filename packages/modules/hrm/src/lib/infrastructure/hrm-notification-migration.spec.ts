import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';

const migration = readFileSync(
  resolve(process.cwd(), '../../../migrations/tenant/hrm/0021-notification-outbox-v1.sql'),
  'utf8',
);

describe('HRM notification compatibility migration', () => {
  it('backfills the unified feed and retires legacy notification writes', () => {
    expect(migration).toContain('notification_schema.notifications');
    expect(migration).toContain('notification_schema.user_state');
    expect(migration).toContain("interval '90 days'");
    expect(migration).not.toMatch(
      /CREATE OR REPLACE FUNCTION hrm_schema\.record_request_event[\s\S]*?INSERT INTO hrm_schema\.notifications/,
    );
  });

  it('publishes request status events with a routable tenant user', () => {
    expect(migration).toContain("'requesterUserId',requester_user_id");
    expect(migration).toContain("'hrm.request.status-changed'");
  });
});

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

integration('HRM notification compatibility migration on PostgreSQL', () => {
  const databaseName = `hrm_notification_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const employeeId = randomUUID();
  const requestId = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;

  const migrate = async (path: string) =>
    pool.query(
      readFileSync(resolve(process.cwd(), '../../../migrations/tenant', path), 'utf8'),
    );

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Local DB required');
    }
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    pool = createPostgresPool(url.toString());
    for (const path of [
      'core/0001-core-schema.sql',
      'core/0002-organization-soft-delete.sql',
      'core/0006-employees.sql',
      'core/0008-notifications.sql',
      '0001-integration.sql',
      'hrm/0001-hrm.sql',
      'hrm/0002-employee-identity.sql',
      'hrm/0003-time-operations.sql',
      'hrm/0004-leave-operations.sql',
      'hrm/0005-timesheet-calculation.sql',
      'hrm/0006-payroll-formulas.sql',
      'hrm/0007-work-references.sql',
      'hrm/0008-profile-corrections.sql',
      'hrm/0009-leave-carryover.sql',
      'hrm/0010-attachments.sql',
      'hrm/0011-advance-settlement.sql',
      'hrm/0012-operations-and-workflow.sql',
    ]) {
      await migrate(path);
    }
    await pool.query(
      `INSERT INTO core_schema.users(id,full_name,email,password_hash)
       VALUES ($1,'Nguyễn Minh Anh','minhanh-notification@example.test','test')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,user_id,full_name)
       VALUES ($1,$2,$3,'Nguyễn Minh Anh')`,
      [employeeId, tenantId, userId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.notifications
        (tenant_id,employee_id,request_kind,request_id,status,created_at,read_at)
       VALUES
        ($1,$2,'leave',$3,'PENDING',now()-interval '2 minutes',now()),
        ($1,$2,'leave',$3,'APPROVED',now()-interval '1 minute',NULL)`,
      [tenantId, employeeId, requestId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_notification_[a-f0-9]{32}$/.test(databaseName)) {
        throw new Error('Invalid test DB');
      }
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  it('backfills the newest request state once and rebuilds unread state', async () => {
    await migrate('hrm/0021-notification-outbox-v1.sql');
    await migrate('hrm/0021-notification-outbox-v1.sql');

    const feed = await pool.query(
      `SELECT source_id,data->>'status' AS status,read_at
         FROM notification_schema.notifications
        WHERE user_id=$1`,
      [userId],
    );
    expect(feed.rows).toEqual([
      { source_id: requestId, status: 'APPROVED', read_at: null },
    ]);
    const state = await pool.query(
      `SELECT last_sequence::int AS last_sequence,unread_count
         FROM notification_schema.user_state WHERE user_id=$1`,
      [userId],
    );
    expect(state.rows).toEqual([{ last_sequence: 1, unread_count: 1 }]);
  });
});
