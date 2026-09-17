import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createPostgresPool,
  inTransaction,
  TenantDatabaseDestruction,
  type TenantDatabaseDestructionTarget,
  type PostgresClient,
} from '@enterprise-platform/adapter-database';
import {
  TenantStorageCleaner,
  TENANT_UPLOAD_URL_TTL_SECONDS,
} from '@enterprise-platform/adapter-storage';
import { TenantEventCleaner } from '@enterprise-platform/adapter-events';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type {
  RequestTenantDeletion,
  TenantDatabaseReference,
  TenantDeletionJob,
  TenantDeletionPreview,
  TenantDeletionStep,
} from '@enterprise-platform/contracts-tenancy';

type Pool = ReturnType<typeof createPostgresPool>;
type Client = PostgresClient;
interface Snapshot {
  tenantId: string;
  slug: string;
  name: string;
  reference: TenantDatabaseReference;
  target: TenantDatabaseDestructionTarget;
  storageLocation: string;
}
interface JobRow {
  id: string;
  tenant_id: string;
  actor_id: string;
  request_hash: string;
  status: TenantDeletionJob['status'];
  step: TenantDeletionStep;
  snapshot: Snapshot;
  attempts: number;
  error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
  next_run_at: Date;
}
interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  database_name: string;
  host: string;
  port: number;
  secret_ref: string;
  ssl: boolean;
  config_version: number;
}

export class TenantDeletionError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(messages[code] ?? messages.DELETION_FAILED);
    this.status = status;
    this.code = code;
  }
}

const messages: Record<string, string> = {
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi.',
  FORBIDDEN: 'Chỉ superadmin có quyền xóa tenant mới được thao tác.',
  CSRF_INVALID: 'CSRF token không hợp lệ.',
  DELETION_DISABLED: 'Chức năng xóa tenant chưa được bật trên hệ thống.',
  TENANT_NOT_FOUND: 'Không tìm thấy tenant.',
  JOB_NOT_FOUND: 'Không tìm thấy tác vụ xóa.',
  TENANT_DELETING: 'Tenant đang được xóa. Hãy theo dõi tác vụ hiện tại.',
  INVALID_REQUEST: 'Thông tin xác nhận xóa không hợp lệ.',
  PREVIEW_EXPIRED:
    'Thông tin tenant hoặc tài nguyên đã thay đổi. Hãy kiểm tra và xác nhận lại.',
  IDEMPOTENCY_CONFLICT: 'Mã yêu cầu đã được dùng cho nội dung khác.',
  DATABASE_TARGET_MISMATCH:
    'Cấu hình database không khớp cụm tenant được quản lý.',
  DATABASE_PROTECTED: 'Database này được bảo vệ và không thể xóa.',
  DATABASE_TARGET_NOT_FOUND:
    'Không xác minh được database của tenant. Cần đối soát cấu hình.',
  DATABASE_SHARED: 'Database đang được tham chiếu bởi tenant khác.',
  DATABASE_CLUSTER_CHANGED: 'Cụm database đã thay đổi sau khi xác nhận.',
  DATABASE_IDENTITY_CHANGED: 'Database đã được thay thế sau khi xác nhận.',
  DATABASE_ADMIN_NOT_CONFIGURED:
    'Chưa cấu hình kết nối quản trị database tenant.',
  DATABASE_DELETE_INCOMPLETE: 'Database chưa được xóa hoàn tất.',
  STORAGE_CHANGED:
    'Cấu hình lưu trữ đã thay đổi. Cần khôi phục đúng cấu hình trước khi thử lại.',
  STORAGE_DELETE_INCOMPLETE:
    'Một số tệp chưa được xóa. Kiểm tra quyền hoặc retention rồi thử lại.',
  STORAGE_PREFIX_MISMATCH: 'Phạm vi lưu trữ không hợp lệ.',
  BROKER_MANAGEMENT_NOT_CONFIGURED:
    'Chưa cấu hình API quản trị hàng đợi để kiểm chứng dữ liệu tích hợp.',
  BROKER_INSPECTION_FAILED:
    'Không kiểm chứng được hàng đợi. Kiểm tra kết nối và quyền quản trị.',
  UPLOAD_DRAIN_NOT_CONFIGURED:
    'Chưa cấu hình thời hạn upload tối đa được cưỡng chế tại cổng lưu trữ.',
  LOCK_LOST: 'Mất khóa điều phối. Tác vụ cần được thử lại.',
  RESOURCE_BUSY:
    'Tài nguyên đang bận hoặc bị khóa. Xử lý nguyên nhân rồi thử lại.',
  RESOURCE_PERMISSION_DENIED: 'Tài khoản dịch vụ chưa đủ quyền xóa tài nguyên.',
  DELETION_FAILED:
    'Xóa chưa hoàn tất. Kiểm tra cấu hình tài nguyên rồi thử lại.',
};

