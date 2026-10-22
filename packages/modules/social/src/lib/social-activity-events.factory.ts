import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { SocialActivityService, SOCIAL_ACTIVITY_EVENT_TYPES } from './application/social-activity.service.js';
import { HttpOrganizationDirectory } from './infrastructure/http-organization-directory.js';
import { PostgresSocialActivityStore } from './infrastructure/postgres-social-activity.store.js';

/** Hàng đợi và loại sự kiện worker bind cho bài tự sinh của Mạng nội bộ (`apps/worker/src/main.ts`). */
export const SOCIAL_INTEGRATION_QUEUE = 'social.integrations.v1';
export const SOCIAL_INTEGRATION_BINDINGS: readonly string[] = SOCIAL_ACTIVITY_EVENT_TYPES;

/** Cùng hình dạng với `LinkEventHandler` của Workspace để worker dùng chung `handleLinkEvent`. */
export interface SocialEventHandler {
  /** Bảng của phân hệ đã có ở tenant này chưa (migration đã chạy). */
  ready(tenantId: string): Promise<boolean>;
  handle(tenantId: string, type: string, payload: unknown): Promise<void>;
}

/**
 * Dựng bộ xử lý sự kiện của Mạng nội bộ ngoài Nest (worker), dùng chung registry DB của worker. Worker
 * chỉ gọi qua đây, không đọc bảng nào của social. Chịu được nhận trùng: mỗi người mỗi loại một bài mỗi
 * ngày nên xử lý lại không tạo bài thứ hai.
 */
export function createSocialActivityEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): SocialEventHandler {
  const activities = new SocialActivityService(
    new PostgresSocialActivityStore(references, pools),
    new HttpOrganizationDirectory(),
  );
  return {
    ready: async (tenantId) => {
      const pool = await pools.forTenant(references.require(tenantId));
      // Cột của migration 0003 (bài tự sinh) phải có thì mới ghi được.
      const result = await pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'social_schema' AND table_name = 'posts' AND column_name = 'activity_type'
         ) AS ready`,
      );
      return result.rows[0]?.ready === true;
    },
    handle: async (tenantId, type, payload) => {
      await activities.handleEvent(tenantId, type, payload);
    },
  };
}
