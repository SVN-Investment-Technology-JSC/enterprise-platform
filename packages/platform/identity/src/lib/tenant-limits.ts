import type { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  type LimitEnforcement,
  STORAGE_DEFAULT_QUOTA_GB,
  STORAGE_RESOURCE_KEY,
  type TenantLimitsResponse,
  type TenantResourceLimit,
} from '@enterprise-platform/contracts-tenancy';

type Pool = ReturnType<typeof createPostgresPool>;

export interface PlanLimitRow {
  readonly resource_key: string;
  readonly limit_value: number;
  readonly enforcement: LimitEnforcement;
  readonly plan_key: string;
}

export interface LimitAddonRow {
  readonly resource_key: string;
  readonly amount: number;
}

/** Mức áp khi tenant chưa gắn gói, hoặc gói chưa khai báo tài nguyên đó. */
const DEFAULT_LIMITS: Readonly<
  Record<string, { readonly value: number; readonly enforcement: LimitEnforcement }>
> = {
  [STORAGE_RESOURCE_KEY]: { value: STORAGE_DEFAULT_QUOTA_GB, enforcement: 'hard' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ghép hạn mức gói với gói mua thêm. Tài nguyên không có trong gói thì lấy mức
 * mặc định; gói mua thêm cho tài nguyên không có mức nền nào thì bỏ qua.
 */
export function resolveTenantLimits(
  tenantId: string,
  planRows: readonly PlanLimitRow[],
  addonRows: readonly LimitAddonRow[],
): TenantLimitsResponse {
  const keys = new Set([
    ...Object.keys(DEFAULT_LIMITS),
    ...planRows.map((row) => row.resource_key),
  ]);
  const limits = [...keys].sort().map((resourceKey): TenantResourceLimit => {
    const plan = planRows.find((row) => row.resource_key === resourceKey);
    const addOnValue = addonRows
      .filter((row) => row.resource_key === resourceKey)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    if (plan) {
      return {
        resourceKey,
        limitValue: Number(plan.limit_value) + addOnValue,
        enforcement: plan.enforcement,
        source: 'plan',
        planKey: plan.plan_key,
        addOnValue,
      };
    }
    const fallback = DEFAULT_LIMITS[resourceKey];
    return {
      resourceKey,
      limitValue: fallback.value + addOnValue,
      enforcement: fallback.enforcement,
      source: 'default',
      addOnValue,
    };
  });
  return { tenantId, limits };
}

/**
 * Hạn mức tài nguyên của tenant theo gói đang dùng, cộng gói mua thêm còn hiệu
 * lực. Phân hệ hỏi qua endpoint nội bộ; Platform không tự đo dung lượng.
 */
export class TenantLimitsService {
  constructor(private readonly pool: Pool) {}

  /** `null` khi tenant không tồn tại. */
  async limits(tenantId: string): Promise<TenantLimitsResponse | null> {
    if (!UUID.test(tenantId)) return null;
    const tenant = await this.pool.query('SELECT 1 FROM tenancy_schema.tenants WHERE id = $1', [
      tenantId,
    ]);
    if (!tenant.rowCount) return null;

    const [plans, addons] = await Promise.all([
      this.optional<PlanLimitRow>(
        `SELECT l.resource_key, l.limit_value, l.enforcement, p.key AS plan_key
           FROM subscription_schema.subscriptions s
           JOIN subscription_schema.plans p ON p.id = s.plan_id AND p.status = 'active'
           JOIN subscription_schema.plan_limits l ON l.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'`,
        [tenantId],
      ),
      this.optional<LimitAddonRow>(
        `SELECT resource_key, SUM(amount)::int AS amount
           FROM subscription_schema.tenant_limit_addons
          WHERE tenant_id = $1
            AND starts_on <= CURRENT_DATE
            AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)
          GROUP BY resource_key`,
        [tenantId],
      ),
    ]);
    return resolveTenantLimits(tenantId, plans, addons);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Bảng hạn mức chưa có (DB chưa chạy migration 0009) thì coi như chưa khai báo. */
  private async optional<T extends object>(sql: string, values: unknown[]): Promise<T[]> {
    try {
      return (await this.pool.query<T>(sql, values)).rows;
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    }
  }
}