export interface TenantDeletionDependencies {
  database: Pick<TenantDatabaseDestruction, 'resourceKey' | 'inspect' | 'drop'>;
  storage: Pick<
    TenantStorageCleaner,
    'location' | 'inspect' | 'purge' | 'close'
  >;
  events: Pick<TenantEventCleaner, 'inspect' | 'purge'>;
  enabled: () => boolean;
  drainSeconds: () => number;
}

export function tenantDeletionDependencies(): TenantDeletionDependencies {
  return {
    database: new TenantDatabaseDestruction(),
    storage: new TenantStorageCleaner(),
    events: new TenantEventCleaner(
      process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672',
      process.env.RABBITMQ_MANAGEMENT_URL ?? '',
      [
        ...new Set([
          'maintenance.integrations.v1',
          'enterprise.events.dead',
          ...(process.env.TENANT_DELETION_QUEUES ?? '')
            .split(',')
            .map((queue) => queue.trim())
            .filter(Boolean),
        ]),
      ],
    ),
    enabled: () => process.env.TENANT_DELETION_ENABLED === 'true',
    drainSeconds: () => {
      const maxUpload = Number(process.env.TENANT_UPLOAD_MAX_DURATION_SECONDS);
      if (
        process.env.TENANT_UPLOAD_DEADLINE_ENFORCED !== 'true' ||
        !Number.isInteger(maxUpload) ||
        maxUpload < 1 ||
        maxUpload > 3600
      ) {
        throw new TenantDeletionError(503, 'UPLOAD_DRAIN_NOT_CONFIGURED');
      }
      return TENANT_UPLOAD_URL_TTL_SECONDS + maxUpload + 60;
    },
  };
}

/** Pure service shared by the Nest API and the existing Node worker. */
export class TenantDeletionService {
  private readonly pool: Pool;
  private readonly dependencies: TenantDeletionDependencies;
  constructor(
    pool: Pool,
    dependencies: TenantDeletionDependencies = tenantDeletionDependencies(),
  ) {
    this.pool = pool;
    this.dependencies = dependencies;
  }

