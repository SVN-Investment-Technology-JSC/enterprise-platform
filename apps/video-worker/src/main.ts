import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createPostgresPool,
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import { RabbitMqConsumer } from '@enterprise-platform/adapter-events';
import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import { SOCIAL_VIDEO_EVENT_TYPES, SOCIAL_VIDEO_QUEUES } from '@enterprise-platform/contracts-social';
import { PostgresSocialVideoStore, SocialVideoProcessingService } from '@enterprise-platform/module-social';
import { readConfig } from './config.js';
import { FfmpegTranscoder } from './ffmpeg-transcoder.js';
import { cleanStaleWorkDirs } from './stale-work-dirs.js';
import { createVideoMessageHandler } from './video-message-handler.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* environment can be injected by the runtime */
}

const STALE_WORK_DIR_MS = 60 * 60 * 1000;
const SHUTDOWN_WAIT_MS = 20_000;
/** Việc tạm thời được giữ chưa ack và gửi lại sau chừng này (nhân theo số lần thử); video nặng nên chờ lâu hơn mặc định. */
const TRANSIENT_RETRY_DELAY_MS = 10_000;

const execFileAsync = promisify(execFile);
const config = readConfig(process.env);

/** Một dòng JSON, không ghi tên tệp hay nội dung người dùng. */
function logEvent(event: string, fields: Record<string, unknown> = {}, level: 'log' | 'warn' | 'error' = 'log') {
  console[level](JSON.stringify({ event, ...fields }));
}

async function ensureBinary(binary: string): Promise<void> {
  try {
    await execFileAsync(binary, ['-version'], { timeout: 15_000, windowsHide: true });
  } catch (error) {
    throw new Error(
      `Không chạy được "${binary}" (kiểm VIDEO_WORKER_FFMPEG_PATH / VIDEO_WORKER_FFPROBE_PATH): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

interface TenantDatabaseRow {
  readonly tenant_id: string;
  readonly database_name: string;
  readonly host: string;
  readonly port: number;
  readonly secret_ref: string;
  readonly ssl: boolean;
  readonly config_version: number;
}

async function main() {
  await ensureBinary(config.ffmpegPath);
  await ensureBinary(config.ffprobePath);
  const removed = await cleanStaleWorkDirs(config.tmpDir, STALE_WORK_DIR_MS);

  const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672';
  const platformPool = createPostgresPool(
    process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform',
  );
  const tenantPools = new PostgresPoolRegistry(undefined, {
    maxPools: Number(process.env.WORKER_MAX_TENANT_POOLS ?? 100),
    maxConnectionsPerPool: Number(process.env.WORKER_MAX_CONNECTIONS_PER_TENANT ?? 4),
  });
  const moduleDatabases = new TenantDatabaseRegistry();
  const storage = new S3ObjectStorage({
    internalEndpoint: process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://minio:9000',
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
  });

  const shutdownController = new AbortController();
  const processor = new SocialVideoProcessingService({
    store: new PostgresSocialVideoStore(moduleDatabases, tenantPools),
    storage,
    transcoder: new FfmpegTranscoder({
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      threads: config.ffmpegThreads,
    }),
    workDir: config.tmpDir,
    leaseSeconds: config.leaseSeconds,
    maxAttempts: config.maxAttempts,
    minFreeDiskBytes: Math.round(config.minFreeDiskGb * 1024 ** 3),
    log: (level, line) => console[level](line),
  });

  async function activeTenantDatabase(tenantId: string): Promise<TenantDatabaseReference | null> {
    const result = await platformPool.query<TenantDatabaseRow>(
      `SELECT d.tenant_id, d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.config_version
         FROM tenancy_schema.tenant_db_configs d
         JOIN tenancy_schema.tenants t ON t.id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.status = 'active' AND t.status = 'active'`,
      [tenantId],
    );
    const row = result.rows[0];
    return row
      ? {
          tenantId: row.tenant_id,
          databaseName: row.database_name,
          host: row.host,
          port: row.port,
          secretRef: row.secret_ref,
          ssl: row.ssl,
          configVersion: row.config_version,
        }
      : null;
  }

  async function moduleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    const result = await platformPool.query(
      `SELECT 1 FROM subscription_schema.tenant_entitlements e JOIN module_registry_schema.modules m ON m.id=e.module_id WHERE e.tenant_id=$1 AND e.status='active' AND m.key=$2 AND m.status='active'`,
      [tenantId, moduleKey],
    );
    return Boolean(result.rowCount);
  }

  // Không giữ khoá vòng đời tenant (withActiveTenant) suốt một lần chuyển mã: việc kéo dài hàng phút sẽ chặn migration
  // và xoá tenant. Tenant bị xoá giữa chừng thì service gặp lỗi DB và dịch vụ xử lý tự thu dọn.
  const handler = createVideoMessageHandler({
    processor,
    signal: shutdownController.signal,
    canProcess: async (tenantId) => {
      const database = await activeTenantDatabase(tenantId);
      if (!database) return false;
      if (!(await moduleEnabled(tenantId, 'social'))) return false;
      moduleDatabases.register(database);
      return true;
    },
  });

  const inFlight = new Set<Promise<void>>();
  const track = (message: Parameters<typeof handler>[0]) => {
    const run = handler(message);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    inFlight.add(settled);
    void settled.finally(() => inFlight.delete(settled));
    return run;
  };

  const consumers = (['comment', 'post'] as const).map(
    (purpose) =>
      new RabbitMqConsumer(rabbitUrl, {
        queue: SOCIAL_VIDEO_QUEUES[purpose],
        bindings: [SOCIAL_VIDEO_EVENT_TYPES[purpose]],
        prefetch: purpose === 'comment' ? config.commentConcurrency : config.postConcurrency,
        transientRetryDelayMs: TRANSIENT_RETRY_DELAY_MS,
      }),
  );

  logEvent('social.video_worker.started', {
    ffmpegThreads: config.ffmpegThreads,
    minFreeDiskGb: config.minFreeDiskGb,
    maxAttempts: config.maxAttempts,
    leaseSeconds: config.leaseSeconds,
    commentConcurrency: config.commentConcurrency,
    postConcurrency: config.postConcurrency,
    queues: consumers.length,
    staleWorkDirsRemoved: removed,
  });

  let stopping = false;
  async function shutdown(signalName: string) {
    if (stopping) return;
    stopping = true;
    logEvent('social.video_worker.stopping', { signal: signalName, inFlight: inFlight.size });
    // Ngừng nhận tin trước; tin chưa ack được broker giao lại cho worker kế tiếp.
    await Promise.allSettled(consumers.map((consumer) => consumer.close()));
    shutdownController.abort();
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref()),
    ]);
    await Promise.allSettled([tenantPools.closeAll(), platformPool.end()]);
  }
  for (const signalName of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signalName, () => {
      void shutdown(signalName).finally(() => process.exit(0));
    });
  }

  for (const consumer of consumers) {
    void consumer
      .start(track)
      .catch((error) =>
        logEvent(
          'social.video_worker.consumer_failed',
          { message: error instanceof Error ? error.message : 'Connection failed' },
          'error',
        ),
      );
  }
}

main().catch((error) => {
  logEvent('social.video_worker.start_failed', { message: error instanceof Error ? error.message : String(error) }, 'error');
  process.exit(1);
});
