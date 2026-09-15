import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import amqp from 'amqplib';
import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  createPostgresPool,
  TenantDatabaseDestruction,
} from '@enterprise-platform/adapter-database';
import { TenantStorageCleaner } from '@enterprise-platform/adapter-storage';
import { TenantEventCleaner } from '@enterprise-platform/adapter-events';
import type {
  PlatformAdminPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import {
  TenantDeletionService,
  type TenantDeletionDependencies,
} from './tenant-deletion';

const testUrl = process.env.TENANT_DELETION_TEST_DATABASE_URL ?? '';
const integration = testUrl ? describe : describe.skip;

integration(
  'tenant deletion with isolated PostgreSQL, MinIO and RabbitMQ',
  () => {
    let pool: ReturnType<typeof createPostgresPool>;
    let admin: ReturnType<typeof createPostgresPool>;
    let service: TenantDeletionService;
    let dependencies: TenantDeletionDependencies;
    let s3: S3Client;
    let broker: Awaited<ReturnType<typeof amqp.connect>>;
    let channel: Awaited<ReturnType<typeof broker.createConfirmChannel>>;
    const actorId = randomUUID();
    const sessionId = randomUUID();
    const csrfValue = 'test-only-tenant-deletion-csrf';
    const csrf = { header: csrfValue, cookie: csrfValue };
    const bucket = `ep-deletion-test-${process.pid}-${randomUUID().slice(0, 8)}`;
    const queues = [
      `ep-deletion-test-${randomUUID()}`,
      `ep-deletion-dead-test-${randomUUID()}`,
    ];
    const databases: string[] = [];
    const roleId = randomUUID();
    const tenantRoleId = randomUUID();
    const actor: PlatformAdminPrincipal = {
      kind: 'platform-admin',
      userId: actorId,
      sessionId,
      email: 'test@example.invalid',
      displayName: 'Test',
      roles: [],
      permissions: [],
    };
    let target: {
      id: string;
      name: string;
      userId: string;
      membershipId: string;
    };
    let neighbour: typeof target;
    const originalEnvironment = {
      PLATFORM_DATABASE_URL: process.env.PLATFORM_DATABASE_URL,
      TENANT_DATABASE_URL_TEMPLATE: process.env.TENANT_DATABASE_URL_TEMPLATE,
    };

    beforeAll(async () => {
      // Refuse accidental use against the development or production databases.
      const url = new URL(testUrl);
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.pathname !== '/ep_deletion_platform'
      )
        throw new Error(
          'Use the isolated ep_deletion_platform test container.',
        );
      for (const key of [
        'TENANT_DELETION_TEST_S3_ENDPOINT',
        'TENANT_DELETION_TEST_AMQP_URL',
        'TENANT_DELETION_TEST_BROKER_HTTP',
      ]) {
        if (
          !['127.0.0.1', 'localhost'].includes(
            new URL(testEnvironment(key)).hostname,
          )
        )
          throw new Error('Only isolated local test services are allowed.');
      }
      pool = createPostgresPool(testUrl, { max: 8 });
      const adminUrl = new URL(url);
      adminUrl.pathname = '/postgres';
      admin = createPostgresPool(adminUrl.toString());
      process.env.PLATFORM_DATABASE_URL = testUrl;
      const template = new URL(url);
      template.pathname = '/{databaseName}';
      process.env.TENANT_DATABASE_URL_TEMPLATE = template
        .toString()
        .replace('%7BdatabaseName%7D', '{databaseName}');
      await pool.query(
        'DROP SCHEMA IF EXISTS identity_schema,tenancy_schema,authorization_schema,module_registry_schema,subscription_schema,audit_schema,integration_schema CASCADE',
      );
      for (const migration of [
        '0001-platform',
        '0003-platform-events',
        '0004-tenant-password-reset',
        '0005-drop-legacy-organization',
      ]) {
        await pool.query(
          await readFile(
            resolve(
              __dirname,
              '../../../../../migrations/platform',
              `${migration}.sql`,
            ),
            'utf8',
          ),
        );
      }
      await pool.query(
        "INSERT INTO authorization_schema.roles(id,key,name,scope) VALUES ($1,'platform-admin','Superadmin','platform'),($2,'tenant-admin','Tenant admin','tenant')",
        [roleId, tenantRoleId],
      );
      await pool.query(
        await readFile(
          resolve(
            __dirname,
            '../../../../../migrations/platform/0006-tenant-deletion.sql',
          ),
          'utf8',
        ),
      );
      await pool.query(
        "INSERT INTO identity_schema.users(id,email,display_name,password_hash,kind) VALUES ($1,'test@example.invalid','Test','unused','platform-admin')",
        [actorId],
      );
      await pool.query(
        "INSERT INTO authorization_schema.user_roles(user_id,role_id,membership_id,assignment_key) VALUES ($1,$2,NULL,'deletion-test-superadmin')",
        [actorId, roleId],
      );
      await pool.query(
        "INSERT INTO identity_schema.auth_sessions(id,user_id,refresh_token_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 hour')",
        [sessionId, actorId, digest(randomUUID()), digest(csrfValue)],
      );
      const options = {
        internalEndpoint: process.env.TENANT_DELETION_TEST_S3_ENDPOINT,
        region: 'us-east-1',
        bucket,
        accessKeyId: 'epdeletetest',
        secretAccessKey: 'ep_delete_test_only',
      };
      s3 = new S3Client({
        endpoint: options.internalEndpoint,
        region: options.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
      broker = await amqp.connect(
        testEnvironment('TENANT_DELETION_TEST_AMQP_URL'),
      );
      channel = await broker.createConfirmChannel();
      for (const queue of queues)
        await channel.assertQueue(queue, { durable: true });
      dependencies = {
        database: new TenantDatabaseDestruction(adminUrl.toString()),
        storage: new TenantStorageCleaner(options),
        events: new TenantEventCleaner(
          testEnvironment('TENANT_DELETION_TEST_AMQP_URL'),
          testEnvironment('TENANT_DELETION_TEST_BROKER_HTTP'),
          queues,
        ),
        enabled: () => true,
        drainSeconds: () => 0,
      };
      service = new TenantDeletionService(pool, dependencies);
      target = await tenant();
      neighbour = await tenant();
    }, 60000);

    afterAll(async () => {
      service?.close();
      s3?.destroy();
      await channel?.close();
      await broker?.close();
      for (const name of databases) {
        if (!/^ep_delete_test_[a-f0-9]+$/.test(name))
          throw new Error('Invalid test database cleanup target.');
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
      await admin?.end();
      await pool?.end();
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }, 30000);

    async function tenant() {
      const id = randomUUID();
      const name = `ep_delete_test_${id.replaceAll('-', '')}`;
      const userId = randomUUID();
      const membershipId = randomUUID();
      await admin.query(`CREATE DATABASE "${name}"`);
      databases.push(name);
      const fixture = new URL(testUrl);
      fixture.pathname = `/${name}`;
      const tenantPool = createPostgresPool(fixture.toString());
      try {
        await tenantPool.query(
          "CREATE SCHEMA core_schema; CREATE TABLE core_schema.sample(value text); INSERT INTO core_schema.sample VALUES ('keep tenant data')",
        );
      } finally {
        await tenantPool.end();
      }
      const endpoint = new URL(testUrl);
      await pool.query(
        'INSERT INTO tenancy_schema.tenants(id,slug,name) VALUES ($1,$2,$2)',
        [id, name],
      );
      await pool.query(
        'INSERT INTO tenancy_schema.tenant_db_configs(id,tenant_id,database_name,host,port,secret_ref) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          randomUUID(),
          id,
          name,
          endpoint.hostname,
          Number(endpoint.port),
          'EP_DELETION_TEST_SECRET_UNUSED',
        ],
      );
      await pool.query(
        "INSERT INTO identity_schema.users(id,email,display_name,password_hash,kind) VALUES ($1,$2,'Legacy','unused','tenant-user')",
        [userId, `${id}@example.invalid`],
      );
      await pool.query(
        'INSERT INTO tenancy_schema.tenant_memberships(id,tenant_id,user_id) VALUES ($1,$2,$3)',
        [membershipId, id, userId],
      );
      await pool.query(
        'INSERT INTO authorization_schema.user_roles(user_id,role_id,membership_id,assignment_key) VALUES ($1,$2,$3,$4)',
        [userId, tenantRoleId, membershipId, randomUUID()],
      );
      await pool.query(
        "INSERT INTO identity_schema.tenant_auth_sessions(id,tenant_id,core_user_id,refresh_token_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '1 hour')",
        [randomUUID(), id, userId, digest(randomUUID()), digest(csrfValue)],
      );
      return { id, name, userId, membershipId };
    }

    it('checks current superadmin permission, session and CSRF, never trusting claims', async () => {
      const tenantUser: TenantUserPrincipal = {
        ...actor,
        kind: 'tenant-user',
        tenantId: target.id,
        tenantSlug: target.name,
        membershipId: target.membershipId,
        permissions: ['platform.tenants.delete'],
      };
      await expect(service.authorize(tenantUser)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        service.authorize({ ...actor, sessionId: randomUUID() }),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        service.authorize(actor, { header: 'wrong', cookie: 'wrong' }),
      ).rejects.toMatchObject({ status: 403 });
      await pool.query(
        'UPDATE identity_schema.auth_sessions SET revoked_at=now() WHERE id=$1',
        [sessionId],
      );
      await expect(service.authorize(actor)).rejects.toMatchObject({
        status: 401,
      });
      await pool.query(
        'UPDATE identity_schema.auth_sessions SET revoked_at=NULL WHERE id=$1',
        [sessionId],
      );
      await pool.query(
        'DELETE FROM authorization_schema.user_roles WHERE user_id=$1',
        [actorId],
      );
      await expect(
        service.authorize({
          ...actor,
          permissions: ['platform.tenants.delete'],
        }),
      ).rejects.toMatchObject({ status: 403 });
      await pool.query(
        "INSERT INTO authorization_schema.user_roles(user_id,role_id,assignment_key) VALUES ($1,$2,'deletion-test-superadmin')",
        [actorId, roleId],
      );
      await expect(service.authorize(actor, csrf)).resolves.toBeUndefined();
      const leaked = await pool.query(
        `SELECT 1 FROM authorization_schema.role_permissions rp JOIN authorization_schema.permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.key='platform.tenants.delete'`,
        [tenantRoleId],
      );
      expect(leaked.rowCount).toBe(0);
    });

    it('rejects protected targets, mismatched secrets and stale preview without locking a tenant', async () => {
      const reference = {
        tenantId: target.id,
        databaseName: 'platform',
        host: '127.0.0.1',
        port: 5432,
        secretRef: 'EP_DELETION_TEST_SECRET_UNUSED',
        ssl: false,
        configVersion: 1,
      };
      expect(() => dependencies.database.resourceKey(reference)).toThrow(
        'DATABASE_PROTECTED',
      );
      expect(() =>
        dependencies.database.resourceKey({
          ...reference,
          databaseName: target.name,
          host: 'untrusted.invalid',
        }),
      ).toThrow('DATABASE_TARGET_MISMATCH');
      const preview = await service.preview(target.id, actor);
      await pool.query(
        'UPDATE tenancy_schema.tenant_db_configs SET config_version=config_version+1 WHERE tenant_id=$1',
        [target.id],
      );
      await expect(
        service.request(
          target.id,
          { confirmSlug: target.name, previewToken: preview.previewToken },
          randomUUID(),
          actor,
          csrf,
        ),
      ).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
      expect(
        (
          await pool.query(
            'SELECT status FROM tenancy_schema.tenants WHERE id=$1',
            [target.id],
          )
        ).rows[0].status,
      ).toBe('active');
    });

    it('does not complete queue cleanup while a consumer holds an unacknowledged message', async () => {
      const tenantId = randomUUID();
      channel.sendToQueue(
        queues[0],
        Buffer.from(JSON.stringify({ tenantId })),
        { persistent: true },
      );
      await channel.waitForConfirms();
      const held = await channel.get(queues[0], { noAck: false });
      if (!held) throw new Error('Expected the held test message.');
      expect(
        await dependencies.events.purge(tenantId, async () => undefined),
      ).toBe(false);
      channel.nack(held, false, true);
      // The channel RPC acts as a barrier after the nack, without a timed sleep.
      await channel.checkQueue(queues[0]);
      expect(
        await dependencies.events.purge(tenantId, async () => undefined),
      ).toBe(true);
      expect(await channel.get(queues[0], { noAck: true })).toBe(false);
    });

    it('refuses a replacement database that reuses the confirmed name', async () => {
      const id = randomUUID();
      const name = `ep_delete_test_${id.replaceAll('-', '')}`;
      databases.push(name);
      await admin.query(`CREATE DATABASE "${name}"`);
      const endpoint = new URL(testUrl);
      const snapshot = await dependencies.database.inspect({
        tenantId: id,
        databaseName: name,
        host: endpoint.hostname,
        port: Number(endpoint.port),
        secretRef: 'EP_DELETION_TEST_SECRET_UNUSED',
        ssl: false,
        configVersion: 1,
      });
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.query(`CREATE DATABASE "${name}"`);
      await expect(
        dependencies.database.drop(snapshot, async () => undefined),
      ).rejects.toThrow('DATABASE_IDENTITY_CHANGED');
      expect(
        (
          await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            name,
          ])
        ).rowCount,
      ).toBe(1);
    });

    it('paginates more than 1000 unversioned objects and keeps a neighbouring prefix', async () => {
      const Bucket = `${bucket}-plain`;
      const id = randomUUID();
      await s3.send(new CreateBucketCommand({ Bucket }));
      for (let offset = 0; offset < 1001; offset += 25) {
        await Promise.all(
          Array.from({ length: Math.min(25, 1001 - offset) }, (_, index) =>
            s3.send(
              new PutObjectCommand({
                Bucket,
                Key: `tenants/${id}/${offset + index}`,
                Body: 'test',
              }),
            ),
          ),
        );
      }
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key: `tenants/${id}-other/keep`,
          Body: 'keep',
        }),
      );
      const cleaner = new TenantStorageCleaner({
        internalEndpoint: testEnvironment('TENANT_DELETION_TEST_S3_ENDPOINT'),
        region: 'us-east-1',
        bucket: Bucket,
        accessKeyId: 'epdeletetest',
        secretAccessKey: 'ep_delete_test_only',
      });
      try {
        await cleaner.purge(id, async () => undefined);
        const remaining = await s3.send(new ListObjectsV2Command({ Bucket }));
        expect(remaining.Contents?.map(({ Key }) => Key)).toEqual([
          `tenants/${id}-other/keep`,
        ]);
      } finally {
        cleaner.close();
      }
    }, 60000);

    it('locks once, survives worker restart and a partial failure, and removes only the selected tenant', async () => {
      const exclusiveId = randomUUID();
      const exclusiveMembership = randomUUID();
      await pool.query(
        "INSERT INTO identity_schema.users(id,email,display_name,password_hash,kind) VALUES ($1,$2,'Exclusive','unused','tenant-user')",
        [exclusiveId, `${exclusiveId}@example.invalid`],
      );
      await pool.query(
        'INSERT INTO tenancy_schema.tenant_memberships(id,tenant_id,user_id) VALUES ($1,$2,$3)',
        [exclusiveMembership, target.id, exclusiveId],
      );
      await pool.query(
        'INSERT INTO authorization_schema.user_roles(user_id,role_id,membership_id,assignment_key) VALUES ($1,$2,$3,$4)',
        [exclusiveId, tenantRoleId, exclusiveMembership, randomUUID()],
      );
      await pool.query(
        "INSERT INTO identity_schema.auth_sessions(id,user_id,refresh_token_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 hour')",
        [randomUUID(), exclusiveId, digest(randomUUID()), digest(csrfValue)],
      );
      const probeId = randomUUID();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `tenants/${probeId}/probe`,
          Body: 'cleanup probe',
        }),
      );
      await dependencies.storage.purge(probeId, async () => undefined);
      const key = `tenants/${target.id}/procedure/document`;
      const neighbourKey = `tenants/${neighbour.id}/inventory/keep`;
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'old version' }),
      );
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'new version' }),
      );
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: neighbourKey,
          Body: 'keep',
        }),
      );
      await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: `tenants/${target.id}/unfinished`,
        }),
      );
      for (const queue of queues) {
        for (const tenantId of [target.id, neighbour.id])
          channel.sendToQueue(
            queue,
            Buffer.from(JSON.stringify({ tenantId, value: 'payload' })),
            { persistent: true, messageId: randomUUID() },
          );
      }
      await channel.waitForConfirms();
      // A legacy identity shared with the neighbour must survive deletion.
      await pool.query(
        'INSERT INTO tenancy_schema.tenant_memberships(id,tenant_id,user_id) VALUES ($1,$2,$3)',
        [randomUUID(), neighbour.id, target.userId],
      );
      const preview = await service.preview(target.id, actor);
      const input = {
        confirmSlug: preview.slug,
        previewToken: preview.previewToken,
      };
      const requestId = randomUUID();
      await expect(
        service.request(
          target.id,
          { ...input, confirmSlug: 'wrong' },
          requestId,
          actor,
          csrf,
        ),
      ).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
      const job = await service.request(
        target.id,
        input,
        requestId,
        actor,
        csrf,
      );
      expect(
        (await service.request(target.id, input, requestId, actor, csrf)).id,
      ).toBe(job.id);
      await expect(
        service.request(
          target.id,
          { ...input, confirmSlug: 'other' },
          requestId,
          actor,
          csrf,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(
        pool.query(
          "UPDATE tenancy_schema.tenants SET status='active' WHERE id=$1",
          [target.id],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        pool.query(
          'INSERT INTO identity_schema.tenant_auth_sessions(id,tenant_id,core_user_id,refresh_token_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$4,$5,now())',
          [
            randomUUID(),
            target.id,
            target.userId,
            digest(randomUUID()),
            digest('csrf'),
          ],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      const lock = await pool.connect();
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        `tenant-lifecycle:${target.id}`,
      ]);
      expect(await service.processPending()).toBe(0);
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
        `tenant-lifecycle:${target.id}`,
      ]);
      lock.release();
      await service.processPending(); // quiesce
      await service.processPending(); // DROP
      expect(
        (
          await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            target.name,
          ])
        ).rowCount,
      ).toBe(0);
      const failing = new TenantDeletionService(pool, {
        ...dependencies,
        storage: {
          ...dependencies.storage,
          location: dependencies.storage.location,
          inspect: async () => undefined,
          close: () => undefined,
          purge: async () => {
            throw new Error('STORAGE_DELETE_INCOMPLETE');
          },
        },
      });
      await failing.processPending();
      expect((await service.get(job.id, actor)).status).toBe('failed');
      expect(
        (
          await pool.query(
            'SELECT status FROM tenancy_schema.tenants WHERE id=$1',
            [target.id],
          )
        ).rows[0].status,
      ).toBe('deletion_failed');
      await service.retry(job.id, actor, csrf);
      const restarted = new TenantDeletionService(pool, dependencies);
      for (let attempt = 0; attempt < 12; attempt++) {
        await restarted.processPending();
        if ((await service.get(job.id, actor)).status === 'completed') break;
        await pool.query(
          'UPDATE integration_schema.tenant_deletion_jobs SET next_run_at=now() WHERE id=$1',
          [job.id],
        );
      }
      const completed = await service.get(job.id, actor);
      expect(completed.status).toBe('completed');
      expect(
        (
          await pool.query('SELECT 1 FROM identity_schema.users WHERE id=$1', [
            exclusiveId,
          ])
        ).rowCount,
      ).toBe(0);
      expect((await service.retry(job.id, actor, csrf)).status).toBe(
        'completed',
      );
      expect(
        (
          await pool.query('SELECT 1 FROM tenancy_schema.tenants WHERE id=$1', [
            target.id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT snapshot FROM integration_schema.tenant_deletion_jobs WHERE id=$1',
            [job.id],
          )
        ).rows[0].snapshot,
      ).toEqual({});
      expect(
        (
          await pool.query('SELECT 1 FROM identity_schema.users WHERE id=$1', [
            target.userId,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query('SELECT 1 FROM tenancy_schema.tenants WHERE id=$1', [
            neighbour.id,
          ])
        ).rowCount,
      ).toBe(1);
      const versions = await s3.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: `tenants/${target.id}/`,
        }),
      );
      expect(versions.Versions ?? []).toHaveLength(0);
      expect(versions.DeleteMarkers ?? []).toHaveLength(0);
      expect(
        (
          await s3.send(
            new ListMultipartUploadsCommand({
              Bucket: bucket,
              Prefix: `tenants/${target.id}/`,
            }),
          )
        ).Uploads ?? [],
      ).toHaveLength(0);
      expect(
        await (
          await s3.send(
            new GetObjectCommand({ Bucket: bucket, Key: neighbourKey }),
          )
        ).Body?.transformToString(),
      ).toBe('keep');
      for (const queue of queues) {
        const retained = await channel.get(queue, { noAck: true });
        expect(
          retained && JSON.parse(retained.content.toString()).tenantId,
        ).toBe(neighbour.id);
        expect(await channel.get(queue, { noAck: true })).toBe(false);
      }
      const neighbourUrl = new URL(testUrl);
      neighbourUrl.pathname = `/${neighbour.name}`;
      const neighbourPool = createPostgresPool(neighbourUrl.toString());
      try {
        expect(
          (await neighbourPool.query('SELECT value FROM core_schema.sample'))
            .rows[0].value,
        ).toBe('keep tenant data');
      } finally {
        await neighbourPool.end();
      }
    }, 60000);
  },
);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function testEnvironment(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing isolated test configuration: ${key}`);
  return value;
}