  async authorize(
    principal: AuthenticatedPrincipal,
    csrf?: { header: string | undefined; cookie: string | undefined },
  ): Promise<void> {
    if (!principal || principal.kind !== 'platform-admin')
      throw new TenantDeletionError(403, 'FORBIDDEN');
    if (!uuid(principal.userId) || !uuid(principal.sessionId))
      throw new TenantDeletionError(401, 'UNAUTHORIZED');
    const result = await this.pool.query<{
      csrf_token_hash: string;
      permitted: boolean;
    }>(
      `SELECT s.csrf_token_hash, EXISTS (
         SELECT 1 FROM authorization_schema.user_roles ur
         JOIN authorization_schema.roles r ON r.id=ur.role_id AND r.scope='platform'
         JOIN authorization_schema.role_permissions rp ON rp.role_id=r.id
         JOIN authorization_schema.permissions p ON p.id=rp.permission_id AND p.key='platform.tenants.delete'
         WHERE ur.user_id=u.id AND ur.membership_id IS NULL) AS permitted
       FROM identity_schema.auth_sessions s JOIN identity_schema.users u ON u.id=s.user_id
       WHERE s.id=$1 AND u.id=$2 AND u.kind='platform-admin' AND u.status='active'
         AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [principal.sessionId, principal.userId],
    );
    const row = result.rows[0];
    if (!row) throw new TenantDeletionError(401, 'UNAUTHORIZED');
    if (!row.permitted) throw new TenantDeletionError(403, 'FORBIDDEN');
    if (
      csrf &&
      (!csrf.header ||
        csrf.header !== csrf.cookie ||
        hash(csrf.header) !== row.csrf_token_hash)
    )
      throw new TenantDeletionError(403, 'CSRF_INVALID');
  }

  async preview(
    tenantId: string,
    actor: AuthenticatedPrincipal,
  ): Promise<TenantDeletionPreview> {
    this.requireEnabled();
    await this.authorize(actor);
    this.dependencies.drainSeconds();
    const snapshot = await this.snapshot(tenantId);
    await this.dependencies.storage.inspect();
    await this.dependencies.events.inspect();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 300000);
    await this.pool.query(
      'DELETE FROM integration_schema.tenant_deletion_previews WHERE expires_at<now()',
    );
    await this.pool.query(
      `INSERT INTO integration_schema.tenant_deletion_previews
      (token_hash,tenant_id,actor_id,session_id,snapshot,expires_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        hash(token),
        tenantId,
        actor.userId,
        actor.sessionId,
        JSON.stringify(snapshot),
        expiresAt,
      ],
    );
    return {
      tenantId,
      slug: snapshot.slug,
      name: snapshot.name,
      databaseName: snapshot.target.databaseName,
      previewToken: token,
      expiresAt: expiresAt.toISOString(),
      backupPolicy:
        'Backup hết hạn theo chính sách lưu trữ; giữ nhật ký xóa tối thiểu.',
    };
  }

