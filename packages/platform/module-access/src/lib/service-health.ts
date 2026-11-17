import { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  Controller,
  Get,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type Type,
} from '@nestjs/common';

/**
 * Healthcheck dùng chung cho API (ISS-OPS-014).
 *
 * - `live`: tiến trình còn sống, không chạm dịch vụ ngoài (luôn 200).
 * - `ready`: kiểm thật DB platform bằng `SELECT 1` và kênh RabbitMQ nếu service dùng; lỗi thì 503 để Docker và gateway
 *   biết service không phục vụ được.
 *
 * Healthcheck không đòi đăng nhập: `ModuleAccess.isHealthCheck` cho mọi đường `/health/live`, `/health/ready` đi qua.
 */

export const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const DEFAULT_PLATFORM_DATABASE_URL = 'postgresql://platform:platform@localhost:55432/platform';

export interface HealthDatabase {
  query(text: string): Promise<unknown>;
}

/** Kênh RabbitMQ: `RabbitMqConsumer.isReady()` thoả kiểu này. */
export interface HealthMessaging {
  isReady(): boolean;
}

export interface ServiceHealthDependencies {
  readonly database: HealthDatabase;
  readonly messaging?: HealthMessaging;
  readonly timeoutMs?: number;
}

export interface LiveResponse {
  readonly status: 'live';
  readonly service: string;
}

export interface ReadyResponse {
  readonly status: 'ready';
  readonly service: string;
}

export class ServiceHealth {
  constructor(
    private readonly service: string,
    private readonly dependencies: ServiceHealthDependencies,
  ) {}

  live(): LiveResponse {
    return { status: 'live', service: this.service };
  }

  async ready(): Promise<ReadyResponse> {
    try {
      await withTimeout(
        this.dependencies.database.query('SELECT 1'),
        this.dependencies.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS,
        'DB platform không trả lời kịp.',
      );
      const messaging = this.dependencies.messaging;
      if (messaging && !messaging.isReady()) throw new Error('Kênh RabbitMQ chưa sẵn sàng.');
      return { status: 'ready', service: this.service };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        service: this.service,
        reason: error instanceof Error ? error.message : 'Kiểm tra phụ thuộc thất bại.',
      });
    }
  }
}

/**
 * Kết nối DB platform riêng cho healthcheck: một connection, mở khi được hỏi lần đầu, không giữ tiến trình sống khi rảnh.
 */
export class PlatformDatabaseProbe implements HealthDatabase {
  private pool?: ReturnType<typeof createPostgresPool>;

  constructor(
    private readonly url: string = process.env.PLATFORM_DATABASE_URL ?? DEFAULT_PLATFORM_DATABASE_URL,
    private readonly timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS,
  ) {}

  async query(text: string): Promise<unknown> {
    this.pool ??= createPostgresPool(this.url, {
      max: 1,
      connectionTimeoutMillis: this.timeoutMs,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    });
    return this.pool.query(text);
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    await pool?.end();
  }
}

export interface HealthControllerOptions {
  /** Đường dẫn controller; mặc định `health` (`/<prefix>/health/live`, `/<prefix>/health/ready`). */
  readonly path?: string;
  /** Thay phụ thuộc trong test; mặc định DB platform theo `PLATFORM_DATABASE_URL`. */
  readonly dependencies?: () => ServiceHealthDependencies;
}

/**
 * Controller `GET health/live` và `GET health/ready` cho một service.
 *
 * @example controllers: [healthController('crm-api')]
 */
export function healthController(service: string, options: HealthControllerOptions = {}): Type<unknown> {
  @Controller(options.path ?? 'health')
  class HealthController implements OnModuleDestroy {
    private readonly dependencies: ServiceHealthDependencies = options.dependencies?.() ?? {
      database: new PlatformDatabaseProbe(),
    };
    private readonly health = new ServiceHealth(service, this.dependencies);

    @Get('live')
    live(): LiveResponse {
      return this.health.live();
    }

    @Get('ready')
    ready(): Promise<ReadyResponse> {
      return this.health.ready();
    }

    async onModuleDestroy(): Promise<void> {
      const { database } = this.dependencies;
      if (database instanceof PlatformDatabaseProbe) await database.close();
    }
  }
  return HealthController;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