  async request(
    tenantId: string,
    input: RequestTenantDeletion,
    idempotencyKey: string,
    actor: AuthenticatedPrincipal,
    csrf: { header: string | undefined; cookie: string | undefined },
  ): Promise<TenantDeletionJob> {
    this.requireEnabled();
    await this.authorize(actor, csrf);
    if (
      !uuid(tenantId) ||
      !input ||
      typeof input.confirmSlug !== 'string' ||
      typeof input.previewToken !== 'string' ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey ?? '')
    )
      throw new TenantDeletionError(400, 'INVALID_REQUEST');
    const requestHash = hash(
      `${tenantId}|${input.confirmSlug}|${input.previewToken}`,
    );
    const existing = await this.pool.query<JobRow>(
      'SELECT * FROM integration_schema.tenant_deletion_jobs WHERE actor_id=$1 AND idempotency_key=$2',
      [actor.userId, idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash)
        throw new TenantDeletionError(409, 'IDEMPOTENCY_CONFLICT');
      return present(existing.rows[0]);
    }
    const currentJob = await this.pool.query<JobRow>(
      'SELECT * FROM integration_schema.tenant_deletion_jobs WHERE tenant_id=$1',
      [tenantId],
    );
    if (currentJob.rows[0]) return present(currentJob.rows[0]);
    const current = await this.snapshot(tenantId);
    const drain = this.dependencies.drainSeconds();
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query<TenantRow>(
        'SELECT * FROM tenancy_schema.tenants WHERE id=$1 FOR UPDATE',
        [tenantId],
      );
      if (!locked.rows[0])
        throw new TenantDeletionError(404, 'TENANT_NOT_FOUND');
      const duplicate = await client.query<JobRow>(
        'SELECT * FROM integration_schema.tenant_deletion_jobs WHERE tenant_id=$1',
        [tenantId],
      );
      if (duplicate.rows[0]) return present(duplicate.rows[0]);
      const previews = await client.query<{ snapshot: Snapshot }>(
        `SELECT snapshot FROM integration_schema.tenant_deletion_previews
        WHERE token_hash=$1 AND tenant_id=$2 AND actor_id=$3 AND session_id=$4 AND expires_at>now() FOR UPDATE`,
        [hash(input.previewToken), tenantId, actor.userId, actor.sessionId],
      );
      const config = await client.query<{ config_version: number }>(
        'SELECT config_version FROM tenancy_schema.tenant_db_configs WHERE tenant_id=$1 FOR UPDATE',
        [tenantId],
      );
      if (
        !previews.rows[0] ||
        fingerprint(previews.rows[0].snapshot) !== fingerprint(current) ||
        input.confirmSlug !== locked.rows[0].slug ||
        locked.rows[0].name !== current.name ||
        config.rows[0]?.config_version !== current.reference.configVersion
      )
        throw new TenantDeletionError(409, 'PREVIEW_EXPIRED');
      const job = await client.query<JobRow>(
        `INSERT INTO integration_schema.tenant_deletion_jobs
        (id,tenant_id,actor_id,idempotency_key,request_hash,status,snapshot,next_run_at)
        VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb,now()+($7 * interval '1 second')) RETURNING *`,
        [
          randomUUID(),
          tenantId,
          actor.userId,
          idempotencyKey,
          requestHash,
          JSON.stringify(current),
          drain,
        ],
      );
      await client.query(
        "UPDATE tenancy_schema.tenants SET status='deleting' WHERE id=$1",
        [tenantId],
      );
      await client.query(
        "UPDATE tenancy_schema.tenant_db_configs SET status='deleting' WHERE tenant_id=$1",
        [tenantId],
      );
      await client.query(
        'UPDATE identity_schema.tenant_auth_sessions SET revoked_at=now() WHERE tenant_id=$1 AND revoked_at IS NULL',
        [tenantId],
      );
      await client.query(
        `UPDATE identity_schema.auth_sessions SET revoked_at=now() WHERE user_id IN
        (SELECT user_id FROM tenancy_schema.tenant_memberships WHERE tenant_id=$1) AND revoked_at IS NULL`,
        [tenantId],
      );
      await client.query(
        'DELETE FROM identity_schema.tenant_password_reset_tokens WHERE tenant_id=$1',
        [tenantId],
      );
      await client.query(
        "UPDATE integration_schema.provisioning_jobs SET status='cancelled',completed_at=now() WHERE tenant_id=$1 AND status='pending'",
        [tenantId],
      );
      await client.query(
        'DELETE FROM integration_schema.tenant_deletion_previews WHERE tenant_id=$1',
        [tenantId],
      );
      await this.audit(client, job.rows[0], 'requested');
      return present(job.rows[0]);
    });
  }

  async list(actor: AuthenticatedPrincipal): Promise<TenantDeletionJob[]> {
    await this.authorize(actor);
    const result = await this.pool.query<JobRow>(
      `SELECT * FROM integration_schema.tenant_deletion_jobs ORDER BY created_at DESC LIMIT 500`,
    );
    return result.rows.map(present);
  }
  async get(
    id: string,
    actor: AuthenticatedPrincipal,
  ): Promise<TenantDeletionJob> {
    await this.authorize(actor);
    if (!uuid(id)) throw new TenantDeletionError(404, 'JOB_NOT_FOUND');
    const result = await this.pool.query<JobRow>(
      'SELECT * FROM integration_schema.tenant_deletion_jobs WHERE id=$1',
      [id],
    );
    if (!result.rows[0]) throw new TenantDeletionError(404, 'JOB_NOT_FOUND');
    return present(result.rows[0]);
  }
  async retry(
    id: string,
    actor: AuthenticatedPrincipal,
    csrf: { header: string | undefined; cookie: string | undefined },
  ): Promise<TenantDeletionJob> {
    this.requireEnabled();
    await this.authorize(actor, csrf);
    if (!uuid(id)) throw new TenantDeletionError(404, 'JOB_NOT_FOUND');
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<JobRow>(
        `SELECT * FROM integration_schema.tenant_deletion_jobs WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!result.rows[0]) throw new TenantDeletionError(404, 'JOB_NOT_FOUND');
      if (result.rows[0].status !== 'failed') return present(result.rows[0]);
      await client.query(
        "UPDATE tenancy_schema.tenants SET status='deleting' WHERE id=$1",
        [result.rows[0].tenant_id],
      );
      const updated = await client.query<JobRow>(
        "UPDATE integration_schema.tenant_deletion_jobs SET status='pending',error_code=NULL,next_run_at=now() WHERE id=$1 RETURNING *",
        [id],
      );
      await this.audit(
        client,
        { ...updated.rows[0], actor_id: actor.userId },
        'retried',
      );
      return present(updated.rows[0]);
    });
  }

  async processPending(): Promise<number> {
    // Disabling new requests must not strand already accepted deletions.
    const jobs = await this.pool
      .query<JobRow>(`SELECT * FROM integration_schema.tenant_deletion_jobs
      WHERE status IN ('pending','processing') AND next_run_at<=now() ORDER BY created_at LIMIT 5`);
    for (const candidate of jobs.rows) {
      const client = await this.pool.connect();
      let owned = true;
      const onError = () => {
        owned = false;
      };
      client.on('error', onError);
      const lockKey = `tenant-lifecycle:${candidate.tenant_id}`;
      let locked = false;
      try {
        const lock = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
          [lockKey],
        );
        locked = lock.rows[0].locked;
        if (!locked) continue;
        const claim = await client.query<JobRow>(
          `UPDATE integration_schema.tenant_deletion_jobs
          SET status='processing',attempts=attempts+1,heartbeat_at=now() WHERE id=$1 AND status IN ('pending','processing') AND next_run_at<=now() RETURNING *`,
          [candidate.id],
        );
        const job = claim.rows[0];
        if (!job) continue;
        const assertOwnership = async () => {
          if (!owned) throw new Error('LOCK_LOST');
          const heartbeat = await client.query(
            "UPDATE integration_schema.tenant_deletion_jobs SET heartbeat_at=now() WHERE id=$1 AND status='processing'",
            [job.id],
          );
          if (!owned || !heartbeat.rowCount) throw new Error('LOCK_LOST');
        };
        try {
          await this.process(job, client, assertOwnership);
        } catch (cause) {
          if (!owned) throw cause;
          const code = errorCode(cause);
          await client.query('BEGIN');
          try {
            await client.query(
              "UPDATE integration_schema.tenant_deletion_jobs SET status='failed',error_code=$2 WHERE id=$1",
              [job.id, code],
            );
            await client.query(
              "UPDATE tenancy_schema.tenants SET status='deletion_failed' WHERE id=$1",
              [job.tenant_id],
            );
            await this.audit(client, job, 'failed', code);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        }
        return 1;
      } finally {
        if (locked && owned)
          await client
            .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
              lockKey,
            ])
            .catch(() => {
              owned = false;
            });
        client.off('error', onError);
        client.release(!owned);
      }
    }
    return 0;
  }

  close(): void {
    this.dependencies.storage.close();
  }
  async onModuleDestroy(): Promise<void> {
    this.close();
    await this.pool.end();
  }

  private async process(
    job: JobRow,
    client: Client,
    assertOwnership: () => Promise<void>,
  ): Promise<void> {
    const snapshot = job.snapshot;
    if (snapshot.storageLocation !== this.dependencies.storage.location)
      throw new Error('STORAGE_CHANGED');
    await assertOwnership();
    if (job.step === 'quiesce') {
      // Reset processing jobs only after acquiring the same lock as provisioners.
      await client.query(
        "UPDATE integration_schema.provisioning_jobs SET status='cancelled',completed_at=now() WHERE tenant_id=$1 AND status IN ('pending','processing')",
        [job.tenant_id],
      );
      await this.advance(client, job, 'drop_database');
    } else if (job.step === 'drop_database') {
      await this.dependencies.database.drop(snapshot.target, assertOwnership);
      await this.advance(client, job, 'purge_storage');
    } else if (job.step === 'purge_storage') {
      await this.dependencies.storage.purge(job.tenant_id, assertOwnership);
      await this.advance(client, job, 'purge_integration');
    } else if (job.step === 'purge_integration') {
      // Lock pending Platform outbox rows against an in-flight relay before
      // inspecting broker queues. The relay also checks the tenant lifecycle.
      await client.query(
        `DELETE FROM integration_schema.inbox_messages WHERE event_id IN
        (SELECT id FROM integration_schema.outbox_events WHERE payload->>'tenantId'=$1)`,
        [job.tenant_id],
      );
      await client.query(
        "DELETE FROM integration_schema.outbox_events WHERE payload->>'tenantId'=$1",
        [job.tenant_id],
      );
      if (
        !(await this.dependencies.events.purge(job.tenant_id, assertOwnership))
      ) {
        await client.query(
          "UPDATE integration_schema.tenant_deletion_jobs SET status='pending',next_run_at=now()+interval '5 seconds' WHERE id=$1",
          [job.id],
        );
        return;
      }
      await this.advance(client, job, 'purge_platform');
    } else {
      // Recheck external resources before the final atomic metadata cleanup.
      await this.dependencies.database.drop(snapshot.target, assertOwnership);
      await this.dependencies.storage.purge(job.tenant_id, assertOwnership);
      if (
        !(await this.dependencies.events.purge(job.tenant_id, assertOwnership))
      ) {
        await client.query(
          "UPDATE integration_schema.tenant_deletion_jobs SET status='pending',next_run_at=now()+interval '5 seconds' WHERE id=$1",
          [job.id],
        );
        return;
      }
      await this.purgePlatform(client, job);
    }
  }

  private async purgePlatform(client: Client, job: JobRow): Promise<void> {
    await client.query('BEGIN');
    try {
      await client.query(
        'SELECT id FROM tenancy_schema.tenants WHERE id=$1 FOR UPDATE',
        [job.tenant_id],
      );
      const users = await client.query<{ id: string }>(
        `SELECT u.id FROM identity_schema.users u
        WHERE u.kind='tenant-user' AND EXISTS (SELECT 1 FROM tenancy_schema.tenant_memberships m WHERE m.user_id=u.id AND m.tenant_id=$1) FOR UPDATE`,
        [job.tenant_id],
      );
      await client.query(
        `DELETE FROM authorization_schema.user_roles WHERE membership_id IN
        (SELECT id FROM tenancy_schema.tenant_memberships WHERE tenant_id=$1)`,
        [job.tenant_id],
      );
      for (const table of [
        'identity_schema.tenant_password_reset_tokens',
        'identity_schema.tenant_auth_sessions',
        'tenancy_schema.tenant_admin_directory',
        'subscription_schema.tenant_entitlements',
        'subscription_schema.subscriptions',
        'integration_schema.provisioning_jobs',
        'integration_schema.tenant_deletion_previews',
        'tenancy_schema.tenant_memberships',
        'tenancy_schema.tenant_db_configs',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [
          job.tenant_id,
        ]);
      }
      for (const user of users.rows) {
        const remaining = await client.query(
          `SELECT 1 WHERE EXISTS (SELECT 1 FROM tenancy_schema.tenant_memberships WHERE user_id=$1)
          OR EXISTS (SELECT 1 FROM authorization_schema.user_roles WHERE user_id=$1)
          OR EXISTS (SELECT 1 FROM identity_schema.tenant_password_reset_tokens WHERE created_by=$1)`,
          [user.id],
        );
        if (remaining.rowCount) continue;
        await client.query(
          'DELETE FROM identity_schema.auth_sessions WHERE user_id=$1',
          [user.id],
        );
        await client.query(
          "DELETE FROM identity_schema.users WHERE id=$1 AND kind='tenant-user'",
          [user.id],
        );
      }
      await client.query(
        "DELETE FROM integration_schema.outbox_events WHERE payload->>'tenantId'=$1",
        [job.tenant_id],
      );
      await client.query(
        'DELETE FROM audit_schema.audit_logs WHERE tenant_id=$1',
        [job.tenant_id],
      );
      await client.query('DELETE FROM tenancy_schema.tenants WHERE id=$1', [
        job.tenant_id,
      ]);
      await client.query(
        "UPDATE integration_schema.tenant_deletion_jobs SET status='completed',completed_at=now(),snapshot='{}'::jsonb,error_code=NULL WHERE id=$1",
        [job.id],
      );
      await this.audit(client, job, 'completed');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  private async snapshot(tenantId: string): Promise<Snapshot> {
    if (!uuid(tenantId)) throw new TenantDeletionError(400, 'INVALID_REQUEST');
    const result = await this.pool.query<TenantRow>(
      `SELECT t.*,d.database_name,d.host,d.port,d.secret_ref,d.ssl,d.config_version
      FROM tenancy_schema.tenants t JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id=t.id WHERE t.id=$1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new TenantDeletionError(404, 'TENANT_NOT_FOUND');
    if (['deleting', 'deletion_failed'].includes(row.status))
      throw new TenantDeletionError(409, 'TENANT_DELETING');
    const reference = toReference(row);
    const key = this.dependencies.database.resourceKey(reference);
    const others = await this.pool.query<TenantRow>(
      `SELECT t.*,d.database_name,d.host,d.port,d.secret_ref,d.ssl,d.config_version
      FROM tenancy_schema.tenants t JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id=t.id WHERE t.id<>$1`,
      [tenantId],
    );
    for (const other of others.rows) {
      if (other.database_name === row.database_name)
        throw new TenantDeletionError(409, 'DATABASE_SHARED');
      // Resolve even differently named references; a secret may target this DB.
      if (this.dependencies.database.resourceKey(toReference(other)) === key)
        throw new TenantDeletionError(409, 'DATABASE_SHARED');
    }
    return {
      tenantId,
      slug: row.slug,
      name: row.name,
      reference,
      target: await this.dependencies.database.inspect(reference),
      storageLocation: this.dependencies.storage.location,
    };
  }
  private requireEnabled(): void {
    if (!this.dependencies.enabled())
      throw new TenantDeletionError(503, 'DELETION_DISABLED');
  }
  private async advance(
    client: Client,
    job: JobRow,
    step: TenantDeletionStep,
  ): Promise<void> {
    await client.query(
      "UPDATE integration_schema.tenant_deletion_jobs SET step=$2,status='pending',error_code=NULL,next_run_at=now(),heartbeat_at=now() WHERE id=$1",
      [job.id, step],
    );
  }
  private async audit(
    client: Client,
    job: JobRow,
    action: string,
    code?: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_schema.audit_logs(id,actor_id,tenant_id,action,metadata)
      VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        randomUUID(),
        job.actor_id,
        job.tenant_id,
        `platform.tenant.deletion.${action}`,
        JSON.stringify({
          jobId: job.id,
          step: job.step,
          ...(code ? { code } : {}),
          backupPolicy: 'expire-by-retention',
        }),
      ],
    );
  }
}

function toReference(row: TenantRow): TenantDatabaseReference {
  return {
    tenantId: row.id,
    databaseName: row.database_name,
    host: row.host,
    port: row.port,
    secretRef: row.secret_ref,
    ssl: row.ssl,
    configVersion: row.config_version,
  };
}
function fingerprint(snapshot: Snapshot): string {
  const r = snapshot.reference;
  const t = snapshot.target;
  return hash(
    JSON.stringify([
      snapshot.tenantId,
      snapshot.slug,
      snapshot.name,
      r.databaseName,
      r.host,
      r.port,
      r.secretRef,
      r.ssl,
      r.configVersion,
      t.databaseOid,
      t.clusterId,
      t.endpoint,
      snapshot.storageLocation,
    ]),
  );
}
function present(row: JobRow): TenantDeletionJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    step: row.step,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    nextRunAt: row.next_run_at.toISOString(),
    error: row.error_code
      ? (messages[row.error_code] ?? messages.DELETION_FAILED)
      : null,
    retryable: row.status === 'failed',
  };
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function uuid(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function errorCode(cause: unknown): string {
  if (cause instanceof TenantDeletionError) return cause.code;
  if (cause instanceof Error && messages[cause.message]) return cause.message;
  const code = (cause as { code?: string })?.code;
  if (code === '42501' || (cause as { name?: string })?.name === 'AccessDenied')
    return 'RESOURCE_PERMISSION_DENIED';
  if (code === '55006' || code === '55P03') return 'RESOURCE_BUSY';
  return 'DELETION_FAILED';
}
